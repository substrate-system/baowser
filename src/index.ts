import { blake3 } from '@nichoth/hash-wasm/blake3'
import { bytesToHex } from './util.js'

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
 * Create a TransformStream that verifies chunks against expected hashes
 * as data flows through.
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
 * Verify a complete stream, return a promise.
 *
 * @param stream - The ReadableStream to verify
 * @param metadata - The metadata containing expected hashes
 * @param options - Optional callbacks for verification events
 * @throws {Error} If the hash doesn't match the data
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

// ============================================================================
// Bab-compatible encoding with interleaved metadata (Merkle tree version)
// ============================================================================

/**
 * Merkle tree node for Bab encoding
 */
interface MerkleNode {
    label:string  // BLAKE3 hash
    isLeaf:boolean
    left?:MerkleNode
    right?:MerkleNode
    data?:Uint8Array  // For leaf nodes
    byteCount:number  // Total bytes in this subtree
}

/**
 * Hash a leaf node (chunk of data)
 */
async function hashChunk (data:Uint8Array):Promise<string> {
    return await blake3(data)
}

/**
 * Hash an internal node (combines two child labels with byte count)
 */
async function hashInner (
    leftLabel:string,
    rightLabel:string,
    byteCount:number
):Promise<string> {
    // Combine left label, right label, and byte count
    const leftBytes = hexToBytes(leftLabel)
    const rightBytes = hexToBytes(rightLabel)
    const countBytes = new Uint8Array(8)
    const view = new DataView(countBytes.buffer)
    view.setBigUint64(0, BigInt(byteCount), true) // little-endian

    const combined = new Uint8Array(
        leftBytes.length + rightBytes.length + countBytes.length
    )
    combined.set(leftBytes, 0)
    combined.set(rightBytes, leftBytes.length)
    combined.set(countBytes, leftBytes.length + rightBytes.length)

    return blake3(combined)
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes (hex:string):Uint8Array {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
    }
    return bytes
}

/**
 * Build a Merkle tree from data chunks using range-based splitting
 * This matches the decoder's top-down approach
 */
async function buildMerkleTree (
    data:Uint8Array,
    chunkSize:number
):Promise<MerkleNode> {
    const numChunks = Math.ceil(data.length / chunkSize)

    // Recursive function to build a node for a range of chunks
    async function buildNode (start:number, end:number):Promise<MerkleNode> {
        if (start === end) {
            // Leaf node - single chunk
            const chunkIndex = start
            const isLastChunk = chunkIndex === numChunks - 1
            const offset = chunkIndex * chunkSize
            const size = isLastChunk
                ? data.length - offset
                : chunkSize

            const chunk = data.slice(offset, offset + size)
            const label = await hashChunk(chunk)

            return {
                label,
                isLeaf: true,
                data: chunk,
                byteCount: chunk.length
            }
        }

        // Internal node - split range
        const mid = Math.floor((start + end) / 2)
        const left = await buildNode(start, mid)
        const right = await buildNode(mid + 1, end)

        const byteCount = left.byteCount + right.byteCount
        const label = await hashInner(left.label, right.label, byteCount)

        return {
            label,
            isLeaf: false,
            left,
            right,
            byteCount
        }
    }

    return buildNode(0, numChunks - 1)
}

/**
 * Encode data into bab format with interleaved labels and chunks
 * Returns a ReadableStream that outputs: [length] [labels...] [chunks...]
 * in depth-first traversal order.
 *
 * @param data - The data to encode
 * @param chunkSize - Size of each chunk in bytes
 * @returns A ReadableStream containing the encoded data with
 *   interleaved metadata
 */
export async function createEncoder (
    data:Uint8Array,
    chunkSize:number
):Promise<ReadableStream<Uint8Array>> {
    const tree = await buildMerkleTree(data, chunkSize)

    // Create a generator that yields chunks lazily
    async function * generateChunks ():AsyncGenerator<Uint8Array> {
        // Yield length prefix (8 bytes, little-endian)
        const lengthBytes = new Uint8Array(8)
        const view = new DataView(lengthBytes.buffer)
        view.setBigUint64(0, BigInt(data.length), true)
        yield lengthBytes

        // Yield tree in depth-first order
        yield * emitNodeGenerator(tree)
    }

    const iterator = generateChunks()

    return new ReadableStream({
        async pull (controller) {
            const { done, value } = await iterator.next()
            if (done) {
                controller.close()
            } else {
                controller.enqueue(value)
            }
        }
    })
}

/**
 * Emit a node and its children in depth-first order using a generator
 */
async function * emitNodeGenerator (
    node:MerkleNode
):AsyncGenerator<Uint8Array> {
    if (node.isLeaf) {
        // Yield chunk data
        if (node.data) {
            yield node.data
        }
    } else {
        // Yield labels for left and right children
        if (node.left) {
            const labelBytes = hexToBytes(node.left.label)
            yield labelBytes
        }
        if (node.right) {
            const labelBytes = hexToBytes(node.right.label)
            yield labelBytes
        }

        // Recursively yield children
        if (node.left) {
            yield * emitNodeGenerator(node.left)
        }
        if (node.right) {
            yield * emitNodeGenerator(node.right)
        }
    }
}

/**
 * Decode and verify a Bab-encoded stream with full Merkle tree verification
 * Returns a ReadableStream of verified data chunks
 *
 * @param stream - The encoded stream to decode
 * @param rootLabel - The expected root hash for verification
 * @param chunkSize - The chunk size used during encoding
 * @param options - Optional callbacks for verification events
 * @returns A ReadableStream of verified data chunks
 */
