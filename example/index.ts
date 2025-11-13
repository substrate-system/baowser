import {
    type FunctionComponent,
    render,
    type TargetedEvent,
} from 'preact'
import { html, useCallback } from 'htm/preact'
import { signal } from '@preact/signals'
import { blake3 } from 'hash-wasm'
import Debug from '@substrate-system/debug'
import { humanBytes } from '@substrate-system/human-bytes'
const debug = Debug(import.meta.env.DEV)

const state = {
    chunkSize: signal<'1024'|'512'|'2048'|'4096'>('1024'),
    selectedFile: signal<null|File>(null),
    encodedFile: signal(null)
}

const Example:FunctionComponent<unknown> = function () {
    const encodeFile = useCallback((ev:MouseEvent) => {
        ev.preventDefault()
        const file = state.selectedFile
        if (!file.value) return
        debug('encode the file...')

        try {
            log(`Encoding file: ${selectedFile.name}`, 'info')
            log(`File size: ${selectedFile.size} bytes`, 'info')

            const chunkSize = parseInt(document.getElementById('chunkSize').value)
            log(`Chunk size: ${chunkSize} bytes`, 'info')

            const fileBuffer = await selectedFile.arrayBuffer()
            const fileData = new Uint8Array(fileBuffer)

            // Calculate root hash
            log('\nCalculating root hash...', 'info')
            const rootHash = await blake3(fileData)
            log(`Root hash: ${rootHash}`, 'hash')

            // Break into chunks and hash each
            log('\nChunking and hashing...', 'info')
            const chunks = []
            for (let offset = 0; offset < fileData.length; offset += chunkSize) {
                const end = Math.min(offset + chunkSize, fileData.length)
                const chunk = fileData.slice(offset, end)
                const chunkHash = await blake3(chunk)

                chunks.push({
                    size: chunk.length,
                    hash: chunkHash,
                    data: Array.from(chunk)
                })

                if (chunks.length % 10 === 0) {
                    log(`Processed ${chunks.length} chunks...`, 'info')
                }
            }

            log(`\n✓ Encoded ${chunks.length} chunks successfully!`, 'success')

            encodedData = {
                fileName: selectedFile.name,
                fileSize: fileData.length,
                rootHash,
                chunkSize,
                chunkCount: chunks.length,
                chunks
            }

            showStats(encodedData)
            document.getElementById('verifyBtn').disabled = false
        } catch (error) {
            log(`\n✗ Error: ${error.message}`, 'error')
        } finally {
            document.getElementById('encodeBtn').disabled = false
        }
    }, [])

    const selectChunkSize = useCallback((ev:TargetedEvent) => {
        ev.preventDefault()
        const { value } = ev.currentTarget as HTMLSelectElement
        debug('select chunk size')
        state.chunkSize.value = value as typeof state.chunkSize.value
    }, [])

    const onFile = useCallback((ev:TargetedEvent<HTMLInputElement>) => {
        const input = ev.target as HTMLInputElement
        const files = input.files!
        if (files.length > 0) {
            state.selectedFile.value = files[0]
        } else {
            state.selectedFile.value = null
        }
    }, [])

    return html`<div class="container">
        <h1>Bao/BLAKE3 Demo</h1>
        <p class="subtitle">
            Upload a file to see encoding and incremental verification.
        </p>

        <div class="upload-area" id="uploadArea">
            ${state.selectedFile.value ?
                html`
                    <p>Selected: ${state.selectedFile.value.name}</p>
                    <p>${humanBytes(state.selectedFile.value.size)} KB</p>
                ` :
                html`
                    <p>Click to select</p>
                    <p>
                        Any file type works - images, documents, videos, etc.
                    </p>
                    <input onChange=${onFile} type="file" id="fileInput" />
                `
            }
        </div>
        
        <div class="controls">
            <label>
                Chunk Size:
                <select id="chunkSize" onChange=${selectChunkSize}>
                    <option value="512">512 bytes (more chunks)</option>
                    <option value="1024" selected>1024 bytes</option>
                    <option value="2048">2048 bytes (fewer chunks)</option>
                    <option value="4096">4096 bytes (even fewer chunks)</option>
                </select>
            </label>

            <button id="encode-btn"
                disabled=${!state.selectedFile.value}
                onClick=${encodeFile}
            >
                Encode File
            </button>
            <button id="verify-btn" disabled=${!state.encodedFile.value}>
                Download & Verify
            </button>
            <button id="clear-btn">Clear Log</button>
        </div>
        
        <div class="stats" id="stats">
            <div class="stat-card">
            <div class="stat-label">File Size</div>
            <div class="stat-value">
                ${(data.fileSize / 1024).toFixed(2)} KB
            </div>
            </div>
            <div class="stat-card">
            <div class="stat-label">Chunk Size</div>
            <div class="stat-value">${data.chunkSize} bytes</div>
            </div>
            <div class="stat-card">
            <div class="stat-label">Total Chunks</div>
            <div class="stat-value">${data.chunkCount}</div>
            </div>
            <div class="stat-card">
            <div class="stat-label">Overhead</div>
            <div class="stat-value">${((data.chunkCount * 64 / data.fileSize) * 100).toFixed(1)}%</div>
            </div>
        </div>

        <div class="log-container" id="logContainer"></div>
    </div>`
}

render(html`<${Example} />`, document.getElementById('root')!)
