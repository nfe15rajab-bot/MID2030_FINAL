// Talks to server/material-autofill-server.js (reached via the
// /api/material-autofill Vite proxy — see vite.config.js). One field per
// call, matching the "Suggest" button being a manually-triggered,
// per-field action in the UI (never a bulk/automatic autofill).

/**
 * @param {{ materialName: string, category: string|null, providerName: string|null, field: string }} args
 * @returns {Promise<{ value: string|number|null, sourceUrl: string|null, confidence: 'high'|'medium'|'low'|null, confidenceLabel: string|null, note: string|null }>}
 */
export async function suggestField({ materialName, category, providerName, field }) {
  const res = await fetch('/api/material-autofill/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materialName, category, providerName, fields: [field] }),
  })

  const body = await res.json()
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return body.suggestions[field]
}
