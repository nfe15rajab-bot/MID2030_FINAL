import React, { useState } from 'react'
import { requestAiFeedback } from '../lib/aiFeedbackClient.js'
import { loadAiFeedback, saveAiFeedback } from '../lib/aiFeedbackStorage.js'
import './FicheTechnique.css'
import './AiFeedbackPanel.css'

// Manually-triggered AI commentary on one assembly's computed
// performance — grounded via the same web-search-enabled Gemini call as
// the material Suggest fields, but this is commentary support, NOT a
// citable source (per the task's own scope guard): no source link, no
// confidence badge, just prose the user is expected to edit. Never
// auto-fires and never auto-inserts anywhere — the "Copy for report"
// button just puts the current (possibly edited) text on the clipboard.
export default function AiFeedbackPanel({ assemblyResult }) {
  const [draft, setDraft] = useState(() => loadAiFeedback(assemblyResult.key)?.text ?? '')
  const [status, setStatus] = useState(draft ? 'ready' : 'idle')
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  async function handleGenerate() {
    setStatus('loading')
    setError(null)
    try {
      const text = await requestAiFeedback({
        assemblyLabel: assemblyResult.label,
        category: assemblyResult.label,
        uValue: assemblyResult.uValue,
        gwpTotal: assemblyResult.gwpKnownCount > 0 ? assemblyResult.gwpTotal : null,
        layerCount: assemblyResult.layerCount,
        completeLayerCount: assemblyResult.completeCount,
        layers: assemblyResult.layers,
      })
      setDraft(text)
      saveAiFeedback(assemblyResult.key, text)
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  function handleDraftChange(value) {
    setDraft(value)
    saveAiFeedback(assemblyResult.key, value)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(draft)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="ai-feedback-panel">
      <button type="button" className="field-suggest-trigger" onClick={handleGenerate} disabled={status === 'loading'}>
        {status === 'loading' ? 'Generating…' : draft ? 'Regenerate AI feedback' : 'AI Feedback'}
      </button>

      {status === 'error' && <p className="field-suggest-note field-suggest-note--error">Feedback failed: {error}</p>}

      {draft && (
        <div className="ai-feedback-result">
          <div className="ai-feedback-badge">AI-drafted — edit before using in your report</div>
          <textarea
            rows={5}
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
          />
          <div className="ai-feedback-actions">
            <button type="button" onClick={handleCopy}>{copied ? 'Copied!' : 'Copy for report'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
