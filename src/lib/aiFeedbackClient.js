// Talks to server/material-autofill-server.js's /feedback route (reached
// via the /api/material-autofill Vite proxy — same server as /suggest,
// same API key, no second backend).

/**
 * @param {{ assemblyLabel: string, category: string|null, uValue: number|null, gwpTotal: number|null, layerCount: number, completeLayerCount: number, layers: Array }} args
 * @returns {Promise<string>} the feedback text
 */
export async function requestAiFeedback(args) {
  const res = await fetch('/api/material-autofill/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const body = await res.json()
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return body.feedback
}
