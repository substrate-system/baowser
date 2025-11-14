import { test } from '@substrate-system/tapzero'
import { encode, verifyStream, createVerifier } from '../src/index.js'

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
    const verifiedData = await verifyStream(stream, metadata)

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
        await verifyStream(stream, metadata)
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
        await verifyStream(stream, metadata)
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
        await verifyStream(stream, metadata)
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

    await verifyStream(stream, metadata, {
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
        await verifyStream(stream, metadata, {
            onError: (error) => {
                errorCallbackInvoked = true
                t.ok(error instanceof Error,
                    'error callback should receive Error instance')
            }
        })
        t.fail('verifyStream should have thrown an error for corrupted data')
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

    t.ok(onChunkVerifiedCalled, 'onChunkVerified callback should have been called')
    t.equal(onErrorCalled, false, 'onError callback should not have been called')
})

test('encodeBab creates self-contained stream with metadata', async t => {
    const data = generateTestData(10 * 1024)  // 10KB test file
    const chunkSize = 2 * 1024  // 2KB chunks

    // Encode data into Bab format
    const { encodeBab } = await import('../src/index.js')
    const encodedStream = await encodeBab(data, chunkSize)

    // Read the encoded stream
    const reader = encodedStream.getReader()
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

    // Verify we got data back
    t.ok(chunks.length > 0, 'should have encoded chunks')

    // First chunk should be the length prefix (8 bytes)
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    t.ok(totalLength > data.length, 'encoded stream should be larger than original (includes metadata)')
})

test('getBabRootLabel returns root hash', async t => {
    const data = generateTestData(5 * 1024)  // 5KB
    const chunkSize = 1024  // 1KB chunks

    const { getBabRootLabel } = await import('../src/index.js')
    const rootLabel = await getBabRootLabel(data, chunkSize)

    t.ok(rootLabel, 'should have root label')
    t.ok(rootLabel.length > 0, 'root label should not be empty')
    t.equal(typeof rootLabel, 'string', 'root label should be a string')
})

test('encodeBab and decodeBab round-trip verification', async t => {
    const data = generateTestData(8 * 1024)  // 8KB test file
    const chunkSize = 2 * 1024  // 2KB chunks

    const { encodeBab, getBabRootLabel, decodeBab } = await import('../src/index.js')

    // Encode data
    const encodedStream = await encodeBab(data, chunkSize)
    const rootLabel = await getBabRootLabel(data, chunkSize)

    // Decode and verify
    const verifiedStream = await decodeBab(encodedStream, rootLabel, chunkSize, {
        onChunkVerified: (i, total) => {
            t.ok(i > 0, 'chunk index should be positive')
            t.ok(i <= total, 'chunk index should not exceed total')
        }
    })

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

    const { encodeBab, getBabRootLabel, decodeBab } = await import('../src/index.js')

    // Encode data
    const encodedStream = await encodeBab(data, chunkSize)
    const rootLabel = await getBabRootLabel(data, chunkSize)

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

    // Attempt to decode - should fail
    try {
        await decodeBab(corruptedStream, rootLabel, chunkSize)
        t.fail('should have thrown an error for corrupted data')
    } catch (error) {
        t.ok(error instanceof Error, 'should throw an Error')
        if (error instanceof Error) {
            t.ok(
                error.message.includes('mismatch') || error.message.includes('Not enough'),
                'error should mention verification failure'
            )
        }
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
