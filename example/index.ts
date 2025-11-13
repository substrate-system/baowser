import { type FunctionComponent, render } from 'preact'
import { html } from 'htm/preact'
import { useRef, useEffect } from 'preact/hooks'
import { blake3 } from '@nichoth/hash-wasm'
import { type Signal, signal, useComputed } from '@preact/signals'
import { humanBytes } from '@substrate-system/human-bytes'
import llamaBase64 from './llama.jpg.base64'
import { encode, createVerifier, type EncodedMetadata } from '../src/index'
import '@substrate-system/css-normalize'

const EM_DASH = '\u2014'
const NBSP = '\u00A0'

interface LogEntry {
    message:string
    type:'info'|'hash'|'success'|'error'
    timestamp:Date
}

interface Stats {
    fileSize:number
    chunkSize:number
    chunkCount:number
}

const state:{
    chunkSize:Signal<number>;
    encodedData:Signal<EncodedMetadata|null>;
    logs:Signal<LogEntry[]>;
    stats:Signal<Stats|null>;
    isEncoding:Signal<boolean>;
    isVerifying:Signal<boolean>;
    base64Text:Signal<string>;
} = {
    chunkSize: signal(1024),
    encodedData: signal(null),
    logs: signal([]),
    stats: signal(null),
    isEncoding: signal(false),
    isVerifying: signal(false),
    base64Text: signal(llamaBase64),
}

const Example:FunctionComponent = function () {
    const logContainerRef = useRef<HTMLDivElement>(null)

    const stats = useComputed(() => {
        return state.stats.value
    })

    // Auto-scroll logs
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop =
                logContainerRef.current.scrollHeight
        }
    }, [state.logs.value])

    return html`<div class="container">
        <h1>Bao/BLAKE3 Streaming Demo</h1>

        <p class="subtitle">
            Streaming verification using the browser's
            native Streams API with BLAKE3 hashes.
        </p>

        <p>
            Below is the image we are transferring. On the right is the same
            image as <code>base64-encoded</code> text.
        </p>

        <p>
            The initial hash is always created of the "real" base64
            string ${EM_DASH} the image on the left. The "Download & Verify"
            button streams the base64 data in the <code>textarea</code> below
            on the right. That way you can${NBSP}
            <strong>change a character and see the verification fail</strong>.
        </p>

        <p>
            This module exposes a <a href="https://developer.mozilla.org/en-US/docs/Web/API/Streams_API">
                browser streams API
            </a> interface for verification. You can fetch something and then
            "pipe" it through this module to verify the download as
            it is transfering.
        </p>

        <div class="content-preview">
            <div class="preview-item">
                <img src=${llamaBase64} alt="Llama" />
                <p class="preview-label">llama.jpg</p>
            </div>
            <div class="preview-item">
                <textarea
                    value=${state.base64Text.value}
                    onInput=${handleTextareaChange}
                    spellcheck=${false}
                    disabled=${state.isEncoding.value || state.isVerifying.value}
                ></textarea>
                <p class="preview-label">Base64 Text (editable)</p>
            </div>
        </div>

        <div class="controls">
            <label>
                Chunk Size:
                <select
                    value=${state.chunkSize.value}
                    onChange=${handleChunkSizeChange}
                    disabled=${state.isEncoding.value || state.isVerifying.value}
                >
                    <option value="512">512 bytes (more chunks)</option>
                    <option value="1024">1024 bytes (default)</option>
                    <option value="2048">2048 bytes (fewer chunks)</option>
                    <option value="4096">4096 bytes (even fewer)</option>
                </select>
            </label>

            <button
                onClick=${encodeFile}
                disabled=${state.isEncoding.value || state.isVerifying.value}
            >
                ${state.isEncoding.value ? 'Encoding...' : 'Encode File'}
            </button>
            <button
                onClick=${verifyFile}
                disabled=${
                    !state.encodedData.value ||
                    state.isVerifying.value ||
                    state.isEncoding.value
                }
            >
                ${state.isVerifying.value ? 'Verifying...' : 'Download & Verify'}
            </button>
            <button
                onClick=${clearLog}
                disabled=${state.isEncoding.value || state.isVerifying.value}
            >
                Clear Log
            </button>
        </div>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-label">File Size</div>
                <div class="stat-value">
                    ${stats.value ? humanBytes(stats.value.fileSize) : 'null'}
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Chunk Size</div>
                <div
                    class="stat-value"
                >
                    ${stats.value?.chunkSize ?
                        stats.value.chunkSize + ' bytes' :
                        'null'
                    }
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Chunks</div>
                <div class="stat-value">
                    ${stats.value?.chunkCount || 'null'}
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Overhead</div>
                <div class="stat-value">
                    ${stats.value ? (
                        (stats.value.chunkCount * 64 / stats.value.fileSize) *
                        100
                    ).toFixed(1) + '%' : 'null'}
                </div>
            </div>
        </div>
       
        <div class="root-hash">
            <pre>
                root hash: ${state.encodedData.value?.rootHash ?
                    state.encodedData.value.rootHash :
                    '-'
                }
            </pre>
        </div>

        <div class="log-container" ref=${logContainerRef}>
            ${state.logs.value.map((entry, i) => html`
                <div key=${i} class="log-entry log-${entry.type}">
                    [${entry.timestamp.toLocaleTimeString()}] ${entry.message}
                </div>
            `)}
        </div>
    </div>`
}

