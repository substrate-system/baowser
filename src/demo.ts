import { BaoEncoder } from './bao-encoder'
import { BaoDecoder } from './bao-decoder'
import * as fs from 'fs'
import * as path from 'path'
import type { BaoEncodingJson } from './types'

async function runDemo (): Promise<void> {
    console.log('╔════════════════════════════════════════════════════════════╗')
    console.log('║  Bao / BLAKE3 Verified Streaming Demo (TypeScript)        ║')
    console.log('║  Demonstrating incremental verification during download   ║')
    console.log('╚════════════════════════════════════════════════════════════╝\n')

    // Create directories
    const dirs = ['encoded', 'decoded']
    for (const dir of dirs) {
        const dirPath = path.join(process.cwd(), dir)
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true })
        }
    }

    const inputFile = 'test-file.bin'
    const encodedFile = 'encoded/test-file.bao'
    const decodedFile = 'decoded/test-file.bin'

    // Check if input file exists
    if (!fs.existsSync(inputFile)) {
        console.error(`Input file not found: ${inputFile}`)
        console.log('\nCreating a test file...')
        const testData = Buffer.alloc(50000)
        for (let i = 0; i < testData.length; i++) {
            testData[i] = Math.floor(Math.random() * 256)
        }
        fs.writeFileSync(inputFile, testData)
        console.log(`✓ Created ${inputFile}\n`)
    }

    console.log('═══════════════════════════════════════════════════════════\n')
    console.log('STEP 1: ENCODING\n')
    console.log('This simulates what happens on the server/sender side.\n')

    const encoder = new BaoEncoder(1024) // 1KB chunks
    await encoder.encode(inputFile, encodedFile)

    console.log('\n═══════════════════════════════════════════════════════════\n')
    console.log('STEP 2: STREAMING VERIFICATION\n')
    console.log('This simulates downloading and verifying chunks incrementally.\n')
    console.log('Key insight: Each chunk is verified BEFORE moving to the next!\n')

    const decoder = new BaoDecoder()

    // Add event listeners to show what's happening
    decoder.on('start', (metadata) => {
        console.log('📡 Starting download...')
    })

    decoder.on('chunk', (chunk) => {
        console.log(`✓ Chunk ${chunk.index + 1} verified and buffered`)
    })

    decoder.on('progress', (progress) => {
        const bar = '█'.repeat(Math.floor(progress.percentage / 2))
        const empty = '░'.repeat(50 - Math.floor(progress.percentage / 2))
        process.stdout.write(`\r[${bar}${empty}] ${progress.percentage}%`)
    })

    decoder.on('complete', (data) => {
        console.log('\n')
    })

    decoder.on('error', (error) => {
        console.error(`\n❌ Error: ${error.message}`)
    })

    try {
        await decoder.decodeFile(encodedFile, decodedFile, {
            delayMs: 50 // Simulate network latency
        })

        console.log('\n═══════════════════════════════════════════════════════════\n')
        console.log('STEP 3: VERIFICATION\n')

        // Compare original and decoded files
        const original = fs.readFileSync(inputFile)
        const decoded = fs.readFileSync(decodedFile)

        if (Buffer.compare(original, decoded) === 0) {
            console.log('✓ Files match perfectly! Verification successful.\n')

            console.log('═══════════════════════════════════════════════════════════\n')
            console.log('🎉 DEMO COMPLETE!\n')
            console.log('What just happened:\n')
            console.log('1. Original file was split into chunks and hashed')
            console.log('2. Each chunk was downloaded and verified individually')
            console.log('3. Root hash was verified after all chunks received')
            console.log('4. File integrity confirmed!\n')
            console.log('Try the web demo next:\n')
            console.log('  1. Run: npm start')
            console.log('  2. Visit: http://localhost:3000\n')
        } else {
            console.error('❌ Files do not match! Something went wrong.\n')
            process.exit(1)
        }
    } catch (error) {
        console.error(`\n❌ Demo failed: ${(error as Error).message}\n`)
        process.exit(1)
    }
}

async function runTamperDemo (): Promise<void> {
    console.log('\n╔════════════════════════════════════════════════════════════╗')
    console.log('║  BONUS: Tamper Detection Demo                             ║')
    console.log('╚════════════════════════════════════════════════════════════╝\n')

    const encodedFile = 'encoded/test-file.bao'

    if (!fs.existsSync(encodedFile)) {
        console.log('⚠️  Encoded file not found. Run the main demo first.\n')
        return
    }

    console.log('Corrupting a chunk to demonstrate tamper detection...\n')

    // Load the encoded file
    const encoded: BaoEncodingJson = JSON.parse(fs.readFileSync(encodedFile, 'utf8'))

    // Corrupt the middle chunk's data
    const middleChunk = Math.floor(encoded.chunks.length / 2)
    const originalData = encoded.chunks[middleChunk].data

    // Flip some bits in the base64 data
    const corrupted = originalData.split('').map((char, i) =>
        i === 10 ? (char === 'A' ? 'B' : 'A') : char
    ).join('')

    encoded.chunks[middleChunk].data = corrupted

    // Save corrupted version
    const corruptedFile = 'encoded/test-file-corrupted.bao'
    fs.writeFileSync(corruptedFile, JSON.stringify(encoded, null, 2))

    console.log(`Corrupted chunk ${middleChunk + 1}/${encoded.chunks.length}\n`)
    console.log('Attempting to decode the corrupted file...\n')

    const decoder = new BaoDecoder()
    decoder.on('chunk', (chunk) => {
        console.log(`✓ Chunk ${chunk.index + 1} verified`)
    })

    try {
        await decoder.decodeFile(corruptedFile, 'decoded/corrupted.bin', { delayMs: 50 })
        console.log('❌ Unexpected: Corrupted file was not detected!\n')
    } catch (error) {
        console.log('\n✓ SUCCESS: Corruption detected!')
        console.log(`   Error: ${(error as Error).message}\n`)
        console.log('This demonstrates that any tampering is immediately detected\n')
        console.log('during the streaming process, before the full file is downloaded.\n')
    }

    // Clean up
    fs.unlinkSync(corruptedFile)
}

// Run demos
async function main () {
    await runDemo()

    // Ask if user wants to see tamper demo
    console.log('Would you like to see a tamper detection demo? [Y/n]')

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    process.stdin.once('data', async (key: string) => {
        process.stdin.setRawMode(false)
        process.stdin.pause()

        if (key.toLowerCase() === 'y' || key === '\r') {
            await runTamperDemo()
        }

        console.log('═══════════════════════════════════════════════════════════\n')
        console.log('Thanks for trying the demo! 🚀\n')
        process.exit(0)
    })
}

if (require.main === module) {
    main()
}

export { runDemo, runTamperDemo }