export function createDecoder (
    stream:ReadableStream<Uint8Array>,
    rootLabel:string,
    chunkSize:number,
    options:VerifierOptions = {}
):ReadableStream<Uint8Array> {
    const LABEL_SIZE = 32  // BLAKE3 produces 32-byte hashes

    return new ReadableStream({
        async start (controller) {
            const reader = stream.getReader()
            let buffer = new Uint8Array(0)
            let totalLength = 0
            let numChunks = 0
            let offset = 0

            // Helper to ensure we have enough bytes in buffer
            async function ensureBytes (needed:number):Promise<void> {
                while (buffer.length - offset < needed) {
                    const { done, value } = await reader.read()
                    if (done) {
                        throw new Error(
                            `Unexpected end of stream. Needed ${needed} bytes, ` +
                            `have ${buffer.length - offset}`
                        )
                    }
                    // Append new data to buffer
                    const newBuffer = new Uint8Array(
                        buffer.length - offset + value.length
                    )
                    newBuffer.set(buffer.slice(offset), 0)
                    newBuffer.set(value, buffer.length - offset)
                    buffer = newBuffer
                    offset = 0
                }
            }

            // Read bytes from buffer
            function readBytes (count:number):Uint8Array {
                const result = buffer.slice(offset, offset + count)
                offset += count
                return result
            }

            try {
                // Read length prefix
                await ensureBytes(8)
                const lengthView = new DataView(
                    buffer.buffer,
                    buffer.byteOffset + offset
                )
                totalLength = Number(lengthView.getBigUint64(0, true))
                offset += 8
                numChunks = Math.ceil(totalLength / chunkSize)

                const verifiedChunks:Uint8Array[] = new Array(numChunks)

                // Recursive function to decode a node
                async function decodeNode (
                    start:number,
                    end:number
                ):Promise<string> {
                    if (start === end) {
                        // Leaf node - read chunk
                        const chunkIndex = start
                        const isLastChunk = chunkIndex === numChunks - 1
                        const expectedSize = isLastChunk
                            ? totalLength - (chunkIndex * chunkSize)
                            : chunkSize

                        await ensureBytes(expectedSize)
                        const chunkData = readBytes(expectedSize)

                        // Verify chunk and get its label
                        const label = await hashChunk(chunkData)
                        verifiedChunks[chunkIndex] = chunkData

                        // Emit verified chunk immediately
                        controller.enqueue(chunkData)

                        if (options.onChunkVerified) {
                            options.onChunkVerified(chunkIndex + 1, numChunks)
                        }

                        return label
                    }

                    // Internal node - read left and right labels
                    await ensureBytes(LABEL_SIZE * 2)
                    const leftLabelBytes = readBytes(LABEL_SIZE)
                    const rightLabelBytes = readBytes(LABEL_SIZE)

                    const expectedLeftLabel = bytesToHex(leftLabelBytes)
                    const expectedRightLabel = bytesToHex(rightLabelBytes)

                    // Decode left child and verify immediately
                    const mid = Math.floor((start + end) / 2)
                    const computedLeftLabel = await decodeNode(start, mid)

                    // Verify left label immediately before continuing
                    if (computedLeftLabel !== expectedLeftLabel) {
                        const error = new Error(
                            `Left child label mismatch at [${start},${mid}]. ` +
                            `Expected: ${expectedLeftLabel}, ` +
                            `Got: ${computedLeftLabel}`
                        )
                        if (options.onError) {
                            options.onError(error)
                        }
                        throw error
                    }

                    // Decode right child and verify immediately
                    const computedRightLabel = await decodeNode(mid + 1, end)

                    if (computedRightLabel !== expectedRightLabel) {
                        const error = new Error(
                            `Right child label mismatch at [${mid + 1},${end}]. ` +
                            `Expected: ${expectedRightLabel}, ` +
                            `Got: ${computedRightLabel}`
                        )
                        if (options.onError) {
                            options.onError(error)
                        }
                        throw error
                    }

                    // Compute this node's label
                    let byteCount = 0
                    for (let i = start; i <= end; i++) {
                        if (i === numChunks - 1) {
                            byteCount += totalLength - (i * chunkSize)
                        } else {
                            byteCount += chunkSize
                        }
                    }

                    const parentLabel = await hashInner(
                        computedLeftLabel,
                        computedRightLabel,
                        byteCount
                    )

                    return parentLabel
                }

                // Decode the tree and verify
                const computedRootLabel = await decodeNode(0, numChunks - 1)

                // Verify root label
                if (computedRootLabel !== rootLabel) {
                    const error = new Error(
                        `Root label mismatch. Expected: ${rootLabel}, ` +
                        `Got: ${computedRootLabel}`
                    )
                    if (options.onError) {
                        options.onError(error)
                    }
                    throw error
                }

                controller.close()
            } catch (error) {
                if (options.onError && error instanceof Error) {
                    options.onError(error)
                }
                controller.error(error)
            } finally {
                reader.releaseLock()
            }
        }
    })
}

/**
 * Helper to get the root label from an encoded Bab stream
 * Builds the tree and returns just the root label
 */
export async function getBabRootLabel (
    data:Uint8Array,
    chunkSize:number
):Promise<string> {
    const tree = await buildMerkleTree(data, chunkSize)
    return tree.label
}
