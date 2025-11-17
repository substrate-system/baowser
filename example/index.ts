import { type FunctionComponent, render } from 'preact'
import { html } from 'htm/preact'
import Route from 'route-event'
import { useRef, useEffect } from 'preact/hooks'
import { blake3 } from '@nichoth/hash-wasm'
import { type Signal, signal, useComputed } from '@preact/signals'
import { humanBytes } from '@substrate-system/human-bytes'
import llamaBase64 from './llama.jpg.base64'
import {
    encode,
    createVerifier,
    createEncoder,
    getRootLabel,
    type EncodedMetadata
} from '../src/index'
import Debug from '@substrate-system/debug'
import '@substrate-system/css-normalize'
// import '@substrate-system/a11y/reduced-motion'

const debug = Debug(import.meta.env.DEV)
debug('logging')

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
    babData:Signal<{
        rootLabel:string,
        encodedStream:ReadableStream<Uint8Array<ArrayBufferLike>>
    }|null>;
    logs:Signal<LogEntry[]>;
    stats:Signal<Stats|null>;
    isEncoding:Signal<boolean>;
    isVerifying:Signal<boolean>;
    base64Text:Signal<string>;
    path:Signal<string>;
} = {
    path: signal(location.pathname),
    chunkSize: signal(1024),
    encodedData: signal(null),
    babData: signal(null),
    logs: signal([]),
    stats: signal(null),
    isEncoding: signal(false),
    isVerifying: signal(false),
    base64Text: signal(llamaBase64),
}

if (import.meta.env.DEV || import.meta.env.MODE === 'staging') {
    // @ts-expect-error dev
    window.state = state
}

const onRoute = Route()

/**
 * Client-side routing
 */
onRoute((path, data) => {
    state.path.value = path

    // handle scroll state like a web browser
    // (restore scroll position on back/forward)
    if (data.popstate) {
        return window.scrollTo(data.scrollX, data.scrollY)
    }
})

