import { blake3 } from 'hash-wasm'
import * as fs from 'fs'
import type { BaoEncoding, BaoEncodingJson, BaoChunk } from './types'

/**
 * Simplified Bao-style encoder
 * Breaks a file into chunks and creates a Merkle tree of hashes
 */

const DEFAULT_CHUNK_SIZE = 1024 // 1KB chunks

export class BaoEncoder {
    private chunkSize: number

    constructor (chunkSize: number = DEFAULT_CHUNK_SIZE) {
        this.chunkSize = chunkSize
    }

    /**
   * Encode a file into a Bao-like format with chunk hashes
   */
    async encode (inputPath: string, outputPath: string): Promise<BaoEncoding> {
        const fileBuffer = fs.readFileSync(inputPath)
        const fileSize = fileBuffer.length

        console.log(`Encoding file: ${inputPath}`)
        console.log(`File size: ${fileSize} bytes`)
        console.log(`Chunk size: ${this.chunkSize} bytes`)

        // Calculate root hash of the entire file
        const rootHash = await blake3(fileBuffer)
        console.log(`Root hash: ${rootHash}`)

        // Break file into chunks and calculate hash for each
        const chunks: BaoChunk[] = []

        for (let offset = 0; offset < fileSize; offset += this.chunkSize) {
            const end = Math.min(offset + this.chunkSize, fileSize)
            const chunk = fileBuffer.slice(offset, end)
            const chunkHash = await blake3(chunk)

            chunks.push({
                size: chunk.length,
                hash: chunkHash,
                data: chunk
            })

            console.log(`Chunk ${chunks.length}: offset ${offset}, size ${chunk.length}, hash ${chunkHash}`)
        }

        const encoding: BaoEncoding = {
            fileSize,
            rootHash,
            chunkSize: this.chunkSize,
            chunkCount: chunks.length,
            chunks
        }

        // Save as JSON for easy parsing
        const jsonEncoding: BaoEncodingJson = {
            fileSize: encoding.fileSize,
            rootHash: encoding.rootHash,
            chunkSize: encoding.chunkSize,
            chunkCount: encoding.chunkCount,
            chunks: encoding.chunks.map(c => ({
                size: c.size,
                hash: c.hash,
                data: c.data.toString('base64')
            }))
        }

        fs.writeFileSync(outputPath, JSON.stringify(jsonEncoding, null, 2))

        console.log(`\nEncoded file saved to: ${outputPath}`)
        console.log(`Total chunks: ${chunks.length}`)

        return encoding
    }

    /**
   * Get the chunk size used by this encoder
   */
    getChunkSize (): number {
        return this.chunkSize
    }
}

// CLI usage
async function main () {
    const args = process.argv.slice(2)
    if (args.length < 2) {
        console.log('Usage: tsx src/bao-encoder.ts <input-file> <output-file> [chunk-size]')
        process.exit(1)
    }

    const [inputPath, outputPath, chunkSizeStr] = args
    const chunkSize = chunkSizeStr ? parseInt(chunkSizeStr) : DEFAULT_CHUNK_SIZE
    const encoder = new BaoEncoder(chunkSize)

    try {
        await encoder.encode(inputPath, outputPath)
        console.log('\nEncoding complete!')
    } catch (err) {
        console.error('Error:', err)
        process.exit(1)
    }
}

if (require.main === module) {
    main()
}
