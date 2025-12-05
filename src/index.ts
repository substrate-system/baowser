import { blake3 } from '@nichoth/hash-wasm/blake3'
import { bytesToHex, hexToBytes } from './util.js'
import Debug from '@substrate-system/debug'
const debug = Debug('baowser')

/**
 * Options for the verifier stream
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
 * Create a verifier stream that decodes Bab-encoded data with
 *   interleaved metadata.
 *
 * @param stream - The encoded stream to decode and verify
 * @param rootHash - The expected root hash for verification (your ONLY trusted input)
 * @param chunkSize - The chunk size used during encoding
 * @param options - Optional callbacks for verification events
 * @returns A ReadableStream of verified data chunks
 */
export function createVerifier (
    stream:ReadableStream<Uint8Array>,
    rootHash:string,
    chunkSize:number,
    options?:VerifierOptions
):ReadableStream<Uint8Array> {
    return decodeBab(stream, rootHash, chunkSize, options)
}

/**
 * Verify a Bab-encoded stream and return the complete verified data.
 *
 * This is a convenience function that handles streaming, verification,
 * and collecting chunks into a single Uint8Array.
 *
 * @param stream - The encoded stream to decode and verify
 * @param rootHash - The expected root hash for verification (your ONLY trusted input)
 * @param chunkSize - The chunk size used during encoding
 * @param options - Optional callbacks for verification events
 * @returns {Promise<Uint8Array>} Promise resolving to the complete verified data
 */