const routes = [
    {
        path: '/',
        text: 'External Metadata'
    },
    {
        path: '/single-stream',
        text: 'Single Stream'
    }
]

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
        <h1>
            Baowser${NBSP}
            <a href="https://github.com/substrate-system/baowser">
                github.com/substrate-system/baowser
            </a>
        </h1>

        <p class="subtitle">
            Verify data using the${NBSP}
            <a href="https://developer.mozilla.org/en-US/docs/Web/API/Streams_API">
                web streams API
            </a>${NBSP}
            and <a href="https://github.com/oconnor663/blake3-js">
                BLAKE3 hashes
            </a> in the browser.
        </p>

        <p>
            Below is the image we are transferring. Below on the right is the
            same image, <code>base64-encoded</code> to a string.
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
            </a> interface. You can fetch something and then
            "pipe" it through this module to verify the download is correct as
            it is streaming.
        </p>

        <hr />

        <nav class="routes">
            <ul>
                ${routes.map(r => {
                    return html`<li class="nav${r.path === state.path.value ? ' active' : ''}">
                        <a href="${r.path}">${r.text}</a>
                    </li>`
                })}
            </ul>
        </nav>

        <div class="explanation">
            <${Explanation} route=${state.path.value} />
        </div>

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
                    (!state.encodedData.value && !state.babData.value) ||
                    state.isVerifying.value ||
                    state.isEncoding.value
                }
            >
                ${state.isVerifying.value ?
                    'Verifying...' :
                    `Download & Verify ${EM_DASH} ${getRoute()?.text}`
                }
            </button>
            <button
                onClick=${clearLog}
                disabled=${state.isEncoding.value || state.isVerifying.value}
            >
                Clear Log
            </button>
        </div>

        <div class="explanation">
            ${state.path.value.includes('/single-stream') ?
                html`<p>
                    All verification data is included in the stream.
                    You only need to know the root hash, and then you can
                    veryify the chunks as they arrive.
                </p>
                ` :
                html`<p>
                    Here verification metadata is created as an external object.
                    We create a transform stream with <code>
                        createVerifier(metadata)
                    </code>,${NBSP}
                    and the stream uses the expected chunk size from the metadata
                    to split the input into chunks, then it compares the computed
                    hash with the hash for that chunk in the metadata.
                </p>
                <p>
                    If the hash is ok, it passes the chunk along through the
                    stream and calls the <code>onChunkVerified</code> callback.
                </p>
                <p>
                    If the hash does not match, it throws an error and aborts
                    the stream. So we stop downloading on hash mismatch.
                </p>
                `

            }
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
                root hash: ${state.encodedData.value?.rootHash ||
                    state.babData.value?.rootLabel ||
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
    if (!state.encodedData.value && !state.babData.value) return

    clearLog()
    state.isVerifying.value = true

    try {
        const isSingleStream = state.path.value.includes('/single-stream')

        if (isSingleStream && state.babData.value) {
            // Bab mode: decode and verify single stream
            const { rootLabel } = state.babData.value
            addLog(
                '=== Starting Bab Stream Verification ===',
                'info'
            )
            addLog(`Expected root label: ${rootLabel}`, 'hash')
            addLog('', 'info')

            // Get the client's base64 text and encode it to a Bab stream
            addLog('Encoding textarea content to stream...', 'info')
            const clientBase64 = state.base64Text.value
            const encoder = new TextEncoder()
            const clientData = encoder.encode(clientBase64)

            // Create a ReadableStream from the data
            const clientDataStream = new ReadableStream({
                start (controller) {
                    controller.enqueue(clientData)
                    controller.close()
                }
            })

            // Encode the data into a Bab stream
            const encodedStream = createEncoder(
                state.chunkSize.value,
                clientDataStream
            )

            // Read the encoded stream into chunks to simulate download
            const reader = encodedStream.getReader()
            const encodedChunks:Uint8Array[] = []
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    encodedChunks.push(value)
                }
            } finally {
                reader.releaseLock()
            }

            addLog('Creating download stream with delays...', 'info')

            // throttled stream to simulate network download
            const DOWNLOAD_CHUNK_SIZE = 16384 // 16KB chunks
            const streamToVerify = new ReadableStream({
                async start (controller) {
                    for (const chunk of encodedChunks) {
                        // Split each chunk into smaller pieces
                        for (
                            let offset = 0;
                            offset < chunk.length;
                            offset += DOWNLOAD_CHUNK_SIZE
                        ) {
                            const piece = chunk.slice(
                                offset,
                                offset + DOWNLOAD_CHUNK_SIZE
                            )
                            controller.enqueue(piece)
                            // Simulate network delay
                            await new Promise(resolve => setTimeout(resolve, 1))
                        }
                    }
                    controller.close()
                }
            })

            addLog('Starting verification...', 'info')
            addLog('', 'info')

            // Decode and verify the stream
            // createVerifier transforms the encoded stream back to original data
            // and throws if any hashes don't match the expected root label
            const verifiedStream = createVerifier(
                streamToVerify,
                rootLabel,
                state.chunkSize.value,
                {
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
                            addLog('Chunk verified via Merkle tree', 'success')
                        }
                    },
                    onError: (err) => {
                        addLog(`Verification error: ${err.message}`, 'error')
                    }
                }
            )

            // Read verified chunks from the decoded stream
            // NOTE: If a hash mismatch is detected during Merkle tree verification,
            // createVerifier will throw an error, aborting the stream processing
            // immediately. No more chunks will be processed.
            const verifiedReader = verifiedStream.getReader()
            const verifiedChunks:Uint8Array[] = []

            while (true) {
                const { done, value } = await verifiedReader.read()
                if (done) break
                verifiedChunks.push(value)
            }

            // Combine all verified chunks
            const verifiedLength = verifiedChunks.reduce(
                (sum, c) => sum + c.length,
                0
            )
            const fullFile = new Uint8Array(verifiedLength)
            let offset = 0
            for (const chunk of verifiedChunks) {
                fullFile.set(chunk, offset)
                offset += chunk.length
            }

            addLog('', 'info')
            addLog('=== Verification Complete ===', 'info')
            addLog(`Reconstructed file size: ${fullFile.length} bytes`, 'info')
            addLog('', 'info')
            addLog(
                'File verified via Bab Merkle tree',
                'success'
            )
            addLog('', 'info')
            addLog('Each chunk was verified.', 'info')
        } else if (state.encodedData.value) {
            // External metadata mode
            const metadata = state.encodedData.value
            addLog(
                '=== Starting Verified Streaming Download (External Metadata) ===',
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

            // Pipe through verifier stream
            const verifiedChunks:Uint8Array[] = []
            const verifier = createVerifier(metadata, {
                // just log every chunk that is verified
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

                // here we listen for errors
                onError: (err) => {
                    addLog(`Verification error: ${err.message}`, 'error')
                }
            })

            const verifiedStream = downloadStream.pipeThrough(verifier)
            const reader = verifiedStream.getReader()

            // Read verified chunks
            // NOTE: If a hash mismatch is detected, reader.read() will throw
            // an error, aborting the stream processing immediately.
            // No more chunks will be processed or downloaded.
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
                'File verified',
                'success'
            )
            addLog('', 'info')
            addLog(
                'Each chunk was verified before the download finished.',
                'info'
            )
        }
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
        const serverBase64 = llamaBase64
        const encoder = new TextEncoder()
        const serverData = encoder.encode(serverBase64)

        addLog(`Base64 text size: ${serverData.length} bytes`, 'info')
        addLog(`Chunk size: ${state.chunkSize.value} bytes`, 'info')
        addLog('', 'info')

        const isSingleStream = state.path.value.includes('/single-stream')

        if (isSingleStream) {
            // Bab mode: create single stream with interleaved metadata
            addLog(
                'Encoding with Bab (single stream with interleaved metadata)...',
                'info'
            )

            const rootLabel = await getRootLabel(
                serverData,
                state.chunkSize.value
            )

            // Create a ReadableStream from the data
            const serverDataStream = new ReadableStream({
                start (controller) {
                    controller.enqueue(serverData)
                    controller.close()
                }
            })

            const encodedStream = createEncoder(
                state.chunkSize.value,
                serverDataStream
            )

            addLog(`Root label: ${rootLabel}`, 'hash')
            addLog('', 'info')
            const numChunks = Math.ceil(serverData.length / state.chunkSize.value)
            addLog(`Encoded ${numChunks} chunks successfully`, 'success')

            state.babData.value = { rootLabel, encodedStream }
            state.encodedData.value = null
            state.stats.value = {
                fileSize: serverData.length,
                chunkSize: state.chunkSize.value,
                chunkCount: numChunks
            }
        } else {
            // External metadata mode
            addLog('Encoding with external metadata...', 'info')
            const metadata = await encode(serverData, state.chunkSize.value)

            addLog(`Root hash: ${metadata.rootHash}`, 'hash')
            addLog('', 'info')
            addLog(`Encoded ${metadata.chunks.length} chunks successfully`, 'success')

            state.encodedData.value = metadata
            state.babData.value = null
            state.stats.value = {
                fileSize: metadata.fileSize,
                chunkSize: metadata.chunkSize,
                chunkCount: metadata.chunks.length
            }
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
    state.babData.value = null
    state.stats.value = null
}

function handleTextareaChange (ev:Event) {
    const target = ev.target as HTMLTextAreaElement
    state.base64Text.value = target.value
}

function Explanation ({ route }:{ route:string }):ReturnType<typeof html>|null {
    if (route === '/') {
        return html`<p>
            Metadata can be generated separately from the blob content.
            This is good in <a href="https://github.com/substrate-system/baowser#metadata">
                some use-cases
            </a>. We fetch the blob, then call <code>createVerifier(metadata)</code>
            ${NBSP}to create a <a href="https://developer.mozilla.org/en-US/docs/Web/API/TransformStream">
                transform stream
            </a> that will use the metadata to verify the file as it streams in.
        </p>`
    }

    if (route.includes('single-stream')) {
        return html`<p>
            Get a single stream that includes metadata and
            blob content mixed together. Alice can publish just the root
            hash ahead of time, and then Bob can verify the
            data incrementally, without waiting for the full download. He
            just needs the root hash.
        </p>
        <p>
            The function <code>createVerifier</code> will return a new stream of
            just the content (no metadata), and will throw an error if any
            of the hashes are bad.
        </p>
        `
    }

    return null
}

function getRoute ():{ path:string, text:string }|null {
    return (routes.find(r => r.path === state.path.value) || null)
}
