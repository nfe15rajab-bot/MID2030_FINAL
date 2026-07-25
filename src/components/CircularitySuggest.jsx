import React, { useState } from 'react'
import { suggestField } from '../lib/materialAutofillClient.js'

// Same suggest -> cite -> confirm pattern as EndOfLifeSuggest.jsx, for the
// two circularity sub-fields (recyclability % + deconstruction method)
// that render alongside endOfLifeScenario/endOfLifeNotes in the fiche's
// left-column circularity bullet block. Kept as its own AI field/component
// rather than folding into 'endOfLife' since that field's {scenario,
// notes} shape already feeds the LCA tab's C&D summary and shouldn't
// change shape.
export default function CircularitySuggest({ materialName, category, providerName, onAccept }) {
  const [state, setState] = useState({ status: 'idle' })

  async function handleSuggest() {
    setState({ status: 'loading' })
    try {
      const suggestion = await suggestField({ materialName, category, providerName, field: 'circularity' })
      const value = suggestion.value
      if (value?.recyclabilityPercent == null && value?.deconstructionMethod == null) {
        setState({ status: 'empty', note: suggestion.note })
      } else {
        setState({
          status: 'ready',
          recyclabilityPercent: value.recyclabilityPercent != null ? String(value.recyclabilityPercent) : '',
          deconstructionMethod: value.deconstructionMethod ?? '',
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
      recyclabilityPercent: state.recyclabilityPercent === '' ? null : Number(state.recyclabilityPercent),
      deconstructionMethod: state.deconstructionMethod,
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
        {state.status === 'loading' ? 'Searching…' : 'Suggest'}
      </button>

      {state.status === 'ready' && (
        <div className="field-suggest-result">
          <input
            type="number"
            min={0}
            max={100}
            value={state.recyclabilityPercent}
            onChange={(e) => setState((s) => ({ ...s, recyclabilityPercent: e.target.value }))}
            placeholder="recyclability %"
          />
          <input
            type="text"
            value={state.deconstructionMethod}
            onChange={(e) => setState((s) => ({ ...s, deconstructionMethod: e.target.value }))}
            placeholder="deconstruction method"
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
