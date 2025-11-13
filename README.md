# baowser
[![tests](https://img.shields.io/github/actions/workflow/status/substrate-system/baowser/nodejs.yml?style=flat-square)](https://github.com/substrate-system/baowser/actions/workflows/nodejs.yml)
[![types](https://img.shields.io/npm/types/@substrate-system/icons?style=flat-square)](README.md)
[![module](https://img.shields.io/badge/module-ESM%2FCJS-blue?style=flat-square)](README.md)
[![semantic versioning](https://img.shields.io/badge/semver-2.0.0-blue?logo=semver&style=flat-square)](https://semver.org/)
[![Common Changelog](https://nichoth.github.io/badge/common-changelog.svg)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-Big_Time-blue?style=flat-square)](LICENSE)


Streaming hash-based verification in the browser.

This is based on the [`bao` library](https://github.com/oconnor663/bao). That's
where the name comes from.

[See a live demo](https://nic.github.io/package-name/)

<details><summary><h2>Contents</h2></summary>
<!-- toc -->
</details>

## install

```sh
npm i -S baowser
```

## API

This exposes ESM and common JS via [package.json `exports` field](https://nodejs.org/api/packages.html#exports).

### ESM
```js
import { encode, createVerifier, verifyStream } from 'baowser'
```

### Common JS
```js
const { encode, createVerifier, verifyStream } = require('baowser')
```

## Usage

Baowser provides a streaming verification API using the browser's native Streams API and BLAKE3 hashing.

### Encoding data

First, encode your data to generate chunk metadata:

```js
import { encode } from 'baowser'

const data = new Uint8Array([...]) // your data
const chunkSize = 1024 // bytes

const metadata = await encode(data, chunkSize)
// metadata contains:
// - rootHash: BLAKE3 hash of the entire data
// - chunks: array of { hash, size } for each chunk
// - fileSize: total size
// - chunkSize: chunk size used
```

### Streaming verification

Use the `createVerifier` TransformStream to verify chunks as they stream through:

```js
import { createVerifier } from 'baowser'

// Create a ReadableStream (e.g., from fetch)
const response = await fetch('/data')
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

// Read verified data
const reader = verifiedStream.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // Use verified chunk
  console.log('Got verified chunk:', value)
}
```

### Convenience method

For simpler use cases, use `verifyStream` to verify and collect all data:

```js
import { verifyStream } from 'baowser'

const response = await fetch('/data')
const verifiedData = await verifyStream(response.body, metadata, {
  onChunkVerified: (i, total) => console.log(`${i}/${total}`)
})

// verifiedData is a Uint8Array with all verified data
```

## How it works

1. **Encoding**: Data is split into chunks, each chunk is hashed with BLAKE3, and a root hash is computed from the entire data
2. **Streaming**: As data streams in, each chunk is verified against its expected hash before being passed through
3. **Security**: If any chunk fails verification, the stream errors immediately - no corrupted data is passed through
4. **Efficiency**: Verification happens incrementally as data arrives, with minimal buffering
