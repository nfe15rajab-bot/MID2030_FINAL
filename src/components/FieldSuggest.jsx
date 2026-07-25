import React, { useState } from 'react'
import { suggestField } from '../lib/materialAutofillClient.js'
import { findMaterialDataMatch, saveMaterialData } from '../lib/aiMaterialDataStorage.js'

// Fields backed by the shared aiMaterialDataStorage.js overlay — an
// Accept here persists team-wide (see saveMaterialData), and a Suggest
// click checks that overlay before ever calling the AI backend, so a
// teammate researching the same material twice doesn't re-spend a
// search or hit "no match" for something already settled. Every other
// field FieldSuggest serves (germanName/specs/norm/providerWebsite)
// keeps its original transient, per-click-only behavior.
const DATASET_FIELDS = new Set(['lambda', 'gwp', 'density'])

// Suggest -> cite -> confirm, the same pattern for every autofillable
// field (German name / specs / norm / provider website / λ / GWP).
// Manually triggered only — never fires on mount or on material
// selection. The suggestion is shown as editable text with its source
// link and confidence badge; nothing reaches saved state until the user
// clicks Accept, which hands the current draft text to the caller's
// own onAccept — same as if the user had typed it themselves. onAccept
// also receives the suggestion's metadata (sourceUrl/confidence/
// confidenceLabel) as a second argument, for callers that need to keep
// it around (e.g. the EPD reference list needs a citable source for
// AI-verified GWP values) — most callers just ignore that second arg.
export default function FieldSuggest({ field, materialName, category, providerName, onAccept, enteredBy, allowManualEntry }) {
  const [state, setState] = useState({ status: 'idle' })
  const [manualDraft, setManualDraft] = useState('')
  const isDatasetField = DATASET_FIELDS.has(field)

  async function handleSuggest() {
    setState({ status: 'loading' })

    if (isDatasetField) {
      const existing = findMaterialDataMatch(materialName, field)
      if (existing) {
        const origin = existing.tier === 'ai-suggested'
          ? `AI-suggested — accepted by ${existing.enteredBy || 'a teammate'}`
          : `Manually entered by ${existing.enteredBy || 'a teammate'}`
        const status = existing.verified
          ? `verified by ${existing.verifiedBy || 'a teammate'}`
          : 'not yet verified'
        setState({
          status: 'ready',
          draft: String(existing.value),
          sourceUrl: existing.sourceUrl,
          confidence: existing.tier,
          confidenceLabel: `${origin}, ${status}`,
          note: existing.justification,
          fromDataset: true,
        })
        return
      }
    }

    try {
      const suggestion = await suggestField({ materialName, category, providerName, field })
      if (suggestion.value == null) {
        setState({ status: 'empty', note: suggestion.note })
      } else {
        setState({ status: 'ready', ...suggestion, draft: String(suggestion.value) })
      }
    } catch (err) {
      setState({ status: 'error', error: err.message })
    }
  }

  function handleAccept() {
    if (isDatasetField) {
      const numericValue = Number(state.draft)
      if (Number.isFinite(numericValue)) {
        saveMaterialData(materialName, field, {
          value: numericValue,
          // Re-affirming an already-stored entry keeps its tier as-is;
          // a genuinely fresh AI suggestion is always tagged
          // ai-suggested here, distinct from the high/medium/low
          // confidence the AI itself self-rated (kept alongside, not
          // replaced — see aiConfidence/aiConfidenceLabel).
          tier: state.fromDataset ? state.confidence : 'ai-suggested',
          aiConfidence: state.fromDataset ? null : (state.confidence ?? null),
          aiConfidenceLabel: state.fromDataset ? null : (state.confidenceLabel ?? null),
          sourceUrl: state.sourceUrl ?? null,
          justification: state.note ?? null,
          enteredBy: enteredBy ?? null,
        })
      }
    }
    onAccept(state.draft, {
      sourceUrl: state.sourceUrl ?? null,
      confidence: state.confidence ?? null,
      confidenceLabel: state.confidenceLabel ?? null,
    })
    setState({ status: 'idle' })
  }

  // Always-available fallback for callers that pass allowManualEntry —
  // Suggest can fail or come back empty, and the caller shouldn't be
  // blocked on a working AI search just to fill in a number it already
  // knows. Persists to the same shared dataset as an AI accept (see
  // saveMaterialData), tagged 'manual-entry' rather than 'ai-suggested'
  // so it's honest about where the number came from — still unverified
  // by default either way.
  function handleManualSave() {
    const numericValue = Number(manualDraft)
    if (!Number.isFinite(numericValue)) return
    saveMaterialData(materialName, field, {
      value: numericValue,
      tier: 'manual-entry',
      sourceUrl: null,
      justification: null,
      enteredBy: enteredBy ?? null,
    })
    onAccept(String(numericValue), {
      sourceUrl: null,
      confidence: 'manual-entry',
      confidenceLabel: 'Manually entered',
    })
    setManualDraft('')
  }

  return (
    <div className="field-suggest">
      <div className="field-suggest-trigger-row">
        <button
          type="button"
          className="field-suggest-trigger"
          onClick={handleSuggest}
          disabled={state.status === 'loading'}
        >
          {state.status === 'loading' ? 'Searching…' : 'Suggest'}
        </button>

        {allowManualEntry && isDatasetField && state.status !== 'ready' && (
          <div className="field-suggest-manual">
            <input
              type="number"
              step="any"
              placeholder={field === 'lambda' ? 'λ W/mK' : field === 'density' ? 'kg/m³' : 'GWP kg CO2e'}
              value={manualDraft}
              onChange={(e) => setManualDraft(e.target.value)}
            />
            <button
              type="button"
              onClick={handleManualSave}
              disabled={manualDraft.trim() === '' || !Number.isFinite(Number(manualDraft))}
            >
              Save
            </button>
          </div>
        )}
      </div>

      {state.status === 'ready' && (
        <div className="field-suggest-result">
          <textarea
            rows={2}
            value={state.draft}
            onChange={(e) => setState((s) => ({ ...s, draft: e.target.value }))}
          />
          <div className="field-suggest-meta">
            {state.confidenceLabel && (
              <span className={`field-suggest-badge field-suggest-badge--${state.confidence}`}>
                {state.confidenceLabel}
              </span>
            )}
            {state.sourceUrl && (
              <a href={state.sourceUrl} target="_blank" rel="noreferrer">source</a>
            )}
            {state.note && <span className="field-suggest-warning">{state.note}</span>}
          </div>
          <div className="field-suggest-actions">
            <button type="button" onClick={handleAccept}>Accept</button>
            <button type="button" onClick={() => setState({ status: 'idle' })}>Discard</button>
          </div>
        </div>
      )}

      {state.status === 'empty' && (
        <p className="field-suggest-note">
          No reliable source found{state.note && state.note !== 'no reliable source found' ? ` — ${state.note}` : ''}.
        </p>
      )}
      {state.status === 'error' && (
        <p className="field-suggest-note field-suggest-note--error">Suggest failed: {state.error}</p>
      )}
    </div>
  )
}
