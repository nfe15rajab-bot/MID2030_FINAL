import React, { useState } from 'react'
import { suggestField } from '../lib/materialAutofillClient.js'

// Same suggest -> cite -> confirm pattern as FieldSuggest/EndOfLifeSuggest,
// for the one gap that actually blocks the A4 transport calc: when
// providers.json has no entry for a material, there's nothing to compute
// distance from. This researches who makes it and where, in one shot,
// rather than leaving "no provider" as a dead end in the LCA tab.
export default function ProviderInfoSuggest({ materialName, category, onAccept }) {
  const [state, setState] = useState({ status: 'idle' })

  async function handleSuggest() {
    setState({ status: 'loading' })
    try {
      const suggestion = await suggestField({ materialName, category, providerName: null, field: 'providerInfo' })
      if (suggestion.value?.name == null) {
        setState({ status: 'empty', note: suggestion.note })
      } else {
        setState({
          status: 'ready',
          name: suggestion.value.name,
          location: suggestion.value.location ?? '',
          website: suggestion.value.website ?? '',
          distanceToHaarlemKm: suggestion.value.distanceToHaarlemKm ?? '',
          sourceUrl: suggestion.sourceUrl,
          confidence: suggestion.confidence,
          confidenceLabel: suggestion.confidenceLabel,
          note: suggestion.note,
        })
      }
    } catch (err) {
      setState({ status: 'error', error: err.message })
    }
  }

  function handleAccept() {
    onAccept({
      name: state.name,
      location: state.location,
      website: state.website,
      distanceToHaarlemKm: state.distanceToHaarlemKm,
      sourceUrl: state.sourceUrl,
      confidence: state.confidence,
      confidenceLabel: state.confidenceLabel,
    })
    setState({ status: 'idle' })
  }

  return (
    <div className="field-suggest">
      <button
        type="button"
        className="field-suggest-trigger"
        onClick={handleSuggest}
        disabled={state.status === 'loading'}
      >
        {state.status === 'loading' ? 'Researching provider…' : 'Suggest provider'}
      </button>

      {state.status === 'ready' && (
        <div className="field-suggest-result">
          <input
            type="text"
            value={state.name}
            onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
            placeholder="provider name"
          />
          <input
            type="text"
            value={state.location}
            onChange={(e) => setState((s) => ({ ...s, location: e.target.value }))}
            placeholder="address, or city, country"
          />
          <input
            type="text"
            value={state.website}
            onChange={(e) => setState((s) => ({ ...s, website: e.target.value }))}
            placeholder="provider website (optional)"
          />
          <input
            type="number"
            min={0}
            value={state.distanceToHaarlemKm}
            onChange={(e) => setState((s) => ({ ...s, distanceToHaarlemKm: e.target.value }))}
            placeholder="distance to Haarlem (km)"
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
