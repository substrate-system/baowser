import type { Request, Response } from 'express'
import express from 'express'
import * as fs from 'fs'
import * as path from 'path'
import type { BaoEncodingJson, BaoMetadata } from './types'

const app = express()
const PORT = process.env.PORT || 3000

// Serve static files
app.use(express.static('public'))

/**
 * API endpoint to get encoded file metadata
 */
app.get('/api/files/:filename/metadata', (req: Request, res: Response) => {
    const filename = req.params.filename
    const encodedPath = path.join(__dirname, '..', 'encoded', `${filename}.bao`)

    if (!fs.existsSync(encodedPath)) {
        return res.status(404).json({ error: 'File not found' })
    }

    const encoded: BaoEncodingJson = JSON.parse(fs.readFileSync(encodedPath, 'utf8'))

    // Send metadata without chunk data
    const metadata: BaoMetadata & { filename: string } = {
        filename,
        fileSize: encoded.fileSize,
        rootHash: encoded.rootHash,
        chunkSize: encoded.chunkSize,
        chunkCount: encoded.chunkCount
    }

    res.json(metadata)
})

/**
 * API endpoint to stream individual chunks
 */
app.get('/api/files/:filename/chunks/:chunkIndex', (req: Request, res: Response) => {
    const filename = req.params.filename
    const chunkIndex = parseInt(req.params.chunkIndex)
    const encodedPath = path.join(__dirname, '..', 'encoded', `${filename}.bao`)

    if (!fs.existsSync(encodedPath)) {
        return res.status(404).json({ error: 'File not found' })
    }

    const encoded: BaoEncodingJson = JSON.parse(fs.readFileSync(encodedPath, 'utf8'))

    if (chunkIndex < 0 || chunkIndex >= encoded.chunks.length) {
        return res.status(404).json({ error: 'Chunk not found' })
    }

    const chunk = encoded.chunks[chunkIndex]

    // Simulate network delay (optional)
    const delay = req.query.delay ? parseInt(req.query.delay as string) : 0

    setTimeout(() => {
        res.json({
            index: chunkIndex,
            size: chunk.size,
            hash: chunk.hash,
            data: chunk.data
        })
    }, delay)
})

/**
 * API endpoint to get all chunks at once (for comparison)
 */
app.get('/api/files/:filename/chunks', (req: Request, res: Response) => {
    const filename = req.params.filename
    const encodedPath = path.join(__dirname, '..', 'encoded', `${filename}.bao`)

    if (!fs.existsSync(encodedPath)) {
        return res.status(404).json({ error: 'File not found' })
    }

    const encoded: BaoEncodingJson = JSON.parse(fs.readFileSync(encodedPath, 'utf8'))
    res.json(encoded)
})

/**
 * List available encoded files
 */
app.get('/api/files', (req: Request, res: Response) => {
    const encodedDir = path.join(__dirname, '..', 'encoded')

    if (!fs.existsSync(encodedDir)) {
        return res.json({ files: [] })
    }

    const files = fs.readdirSync(encodedDir)
        .filter(f => f.endsWith('.bao'))
        .map(f => {
            const encoded: BaoEncodingJson = JSON.parse(
                fs.readFileSync(path.join(encodedDir, f), 'utf8')
            )
            return {
                filename: f.replace('.bao', ''),
                fileSize: encoded.fileSize,
                chunkCount: encoded.chunkCount,
                rootHash: encoded.rootHash
            }
        })

    res.json({ files })
});

// Create directories if they don't exist
['encoded', 'public'].forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir)
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
    }
})

// Start server
function startServer () {
    app.listen(PORT, () => {
        console.log(`\n🚀 Bao Streaming Server running on http://localhost:${PORT}`)
        console.log('\nAPI Endpoints:')
        console.log('  GET /api/files                          - List all encoded files')
        console.log('  GET /api/files/:filename/metadata       - Get file metadata')
        console.log('  GET /api/files/:filename/chunks/:index  - Get specific chunk')
        console.log('  GET /api/files/:filename/chunks         - Get all chunks')
    })
}

if (require.main === module) {
    startServer()
}

export { app, startServer }
