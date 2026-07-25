// Talks to server/section-export-server.js (reached via the /api/section-export
// Vite proxy — see vite.config.js), which shells out to the Python/ezdxf
// true-to-scale generator (server/section_generator/generate.py) and hands
// back the DXF + PDF it wrote.

function base64ToBlob(base64, mimeType) {
  const bytes = atob(base64)
  const array = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i)
  return new Blob([array], { type: mimeType })
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * @param {{ section: string, owner: string, savedAt: string|null, layers: Array, pitchDeg: number|undefined }} sectionData
 *   pitchDeg is roof-only (generate.py ignores it for wall/floor) — the
 *   manual pitch angle the diagram gets rotated to, same value
 *   SectionPreview.jsx renders live in the browser.
 * @returns {Promise<{ log: string }>}
 */
export async function exportTrueScaleSection(sectionData) {
  const res = await fetch('/api/section-export/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sectionData),
  })

  const body = await res.json()
  if (!res.ok) {
    const detail = body.stderr || body.stdout || body.error || `HTTP ${res.status}`
    throw new Error(detail)
  }

  const sectionLower = sectionData.section.toLowerCase()
  downloadBlob(base64ToBlob(body.dxfBase64, 'application/dxf'), `${sectionLower}.dxf`)
  downloadBlob(base64ToBlob(body.pdfBase64, 'application/pdf'), `${sectionLower}.pdf`)

  return { log: body.log }
}
