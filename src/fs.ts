import { mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import * as path from 'node:path'
import { createEncoder, getRootLabel } from './index.js'

/**
 * Write data to a file with the root hash as filename.
 *
 * @param dir Directory path where the file will be written
 * @param data Data to encode and write (Buffer, Uint8Array, or ReadableStream)
 * @param options Encoding options
 * @param options.chunkSize Chunk size for encoding (default: 1024)
 * @returns {Promise<{ rootHash, filePath }>}
 *
 * @example
 * ```ts
 * const { rootHash, filePath } = await writeByHash(
 *   './data',
 *   Buffer.from('hello world'),
 *   { chunkSize: 1024 }
 * )
 * console.log(`Wrote file: ${filePath}`)
 * console.log(`Root hash: ${rootHash}`)
 * ```
 */
export async function write (
    dir:string,
    data:Buffer|Uint8Array|ReadableStream<Uint8Array>,
    { chunkSize = 1024 }:{ chunkSize?:number } = {}
):Promise<{ rootHash:string; filePath:string }> {
    // Ensure directory exists
    await mkdir(dir, { recursive: true })

    // Convert data to Uint8Array if it's a Buffer
    let dataArray:Uint8Array

    if (data instanceof ReadableStream) {
        // If it's already a stream, we need to read it to compute the hash
        // then re-create it for encoding
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

        // Combine chunks
        dataArray = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
            dataArray.set(chunk, offset)
            offset += chunk.length
        }
    } else {
        dataArray = data instanceof Buffer ? new Uint8Array(data) : data
    }

    // Get root hash
    const rootHash = await getRootLabel(dataArray, chunkSize)

    // Create file path using root hash
    const filePath = path.join(dir, rootHash)

    // Create data stream for encoding
    const dataStream = new ReadableStream({
        start (controller) {
            controller.enqueue(dataArray)
            controller.close()
        }
    })

    // Encode the data
    const encodedStream = createEncoder(chunkSize, dataStream)

    // Write to file using Web Streams API
    const writer = createWriteStream(filePath)
    const reader = encodedStream.getReader()

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            writer.write(value)
        }
    } finally {
        reader.releaseLock()
        writer.end()

        // Wait for write to complete
        await new Promise<void>((resolve, reject) => {
            writer.on('finish', resolve)
            writer.on('error', reject)
        })
    }

    return { rootHash, filePath }
}
