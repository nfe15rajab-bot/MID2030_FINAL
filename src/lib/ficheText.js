// Shared text-shaping helpers for the fiche technique sheet's bulleted
// blocks (technical specs, end-of-life/circularity) — keeps both blocks
// visually consistent (short label:value lines) regardless of whether the
// underlying text came from a fresh AI suggestion already in that format,
// a paragraph saved before this format existed, or free-typed prose.
const FILLER_PATTERNS = [
  /\bis commonly supplied by\b/gi,
  /\bis typically supplied by\b/gi,
  /\bfeatures an?\b/gi,
  /\bwhich is\b/gi,
  /\bthat is\b/gi,
  /\bcan be\b/gi,
  /\bis generally\b/gi,
  /\bis usually\b/gi,
  /\bis commonly\b/gi,
]

export function trimToWords(text, maxWords = 8) {
  if (!text) return ''
  const words = String(text).trim().split(/\s+/)
  return words.length > maxWords ? words.slice(0, maxWords).join(' ') : words.join(' ')
}

// Splits free text into short label:value-style bullets, capped at
// maxBullets/maxWords. Prefers existing line breaks (the format the specs
// AI prompt now asks for); falls back to sentence-splitting so older
// paragraph-style saved text (or hand-typed prose) still renders as
// bullets instead of overflowing the column as one block of text.
export function toSpecsBullets(text, { maxBullets = 6, maxWords = 8 } = {}) {
  const trimmed = (text || '').trim()
  if (!trimmed) return []

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const candidates = lines.length > 1
    ? lines
    : trimmed.split(/(?<=[.;])\s+/).map((s) => s.trim()).filter(Boolean)

  const bullets = []
  for (let candidate of candidates) {
    candidate = candidate.replace(/^[-•*]\s*/, '').replace(/[.;]+$/, '').trim()
    if (!candidate) continue
    for (const pattern of FILLER_PATTERNS) candidate = candidate.replace(pattern, '').trim()
    candidate = candidate.replace(/\s{2,}/g, ' ')
    candidate = trimToWords(candidate, maxWords)
    if (candidate) bullets.push(candidate)
    if (bullets.length >= maxBullets) break
  }
  return bullets
}
