import { test } from '@substrate-system/tapzero'
import {
    encode,
    verify,
    createVerifier,
    createEncoder,
    getRootLabel
} from '../src/index.js'

const CHUNK_SIZE = 64 * 1024  // 64KB chunks

test('encode data and generate metadata', async t => {
    const data = generateTestData(200 * 1024)  // 200KB test file
    const metadata = await encode(data, CHUNK_SIZE)

    t.ok(metadata.rootHash, 'should have root hash')
    t.ok(metadata.rootHash.length > 0, 'root hash should not be empty')
    t.equal(metadata.fileSize, data.length, 'file size should match')
    t.equal(metadata.chunkSize, CHUNK_SIZE, 'chunk size should match')
    t.ok(metadata.chunks.length > 0, 'should have chunks')

    // Verify each chunk has hash and size
    for (const chunk of metadata.chunks) {
        t.ok(chunk.hash, 'chunk should have hash')
        t.ok(chunk.size > 0, 'chunk should have size')
    }
})

test('verify valid data', async t => {
    const data = generateTestData(150 * 1024)  // 150KB test file
    const metadata = await encode(data, CHUNK_SIZE)

    // Create a readable stream from the data
    const stream = new ReadableStream({
        start (controller) {
            controller.enqueue(data)
            controller.close()
        }
    })

    // Verify the stream
    const verifiedData = await verify(stream, metadata)

    t.equal(verifiedData.length, data.length, 'verified data length should match')
    t.ok(
        verifiedData.every((byte, i) => byte === data[i]),
        'verified data should match original'
    )
})

test('detect corruption', async t => {
    const data = generateTestData(100 * 1024)  // 100KB test file
    const metadata = await encode(data, CHUNK_SIZE)

    // Create corrupted data by flipping a single bit in the middle
    const corruptedData = new Uint8Array(data.length)
    corruptedData.set(data)
    const corruptIndex = Math.floor(data.length / 2)
    corruptedData[corruptIndex] = corruptedData[corruptIndex] ^ 0x01 // Flip the least significant bit

    const stream = new ReadableStream({
        start (controller) {
            controller.enqueue(corruptedData)
            controller.close()
        }
    })

    // Verification should fail
    try {
        await verify(stream, metadata)
        t.fail('should have thrown an error for corrupted data')
    } catch (error) {
        t.ok(error instanceof Error, 'should throw an Error')
        if (error instanceof Error) {
            t.ok(
                error.message.includes('hash mismatch'),
                'error should mention hash mismatch'
            )
        }
    }
})

test('detect corruption at the beginning of file', async t => {
    const data = generateTestData(100 * 1024)  // 100KB test file
    const metadata = await encode(data, CHUNK_SIZE)

    // Corrupt the first byte
    const corruptedData = new Uint8Array(data.length)
    corruptedData.set(data)
    corruptedData[0] = corruptedData[0] ^ 0x80  // Flip the most significant bit

    const stream = new ReadableStream({
        start (controller) {
            controller.enqueue(corruptedData)
            controller.close()
        }
    })

    try {
        await verify(stream, metadata)
        t.fail('should have thrown an error for corrupted data')
    } catch (error) {
        t.ok(error instanceof Error, 'should throw an Error')
        if (error instanceof Error) {
            t.ok(
                error.message.includes('Chunk 1 hash mismatch'),
                'should detect corruption in first chunk'
            )
        }
    }
})

test('should detect corruption at the end of file', async t => {
    const data = generateTestData(100 * 1024)  // 100KB test file
    const metadata = await encode(data, CHUNK_SIZE)

    // bad last byte
    const corruptedData = new Uint8Array(data.length)
    corruptedData.set(data)
    const lastIndex = data.length - 1
    corruptedData[lastIndex] = corruptedData[lastIndex] ^ 0x01

    const stream = new ReadableStream({
        start (controller) {
            controller.enqueue(corruptedData)
            controller.close()
        }
    })

    try {
        await verify(stream, metadata)
        t.fail('should have thrown an error for corrupted data')
    } catch (error) {
        t.ok(error instanceof Error, 'should throw an Error')
        if (error instanceof Error) {
            t.ok(
                error.message.includes('hash mismatch'),
                'error should mention hash mismatch'
            )
        }
    }
})

test('track chunk verification progress', async t => {
    const data = generateTestData(100 * 1024)  // 100KB test file
    const metadata = await encode(data, CHUNK_SIZE)

    const verifiedChunks:number[] = []

    const stream = new ReadableStream({
        start (controller) {
            controller.enqueue(data)
            controller.close()
        }
    })

    await verify(stream, metadata, {
        onChunkVerified: (chunkIndex, totalChunks) => {
            verifiedChunks.push(chunkIndex)
            t.ok(chunkIndex <= totalChunks, 'chunk index should be valid')
        }
    })

    t.equal(verifiedChunks.length, metadata.chunks.length,
        'should verify all chunks')

    // chunks should be in order
    for (let i = 0; i < verifiedChunks.length; i++) {
        t.equal(verifiedChunks[i], i + 1,
            `chunk ${i + 1} should be verified in order`)
    }
})

