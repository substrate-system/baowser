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
where the name comes from.

[See a live demo](https://substrate-system.github.io/baowser/)

<details><summary><h2>Contents</h2></summary>

<!-- toc -->

- [install](#install)
- [API](#api)
  * [ESM](#esm)
  * [Common JS](#common-js)
- [Use](#use)
  * [Encoding data](#encoding-data)
  * [Streaming verification](#streaming-verification)
  * [Convenience method](#convenience-method)
- [See Also](#see-also)
  * [Some Important Dependencies](#some-important-dependencies)

<!-- tocstop -->

</details>

## install

```sh
npm i -S @substrate-system/baowser
```

## API

This exposes ESM and common JS via
[package.json `exports` field](https://nodejs.org/api/packages.html#exports).

### ESM
```js
import { encode, createVerifier, verifyStream } from 'baowser'
```

### Common JS
```js
const { encode, createVerifier, verifyStream } = require('baowser')
```

## Use

This is a streaming API (the browser's native Streams API).

### Metadata

Metadata can be generated as a separate object from the blob. This makes sense
for some use cases:

* Store metadata in a database but data in object storage
* Transmit metadata via different channels (API vs CDN)
* Update metadata without re-uploading data


### Single Stream (metadata + data)

When you want a single self-contained stream with metadata interleaved
(similar to [Bab](https://worm-blossom.github.io/bab/)),
use the Bab-compatible encoding:

```js
import {
  encodeBab,
  getBabRootLabel,
  decodeBab
} from '@substrate-system/baowser'

// On the server: encode data into Bab format
const data = new Uint8Array([...])  // your data
const chunkSize = 1024
const encodedStream = await encodeBab(data, chunkSize)

// Get the root label (hash) to send separately or embed
const rootLabel = await getBabRootLabel(data, chunkSize)


// ------- client side -------


// decode and verify the stream client-side
const response = await fetch('/data.bab')
const verifiedStream = await decodeBab(response.body, rootLabel, chunkSize, {
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
```

#### Encoding Format

The Bab encoding uses a Merkle tree structure where hash labels
are interleaved with data chunks. The decoder performs full verification by
recursively verifying each node's label matches the computed hash from
its children, ensuring the entire tree structure is valid.


### Separate Metadata

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


#### When a hash mismatch is detected

1. The onError callback is invoked (if you provided one) with the error
2. An error is thrown from the stream with a message like:
   Chunk 2 hash mismatch. Expected: abc123..., Got: def456...
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

### `verifyStream`

Can use `verifyStream` to verify and collect all data. This is a
convenience function that handles collecting the chunks.

```js
import { verifyStream } from '@substrate-system/baowser'

// First, fetch the metadata (generated during encoding on the server)
// The server would provide this
const metadataResponse = await fetch('/data.metadata.json')
const metadata = await metadataResponse.json()

// Now fetch and verify the actual data
const response = await fetch('/data.jpg')
const verifiedData = await verifyStream(response.body, metadata, {
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