export async function verify (
    stream:ReadableStream<Uint8Array>,
    rootHash:string,
    chunkSize:number,
    options?:VerifierOptions
):Promise<Uint8Array> {
    const verifiedStream = decodeBab(stream, rootHash, chunkSize, options)
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
 * Return a transform stream if input data is not provided.
 *
 * @param {number} chunkSize Chunk size
 */
export function createEncoder (
    chunkSize:number
):TransformStream<Uint8Array, Uint8Array>

/**
 * Return a new readable stream.
 *
 * @param {number} chunkSize Chunk size.
 * @param {ReadableStream<Uint8Array>} data The input data.
 */
export function createEncoder (
    chunkSize:number,
    data:ReadableStream<Uint8Array>
):ReadableStream<Uint8Array>

/**
 * Encode data into bab format with interleaved labels and chunks.
 * Returns a ReadableStream or a TransformStream that outputs:
 *   [length] [labels...] [chunks...]
 * in depth-first traversal order.
 *
 * @param {number} chunkSize - Size of each chunk in bytes
 * @param {ReadableStream<Uint8Array>} [data] - The data stream to encode.
 *   If omitted, returns a TransformStream that will encode its input.
 * @returns {ReadableStream<Uint8Array>|TransformStream<Uint8Array>}
 *   A ReadableStream or TransformStream containing the encoded data with
 *   interleaved metadata
 */
export function createEncoder (
    chunkSize:number,
    data?:ReadableStream<Uint8Array>,
):ReadableStream<Uint8Array>|TransformStream<Uint8Array, Uint8Array> {
    if (!data) {
        // Create a transform stream that buffers all input,
        // then builds the tree and emits encoded data
        let buffer = new Uint8Array(0)

        return new TransformStream<Uint8Array, Uint8Array>({
            transform (chunk:Uint8Array) {
                // Buffer incoming chunks
                const newBuffer = new Uint8Array(buffer.length + chunk.length)
                newBuffer.set(buffer, 0)
                newBuffer.set(chunk, buffer.length)
                buffer = newBuffer
            },

            async flush (controller:TransformStreamDefaultController<Uint8Array>) {
                // Build the Merkle tree from buffered data
                const tree = await buildMerkleTree(buffer, chunkSize)

                // Emit length prefix (8 bytes, little-endian)
                const lengthBytes = new Uint8Array(8)
                const view = new DataView(lengthBytes.buffer)
                view.setBigUint64(0, BigInt(buffer.length), true)
                controller.enqueue(lengthBytes)

                // Emit tree in depth-first order
                for await (const chunk of emitNodeGenerator(tree)) {
                    controller.enqueue(chunk)
                }
            }
        })
    }

    // If data is provided, return a ReadableStream
    return new ReadableStream<Uint8Array>({
        async start (controller) {
            // Read all data from the stream
            const reader = data.getReader()
            const chunks:Uint8Array[] = []
            let totalLength = 0

            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    chunks.push(value)
                    totalLength += value.length
                }
            } finally {
                reader.releaseLock()
            }

            // Combine chunks into single buffer
            const buffer = new Uint8Array(totalLength)
            let offset = 0
            for (const chunk of chunks) {
                buffer.set(chunk, offset)
                offset += chunk.length
            }

            // Build the Merkle tree
            const tree = await buildMerkleTree(buffer, chunkSize)

            // Emit length prefix (8 bytes, little-endian)
            const lengthBytes = new Uint8Array(8)
            const view = new DataView(lengthBytes.buffer)
            view.setBigUint64(0, BigInt(buffer.length), true)
            controller.enqueue(lengthBytes)

            // Emit tree in depth-first order
            for await (const chunk of emitNodeGenerator(tree)) {
                controller.enqueue(chunk)
            }

            controller.close()
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
 * Internal function. Decode and verify a Bab-encoded stream with incremental
 *   Merkle tree verification.
 *
 * The rootLabel is the only trusted input. This single hash is
 * sufficient for complete incremental verification. As we decode the tree:
 * 1. We compute hashes of leaf nodes (data chunks)
 * 2. We compute hashes of internal nodes from their children
 * 3. At each step, we compare computed hashes against expected labels from the stream
 * 4. Everything chains up to verify against the rootLabel
 *
 * You can detect corruption as soon as it occurs, without downloading the
 * entire file first.
 *
 * Return a ReadableStream of verified data chunks
 */
function decodeBab (
    stream:ReadableStream<Uint8Array>,
    rootLabel:string,
    chunkSize:number,
    opts:VerifierOptions = {}
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
                //
                // This is where incremental verification happens! At each level:
                // - For leaves: we hash the data chunk and return that hash
                // - For internal nodes: we recursively decode children, verify their
                //   computed hashes match the expected labels from the stream, then
                //   compute this node's hash from its children
                // - Everything chains up to verify against the rootLabel
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

                        // Compute this chunk's hash - this will be verified by our parent
                        const label = await hashChunk(chunkData)
                        verifiedChunks[chunkIndex] = chunkData

                        // Emit verified chunk immediately
                        controller.enqueue(chunkData)

                        if (opts.onChunkVerified) {
                            opts.onChunkVerified(chunkIndex + 1, numChunks)
                        }

                        return label
                    }

                    // Internal node - read expected labels for children from the stream
                    await ensureBytes(LABEL_SIZE * 2)
                    const leftLabelBytes = readBytes(LABEL_SIZE)
                    const rightLabelBytes = readBytes(LABEL_SIZE)

                    const expectedLeftLabel = bytesToHex(leftLabelBytes)
                    const expectedRightLabel = bytesToHex(rightLabelBytes)

                    // Decode children recursively - they'll compute their own hashes
                    const mid = Math.floor((start + end) / 2)
                    const computedLeftLabel = await decodeNode(start, mid)
                    const computedRightLabel = await decodeNode(mid + 1, end)

                    // INCREMENTAL VERIFICATION: Verify computed hashes match expected
                    // labels from the stream. We verify each subtree
                    // immediately, without needing to download everything first.
                    if (computedLeftLabel !== expectedLeftLabel) {
                        debug('if', computedLeftLabel, expectedLeftLabel)
                        const error = new Error(
                            `Left child label mismatch at [${start},${mid}]. ` +
                            `Expected: ${expectedLeftLabel}, ` +
                            `Got: ${computedLeftLabel}. `
                        )
                        throw error
                    } else if (computedRightLabel !== expectedRightLabel) {
                        debug('else', computedRightLabel, expectedRightLabel)
                        const error = new Error(
                            `Right child label mismatch at [${mid + 1},${end}]. ` +
                            `Expected: ${expectedRightLabel}, ` +
                            `Got: ${computedRightLabel}. `
                        )
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

                // Verify root label - this is the final check that everything chains
                // back to our ONLY trusted input (the root hash). If this matches,
                // we know all chunks were verified correctly through the tree structure.
                if (computedRootLabel !== rootLabel) {
                    const error = new Error(
                        `Root label mismatch. Expected: ${rootLabel}, ` +
                        `Got: ${computedRootLabel}`
                    )
                    throw error
                }

                controller.close()
            } catch (error) {
                // Only call onError if it hasn't been called already
                // Errors from decodeNode already called onError
                // But other errors (like stream read errors) need it
                if (opts.onError && error instanceof Error) {
                    opts.onError(error)
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
export async function getRootLabel (
    data:Uint8Array,
    chunkSize:number
):Promise<string> {
    const tree = await buildMerkleTree(data, chunkSize)
    return tree.label
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
