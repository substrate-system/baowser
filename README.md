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
  * [Encoding (Server-side)](#encoding-server-side)
  * [Verification (Client-side)](#verification-client-side)
- [API](#api)
  * [ESM](#esm)
  * [Common JS](#common-js)
- [Use](#use)
  * [How It Works](#how-it-works)
  * [Complete Example](#complete-example)
  * [How Verification Works](#how-verification-works)
  * [Error Handling](#error-handling)
- [See Also](#see-also)
  * [Some Important Dependencies](#some-important-dependencies)

<!-- tocstop -->

</details>

## Install

```sh
npm i -S @substrate-system/baowser
```

## Example

### Encoding (Server-side)

```ts
import {
  createEncoder,
  getRootLabel
} from '@substrate-system/baowser'

// Your file data
const fileData = new Uint8Array([/* ... */])
const chunkSize = 1024 // 1KB chunks

// Get the root hash - this is your content identifier
const rootHash = await getRootLabel(fileData, chunkSize)

// Create the encoded stream with interleaved metadata
const encodedStream = createEncoder(chunkSize, fileData)

// Publish the root hash via a trusted channel (IPFS CID, database, etc.)
// Stream the encodedStream to clients
```

### Verification (Client-side)

**Key Insight:** The root hash is your ONLY trusted input. This single 32-byte hash is sufficient for complete incremental verification. At every step during verification, you can prove that the data corresponds to the root hash you requested.

```ts
import { createVerifier, verify } from '@substrate-system/baowser'

// The root hash you're requesting (received via trusted channel)
const rootHash = 'abc123...'
const chunkSize = 1024

const response = await fetch('/data.bab')

// Option 1: Using streaming API
const verifiedStream = createVerifier(response.body, rootHash, chunkSize, {
  onChunkVerified: (i, total) => console.log(`Verified ${i}/${total}`)
})

// Read from verifiedStream...
const reader = verifiedStream.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // Use verified chunk...
}

// Option 2: Using promise-based API (simpler)
const response2 = await fetch('/data.bab')
const verifiedData = await verify(response2.body, rootHash, chunkSize)
// verifiedData is complete Uint8Array, fully verified
```


## API

This exposes ESM and common JS via
[package.json `exports` field](https://nodejs.org/api/packages.html#exports).

### ESM
```js
import { createEncoder, getRootLabel, createVerifier, verify } from 'baowser'
```

### Common JS
```js
const { createEncoder, getRootLabel, createVerifier, verify } = require('baowser')
```

## Use

This uses browser native streams and the [Bab](https://worm-blossom.github.io/bab/) encoding format.

### How It Works

The encoding uses a Merkle tree structure where hash labels are interleaved with data chunks in depth-first order. **The root hash (32 bytes) is your ONLY trusted input** - this is shared via a trusted channel (IPFS CID, database, content-addressed identifier, etc.).

The stream contains all the verification metadata (child node hashes), but crucially, that metadata is itself verified against the root hash during decoding. This enables true incremental verification: at each step, you verify that subtrees match their expected labels, which ultimately chain up to verify against the root hash.

**Key properties:**
- Content-addressed: The root hash IS the content identifier
- Incremental verification: Detect corruption immediately as chunks arrive
- Fail-fast: Download stops as soon as any mismatch is detected
- Space-efficient: Only need to share a 32-byte hash
- Trust-minimized: The hash is both the identifier AND the complete verification authority

If any hash does not match during verification, the stream throws an error and aborts immediately.

### Complete Example

```js
import {
  createEncoder,
  getRootLabel,
  createVerifier,
  verify
} from '@substrate-system/baowser'

// ============================================================================
// SERVER SIDE: Encode data into Bab format
// ============================================================================

const data = new Uint8Array([/* ... */])  // your data
const chunkSize = 1024

// Get the root hash - this is your content identifier
const rootHash = await getRootLabel(data, chunkSize)

// Create the encoded stream with interleaved metadata
const encodedStream = createEncoder(chunkSize, data)

// Publish rootHash via trusted channel (IPFS CID, database, etc.)
// Stream encodedStream to clients


// ============================================================================
// CLIENT SIDE: Download and verify using ONLY the root hash
// ============================================================================

const rootHash = 'abc123...'  // received via trusted channel
const chunkSize = 1024

// Option 1: Streaming API - verify as data arrives
const response = await fetch('/data.bab')
const verifiedStream = createVerifier(response.body, rootHash, chunkSize, {
  onChunkVerified: (i, total) => console.log(`Verified ${i}/${total}`),
  onError: (err) => console.error('Verification failed:', err)
})

// Read verified chunks
const reader = verifiedStream.getReader()
const chunks = []
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  chunks.push(value)  // Only verified chunks reach here
}

// Option 2: Promise-based API - simpler interface
const response2 = await fetch('/data.bab')
const verifiedData = await verify(response2.body, rootHash, chunkSize, {
  onChunkVerified: (i, total) => console.log(`${i}/${total}`)
})
// verifiedData is a Uint8Array with all verified data
```

### How Verification Works

During decoding, the verifier:
1. Uses the trusted root hash as the reference point
2. Recursively processes the Merkle tree in depth-first order
3. Computes hashes of each data chunk
4. Computes hashes of each internal node from its children
5. Immediately compares each computed hash against the expected label from the stream
6. Fails fast if any mismatch is detected - stops downloading immediately

**This is true incremental verification:** The root hash alone is sufficient to verify each chunk as it arrives, because each chunk's validity chains up through the tree structure to the root.

### Error Handling

When a hash mismatch is detected:
1. The `onError` callback is invoked (if provided)
2. An error is thrown from the stream
3. The stream aborts - no more data is downloaded or processed

```js
try {
  const verifiedData = await verify(stream, rootHash, chunkSize, {
    onError: (err) => console.error('Verification failed:', err)
  })
  // Use verified data...
} catch (error) {
  console.error('Stream verification failed:', error.message)
  // Handle error - stream has been aborted
}
```

## See Also

### Some Important Dependencies

* [nichoth/hash-wasm](https://github.com/nichoth/hash-wasm) &mdash; a fork of
  [Daninet/hash-wasm](https://github.com/Daninet/hash-wasm). It doesn't add
  or change anything.
