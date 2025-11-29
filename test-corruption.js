// Quick test to verify fail-fast behavior
import { createEncoder, createVerifier } from './dist/index.js'

async function test() {
    console.log('Testing fail-fast verification with corrupted Bab stream...\n')

    // Create some test data
    const testData = new Uint8Array(4096) // 4KB of data
    for (let i = 0; i < testData.length; i++) {
        testData[i] = i % 256
    }

    const chunkSize = 1024 // 4 chunks

    // Encode into Bab stream
    console.log('1. Encoding data into Bab stream...')
    const dataStream = new ReadableStream({
        start(controller) {
            controller.enqueue(testData)
            controller.close()
        }
    })

    const encodedStream = createEncoder(chunkSize, dataStream)
    const reader = encodedStream.getReader()
    const chunks = []

    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
    const babStream = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
        babStream.set(chunk, offset)
        offset += chunk.length
    }

    console.log(`   Bab stream size: ${babStream.length} bytes`)

    // Get the root label by re-encoding (or we could decode and get it)
    const { getRootLabel } = await import('./dist/index.js')
    const rootLabel = await getRootLabel(testData, chunkSize)
    console.log(`   Root label: ${rootLabel.slice(0, 16)}...`)

    // Now corrupt a byte in the stream
    console.log('\n2. Corrupting byte 720 in the Bab stream...')
    const corruptedStream = new Uint8Array(babStream)
    corruptedStream[720] = (corruptedStream[720] + 1) % 256
    console.log(`   Changed byte from ${babStream[720]} to ${corruptedStream[720]}`)

    // Try to verify the corrupted stream
    console.log('\n3. Attempting to verify corrupted stream...')

    let chunkCount = 0
    let errorOccurred = false
    let errorMessage = ''

    try {
        const corruptedReadableStream = new ReadableStream({
            start(controller) {
                controller.enqueue(corruptedStream)
                controller.close()
            }
        })

        const verifiedStream = createVerifier(
            corruptedReadableStream,
            rootLabel,
            chunkSize,
            {
                onChunkVerified: (index, total) => {
                    chunkCount = index
                    console.log(`   Chunk ${index}/${total} processed`)
                },
                onError: (err) => {
                    errorMessage = err.message
                    console.log(`   ERROR: ${err.message}`)
                }
            }
        )

        const verifiedReader = verifiedStream.getReader()
        while (true) {
            const { done } = await verifiedReader.read()
            if (done) break
        }

        console.log('\n UNEXPECTED: Verification succeeded when it should have failed!')
    } catch (error) {
        errorOccurred = true
        console.log(`\n SUCCESS: Verification failed after ${chunkCount} chunks`)
        console.log(`   Error: ${error.message}`)
    }

    if (!errorOccurred) {
        console.log('\n TEST FAILED: Expected verification to fail!')
        process.exit(1)
    }

    if (chunkCount >= 4) {
        console.log(`\n TEST FAILED: Processed all ${chunkCount} chunks before failing!`)
        console.log('   Expected to fail on first chunk.')
        process.exit(1)
    }

    console.log('\n TEST PASSED: Fail-fast verification working correctly!')
}

test().catch(err => {
    console.error('Test failed with error:', err)
    process.exit(1)
})
