# baowser
[![tests](https://img.shields.io/github/actions/workflow/status/substrate-system/baowser/nodejs.yml?style=flat-square)](https://github.com/substrate-system/baowser/actions/workflows/nodejs.yml)
[![types](https://img.shields.io/npm/types/@substrate-system/baowser?style=flat-square)](README.md)
[![module](https://img.shields.io/badge/module-ESM%2FCJS-blue?style=flat-square)](README.md)
[![semantic versioning](https://img.shields.io/badge/semver-2.0.0-blue?logo=semver&style=flat-square)](https://semver.org/)
[![Common Changelog](https://nichoth.github.io/badge/common-changelog.svg)](./CHANGELOG.md)
[![install size](https://flat.badgen.net/packagephobia/install/@substrate-system/baowser?v=2)](https://packagephobia.com/result?p=@substrate-system/baowser)
[![gzip size](https://flat.badgen.net/bundlephobia/minzip/@substrate-system/baowser)](https://bundlephobia.com/package/@substrate-system/baowser)
[![license](https://img.shields.io/badge/license-Big_Time-blue?style=flat-square)](LICENSE)


Streaming hash-based verification in the browser.

This is based on the [`bao` library](https://github.com/oconnor663/bao). That's
where the name comes from. Also, look at
[bab](https://github.com/worm-blossom/bab).

This is incremental verification for the browser. You can start a
streaming download, and verify it is correct before you have downloaded the
entire file. You only need to know the "root hash" ahead of time, and then
you can verify each piece of the downlaod as it arrives.

[See a live demo](https://substrate-system.github.io/baowser/)

<details><summary><h2>Contents</h2></summary>

<!-- toc -->

- [Install](#install)
- [Example](#example)
  * [Encoding (Server-side)](#encoding-server-side)
    + [Use the `write` helper](#use-the-write-helper)
    + [Option 2: Manual encoding](#option-2-manual-encoding)
  * [Verification (Client-side)](#verification-client-side)
- [Modules](#modules)
  * [ESM](#esm)
    + [Node only](#node-only)
  * [Common JS](#common-js)
- [How It Works](#how-it-works)
- [Node API](#node-api)
  * [`write(dir, data, options)`](#writedir-data-options)
    + [`write` Example](#write-example)
- [Error Handling](#error-handling)
- [See Also](#see-also)
  * [Prior Art](#prior-art)
  * [Some Important Dependencies](#some-important-dependencies)

<!-- tocstop -->

</details>

## Install

```sh
npm i -S @substrate-system/baowser
```

## Example

### Encoding (Server-side)

#### Use the `write` helper

Encode your data and save it to a file named by its hash.

```ts
import { write } from '@substrate-system/baowser/fs'

// Write data to a content-addressed file
const { rootHash, filePath } = await write(
  './data',  // Directory
  Buffer.from('hello world'),  // Data (Buffer, Uint8Array, or Node.js Readable)
  { chunkSize: 1024 }  // default = 1024
)

console.log(`File: ${filePath}`)  // ./data/abc123...
console.log(`Hash: ${rootHash}`)  // abc123...

// Publish rootHash via trusted channel (IPFS CID, database, etc.)
// Serve the file at filePath to clients
```

#### Option 2: Manual encoding

```ts
import {
  createEncoder,
  getRootLabel
} from '@substrate-system/baowser'

// Your file data
const fileData = new Uint8Array([/* ... */])
const chunkSize = 1024  // 1KB chunks, default

// Get the root hash - this is the CID
const rootHash = await getRootLabel(fileData, chunkSize)

// Create the encoded stream with interleaved metadata
const encodedStream = createEncoder(chunkSize, fileData)

// Publish the root hash via a trusted channel (IPFS CID, database, etc.)
// Stream the encodedStream to clients
```

### Verification (Client-side)

The root hash is the only trusted input. This 32-byte hash is sufficient
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
// verifiedData is the complete Uint8Array, fully verified
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

#### Node only

```js
import { write } from '@substrate-system/baowser/fs'
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

```js
const { write } = require('@substrate-system/baowser/fs')
```

## How It Works

The encoding is a Merkle tree where hash labels are interleaved
with data chunks in depth-first order.
**The root hash (32 bytes) is your only trusted input**.

The stream contains all verification metadata (child node hashes),
and that metadata is itself verified against the root hash during
decoding. This enables incremental verification: at each step,
you verify that subtrees match their expected labels,
which ultimately chain up to verify against the root hash.

If any hash does not match during verification,
the stream throws an error and aborts immediately, before the download
is complete.

## Node API

### `write(dir, data, options)`

Encode data and write it to a file in the given directory, using
the root hash as the filename.

```ts
async function write (
    dir:string,
    data:Buffer|Uint8Array|Readable,
    { chunkSize = 1024 }:{ chunkSize?:number } = {}
):Promise<{ rootHash:string; filePath:string }>
```

#### `write` Example

```ts
import { write } from '@substrate-system/baowser/fs'
import { createReadStream } from 'node:fs'

// Write with Buffer
const result1 = await write('./data', Buffer.from('hello'))

// Write with Uint8Array
const data = new Uint8Array([1, 2, 3, 4, 5])
const result2 = await write('./data', data, { chunkSize: 512 })

// Write with Node.js Readable stream
const stream = createReadStream('./input.txt')
const result3 = await write('./data', stream)

console.log(result3.rootHash)  // "abc123..."
console.log(result3.filePath)  // "./data/abc123..."
```

## Error Handling

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

### Prior Art

* [worm-blossom/bab](https://github.com/worm-blossom/bab)
* [bab in rust](https://codeberg.org/worm-blossom/bab_rs)
* [n0-computer/bao-docs](https://github.com/n0-computer/bao-docs)
* [oconnor663/bao](https://github.com/oconnor663/bao)

### Some Important Dependencies

* [nichoth/hash-wasm](https://github.com/nichoth/hash-wasm) &mdash; a fork of
  [Daninet/hash-wasm](https://github.com/Daninet/hash-wasm). It doesn't add
  or change anything.
