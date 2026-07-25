// Tiny local backend for the true-to-scale section generator. The DXF/PDF
// pipeline is Python (ezdxf) — see server/section_generator/ — so this
// server exists only to bridge the browser to that script: receive the
// section JSON, shell out to generate.py, hand back the two output files.
// Started alongside `vite` via `npm run dev` (see package.json) and
// reached through Vite's dev proxy at /api/section-export (vite.config.js)
// so the browser never needs to know it's a separate process/port.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 3901
const GENERATE_SCRIPT = path.join(import.meta.dirname, 'section_generator', 'generate.py')

// `python`/`python3` on PATH can resolve to the Windows Store's stub alias
// (exits with "Python was not found..." instead of running anything) even
// when a real Python is installed elsewhere, so probe a few candidates
// instead of trusting PATH blindly.
const PYTHON_CANDIDATES = [
  'C:\\Users\\Shadow\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
  'python3',
  'python',
]

let cachedPython = null
function findPython() {
  if (cachedPython) return cachedPython
  for (const candidate of PYTHON_CANDIDATES) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf-8' })
    if (result.status === 0) {
      cachedPython = candidate
      return candidate
    }
  }
  throw new Error(
    `No working Python interpreter found. Tried: ${PYTHON_CANDIDATES.join(', ')}`
  )
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

function handleGenerate(req, res) {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    let input
    try {
      input = JSON.parse(body)
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' })
      return
    }
    if (!input.section || !Array.isArray(input.layers)) {
      sendJson(res, 400, { error: 'Body must include "section" and "layers"' })
      return
    }
    if (!existsSync(GENERATE_SCRIPT)) {
      sendJson(res, 500, { error: `generate.py not found at ${GENERATE_SCRIPT}` })
      return
    }

    let python
    try {
      python = findPython()
    } catch (err) {
      sendJson(res, 500, { error: err.message })
      return
    }

    const tmpDir = mkdtempSync(path.join(tmpdir(), 'mid2030-section-'))
    const inputPath = path.join(tmpDir, 'input.json')
    const outDir = path.join(tmpDir, 'out')
    writeFileSync(inputPath, JSON.stringify(input))

    const child = spawn(python, [GENERATE_SCRIPT, inputPath, outDir])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })

    child.on('error', (err) => {
      rmSync(tmpDir, { recursive: true, force: true })
      sendJson(res, 500, { error: `Failed to spawn Python: ${err.message}` })
    })

    child.on('close', (code) => {
      if (code !== 0) {
        rmSync(tmpDir, { recursive: true, force: true })
        sendJson(res, 500, { error: 'generate.py exited with an error', code, stdout, stderr })
        return
      }
      const sectionLower = input.section.toLowerCase()
      const dxfPath = path.join(outDir, `${sectionLower}.dxf`)
      const pdfPath = path.join(outDir, `${sectionLower}.pdf`)
      if (!existsSync(dxfPath) || !existsSync(pdfPath)) {
        rmSync(tmpDir, { recursive: true, force: true })
        sendJson(res, 500, { error: 'generate.py reported success but output files are missing', stdout, stderr })
        return
      }
      const dxfBase64 = readFileSync(dxfPath).toString('base64')
      const pdfBase64 = readFileSync(pdfPath).toString('base64')
      rmSync(tmpDir, { recursive: true, force: true })
      sendJson(res, 200, { dxfBase64, pdfBase64, log: stdout, section: input.section })
    })
  })
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/generate') {
    handleGenerate(req, res)
    return
  }
  sendJson(res, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  console.log(`[section-export-server] listening on http://localhost:${PORT}`)
})
