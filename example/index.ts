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

if (import.meta.env.DEV || import.meta.env.MODE === 'staging') {
    localStorage.setItem('DEBUG', 'baowser')
} else {
    localStorage.removeItem('DEBUG')
    localStorage.removeItem('debug')
}

const debug = Debug(import.meta.env.DEV)
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
        babStream:Uint8Array  // The encoded Bab stream bytes
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
                    You can veryify the chunks as they arrive.
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
            const { rootLabel, babStream } = state.babData.value

            // Check if textarea was modified
            const clientBase64 = state.base64Text.value
            const serverBase64 = llamaBase64
            const isModified = clientBase64 !== serverBase64

            addLog(
                '=== Starting Bab Stream Verification ===',
                'info'
            )
            addLog(`Expected root label: ${rootLabel}`, 'hash')
            addLog('', 'info')

            // The Bab stream contains interleaved labels and data chunks in depth-first order.
            // When the user modifies the textarea, we simulate a corrupted transmission
            // by flipping some bytes in the Bab stream.
            //
            // Key insight: In Bab, we don't need to know WHICH bytes are data vs labels.
            // We just corrupt some bytes. If we corrupt a data chunk, verification fails
            // when computing that chunk's hash. If we corrupt a label, verification fails
            // when comparing against the computed child label.
            let streamToVerify = babStream

            if (isModified) {
                addLog('⚠ Textarea modified - simulating corrupted transmission', 'info')
                addLog('', 'info')
                addLog('HOW THIS WORKS:', 'info')
                addLog('1. Alice creates Bab stream from ORIGINAL data (llama image)', 'info')
                addLog('2. Alice publishes root hash via trusted channel.', 'info')
                addLog('3. Bob downloads Bab stream (simulating with local stream)', 'info')
                addLog('4. Stream gets corrupted in transit (simulating with your edit)', 'info')
                addLog('5. Bob verifies with ONLY the root hash - incremental verification!', 'info')
                addLog('', 'info')

                // Create a copy of the original stream
                streamToVerify = new Uint8Array(babStream)

                // Find the first byte that differs between original and modified
                const encoder = new TextEncoder()
                const originalBytes = encoder.encode(serverBase64)
                const modifiedBytes = encoder.encode(clientBase64)

                let firstDiffIndex = -1
                const minLength = Math.min(originalBytes.length, modifiedBytes.length)
                for (let i = 0; i < minLength; i++) {
                    if (originalBytes[i] !== modifiedBytes[i]) {
                        firstDiffIndex = i
                        break
                    }
                }

                // Handle length changes
                if (firstDiffIndex === -1 && originalBytes.length !== modifiedBytes.length) {
                    firstDiffIndex = minLength
                }

                if (firstDiffIndex >= 0) {
                    // Map this byte position in the source data to the Bab stream
                    // We need to account for:
                    // 1. 8-byte length prefix
                    // 2. Labels that come before chunks in depth-first order
                    //
                    // For now, let's use a simple heuristic: corrupt a byte roughly
                    // in the position corresponding to the first difference.
                    // The Bab stream has labels interspersed, so we'll corrupt at
                    // a position that's proportionally similar.

                    const dataRatio = firstDiffIndex / originalBytes.length
                    // Skip the length prefix (8 bytes)
                    const babDataStart = 8
                    const babDataLength = streamToVerify.length - babDataStart
                    const corruptionOffset = babDataStart + Math.floor(babDataLength * dataRatio)

                    // Corrupt a small number of bytes to simulate transmission error
                    const bytesToCorrupt = Math.min(4, streamToVerify.length - corruptionOffset)

                    const originalByte = streamToVerify[corruptionOffset]
                    for (let i = 0; i < bytesToCorrupt; i++) {
                        streamToVerify[corruptionOffset + i] ^= 0xFF  // Flip all bits
                    }

                    addLog(`Data difference detected at byte ${firstDiffIndex} of ${originalBytes.length}`, 'info')
                    addLog(`Corrupting Bab stream at offset ${corruptionOffset} (${bytesToCorrupt} bytes)`, 'info')
                    addLog(`  Original byte: 0x${originalByte.toString(16).padStart(2, '0')}`, 'info')
                    addLog(`  Corrupted byte: 0x${streamToVerify[corruptionOffset].toString(16).padStart(2, '0')}`, 'info')
                    addLog('', 'info')
                    addLog('⚠ Verification should FAIL FAST when corrupted chunk is processed!', 'error')
                    addLog('', 'info')
                } else {
                    addLog('No differences found between original and modified text', 'info')
                    addLog('Verification should succeed', 'success')
                    addLog('', 'info')
                }
            }

            addLog('Creating download stream with simulated delays...', 'info')
            addLog('Stream will verify incrementally as data arrives', 'info')
            addLog('', 'info')

            // Create a throttled stream that simulates network download
            const DOWNLOAD_CHUNK_SIZE = 16384 // 16KB chunks for network simulation
            const downloadStream = new ReadableStream({
                async start (controller) {
                    for (
                        let offset = 0;
                        offset < streamToVerify.length;
                        offset += DOWNLOAD_CHUNK_SIZE
                    ) {
                        const piece = streamToVerify.slice(
                            offset,
                            Math.min(offset + DOWNLOAD_CHUNK_SIZE, streamToVerify.length)
                        )
                        // Simulate network delay
                        await new Promise(resolve => setTimeout(resolve, 0))
                        controller.enqueue(piece)
                    }
                    controller.close()
                }
            })

            addLog('Starting verification...', 'info')
            addLog('', 'info')

            // Decode and verify the stream
            //
            // This is the key to bab's design:
            // - As the stream arrives, we read labels and chunks in
            //   depth-first order
            // - We verify each subtree's label IMMEDIATELY after computing it
            // - If any label mismatches the expected value, we fail immediately
            //
            // The createVerifier will:
            // 1. Read the length prefix
            // 2. Recursively process the tree in depth-first order:
            //    - For internal nodes: read left/right child labels
            //    - Process left child, compute its label, verify it matches
            //    - Process right child, compute its label, verify it matches
            //    - Compute parent label and return it for verification
            // 3. Verify the root label matches our trusted value
            const verifiedStream = createVerifier(
                downloadStream,
                rootLabel,
                state.chunkSize.value,
                {
                    onChunkVerified: (chunkIndex, totalChunks) => {
                        // Log first few chunks to show incremental verification
                        if (
                            chunkIndex <= 5 ||
                            chunkIndex % 50 === 0 ||
                            chunkIndex === totalChunks
                        ) {
                            addLog('', 'info')
                            addLog(
                                `--- Chunk ${chunkIndex}/${totalChunks} ---`,
                                'info'
                            )
                            addLog('Chunk verified incrementally', 'success')
                            if (chunkIndex === 5) {
                                addLog('(Logging every 50th chunk from now on...)', 'info')
                            }
                        }
                    },
                    onError: (err) => {
                        debug('got an error', err)
                        addLog('', 'info')
                        addLog('='.repeat(60), 'error')
                        addLog('INCREMENTAL VERIFICATION FAILED', 'error')
                        addLog('='.repeat(60), 'error')
                        addLog('', 'error')
                        addLog(`Error: ${err.message}`, 'error')
                        addLog('', 'error')
                        addLog(
                            "Stream was aborted early because the hash didn't match.",
                            'error')
                    }
                }
            )

            // Read verified chunks from the decoded stream
            //
            // IMPORTANT: If a label mismatch is detected during tree traversal,
            // the verifiedStream will throw an error immediately, aborting the
            // entire process. The while loop below will stop, and no more chunks
            // will be downloaded or processed. This is true incremental verification!
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
            const serverBase64 = llamaBase64
            const isModified = clientBase64 !== serverBase64

            if (isModified) {
                addLog('⚠ Textarea has been modified!', 'info')
                addLog('Verification will fail on first mismatched chunk', 'info')
                addLog('', 'info')
            }

            const encoder = new TextEncoder()
            const clientData = encoder.encode(clientBase64)

            addLog(`Data size: ${clientData.length} bytes`, 'info')
            addLog('', 'info')
            addLog('Creating stream and verifier...', 'info')

            // Create a ReadableStream that simulates downloading chunks
            const downloadStream = new ReadableStream<Uint8Array>({
                async start (controller) {
                    addLog('Stream started', 'info')

                    for (let i = 0; i < metadata.chunks.length; i++) {
                        // Simulate network delay
                        await new Promise(resolve => setTimeout(resolve, 0))

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

                onError: (err) => {
                    addLog(`Verification error: ${err.message}`, 'error')
                }
            })

            const verifiedStream = downloadStream.pipeThrough(verifier)
            const reader = verifiedStream.getReader()

            // Read verified chunks
            // NOTE: If a hash mismatch is detected, reader.read() will throw
            // an error, aborting the stream processing immediately.
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
        // Don't add redundant error logging if onError already logged it
        debug('error in stream', error)
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

            addLog(`Root label: ${rootLabel}`, 'hash')
            addLog('', 'info')

            // Create the actual Bab-encoded stream
            const dataStream = new ReadableStream({
                start (controller) {
                    controller.enqueue(serverData)
                    controller.close()
                }
            })

            const encodedStream = createEncoder(state.chunkSize.value, dataStream)
            const reader = encodedStream.getReader()
            const chunks:Uint8Array[] = []

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                chunks.push(value)
            }

            const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
            const babStream = new Uint8Array(totalLength)
            let offset = 0
            for (const chunk of chunks) {
                babStream.set(chunk, offset)
                offset += chunk.length
            }

            const numChunks = Math.ceil(serverData.length / state.chunkSize.value)
            addLog(`Encoded ${numChunks} chunks successfully`, 'success')
            addLog(`Bab stream size: ${babStream.length} bytes`, 'info')

            state.babData.value = { rootLabel, babStream }
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
            <strong>Bab Incremental Verification:</strong> Alice encodes her data
            into a Bab stream, which interleaves Merkle tree labels with data chunks
            in depth-first order. She publishes only the root hash as the
            trust anchor. Bob downloads the Bab stream and verifies it
            incrementally by computing labels from the data and comparing them
            against the labels in the stream, ultimately verifying that his
            computed root matches Alice's published root hash.
        </p>
        <p>
            <strong>Trust model:</strong> Bob trusts only the root hash obtained
            out-of-band. He does not trust the labels in the stream - instead, he
            cryptographically verifies each label by recomputing it from verified
            data. Every chunk and label is verified before use.
        </p>
        <p>
            Bob can detect corruption as soon as a
            corrupted chunk or label is processed - he doesn't need to download
            the entire file first. The interleaved labels enable fail-fast
            incremental verification.
        </p>
        <p>
            <strong>Demo:</strong> Modify the textarea to simulate a corrupted
            transmission. The demo will flip bytes in the Bab stream at the
            corresponding position. Verification should fail at the first
            corrupted chunk.
        </p>
        `
    }

    return null
}

function getRoute ():{ path:string, text:string }|null {
    return (routes.find(r => r.path === state.path.value) || null)
}
