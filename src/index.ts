import { blake3 } from '@nichoth/hash-wasm/blake3'

/**
 * Metadata for a single chunk
 */
export interface ChunkMetadata {
    hash:string
    size:number
}

/**
 * Complete metadata for encoded data with BLAKE3 hashes
 */
export interface EncodedMetadata {
    rootHash:string
    fileSize:number
    chunkSize:number
    chunks:ChunkMetadata[]
}

/**
 * Options for the verifier transform stream
 */
export interface VerifierOptions {
    /**
     * Callback invoked when a chunk is successfully verified
     */
    onChunkVerified?:(chunkIndex:number, totalChunks:number) => void
    /**
     * Callback invoked when verification fails
     */
    onError?:(error:Error) => void
}

/**
 * Encodes data by chunking it and creating BLAKE3 hashes for each chunk
 *
 * @param data - The data to encode
 * @param chunkSize - Size of each chunk in bytes
 * @returns Metadata containing root hash and chunk hashes
 */
export async function encode (
    data:Uint8Array,
    chunkSize:number
):Promise<EncodedMetadata> {
    // Calculate root hash of entire data
    const rootHash = await blake3(data)

    // Break into chunks and hash each
    const chunks:ChunkMetadata[] = []
    for (let offset = 0; offset < data.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, data.length)
        const chunk = data.slice(offset, end)
        const chunkHash = await blake3(chunk)

        chunks.push({
            size: chunk.length,
            hash: chunkHash
        })
    }

    return {
        rootHash,
        fileSize: data.length,
        chunkSize,
        chunks
    }
}

/**
 * Creates a TransformStream that verifies chunks against expected hashes
 * as data flows through
 *
 * @param metadata - The metadata containing expected hashes
 * @param options - Optional callbacks for verification events
 * @returns A TransformStream that verifies chunks
 */
export function createVerifier (
    metadata:EncodedMetadata,
    options:VerifierOptions = {}
):TransformStream<Uint8Array, Uint8Array> {
    let buffer = new Uint8Array(0)
    let currentChunkIndex = 0
    let totalBytesProcessed = 0

    return new TransformStream<Uint8Array, Uint8Array>({
        async transform (chunk, controller) {
            try {
                // Add chunk to buffer
                const newBuffer = new Uint8Array(buffer.length + chunk.length)
                newBuffer.set(buffer, 0)
                newBuffer.set(chunk, buffer.length)
                buffer = newBuffer

                // Process complete chunks from buffer
                while (
                    buffer.length >= metadata.chunkSize ||
                    (currentChunkIndex === metadata.chunks.length - 1 &&
                        buffer.length > 0)
                ) {
                    if (currentChunkIndex >= metadata.chunks.length) {
                        throw new Error(
                            'Received more data than expected ' +
                            `(${totalBytesProcessed} bytes)`
                        )
                    }

                    const expectedChunk = metadata.chunks[currentChunkIndex]
                    const chunkData = buffer.slice(0, expectedChunk.size)

                    // Verify chunk hash
                    const computedHash = await blake3(chunkData)
                    if (computedHash !== expectedChunk.hash) {
                        const error = new Error(
                            `Chunk ${currentChunkIndex + 1} hash mismatch. ` +
                            `Expected: ${expectedChunk.hash}, ` +
                            `Got: ${computedHash}`
                        )
                        if (options.onError) {
                            options.onError(error)
                        }
                        throw error
                    }

                    // Chunk verified - pass it through
                    controller.enqueue(chunkData)
                    totalBytesProcessed += chunkData.length

                    // Notify callback
                    if (options.onChunkVerified) {
                        options.onChunkVerified(
                            currentChunkIndex + 1,
                            metadata.chunks.length
                        )
                    }

                    // Remove processed chunk from buffer
                    buffer = buffer.slice(expectedChunk.size)
                    currentChunkIndex++

                    // If this was the last chunk, ensure we've processed all data
                    if (
                        currentChunkIndex === metadata.chunks.length &&
                        buffer.length > 0
                    ) {
                        throw new Error(
                            `Extra data after last chunk: ${buffer.length} bytes`
                        )
                    }
                }
            } catch (error) {
                if (options.onError && error instanceof Error) {
                    options.onError(error)
                }
                throw error
            }
        },

        async flush () {
            // Verify all chunks were received
            if (currentChunkIndex !== metadata.chunks.length) {
                const error = new Error(
                    `Incomplete stream: received ${currentChunkIndex} of ` +
                    `${metadata.chunks.length} chunks`
                )
                if (options.onError) {
                    options.onError(error)
                }
                throw error
            }

            // Verify no remaining data in buffer
            if (buffer.length > 0) {
                const error = new Error(
                    `Unexpected remaining data: ${buffer.length} bytes`
                )
                if (options.onError) {
                    options.onError(error)
                }
                throw error
            }
        }
    })
}

/**
 * Convenience function to verify a complete stream and collect all data
 *
 * @param stream - The ReadableStream to verify
 * @param metadata - The metadata containing expected hashes
 * @param options - Optional callbacks for verification events
 * @returns Promise resolving to the complete verified data
 */
export async function verifyStream (
    stream:ReadableStream<Uint8Array>,
    metadata:EncodedMetadata,
    options:VerifierOptions = {}
):Promise<Uint8Array> {
    const verifiedStream = stream.pipeThrough(createVerifier(metadata, options))
    const reader = verifiedStream.getReader()
    const chunks:Uint8Array[] = []

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
        }
    } finally {
        reader.releaseLock()
    }

    // Combine all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
    }

    // Final verification: check root hash
    const computedRootHash = await blake3(result)
    if (computedRootHash !== metadata.rootHash) {
        throw new Error(
            `Root hash mismatch. Expected: ${metadata.rootHash}, ` +
            `Got: ${computedRootHash}`
        )
    }

    return result
}
