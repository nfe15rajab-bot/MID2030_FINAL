// Per-assembly AI Feedback text — accepted (possibly user-edited) drafts,
// same localStorage pattern as ficheStorage.js/assemblyGeometryStorage.js,
// keyed by assembly instead of material. This is commentary support, not
// a citable source (see AiFeedbackPanel.jsx) — never has a sourceUrl of
// its own, unlike the fiche's AI-suggested fields.
const PREFIX = 'mid2030:aifeedback:'

/** @returns {{ text: string, generatedAt: string } | null} */
export function loadAiFeedback(assemblyKey) {
  const raw = localStorage.getItem(`${PREFIX}${assemblyKey}`)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveAiFeedback(assemblyKey, text) {
  const record = { text, generatedAt: new Date().toISOString() }
  localStorage.setItem(`${PREFIX}${assemblyKey}`, JSON.stringify(record))
  return record
}

export function clearAiFeedback(assemblyKey) {
  localStorage.removeItem(`${PREFIX}${assemblyKey}`)
}
