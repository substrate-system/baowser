# baowser
[![tests](https://img.shields.io/github/actions/workflow/status/substrate-system/baowser/nodejs.yml?style=flat-square)](https://github.com/substrate-system/baowser/actions/workflows/nodejs.yml)
[![types](https://img.shields.io/npm/types/@substrate-system/baowser?style=flat-square)](README.md)
[![module](https://img.shields.io/badge/module-ESM%2FCJS-blue?style=flat-square)](README.md)
[![semantic versioning](https://img.shields.io/badge/semver-2.0.0-blue?logo=semver&style=flat-square)](https://semver.org/)
[![Common Changelog](https://nichoth.github.io/badge/common-changelog.svg)](./CHANGELOG.md)
[![install size](https://flat.badgen.net/packagephobia/install/@substrate-system/baowser)](https://packagephobia.com/result?p=@substrate-system/baowser)
[![gzip size](https://img.shields.io/bundlephobia/minzip/@substrate-system/baowser?style=flat-square)](https://bundlephobia.com/@substrate-system/name/package/baowser)
[![license](https://img.shields.io/badge/license-Big_Time-blue?style=flat-square)](LICENSE)


Streaming hash-based verification in the browser.

This is based on the [`bao` library](https://github.com/oconnor663/bao). That's
where the name comes from. Also, look at [bab](https://github.com/worm-blossom/bab).

[See a live demo](https://substrate-system.github.io/baowser/)

<details><summary><h2>Contents</h2></summary>

<!-- toc -->

- [Install](#install)
- [Example](#example)
  * [File Provider (Server-side)](#file-provider-server-side)
  * [File Downloader (Client-side)](#file-downloader-client-side)
- [API](#api)
  * [ESM](#esm)
  * [Common JS](#common-js)
- [Use](#use)
  * [Metadata](#metadata)
  * [Single Stream (metadata + data)](#single-stream-metadata--data)
  * [External Metadata](#external-metadata)
  * [Verify data](#verify-data)
  * [`verify`](#verify)
- [See Also](#see-also)
  * [Some Important Dependencies](#some-important-dependencies)

<!-- tocstop -->

</details>

## Install

```sh
npm i -S @substrate-system/baowser
```

## Example

### File Provider (Server-side)

```ts
import {
  encode,
  createEncoder,
  getRootLabel
} from '@substrate-system/baowser'

// Your file data
const fileData = new Uint8Array([/* ... */])
const chunkSize = 1024 // 1KB chunks

// Option 1: External metadata (good for databases/APIs)
const metadata = await encode(fileData, chunkSize)
// Send metadata separately (e.g., via API)
// Send fileData via CDN/object storage

// Option 2: Single stream with interleaved metadata (bab format)
const rootLabel = await getRootLabel(fileData, chunkSize)
const encodedStream = createEncoder(chunkSize, fileData)
// Send just the rootLabel via trusted channel (IPFS CID, etc.)
// Stream the encodedStream to the client
```

### File Downloader (Client-side)

As long as you know the root hash, then you can verify chunks of the file as
they arrive. You don't have to wait for the full download before finding out
that it is not valid.

```ts
import { createVerifier, verify } from '@substrate-system/baowser'

// Option 1: With external metadata
const metadataRes = await fetch('/api/file-metadata')
const metadata = await metadataRes.json()

const fileRes = await fetch('/cdn/file-data')

// Stream approach - verify as data arrives
const verifier = createVerifier(metadata, {
  onChunkVerified: (i, total) => console.log(`${i}/${total} verified`)
})
const verifiedStream = fileRes.body.pipeThrough(verifier)

// now read from verifiedStream...

// Or Promise approach - simpler API
const verifiedData = await verify(fileRes.body, metadata)

// verifiedData is complete Uint8Array

// Option 2: Bab format with interleaved metadata
const rootLabel = 'abc123...'  // received from server
const chunkSize = 1024

const babRes = await fetch('/data.bab')

// Stream
const verifiedStream = createVerifier(babRes.body, rootLabel, chunkSize, {
  onChunkVerified: (i, total) => console.log(`${i}/${total}`)
})

// Read from verifiedStream...

// Or Promise
const verifiedData = await verify(babRes.body, rootLabel, chunkSize)

// verifiedData is complete Uint8Array
```


## API

This exposes ESM and common JS via
[package.json `exports` field](https://nodejs.org/api/packages.html#exports).

### ESM
```js
import { encode, createVerifier, verify } from 'baowser'
```

### Common JS
```js
const { encode, createVerifier, verify } = require('baowser')
```

## Use

This uses browser native streams.

### Metadata

Metadata can be generated as a separate object from the blob. This makes sense
for some use cases:

* Store metadata in a database but data in object storage
* Transmit metadata via different channels (API vs CDN)
* File transfer with zero trust between participants

Or the metadata can be interleaved with the blob content. In that case only
a single stream is required for verification (no external metadata).

The stream uses a Merkle tree structure with interleaved metadata. You want
to use `createVerifier` with the bab format. It transforms the incoming stream
to a standard blob stream (without metadata), and also verifies that the data
is correct.

If the hash does not match, it will throw an error and abort the stream.

### Single Stream (metadata + data)

Create a single self-contained stream with metadata interleaved
with data (similar to [Bab](https://worm-blossom.github.io/bab/)).

You only need to share the root hash (32 bytes) via a trusted
channel, and the stream contains all the verification metadata needed for
incremental verification. This is ideal for content-addressed systems like
IPFS or torrents where the root hash IS the content identifier.

```js
import {
  createEncoder,
  getRootLabel,
  createVerifier,
  verify
} from '@substrate-system/baowser'

// On the server: encode data into Bab format
const data = new Uint8Array([/* ... */])  // your data
const chunkSize = 1024

// Get the root label (hash) - this is published via trusted channel
const rootLabel = await getRootLabel(data, chunkSize)

// Create the encoded stream
const encodedStream = createEncoder(chunkSize, data)


// ------- client side -------


// Option 1: Stream approach - decode and verify as data arrives
const response = await fetch('/data')
const verifiedStream = createVerifier(response.body, rootLabel, chunkSize, {
  onChunkVerified: (i, total) => console.log(`${i}/${total}`),
  onError: (err) => console.error('Verification failed:', err)
})

// Read verified data
const reader = verifiedStream.getReader()
const chunks = []
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  chunks.push(value)
}

// Option 2: Use a promise
const response2 = await fetch('/data.bab')
const verifiedData = await verify(response2.body, rootLabel, chunkSize)
// verifiedData is a Uint8Array with all data
```

#### Encoding Format

The encoding format uses a Merkle tree structure where hash labels
are interleaved with data chunks. The decoder performs full verification by
recursively verifying that each node's label matches the computed hash from
its children, ensuring the entire tree structure is valid.


### External Metadata

First, encode your data to generate chunk metadata. This would happen
on the machine that is providing the file (a server).

```js
import { encode } from '@substrate-system/baowser'

const data = new Uint8Array([...])  // your data
const chunkSize = 1024

const metadata = await encode(data, chunkSize)

// metadata contains:
// - rootHash: BLAKE3 hash of full blob
// - chunks: array of { hash, size } for each chunk
// - fileSize: total size
// - chunkSize: chunk size used
```

### Verify data

Use the function `createVerifier` to create a
[`TransformStream`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream)
and verify the stream as it downloads.

#### Piping through the verifier

```js
import { createVerifier } from '@substrate-system/baowser'

// Fetch metadata from your API
const metadataRes = await fetch('/api/file-metadata')
const metadata = await metadataRes.json()

// Fetch the actual file data
const response = await fetch('/cdn/file-data.jpg')
const unverifiedStream = response.body  // ReadableStream<Uint8Array>

// Create a TransformStream verifier
const verifier = createVerifier(metadata, {
  onChunkVerified: (chunkIndex, totalChunks) => {
    console.log(`✓ Chunk ${chunkIndex}/${totalChunks} verified`)
  },
  onError: (error) => {
    // Called immediately when verification fails
    console.error('Verification error:', error.message)
  }
})

// Pipe the unverified stream through the verifier
// This returns a new ReadableStream with verified data
const verifiedStream = unverifiedStream.pipeThrough(verifier)

// Read from the verified stream
const reader = verifiedStream.getReader()
const chunks = []

try {
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)  // Only verified chunks reach here
  }

  // Combine chunks into complete data
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const verifiedData = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    verifiedData.set(chunk, offset)
    offset += chunk.length
  }

  console.log('File fully verified!', verifiedData.length, 'bytes')

  // Use the verified data
  const blob = new Blob([verifiedData], { type: 'image/jpeg' })
  const url = URL.createObjectURL(blob)
  // ... use the blob

} catch (error) {
  // If verification fails, reader.read() will throw
  console.error('Stream aborted due to verification failure:', error.message)
  // The download is automatically stopped - no more data is processed
  throw error
} finally {
  reader.releaseLock()
}
```

#### When a hash mismatch is detected

1. The onError callback is invoked (if you provided one) with the error
2. An error is thrown from the stream with a message like:
   `Chunk 2 hash mismatch. Expected: abc123..., Got: def456...`
3. This causes `reader.read()` to reject, triggering the catch block

```js
import { createVerifier } from '@substrate-system/baowser'

// Create a ReadableStream (e.g., from fetch)
const response = await fetch('/data.jpg')
const stream = response.body

// Create verifier with callbacks
const verifier = createVerifier(metadata, {
  onChunkVerified: (chunkIndex, totalChunks) => {
    console.log(`Verified chunk ${chunkIndex}/${totalChunks}`)
  },
  onError: (error) => {
    console.error('Verification failed:', error)
  }
})

// Pipe through verifier
const verifiedStream = stream.pipeThrough(verifier)

// Collect all verified chunks
const chunks = []
const reader = verifiedStream.getReader()

try {
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
} catch (error) {
  // Verification failed - hash mismatch detected
  console.error('Stream verification failed:', error.message)
  throw error  // Re-throw or handle as appropriate
} finally {
  reader.releaseLock()
}

// stream is complete now
// combine chunks into complete data
const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
const completeData = new Uint8Array(totalLength)
let offset = 0
for (const chunk of chunks) {
  completeData.set(chunk, offset)
  offset += chunk.length
}

// Now use the verified data.
// Create a Blob and add it to the DOM.
const blob = new Blob([completeData], { type: 'image/jpeg' })
const blobUrl = URL.createObjectURL(blob)

// Add to DOM
const img = document.createElement('img')
img.src = blobUrl
document.body.appendChild(img)

// Or trigger a download
const link = document.createElement('a')
link.href = blobUrl
link.download = 'verified-data.jpg'
link.click()

// Clean up the object URL when done
URL.revokeObjectURL(blobUrl)
```

### `verify`

Use `verify` to verify and collect all data in one call. This is a
convenience function that handles streaming, verification, and collecting
the chunks into a single `Uint8Array`.

```js
import { verify } from '@substrate-system/baowser'

// First, fetch the metadata (generated during encoding on the server)
// The server would provide this
const metadataResponse = await fetch('/data.metadata.json')
const metadata = await metadataResponse.json()

// Now fetch and verify the actual data
const response = await fetch('/data.jpg')
const verifiedData = await verify(response.body, metadata, {
  onChunkVerified: (i, total) => console.log(`${i}/${total}`),
  onError: (err) => console.log('oh no', err.message)
})

// verifiedData is a Uint8Array with all verified data
// Create a Blob and display the image
const blob = new Blob([verifiedData], { type: 'image/jpeg' })
const blobUrl = URL.createObjectURL(blob)

// Add to DOM
const img = document.createElement('img')
img.src = blobUrl
document.body.appendChild(img)

// Clean up when done
img.onload = () => URL.revokeObjectURL(blobUrl)
```

## See Also

### Some Important Dependencies

* [nichoth/hash-wasm](https://github.com/nichoth/hash-wasm) &mdash; a fork of
  [Daninet/hash-wasm](https://github.com/Daninet/hash-wasm). It doesn't add
  or change anything.
