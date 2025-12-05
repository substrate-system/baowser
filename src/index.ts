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
 * Verify a Bab-encoded stream and return the complete verified data.
 *
 * Convenience function that handles streaming, verification,
 * and collecting chunks into a single Uint8Array.
 *
 * @param stream - The encoded stream to decode and verify
 * @param rootHash - The expected root hash for verification (your ONLY trusted input)
 * @param chunkSize - The chunk size used during encoding
 * @param options - Optional callbacks for verification events
 * @returns {Promise<Uint8Array>} Promise resolving to the complete verified data
 * @throws {Error} Throws if verification fails due to:
 *   - Hash mismatch (computed hash doesn't match expected label)
 *   - Root hash mismatch (final computed root doesn't match provided rootHash)
 *   - Insufficient data in stream
 *   - Stream read errors
 */
export async function verify (
    stream:ReadableStream<Uint8Array>,
    rootHash:string,
    chunkSize:number,
    options?:VerifierOptions
):Promise<Uint8Array> {
    const verifier = createVerifier(rootHash, chunkSize, options)
    const verifiedStream = stream.pipeThrough(verifier)
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
 * Create a verifier transform stream that decodes and verifies encoded data.
 *
 * Returns a TransformStream that accepts encoded chunks on the writable side
 * and outputs verified data chunks on the readable side.
 *
 * @param rootHash - The expected root hash (should be trusted input)
 * @param chunkSize - The chunk size used during encoding
 * @param options - Optional callbacks for verification events
 * @returns {TransformStream} A TransformStream<Uint8Array, Uint8Array>.
 *  Transforms the input to an output stream of regular blob chunks.
 *
 * @example
 * ```ts
 * const verifier = createVerifier(rootHash, chunkSize)
 * const verifiedStream = encodedStream.pipeThrough(verifier)
 * ```
 */
export function createVerifier (
    rootLabel:string,
    chunkSize:number,
    opts:VerifierOptions = {}
):TransformStream<Uint8Array, Uint8Array> {
    const LABEL_SIZE = createVerifier.LABEL_SIZE
    let buffer = new Uint8Array(0)

    return new TransformStream({
        // Buffer incoming chunks
        transform (chunk) {
            const newBuffer = new Uint8Array(buffer.length + chunk.length)
            newBuffer.set(buffer, 0)
            newBuffer.set(chunk, buffer.length)
            buffer = newBuffer
        },

        // Process all buffered data when stream ends
        async flush (controller) {
            try {
                let offset = 0

                // Helper to read bytes from buffer
                function readBytes (count:number):Uint8Array {
                    if (offset + count > buffer.length) {
                        throw new Error(
                            `Not enough data in buffer. Needed ${count} bytes, ` +
                            `have ${buffer.length - offset}`
                        )
                    }
                    const result = buffer.slice(offset, offset + count)
                    offset += count
                    return result
                }

                // Read length prefix (8 bytes, little-endian uint64)
                const lengthBytes = readBytes(8)
                const lengthView = new DataView(lengthBytes.buffer, lengthBytes.byteOffset)
                const totalLength = Number(lengthView.getBigUint64(0, true))
                const numChunks = Math.ceil(totalLength / chunkSize)

                // Recursive function to decode a node
                //
                // At each level:
                // - For leaves: we hash the data chunk and return that hash
                // - For internal nodes: recursively decode children, verify
                //   their computed hashes match the expected labels,
                //   then compute this node's hash from its children
                // - Everything chains up to verify against the rootLabel
                async function decodeNode (
                    start:number,
                    end:number
                ):Promise<string> {
                    if (start === end) {
                        // Leaf node - read and verify chunk
                        const chunkIndex = start
                        const isLastChunk = chunkIndex === numChunks - 1
                        const expectedSize = isLastChunk ?
                            totalLength - (chunkIndex * chunkSize) :
                            chunkSize

                        const chunkData = readBytes(expectedSize)

                        // Compute this chunk's hash
                        // this will be verified by the parent
                        const label = await hashChunk(chunkData)

                        // Emit verified chunk immediately
                        controller.enqueue(chunkData)

                        if (opts.onChunkVerified) {
                            opts.onChunkVerified(chunkIndex + 1, numChunks)
                        }

                        return label
                    }

                    // Internal node
                    // read expected labels for children from the stream
                    const leftLabelBytes = readBytes(LABEL_SIZE)
                    const rightLabelBytes = readBytes(LABEL_SIZE)

                    const expectedLeftLabel = bytesToHex(leftLabelBytes)
                    const expectedRightLabel = bytesToHex(rightLabelBytes)

                    // Decode children recursively - they'll compute their own hashes
                    const mid = Math.floor((start + end) / 2)
                    const computedLeftLabel = await decodeNode(start, mid)
                    const computedRightLabel = await decodeNode(mid + 1, end)

                    // INCREMENTAL VERIFICATION
                    // Verify computed hashes match expected labels from
                    // the stream. Verify each subtree immediately
                    if (computedLeftLabel !== expectedLeftLabel) {
                        debug('if', computedLeftLabel, expectedLeftLabel)
                        throw new Error(
                            `Left child label mismatch at [${start},${mid}]. ` +
                            `Expected: ${expectedLeftLabel}, Got: ${computedLeftLabel}`
                        )
                    }
                    if (computedRightLabel !== expectedRightLabel) {
                        debug('else', computedRightLabel, expectedRightLabel)
                        throw new Error(
                            `Right child label mismatch at [${mid + 1},${end}]. ` +
                            `Expected: ${expectedRightLabel}, Got: ${computedRightLabel}`
                        )
                    }

                    // Compute this node's label from its children
                    let byteCount = 0
                    for (let i = start; i <= end; i++) {
                        if (i === numChunks - 1) {
                            byteCount += totalLength - (i * chunkSize)
                        } else {
                            byteCount += chunkSize
                        }
                    }

                    return await hashInner(
                        computedLeftLabel,
                        computedRightLabel,
                        byteCount
                    )
                }

                // Decode the tree and verify
                const computedRootLabel = await decodeNode(0, numChunks - 1)

                // Verify root label - the final check that everything chains
                // back to our trusted root hash. If this matches,
                // we know all chunks were verified correctly through the
                // tree structure.
                if (computedRootLabel !== rootLabel) {
                    throw new Error(
                        `Root label mismatch. Expected: ${rootLabel}, ` +
                        `Got: ${computedRootLabel}`
                    )
                }

                // All verified successfully - terminate the stream
                controller.terminate()
            } catch (error) {
                // Call onError callback if provided
                if (opts.onError && error instanceof Error) {
                    opts.onError(error)
                }
                // Signal error to the stream
                // this aborts both readable and writable sides
                controller.error(error)
            }
        }
    })
}

createVerifier.LABEL_SIZE = 32

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
 * Hash a leaf node (chunk of data)
 */
async function hashChunk (data:Uint8Array):Promise<string> {
    return await blake3(data)
}
