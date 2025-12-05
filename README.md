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
where the name comes from. Also, look at
[bab](https://github.com/worm-blossom/bab).

[See a live demo](https://substrate-system.github.io/baowser/)

<details><summary><h2>Contents</h2></summary>

<!-- toc -->

- [Install](#install)
- [Example](#example)
  * [Encoding (Server-side)](#encoding-server-side)
  * [Verification (Client-side)](#verification-client-side)
- [Modules](#modules)
  * [ESM](#esm)
  * [Common JS](#common-js)
- [How It Works](#how-it-works)
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
import * as fs from 'node:fs'
import {
  createEncoder,
  getRootLabel
} from '@substrate-system/baowser'

// Your file data
const fileData = new Uint8Array([/* ... */])
// const fileData = await fs.readFile('./foobar.txt')
const chunkSize = 1024 // 1KB chunks

// Get the root hash - this is your content identifier
const rootHash = await getRootLabel(fileData, chunkSize)

// Create the encoded stream with interleaved metadata
const encodedStream = createEncoder(chunkSize, fileData)

// Publish the root hash via a trusted channel (IPFS CID, database, etc.)
// Stream the encodedStream to clients

// server example here

```

### Verification (Client-side)

The root hash is the only trusted input. The 32-byte hash is sufficient
for incremental verification. At each chunk in the stream,
you can prove that the data corresponds to the root hash you requested.

```ts
import { createVerifier, verify } from '@substrate-system/baowser'

// The root hash you're requesting (received via trusted channel)
const rootHash = 'abc123...'
const chunkSize = 1024

const response = await fetch('/data.abc')

// Option 1 - TransformStream API
// createVerifier returns a TransformStream that you pipe through
const verifier = createVerifier(rootHash, chunkSize, {
  onChunkVerified: (i, total) => console.log(`Verified ${i}/${total}`)
})

const verifiedStream = response.body.pipeThrough(verifier)

// Read from verifiedStream...
const reader = verifiedStream.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // Use verified chunk...
}

// Option 2 - Promise-based API
const response2 = await fetch('/data.bab')
const verifiedData = await verify(response2.body, rootHash, chunkSize)
// verifiedData is complete Uint8Array, fully verified
// it will throw if verification fails at any point
```

## Modules

This exposes ESM and common JS via
[package.json `exports` field](https://nodejs.org/api/packages.html#exports).

### ESM
```js
import {
  createEncoder,
  getRootLabel,
  createVerifier,
  verify
} from '@substrate-system/baowser'
```

### Common JS
```js
const {
  createEncoder,
  getRootLabel,
  createVerifier,
  verify
} = require('@substrate-system/baowser')
```

## How It Works

The encoding is a Merkle tree where hash labels are interleaved
with data chunks in depth-first order.
**The root hash (32 bytes) is your ONLY trusted input**.

The stream contains all the verification metadata (child node hashes),
and that metadata is itself verified against the root hash during
decoding. This enables incremental verification: at each step,
you verify that subtrees match their expected labels,
which ultimately chain up to verify against the root hash.

If any hash does not match during verification,
the stream throws an error and aborts immediately, before the download
is complete.

### Error Handling

When a hash mismatch is detected:

1. An error is thrown from the stream
2. The stream aborts - no more data is downloaded

```js
try {
  const verifiedData = await verify(stream, rootHash, chunkSize)
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
