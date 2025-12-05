import { test } from '@substrate-system/tapzero'
import {
    verify,
    createVerifier,
    createEncoder,
    getRootLabel
} from '../src/index.js'
const isNode:boolean = (typeof process !== 'undefined' && !!process.versions?.node)
let __dirname:string
let path

if (isNode) {
    path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const __filename = fileURLToPath(import.meta.url)
    __dirname = path.dirname(__filename)
}

const CHUNK_SIZE = 2 * 1024  // 2KB chunks for faster tests

test('getRootLabel returns root hash', async t => {
    const data = generateTestData(5 * 1024)  // 5KB
    const chunkSize = 1024  // 1KB chunks
    const rootLabel = await getRootLabel(data, chunkSize)

    t.ok(rootLabel, 'should have root label')
    t.ok(rootLabel.length > 0, 'root label should not be empty')
    t.equal(typeof rootLabel, 'string', 'root label should be a string')
})

test('createEncoder with no data returns a TransformStream', async t => {
    const data = generateTestData(4 * 1024)  // 4KB test file
    const chunkSize = 1024  // 1KB chunks

    // Create encoder transform stream
    const encoderTransform = createEncoder(chunkSize)

    // Get root label for verification
    const rootLabel = await getRootLabel(data, chunkSize)

    // Create input stream
    const inputStream = new ReadableStream({
        start (controller) {
            controller.enqueue(data)
            controller.close()
        }
    })

    // Pipe through the encoder transform
    const encodedStream = inputStream.pipeThrough(encoderTransform)

    // Decode and verify the result
    const verifiedStream = createVerifier(encodedStream, rootLabel, chunkSize)
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

    // Combine chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
    }

    // Verify data matches original
    t.equal(result.length, data.length, 'decoded data length should match')
    t.ok(
        result.every((byte, i) => byte === data[i]),
        'decoded data should match original'
    )
})

test('createEncoder round-trip verification', async t => {
    const data = generateTestData(8 * 1024)  // 8KB test file
    const chunkSize = 2 * 1024  // 2KB chunks

    // Create a ReadableStream from the data
    const dataStream = new ReadableStream({
        start (controller) {
            controller.enqueue(data)
            controller.close()
        }
    })

    // Encode data
    const encodedStream = createEncoder(chunkSize, dataStream)
    const rootLabel = await getRootLabel(data, chunkSize)

    // Decode and verify
    const verifiedStream = createVerifier(
        encodedStream,
        rootLabel,
        chunkSize,
        {
            onChunkVerified: (i, total) => {
                t.ok(i > 0, 'chunk index should be positive')
                t.ok(i <= total, 'chunk index should not exceed total')
            }
        }
    )

    // Read verified data
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

    // Combine chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
    }

    // Verify data matches original
    t.equal(result.length, data.length, 'decoded data length should match')
    t.ok(
        result.every((byte, i) => byte === data[i]),
        'decoded data should match original'
    )
})

test('encodeBab and decodeBab with actual file', async t => {
    // Read the actual llama.jpg file
    const chunkSize = 1024

    // Read file using Node.js fs (in browser this test will be skipped)
    if (isNode) {
        const fs = await import('node:fs')

        const filePath = path.join(__dirname, 'example', 'llama.jpg')

        // Read the entire file first to get root label
        const fileBuffer = fs.readFileSync(filePath)
        const data = new Uint8Array(fileBuffer)
        const rootLabel = await getRootLabel(data, chunkSize)

        t.ok(data.length > 0, 'file should have data')
        t.ok(rootLabel, 'should have root label')

        // Create a ReadableStream from the file
        const fileReadStream = fs.createReadStream(filePath)

        // Convert Node.js Readable to Web ReadableStream
        const dataStream = new ReadableStream({
            async start (controller) {
                for await (const chunk of fileReadStream) {
                    controller.enqueue(new Uint8Array(chunk))
                }
                controller.close()
            }
        })

        // Encode the file stream
        const encodedStream = createEncoder(chunkSize, dataStream)

        // Decode and verify
        const verifiedStream = createVerifier(encodedStream, rootLabel, chunkSize)

        // Read verified data
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

        // Combine chunks
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const result = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
            result.set(chunk, offset)
            offset += chunk.length
        }

        // Verify data matches original
        t.equal(result.length, data.length, 'decoded data length should match')
        t.ok(
            result.every((byte, i) => byte === data[i]),
            'decoded data should match original'
        )
    } else {
        t.ok(true, 'Skipping file test in browser environment')
    }
})

