import { type FunctionComponent, render } from 'preact'
import { html } from 'htm/preact'
import { useRef, useEffect } from 'preact/hooks'
import { useComputed } from '@preact/signals'
import { humanBytes } from '@substrate-system/human-bytes'
import '@substrate-system/css-normalize'
import { State, verifyFile } from './state.js'
import llamaBase64 from './llama.jpg.base64.js'

if (import.meta.env.DEV || import.meta.env.MODE === 'staging') {
    localStorage.setItem('DEBUG', 'baowser')
} else {
    localStorage.removeItem('DEBUG')
    localStorage.removeItem('debug')
}

const EM_DASH = '\u2014'
const NBSP = '\u00A0'

// Create state instance
const state = State()

if (import.meta.env.DEV || import.meta.env.MODE === 'staging') {
    // @ts-expect-error dev
    window.state = state
}

// Handler functions that call State methods with state parameter
function handleChunkSizeChange (ev:Event) {
    State.handleChunkSizeChange(state, ev)
}

function handleTextareaChange (ev:Event) {
    State.handleTextareaChange(state, ev)
}

function encodeFile () {
    State.encodeFile(state)
}

function _verifyFile () {
    verifyFile(state)
}

function clearLog () {
    State.clearLog(state)
}

const Example:FunctionComponent = function () {
    const logContainerRef = useRef<HTMLDivElement>(null)

    const stats = useComputed(() => {
        return state.stats.value
    })

    // Auto-scroll logs
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop =
                logContainerRef.current.scrollHeight
        }
    }, [state.logs.value])

    return html`<div class="container">
        <h1>
            Baowser${NBSP}
            <a href="https://github.com/substrate-system/baowser">
                github.com/substrate-system/baowser
            </a>
        </h1>

        <p class="subtitle">
            Verify data with the${NBSP}
            <a href="https://developer.mozilla.org/en-US/docs/Web/API/Streams_API">
                web streams API
            </a>${NBSP}
            and <a href="https://github.com/oconnor663/blake3-js">
                BLAKE3 hashes
            </a> in the browser.
        </p>

        <p>
            Below is the image we are transferring. Below on the right is the
            same image, <code>base64</code> encoded to a string.
        </p>

        <p>
            The initial hash is always created of the "real" base64
            string ${EM_DASH} the image on the left. The "Download & Verify"
            button streams the base64 data in the <code>textarea</code> below
            on the right. That way you can${NBSP}
            <strong>change a character and see the verification fail</strong>.
        </p>

        <p>
            This module exposes a <a href="https://developer.mozilla.org/en-US/docs/Web/API/Streams_API">
                browser streams API
            </a> interface. You can fetch something and then
            "pipe" it through this module to verify the download is correct as
            it is streaming.
        </p>

        <hr />

        <div class="explanation">
            <p>
                Alice encodes her data into a Merkle tree with interleaved labels
                and data chunks (in depth-first order), and publishes the root hash
                via a trusted channel. <strong>The root hash is the only trusted
                input Bob needs</strong>. With the root hash, Bob can
                incrementally verify all the intermediate chunks transferred.
            </p>
            <p>
                Bob downloads the stream and verifies it incrementally by computing
                hashes from the data and comparing them against the expected labels
                in the stream. Each verification step chains up to ultimately verify
                against the trusted root hash.
            </p>
            <p>
                <strong>Demo:</strong> Modify the textarea to simulate a corrupted
                transmission. The demo will flip bytes in the Bab stream at the
                corresponding position. Verification should fail at the first
                corrupted chunk.
            </p>
        </div>

        <div class="content-preview">
            <div class="preview-item">
                <img src=${llamaBase64} alt="Llama" />
                <p class="preview-label">llama.jpg</p>
            </div>
            <div class="preview-item">
                <textarea
                    value=${state.base64Text.value}
                    onInput=${handleTextareaChange}
                    spellcheck=${false}
                    disabled=${state.isEncoding.value || state.isVerifying.value}
                ></textarea>
                <p class="preview-label">Base64 Text (editable)</p>
            </div>
        </div>

        <div class="controls">
            <label>
                Chunk Size:
                <select
                    value=${state.chunkSize.value}
                    onChange=${handleChunkSizeChange}
                    disabled=${state.isEncoding.value || state.isVerifying.value}
                >
                    <option value="512">512 bytes (more chunks)</option>
                    <option value="1024">1024 bytes (default)</option>
                    <option value="2048">2048 bytes (fewer chunks)</option>
                    <option value="4096">4096 bytes (even fewer)</option>
                </select>
            </label>

            <button
                onClick=${encodeFile}
                disabled=${state.isEncoding.value || state.isVerifying.value}
            >
                ${state.isEncoding.value ? 'Encoding...' : 'Encode File'}
            </button>
            <button
                onClick=${_verifyFile}
                disabled=${
                    !state.streamData.value ||
                    state.isVerifying.value ||
                    state.isEncoding.value
                }
            >
                ${state.isVerifying.value ?
                    'Verifying...' :
                    'Download & Verify'
                }
            </button>
            <button
                onClick=${clearLog}
                disabled=${state.isEncoding.value || state.isVerifying.value}
            >
                Clear Log
            </button>
        </div>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-label">File Size</div>
                <div class="stat-value">
                    ${stats.value ? humanBytes(stats.value.fileSize) : 'null'}
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Chunk Size</div>
                <div
                    class="stat-value"
                >
                    ${stats.value?.chunkSize ?
                        stats.value.chunkSize + ' bytes' :
                        'null'
                    }
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Chunks</div>
                <div class="stat-value">
                    ${stats.value?.chunkCount || 'null'}
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Overhead</div>
                <div class="stat-value">
                    ${stats.value ? (
                        (stats.value.chunkCount * 64 / stats.value.fileSize) *
                        100
                    ).toFixed(1) + '%' : 'null'}
                </div>
            </div>
        </div>
       
        <div class="root-hash">
            <pre>
                root hash: ${state.streamData.value?.rootLabel || '-'}
            </pre>
        </div>

        <div class="log-container" ref=${logContainerRef}>
            ${state.logs.value.map((entry, i) => html`
                <div key=${i} class="log-entry log-${entry.type}">
                    [${entry.timestamp.toLocaleTimeString()}] ${entry.message}
                </div>
            `)}
        </div>
    </div>`
}

render(html`<${Example} />`, document.getElementById('root')!)
