import { blake3 } from 'hash-wasm'
import * as fs from 'fs'
import { EventEmitter } from 'events'
import type {
    BaoMetadata,
    BaoEncodingJson,
    BaoChunkJson,
    ChunkVerificationEvent,
    ProgressEvent,
    DecoderOptions
} from './types'

/**
 * Simplified Bao-style decoder
 * Verifies chunks incrementally as they arrive
 */

export interface BaoDecoderEvents {
  start: (metadata: BaoMetadata) => void;
  chunk: (chunk: ChunkVerificationEvent) => void;
  progress: (progress: ProgressEvent) => void;
  complete: (data: Buffer) => void;
  error: (error: Error) => void;
}

export declare interface BaoDecoder {
  on<U extends keyof BaoDecoderEvents>(event: U, listener: BaoDecoderEvents[U]): this;
  emit<U extends keyof BaoDecoderEvents>(event: U, ...args: Parameters<BaoDecoderEvents[U]>): boolean;
}

export class BaoDecoder extends EventEmitter {
    private metadata: BaoMetadata | null = null
    private verifiedChunks: Buffer[] = []
    private receivedChunks: number = 0

    /**
   * Start decoding with metadata
   */
    start (metadata: BaoMetadata): void {
        this.metadata = metadata
        console.log('\n=== Starting Bao Decoder ===')
        console.log(`Expected root hash: ${metadata.rootHash}`)
        console.log(`File size: ${metadata.fileSize} bytes`)
        console.log(`Total chunks: ${metadata.chunkCount}`)
        this.emit('start', metadata)
    }

    /**
   * Process a chunk and verify it incrementally
   */
    async processChunk (chunkData: BaoChunkJson): Promise<Buffer> {
        if (!this.metadata) {
            throw new Error('Decoder not started. Call start() first.')
        }

        const { size, hash, data } = chunkData
        this.receivedChunks++

        console.log(`\n--- Processing chunk ${this.receivedChunks}/${this.metadata.chunkCount} ---`)
        console.log(`Expected hash: ${hash}`)
        console.log(`Chunk size: ${size} bytes`)

        // Decode base64 data
        const buffer = Buffer.from(data, 'base64')

        // Verify the chunk hash
        const computedHash = await blake3(buffer)
        console.log(`Computed hash: ${computedHash}`)

        if (computedHash !== hash) {
            const error = new Error(`Chunk ${this.receivedChunks} hash mismatch!`)
            this.emit('error', error)
            throw error
        }

        console.log('✓ Chunk verified successfully!')
        this.verifiedChunks.push(buffer)

        // Emit chunk verified event
        this.emit('chunk', {
            index: this.receivedChunks - 1,
            size,
            hash,
            data: buffer
        })

        // Calculate progress
        const progress = (this.receivedChunks / this.metadata.chunkCount) * 100
        this.emit('progress', {
            received: this.receivedChunks,
            total: this.metadata.chunkCount,
            percentage: parseFloat(progress.toFixed(2))
        })

        return buffer
    }

    /**
   * Finalize decoding and verify root hash
   */
    async finalize (): Promise<Buffer> {
        if (!this.metadata) {
            throw new Error('Decoder not started. Call start() first.')
        }

        console.log('\n=== Finalizing Decoding ===')

        // Combine all chunks
        const fullFile = Buffer.concat(this.verifiedChunks)
        console.log(`Reconstructed file size: ${fullFile.length} bytes`)

        // Verify root hash
        const computedRootHash = await blake3(fullFile)
        console.log(`Expected root hash: ${this.metadata.rootHash}`)
        console.log(`Computed root hash: ${computedRootHash}`)

        if (computedRootHash !== this.metadata.rootHash) {
            const error = new Error('Root hash mismatch! File integrity check failed.')
            this.emit('error', error)
            throw error
        }

        console.log('✓ Root hash verified! File is authentic and complete.')
        this.emit('complete', fullFile)

        return fullFile
    }

    /**
   * Decode from a file (simulates streaming)
   */
    async decodeFile (
        encodedPath: string,
        outputPath: string,
        options: DecoderOptions = {}
    ): Promise<Buffer> {
        const { delayMs = 0 } = options

        // Load encoded file
        const encoded: BaoEncodingJson = JSON.parse(fs.readFileSync(encodedPath, 'utf8'))

        // Start decoding
        this.start({
            fileSize: encoded.fileSize,
            rootHash: encoded.rootHash,
            chunkSize: encoded.chunkSize,
            chunkCount: encoded.chunkCount
        })

        // Process each chunk (with optional delay to simulate network streaming)
        for (const chunk of encoded.chunks) {
            if (delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs))
            }
            await this.processChunk(chunk)
        }

        // Finalize and verify
        const decodedFile = await this.finalize()

        // Save decoded file
        fs.writeFileSync(outputPath, decodedFile)
        console.log(`\nDecoded file saved to: ${outputPath}`)

        return decodedFile
    }

    /**
   * Reset the decoder state
   */
    reset (): void {
        this.metadata = null
        this.verifiedChunks = []
        this.receivedChunks = 0
    }
}

// CLI usage
async function main () {
    const args = process.argv.slice(2)
    if (args.length < 2) {
        console.log('Usage: tsx src/bao-decoder.ts <encoded-file> <output-file> [delay-ms]')
        process.exit(1)
    }

    const [encodedPath, outputPath, delayMsStr] = args
    const decoder = new BaoDecoder()

    // Add progress listener
    decoder.on('progress', (progress) => {
        console.log(`Progress: ${progress.percentage}% (${progress.received}/${progress.total} chunks)`)
    })

    try {
        await decoder.decodeFile(encodedPath, outputPath, {
            delayMs: delayMsStr ? parseInt(delayMsStr) : 100
        })
        console.log('\nDecoding complete!')
    } catch (err) {
        console.error('Error:', (err as Error).message)
        process.exit(1)
    }
}

if (require.main === module) {
    main()
}
