import { test } from '@substrate-system/tapzero'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { equals } from 'uint8arrays'
import { write } from '../src/fs.js'
import { verify, getRootLabel } from '../src/index.js'

const TEST_DIR = path.join(process.cwd(), 'test-output')
const CHUNK_SIZE = 1024

test('write file with Buffer', async t => {
    await cleanup()

    const testData = Buffer.from('hello world')
    const { rootHash, filePath } = await write(TEST_DIR, testData, {
        chunkSize: CHUNK_SIZE
    })

    // Verify hash was returned
    t.equal(typeof rootHash, 'string', 'root hash should be a string')
    t.ok(rootHash.length > 0, 'hash should not be empty')

    // Verify file path was returned
    t.ok(filePath, 'should return file path')
    t.ok(filePath.includes(rootHash), 'file path should contain hash')

    // Verify file exists
    const fileExists = fs.existsSync(filePath)
    t.ok(fileExists, 'file should exist on disk')

    // Verify we can read and verify the file
    const encodedData = await fs.promises.readFile(filePath)
    const encodedStream = new ReadableStream({
        start (controller) {
            controller.enqueue(encodedData)
            controller.close()
        }
    })

    const verifiedData = await verify(encodedStream, rootHash, CHUNK_SIZE)
    t.equal(verifiedData.length, testData.length,
        'verified data length should match')

    t.ok(
        verifiedData.every((byte, i) => byte === testData[i]),
        'verified data should match original'
    )

    await cleanup()
})

test('write file with Uint8Array', async t => {
    await cleanup()

    const testData = generateTestData(5 * 1024) // 5KB
    const { rootHash, filePath } = await write(TEST_DIR, testData, {
        chunkSize: CHUNK_SIZE
    })

    t.ok(rootHash, 'should return root hash')
    t.ok(filePath, 'should return file path')

    // Verify file exists
    const fileExists = fs.existsSync(filePath)
    t.ok(fileExists, 'file should exist on disk')

    // Read and verify
    const encodedData = await fs.promises.readFile(filePath)
    const encodedStream = new ReadableStream({
        start (controller) {
            controller.enqueue(encodedData)
            controller.close()
        }
    })

    const verifiedData = await verify(encodedStream, rootHash, CHUNK_SIZE)
    t.equal(verifiedData.length, testData.length,
        'verified data length should match')
    t.ok(
        verifiedData.every((byte, i) => byte === testData[i]),
        'verified data should match original'
    )

    t.ok(equals(testData, verifiedData), 'should return the same data')

    await cleanup()
})

test('write file with ReadableStream', async t => {
    await cleanup()

    const testData = generateTestData(3 * 1024) // 3KB
    const dataStream = new ReadableStream({
        start (controller) {
            controller.enqueue(testData)
            controller.close()
        }
    })

    const { rootHash, filePath } = await write(TEST_DIR, dataStream, {
        chunkSize: CHUNK_SIZE
    })

    t.ok(rootHash, 'should return root hash')
    t.ok(filePath, 'should return file path')

    // Verify file exists
    const fileExists = fs.existsSync(filePath)
    t.ok(fileExists, 'file should exist on disk')

    // Read and verify
    const encodedData = await fs.promises.readFile(filePath)
    const encodedStream = new ReadableStream({
        start (controller) {
            controller.enqueue(encodedData)
            controller.close()
        }
    })

    const verifiedData = await verify(encodedStream, rootHash, CHUNK_SIZE)
    t.equal(verifiedData.length, testData.length,
        'verified data length should match')

    await cleanup()
})

test('write creates directory if it does not exist', async t => {
    await cleanup()

    const nestedDir = path.join(TEST_DIR, 'nested', 'deep', 'path')
    const testData = Buffer.from('test data')

    const { rootHash, filePath } = await write(nestedDir, testData, {
        chunkSize: CHUNK_SIZE
    })

    t.ok(rootHash, 'should return root hash')
    t.ok(filePath, 'should return file path')

    // Verify nested directory was created
    const dirExists = fs.existsSync(nestedDir)
    t.ok(dirExists, 'nested directory should be created')

    // Verify file exists in nested directory
    const fileExists = fs.existsSync(filePath)
    t.ok(fileExists, 'file should exist in nested directory')

    await cleanup()
})

test('hash matches computed root label', async t => {
    await cleanup()

    const testData = generateTestData(2 * 1024) // 2KB
    const expectedHash = await getRootLabel(testData, CHUNK_SIZE)

    const { rootHash } = await write(TEST_DIR, testData, {
        chunkSize: CHUNK_SIZE
    })

    t.equal(rootHash, expectedHash, 'returned hash should match computed root label')

    await cleanup()
})

test('write with different chunk sizes', async t => {
    await cleanup()

    const testData = generateTestData(4 * 1024) // 4KB
    const chunkSizes = [512, 1024, 2048]

    for (const chunkSize of chunkSizes) {
        const { rootHash, filePath } = await write(TEST_DIR, testData, {
            chunkSize
        })

        t.ok(rootHash, `should return hash for chunk size ${chunkSize}`)
        t.ok(fs.existsSync(filePath), `file should exist for chunk size ${chunkSize}`)

        // Verify the file can be read back
        const encodedData = await fs.promises.readFile(filePath)
        const encodedStream = new ReadableStream({
            start (controller) {
                controller.enqueue(encodedData)
                controller.close()
            }
        })

        const verifiedData = await verify(encodedStream, rootHash, chunkSize)
        t.equal(
            verifiedData.length,
            testData.length,
            `verified data length should match for chunk size ${chunkSize}`
        )

        // Clean up after each iteration
        await fs.promises.unlink(filePath)
    }

    await cleanup()
})

test('same data produces same hash and filename', async t => {
    await cleanup()

    const testData = Buffer.from('identical data')

    // Write the same data twice
    const result1 = await write(TEST_DIR, testData, { chunkSize: CHUNK_SIZE })
    const result2 = await write(TEST_DIR, testData, { chunkSize: CHUNK_SIZE })

    t.equal(result1.rootHash, result2.rootHash, 'hashes should be identical')
    t.equal(result1.filePath, result2.filePath, 'file paths should be identical')

    // File should only exist once (second write overwrites first)
    const fileExists = fs.existsSync(result1.filePath)
    t.ok(fileExists, 'file should exist')

    await cleanup()
})

// Helper to generate test data
function generateTestData (size:number):Uint8Array {
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        data[i] = (i * 7919 + 104729) % 256
    }
    return data
}

// Helper to clean up test directory
async function cleanup () {
    try {
        await fs.promises.rm(TEST_DIR, { recursive: true, force: true })
    } catch (_err) {
        console.log('error...', _err)
    }
}