test('invoke error callback and throw on corruption', async t => {
    const data = generateTestData(100 * 1024)  // 100KB test file

    t.ok(data.length > 1000, 'test file should be large enough')

    const metadata = await encode(data, CHUNK_SIZE)

    // Corrupt data in the middle of first chunk
    const corruptedData = new Uint8Array(data.length)
    corruptedData.set(data)
    const originalValue = corruptedData[1000]
    corruptedData[1000] = originalValue ^ 0xFF

    t.notEqual(corruptedData[1000], originalValue, 'data should be corrupted')

    let errorCallbackInvoked = false

    const stream = new ReadableStream({
        start (controller) {
            controller.enqueue(corruptedData)
            controller.close()
        }
    })

    try {
        await verify(stream, metadata, {
            onError: (error) => {
                errorCallbackInvoked = true
                t.ok(error instanceof Error,
                    'error callback should receive Error instance')
            }
        })
        t.fail('verify should have thrown an error for corrupted data')
    } catch (error) {
        t.ok(error instanceof Error, 'should throw an Error instance')
        t.ok(errorCallbackInvoked, 'onError callback should have been invoked')
    }
})

test('use createVerifier to manually pipe data through transform stream', async t => {
    const data = generateTestData(100 * 1024)  // 100KB test file
    const metadata = await encode(data, CHUNK_SIZE)

    // Create verifier transform stream
    const verifier = createVerifier(metadata)

    // Create input stream
    const inputStream = new ReadableStream({
        start (controller) {
            controller.enqueue(data)
            controller.close()
        }
    })

    // Pipe through verifier
    const verifiedStream = inputStream.pipeThrough(verifier)
    const reader = verifiedStream.getReader()

    // Collect verified chunks
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

    t.equal(result.length, data.length, 'verified data length should match')
    t.ok(
        result.every((byte, i) => byte === data[i]),
        'verified data should match original'
    )
})

test('createVerifier should detect corruption', async t => {
    const data = generateTestData(100 * 1024)  // 100KB test file
    const metadata = await encode(data, CHUNK_SIZE)

    // Corrupt the data
    const corruptedData = new Uint8Array(data.length)
    corruptedData.set(data)
    corruptedData[500] = corruptedData[500] ^ 0xFF

    let errorDetected = false

    // Create verifier with error callback
    const verifier = createVerifier(metadata, {
        onError: (error) => {
            errorDetected = true
            t.ok(error instanceof Error, 'should receive Error in callback')
            t.ok(
                error.message.includes('hash mismatch'),
                'error should indicate hash mismatch'
            )
        }
    })

    // Create input stream with corrupted data
    const inputStream = new ReadableStream({
        start (controller) {
            controller.enqueue(corruptedData)
            controller.close()
        }
    })

    // Pipe through verifier - should throw
    const verifiedStream = inputStream.pipeThrough(verifier)
    const reader = verifiedStream.getReader()

    try {
        while (true) {
            const { done } = await reader.read()
            if (done) break
        }
        t.fail('should have thrown an error for corrupted data')
    } catch (error) {
        t.ok(error instanceof Error, 'should throw Error')
        t.ok(errorDetected, 'onError callback should have been invoked')
    } finally {
        reader.releaseLock()
    }
})

test('createVerifier with callback tracking', async t => {
    const data = generateTestData(50 * 1024)  // 50KB - less than one chunk
    const metadata = await encode(data, CHUNK_SIZE)

    t.equal(metadata.chunks.length, 1, 'should have exactly one chunk for 50KB')

    let onChunkVerifiedCalled = false
    let onErrorCalled = false

    // Create verifier with callbacks
    const verifier = createVerifier(metadata, {
        onChunkVerified: (chunkIndex, totalChunks) => {
            onChunkVerifiedCalled = true
            t.equal(chunkIndex, 1, 'should verify chunk 1')
            t.equal(totalChunks, 1, 'should have 1 total chunk')
        },
        onError: (error) => {
            onErrorCalled = true
            t.fail(`Should not call onError: ${error.message}`)
        }
    })

    // Create input stream with all data at once
    const inputStream = new ReadableStream({
        start (controller) {
            controller.enqueue(data)
            controller.close()
        }
    })

    // Pipe through verifier
    const verifiedStream = inputStream.pipeThrough(verifier)
    const reader = verifiedStream.getReader()

    // Read all data
    try {
        while (true) {
            const { done } = await reader.read()
            if (done) break
        }
    } finally {
        reader.releaseLock()
    }

    t.ok(onChunkVerifiedCalled,
        'onChunkVerified callback should have been called')
    t.equal(onErrorCalled, false,
        'onError callback should not have been called')
})

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
    // Use a size similar to the llama image in the demo: ~2.13 MB
    // With 1024 byte chunks = 2080 chunks (not a power of 2)
    const data = generateTestData(2180000)  // ~2.08 MB
    const chunkSize = 1024

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

// Generate test data
function generateTestData (size:number):Uint8Array {
    const data = new Uint8Array(size)
    // Fill with random but deterministic data
    for (let i = 0; i < size; i++) {
        data[i] = (i * 7919 + 104729) % 256  // Use prime numbers for variety
    }
    return data
}
