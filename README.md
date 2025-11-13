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

### Encoding data

First, encode your data to generate chunk metadata. This would happen
on the machine that is providing the file (a server).

```js
import { encode } from '@substrate-system/baowser'

const data = new Uint8Array([...]) // your data
const chunkSize = 1024

const metadata = await encode(data, chunkSize)

// metadata contains:
// - rootHash: BLAKE3 hash of full blob
// - chunks: array of { hash, size } for each chunk
// - fileSize: total size
// - chunkSize: chunk size used
```

### Streaming verification

Use the `createVerifier`
[`TransformStream`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream)
to verify chunks as they stream in.

```js
import { createVerifier } from '@substrate-system/baowser'

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

Can use `verifyStream` to verify and collect all data.

```js
import { verifyStream } from '@substrate-system/baowser'

const response = await fetch('/data')
const verifiedData = await verifyStream(response.body, metadata, {
  onChunkVerified: (i, total) => console.log(`${i}/${total}`),
  onError: (err) => console.log('oh no', err.message)
})

// verifiedData is a Uint8Array with all verified data
```
