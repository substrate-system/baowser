import { signal, type Signal } from '@preact/signals'
import Debug from '@substrate-system/debug'
import llamaBase64 from './llama.jpg.base64'
import type { Stats, LogEntry } from './types.js'
const debug = Debug(import.meta.env.DEV)

export function State () {
    const state:{
        chunkSize:Signal<number>;
        streamData:Signal<{
            rootLabel:string,
            stream:Uint8Array  // The encoded stream bytes
        }|null>;
        logs:Signal<LogEntry[]>;
        stats:Signal<Stats|null>;
        isEncoding:Signal<boolean>;
        isVerifying:Signal<boolean>;
        base64Text:Signal<string>;
    } = {
        chunkSize: signal(1024),
        streamData: signal(null),
        logs: signal([]),
        stats: signal(null),
        isEncoding: signal(false),
        isVerifying: signal(false),
        base64Text: signal(llamaBase64),
    }

    return state
}

export async function verifyFile (state:ReturnType<typeof State>) {
    if (!state.streamData.value) return

    State.clearLog(state)
    state.isVerifying.value = true

    try {
        // Bab mode: decode and verify single stream
        const { rootLabel, stream } = state.streamData.value

        // Check if textarea was modified
        const clientBase64 = state.base64Text.value
        const serverBase64 = llamaBase64
        const isModified = clientBase64 !== serverBase64

        State.addLog(
            state,
            '=== Starting Bab Stream Verification ===',
            'info'
        )
        State.addLog(state, `Expected root label: ${rootLabel}`, 'hash')
        State.addLog(state, '', 'info')

        // When the user modifies the textarea, we simulate a corrupted
        // transmission by flipping some bytes in the stream.
        //
        // We don't need to know WHICH bytes are data vs labels.
        //
        // We just corrupt some bytes. If we corrupt a data chunk,
        // verification fails when computing that chunk's hash. If we
        // corrupt a label, verification fails when comparing against the
        // computed child label.
        let streamToVerify = stream

        if (isModified) {
            addLog(
                'Textarea modified - simulating corrupted transmission',
                'info'
            )
            addLog('', 'info')
            addLog('HOW THIS WORKS:', 'info')
            addLog('1. Alice creates Bab stream from ORIGINAL data (llama image)', 'info')
            addLog('2. Alice publishes root hash via trusted channel.', 'info')
            addLog('3. Bob downloads Bab stream (simulating with local stream)', 'info')
            addLog('4. Stream gets corrupted in transit (simulating with your edit)', 'info')
            addLog('5. Bob verifies with ONLY the root hash - incremental verification!', 'info')
            addLog('', 'info')

            // Create a copy of the original stream
            streamToVerify = new Uint8Array(stream)

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
                const corruptionOffset = babDataStart +
                    Math.floor(babDataLength * dataRatio)

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
        // KEY INSIGHT: The rootLabel is our ONLY trusted input. This single
        // hash is sufficient for complete incremental verification!
        //
        // How it works:
        // - As the stream arrives, we read labels and chunks in depth-first order
        // - We compute hashes of data chunks and internal nodes
        // - We IMMEDIATELY verify each computed hash against the expected label
        // - Everything chains up to verify against the rootLabel
        // - If ANY hash mismatches, we fail immediately and stop downloading
        //
        // Create a verifier TransformStream
        // The createVerifier will:
        // 1. Read the length prefix
        // 2. Recursively process the tree in depth-first order:
        //    - For internal nodes: read expected left/right child labels
        //      from stream
        //    - Process left child, compute its hash, verify against
        //      expected label
        //    - Process right child, compute its hash, verify against
        //      expected label
        //    - Compute parent hash from children and return it
        //      for verification
        // 3. Verify the final computed root hash matches our
        //    trusted rootLabel
        const verifier = createVerifier(
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
                        'Stream was aborted early because the hash ' +
                            "didn't match.",
                        'error'
                    )
                }
            }
        )

        // Pipe the download stream through the verifier
        const verifiedStream = downloadStream.pipeThrough(verifier)

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
    } catch (error) {
        // Don't add redundant error logging if onError already logged it
        debug('error in stream', error)
    } finally {
        state.isVerifying.value = false
    }
}

State.clearLog = function clearLog (state:ReturnType<typeof State>) {
    state.logs.value = []
}

State.encodeFile = async function encodeFile (state:ReturnType<typeof State>) {
    State.clearLog(state)
    state.isEncoding.value = true

    try {
        const serverBase64 = llamaBase64
        const encoder = new TextEncoder()
        const serverData = encoder.encode(serverBase64)

        addLog(`Base64 text size: ${serverData.length} bytes`, 'info')
        addLog(`Chunk size: ${state.chunkSize.value} bytes`, 'info')
        addLog('', 'info')

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
        const stream = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
            stream.set(chunk, offset)
            offset += chunk.length
        }

        const numChunks = Math.ceil(serverData.length / state.chunkSize.value)
        addLog(`Encoded ${numChunks} chunks successfully`, 'success')
        addLog(`Bab stream size: ${stream.length} bytes`, 'info')

        state.streamData.value = { rootLabel, stream }
        state.stats.value = {
            fileSize: serverData.length,
            chunkSize: state.chunkSize.value,
            chunkCount: numChunks
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
    state.streamData.value = null
    state.stats.value = null
}

function handleTextareaChange (ev:Event) {
    const target = ev.target as HTMLTextAreaElement
    state.base64Text.value = target.value
}

// Functions removed - no longer needed without routing
State.addLog = function addLog (
    state:ReturnType<typeof State>,
    message:string,
    type:LogEntry['type'] = 'info'
) {
    state.logs.value = [...state.logs.value, {
        message,
        type,
        timestamp: new Date()
    }]
}