test('decodeBab detects corrupted data', async t => {
    const data = generateTestData(6 * 1024)  // 6KB
    const chunkSize = 2 * 1024  // 2KB chunks

    // Create a ReadableStream from the data
    const dataStream = new ReadableStream({
        start (controller) {
            controller.enqueue(data)
            controller.close()
        }
    })

    // Encode data
    const encodedStream = createEncoder(chunkSize, dataStream)
    const rootLabel = await getRootLabel(data, chunkSize)

    // Read and corrupt the encoded stream
    const reader = encodedStream.getReader()
    const encodedChunks:Uint8Array[] = []
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            encodedChunks.push(value)
        }
    } finally {
        reader.releaseLock()
    }

    // Combine and corrupt
    const totalBytes = encodedChunks.reduce((sum, c) => sum + c.length, 0)
    const corruptedBuffer = new Uint8Array(totalBytes)
    let writeOffset = 0
    for (const chunk of encodedChunks) {
        corruptedBuffer.set(chunk, writeOffset)
        writeOffset += chunk.length
    }

    // Corrupt a byte in the data section (after length prefix and labels)
    const corruptIndex = Math.floor(corruptedBuffer.length / 2)
    corruptedBuffer[corruptIndex] = corruptedBuffer[corruptIndex] ^ 0xFF

    // Create stream from corrupted data
    const corruptedStream = new ReadableStream({
        start (controller) {
            controller.enqueue(corruptedBuffer)
            controller.close()
        }
    })

    // Attempt to decode - should fail during stream consumption
    const verifiedStream = createVerifier(corruptedStream, rootLabel, chunkSize)
    const verifiedReader = verifiedStream.getReader()

    try {
        // Try to read from the stream - should throw
        while (true) {
            const { done } = await verifiedReader.read()
            if (done) break
        }
        t.fail('should have thrown an error for corrupted data')
    } catch (error) {
        t.ok(error instanceof Error, 'should throw an Error')
        if (error instanceof Error) {
            t.ok(
                error.message.includes('mismatch') || error.message.includes('Not enough'),
                'error should mention verification failure'
            )
        }
    } finally {
        verifiedReader.releaseLock()
    }
})

test('detect corruption early without reading the entire stream', async t => {
    t.plan(2)
    // Create test data with 6 chunks
    const data = generateTestData(6 * 1024)  // 6KB
    const chunkSize = 1024  // 1KB chunks

    // Create a ReadableStream from the data
    const dataStream = new ReadableStream({
        start (controller) {
            controller.enqueue(data)
            controller.close()
        }
    })

    // Encode the original data
    const rootLabel = await getRootLabel(data, chunkSize)
    const encodedStream = createEncoder(chunkSize, dataStream)

    // Read the entire encoded stream into a buffer
    const reader = encodedStream.getReader()
    const encodedChunks:Uint8Array[] = []
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            encodedChunks.push(value)
        }
    } finally {
        reader.releaseLock()
    }

    // Combine into single buffer
    const totalBytes = encodedChunks.reduce((sum, c) => sum + c.length, 0)
    const encodedBuffer = new Uint8Array(totalBytes)
    let writeOffset = 0
    for (const chunk of encodedChunks) {
        encodedBuffer.set(chunk, writeOffset)
        writeOffset += chunk.length
    }

    // Corrupt the first chunk's data (after length prefix + labels)
    // The structure is: [8 bytes length][labels...][chunk data...]
    // For 6 chunks, there are 10 labels (5 internal nodes * 2) = 320 bytes
    const firstChunkOffset = 8 + (10 * 32)
    encodedBuffer[firstChunkOffset] = encodedBuffer[firstChunkOffset] ^ 0xFF

    // Track how much data was read from the stream before error
    let bytesRead = 0
    const trackingStream = new ReadableStream({
        start (controller) {
            let offset = 0
            // Enqueue one encoded chunk at a time to track reads accurately
            for (const chunk of encodedChunks) {
                controller.enqueue(encodedBuffer.slice(offset, offset + chunk.length))
                offset += chunk.length
            }
            controller.close()
        }
    })

    const trackingReader = trackingStream.getReader()
    const retrackingStream = new ReadableStream({
        async pull (controller) {
            const { done, value } = await trackingReader.read()
            if (done) {
                controller.close()
                return
            }
            bytesRead += value.length
            controller.enqueue(value)
        }
    })

    // Try to decode
    const verifiedStream = createVerifier(retrackingStream, rootLabel, chunkSize)
    const verifiedReader = verifiedStream.getReader()

    try {
        while (true) {
            const { done } = await verifiedReader.read()
            if (done) break
        }
        t.fail('should have thrown an error for corrupted data')
    } catch (error) {
        t.ok(error instanceof Error, 'should throw an Error')

        // Verify we didn't read the entire stream
        t.ok(
            bytesRead < totalBytes,
            `should detect corruption early (read ${bytesRead}/${totalBytes} bytes)`
        )
    } finally {
        verifiedReader.releaseLock()
    }
})

test('All done', () => {
    if (!isNode) {
        // @ts-expect-error tests
        window.testsFinished = true
    }
})

// Generate test data
function generateTestData (size:number):Uint8Array {
    const data = new Uint8Array(size)
    // Fill with random but deterministic data
    for (let i = 0; i < size; i++) {
        data[i] = (i * 7919 + 104729) % 256  // Use prime numbers for variety
    }
    return data
}
