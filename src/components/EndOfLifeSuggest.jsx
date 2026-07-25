import React, { useState } from 'react'
import { suggestField } from '../lib/materialAutofillClient.js'

export const END_OF_LIFE_SCENARIOS = [
  'Reuse',
  'Recycle',
  'Downcycle',
  'Energy recovery (incineration)',
  'Landfill/disposal',
]

// Same suggest -> cite -> confirm pattern as FieldSuggest.jsx (same CSS
// classes, same manual-trigger-only rule, same "nothing saves until
// Accept" rule) but for the one field whose suggested value isn't a
// single string: end-of-life is a {scenario, notes} pair, and — unlike
// the other fields — its confidence/source are meant to be KEPT after
// accepting (see the "Confidence" line under the accepted value below),
// not just shown transiently during review. That's the one real
// difference from FieldSuggest, so it gets its own small component
// instead of overloading that one with a structured-value special case.
export default function EndOfLifeSuggest({ materialName, category, providerName, onAccept }) {
  const [state, setState] = useState({ status: 'idle' })

  async function handleSuggest() {
    setState({ status: 'loading' })
    try {
      const suggestion = await suggestField({ materialName, category, providerName, field: 'endOfLife' })
      if (suggestion.value?.scenario == null) {
        setState({ status: 'empty', note: suggestion.note })
      } else {
        setState({
          status: 'ready',
          scenario: suggestion.value.scenario,
          notes: suggestion.value.notes ?? '',
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
      scenario: state.scenario,
      notes: state.notes,
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
          <select
            value={state.scenario}
            onChange={(e) => setState((s) => ({ ...s, scenario: e.target.value }))}
          >
            {END_OF_LIFE_SCENARIOS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <textarea
            rows={2}
            value={state.notes}
            onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
            placeholder="why this scenario applies"
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
