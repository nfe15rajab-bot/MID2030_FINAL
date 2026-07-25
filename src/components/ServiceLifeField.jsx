import React, { useState } from 'react'
import { suggestField } from '../lib/materialAutofillClient.js'
import { findMaterialDataMatch, saveMaterialData } from '../lib/aiMaterialDataStorage.js'

// Deliberately its own component, not another FieldSuggest field — service
// life's 3-tier provenance labeling ("Verified — EPD sourced" / "Unverified
// — AI sourced" / "Verified — manual") is a different vocabulary from every
// other field's high/medium/low confidence scale, and tier 1 (EPD) isn't a
// Suggest click at all — it's already on the layer the moment it's picked
// from a live Ökobaudat search (see LayerBuilder.jsx's onOkobaudatSelect).
// This component only ever handles tiers 2 (AI) and 3 (manual); it's not
// rendered at all when tier 1 already filled the value — see
// SortableLayerRow's layer.serviceLifeSource === 'epd' check.
//
// AI/manual values persist through the same shared aiMaterialDataStorage
// overlay λ/GWP/density already use (Firestore-synced team-wide) — reusing
// that storage, not its FieldSuggest UI, since only the display labels
// differ here, not the "research once, share with the team" data model.
export default function ServiceLifeField({ materialName, category, providerName, enteredBy, onAccept }) {
  const [state, setState] = useState({ status: 'idle' })
  const [manualDraft, setManualDraft] = useState('')

  async function handleSuggest() {
    setState({ status: 'loading' })

    const existing = findMaterialDataMatch(materialName, 'serviceLife')
    if (existing) {
      setState({
        status: 'ready',
        draft: String(existing.value),
        sourceUrl: existing.sourceUrl,
        tier: existing.tier,
        note: existing.justification,
        fromDataset: true,
      })
      return
    }

    try {
      const suggestion = await suggestField({ materialName, category, providerName, field: 'serviceLife' })
      if (suggestion.value == null) {
        setState({ status: 'empty', note: suggestion.note })
      } else {
        setState({
          status: 'ready',
          draft: String(suggestion.value),
          sourceUrl: suggestion.sourceUrl,
          tier: 'ai-suggested',
          note: suggestion.note,
        })
      }
    } catch (err) {
      setState({ status: 'error', error: err.message })
    }
  }

  function handleAccept() {
    const numericValue = Number(state.draft)
    if (Number.isFinite(numericValue)) {
      saveMaterialData(materialName, 'serviceLife', {
        value: numericValue,
        tier: state.fromDataset ? state.tier : 'ai-suggested',
        sourceUrl: state.sourceUrl ?? null,
        justification: state.note ?? null,
        enteredBy: enteredBy ?? null,
      })
    }
    onAccept(state.draft, 'ai')
    setState({ status: 'idle' })
  }

  function handleManualSave() {
    const numericValue = Number(manualDraft)
    if (!Number.isFinite(numericValue)) return
    saveMaterialData(materialName, 'serviceLife', {
      value: numericValue,
      tier: 'manual-entry',
      sourceUrl: null,
      justification: null,
      enteredBy: enteredBy ?? null,
    })
    onAccept(String(numericValue), 'manual')
    setManualDraft('')
  }

  return (
    <div className="field-suggest service-life-field">
      <div className="field-suggest-trigger-row">
        <button
          type="button"
          className="field-suggest-trigger"
          onClick={handleSuggest}
          disabled={state.status === 'loading'}
        >
          {state.status === 'loading' ? 'Searching…' : 'Search with AI'}
        </button>

        {state.status !== 'ready' && (
          <div className="field-suggest-manual">
            <input
              type="number"
              step="any"
              placeholder="years"
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
          <input
            type="number"
            step="any"
            value={state.draft}
            onChange={(e) => setState((s) => ({ ...s, draft: e.target.value }))}
          />
          <div className="field-suggest-meta">
            <span className={`service-life-badge service-life-badge--${state.tier === 'manual-entry' ? 'verified' : 'unverified'}`}>
              {state.tier === 'manual-entry' ? 'Verified — manual' : 'Unverified — AI sourced'}
            </span>
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
          No reliable source found{state.note && state.note !== 'no reliable source found' ? ` — ${state.note}` : ''} — enter manually if known.
        </p>
      )}
      {state.status === 'error' && (
        <p className="field-suggest-note field-suggest-note--error">Search failed: {state.error}</p>
      )}
    </div>
  )
}