render(html`<${Example} />`, document.getElementById('root')!)

async function verifyFile () {
    if (!state.encodedData.value) return

    clearLog()
    state.isVerifying.value = true

    try {
        const metadata = state.encodedData.value
        addLog(
            '=== Starting Verified Streaming Download ===',
            'info'
        )
        addLog(`Expected root hash: ${metadata.rootHash}`, 'hash')
        addLog(`Total chunks to download: ${metadata.chunks.length}`, 'info')
        addLog('', 'info')

        // Get the client's base64 text (potentially modified)
        const clientBase64 = state.base64Text.value
        const encoder = new TextEncoder()
        const clientData = encoder.encode(clientBase64)

        addLog(`Client base64 text size: ${clientData.length} bytes`, 'info')
        addLog('', 'info')
        addLog('Creating stream and verifier...', 'info')

        // Create a ReadableStream that simulates downloading chunks
        const downloadStream = new ReadableStream<Uint8Array>({
            async start (controller) {
                addLog('Stream started', 'info')

                for (let i = 0; i < metadata.chunks.length; i++) {
                    // Simulate network delay
                    await new Promise(resolve => setTimeout(resolve, 5))

                    const chunkOffset = i * metadata.chunkSize
                    const chunkEnd = Math.min(
                        chunkOffset + metadata.chunkSize,
                        clientData.length
                    )
                    const chunk = clientData.slice(chunkOffset, chunkEnd)

                    // Push chunk to stream
                    controller.enqueue(chunk)
                }

                controller.close()
            }
        })

        // Pipe through verifier
        const verifiedChunks:Uint8Array[] = []
        const verifier = createVerifier(metadata, {
            onChunkVerified: (chunkIndex, totalChunks) => {
                // Only log every 50 chunks to avoid overwhelming the log
                if (
                    chunkIndex % 50 === 0 ||
                    chunkIndex === totalChunks
                ) {
                    addLog('', 'info')
                    addLog(
                        `--- Chunk ${chunkIndex}/${totalChunks} ---`,
                        'info'
                    )
                    addLog('Chunk verified and buffered', 'success')
                }
            },
            onError: (err) => {
                addLog(`Verification error: ${err.message}`, 'error')
            }
        })

        const verifiedStream = downloadStream.pipeThrough(verifier)
        const reader = verifiedStream.getReader()

        // Read verified chunks
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            verifiedChunks.push(value)
        }

        addLog('', 'info')
        addLog('=== Finalizing Verification ===', 'info')

        // Combine all chunks
        const totalLength = verifiedChunks.reduce(
            (sum, c) => sum + c.length,
            0
        )
        const fullFile = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of verifiedChunks) {
            fullFile.set(chunk, offset)
            offset += chunk.length
        }

        addLog(`Reconstructed file size: ${fullFile.length} bytes`, 'info')

        // Verify root hash
        addLog('', 'info')
        addLog('Verifying root hash...', 'info')
        const computedRootHash = await blake3(fullFile)
        addLog(`Expected: ${metadata.rootHash}`, 'hash')
        addLog(`Computed: ${computedRootHash}`, 'hash')

        if (computedRootHash !== metadata.rootHash) {
            throw new Error(
                'Root hash mismatch! File integrity check failed.'
            )
        }

        addLog('', 'info')
        addLog(
            'File verified authentic and complete',
            'success'
        )
        addLog('', 'info')
        addLog(
            'Each chunk was verified as it streamed through.',
            'info'
        )
    } catch (error) {
        addLog('', 'info')
        addLog(`Error: ${(error as Error).message}`, 'error')
    } finally {
        state.isVerifying.value = false
    }
}

function addLog (message:string, type:LogEntry['type'] = 'info') {
    state.logs.value = [...state.logs.value, {
        message,
        type,
        timestamp: new Date()
    }]
}

function clearLog () {
    state.logs.value = []
}

async function encodeFile () {
    clearLog()
    state.isEncoding.value = true

    try {
        addLog('Encoding llama.jpg base64 text...', 'info')

        // Hash the original base64 string from the server
        const serverBase64 = llamaBase64
        const encoder = new TextEncoder()
        const serverData = encoder.encode(serverBase64)

        addLog(`Base64 text size: ${serverData.length} bytes`, 'info')
        addLog(`Chunk size: ${state.chunkSize.value} bytes`, 'info')

        // Use the streaming API's encode function
        addLog('', 'info')
        addLog('Encoding with streaming API...', 'info')
        const metadata = await encode(serverData, state.chunkSize.value)

        addLog(`Root hash: ${metadata.rootHash}`, 'hash')
        addLog('', 'info')
        addLog(`Encoded ${metadata.chunks.length} chunks successfully`, 'success')

        state.encodedData.value = metadata
        state.stats.value = {
            fileSize: metadata.fileSize,
            chunkSize: metadata.chunkSize,
            chunkCount: metadata.chunks.length
        }
    } catch (error) {
        addLog(`✗ Error: ${(error as Error).message}`, 'error')
    } finally {
        state.isEncoding.value = false
    }
}

function handleChunkSizeChange (ev:Event) {
    const target = ev.target as HTMLSelectElement
    state.chunkSize.value = parseInt(target.value)
    state.encodedData.value = null
    state.stats.value = null
}

function handleTextareaChange (ev:Event) {
    const target = ev.target as HTMLTextAreaElement
    state.base64Text.value = target.value
}
