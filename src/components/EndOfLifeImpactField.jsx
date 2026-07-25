import React, { useState } from 'react'
import { suggestField } from '../lib/materialAutofillClient.js'
import { findMaterialDataMatch, saveMaterialData } from '../lib/aiMaterialDataStorage.js'

const EMPTY_MANUAL = {
  recycledPct: '', landfillPct: '', incineratedPct: '',
  c1: '', c3: '', c4: '', moduleD: '', assumptionBasis: '',
}

function toNum(v) {
  return v === '' || v == null ? null : Number(v)
}

// Bespoke, like ServiceLifeField.jsx — end-of-life impact is a structured
// object (route % split + C1/C3/C4/D), not a single number, so it needs
// its own form rather than FieldSuggest's single-value UI. Same 3-tier
// provenance labeling convention as service life (EPD tier isn't rendered
// here at all — see SortableLayerRow's layer.eolSource === 'epd' check,
// same as service life's own EPD tier). C2 (transport to waste
// processing) deliberately has no field here — it's always computed
// locally from real distance/mass data (see lcaAnalysis.js), never
// researched or typed in.
export default function EndOfLifeImpactField({ materialName, category, providerName, enteredBy, onAccept }) {
  const [state, setState] = useState({ status: 'idle' })
  const [manual, setManual] = useState(EMPTY_MANUAL)
  const [showManual, setShowManual] = useState(false)

  async function handleSuggest() {
    setState({ status: 'loading' })

    const existing = findMaterialDataMatch(materialName, 'endOfLifeImpact')
    if (existing) {
      setState({
        status: 'ready',
        draft: existing.value,
        sourceUrl: existing.sourceUrl,
        tier: existing.tier,
        note: existing.justification,
        fromDataset: true,
      })
      return
    }

    try {
      const suggestion = await suggestField({ materialName, category, providerName, field: 'endOfLifeImpact' })
      if (suggestion.value == null) {
        setState({ status: 'empty', note: suggestion.note })
      } else {
        setState({
          status: 'ready',
          draft: suggestion.value,
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
    saveMaterialData(materialName, 'endOfLifeImpact', {
      value: state.draft,
      tier: state.fromDataset ? state.tier : 'ai-suggested',
      sourceUrl: state.sourceUrl ?? null,
      justification: state.note ?? null,
      enteredBy: enteredBy ?? null,
    })
    onAccept(state.draft, 'ai')
    setState({ status: 'idle' })
  }

  function handleManualSave() {
    const value = {
      recycledPct: toNum(manual.recycledPct),
      landfillPct: toNum(manual.landfillPct),
      incineratedPct: toNum(manual.incineratedPct),
      c1: toNum(manual.c1),
      c3: toNum(manual.c3),
      c4: toNum(manual.c4),
      moduleD: toNum(manual.moduleD),
      assumptionBasis: manual.assumptionBasis || null,
    }
    saveMaterialData(materialName, 'endOfLifeImpact', {
      value,
      tier: 'manual-entry',
      sourceUrl: null,
      justification: manual.assumptionBasis || null,
      enteredBy: enteredBy ?? null,
    })
    onAccept(value, 'manual')
    setManual(EMPTY_MANUAL)
    setShowManual(false)
  }

  return (
    <div className="field-suggest eol-impact-field">
      <div className="field-suggest-trigger-row">
        <button type="button" className="field-suggest-trigger" onClick={handleSuggest} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Searching…' : 'Search with AI'}
        </button>
        <button type="button" className="field-suggest-trigger" onClick={() => setShowManual((s) => !s)}>
          {showManual ? 'Hide manual entry' : 'Manual entry'}
        </button>
      </div>

      {showManual && (
        <div className="eol-impact-manual">
          <div className="eol-impact-row">
            <input type="number" min={0} max={100} placeholder="% recycled" value={manual.recycledPct} onChange={(e) => setManual((m) => ({ ...m, recycledPct: e.target.value }))} />
            <input type="number" min={0} max={100} placeholder="% landfill" value={manual.landfillPct} onChange={(e) => setManual((m) => ({ ...m, landfillPct: e.target.value }))} />
            <input type="number" min={0} max={100} placeholder="% incinerated" value={manual.incineratedPct} onChange={(e) => setManual((m) => ({ ...m, incineratedPct: e.target.value }))} />
          </div>
          <div className="eol-impact-row">
            <input type="number" step="any" placeholder="C1 kg CO₂e" value={manual.c1} onChange={(e) => setManual((m) => ({ ...m, c1: e.target.value }))} />
            <input type="number" step="any" placeholder="C3 kg CO₂e" value={manual.c3} onChange={(e) => setManual((m) => ({ ...m, c3: e.target.value }))} />
            <input type="number" step="any" placeholder="C4 kg CO₂e" value={manual.c4} onChange={(e) => setManual((m) => ({ ...m, c4: e.target.value }))} />
            <input type="number" step="any" max={0} placeholder="D kg CO₂e (credit, ≤0)" value={manual.moduleD} onChange={(e) => setManual((m) => ({ ...m, moduleD: e.target.value }))} />
          </div>
          <textarea
            rows={2}
            placeholder='Assumption basis — why this scenario (e.g. "timber → incineration w/ energy recovery, typical for untreated softwood cladding")'
            value={manual.assumptionBasis}
            onChange={(e) => setManual((m) => ({ ...m, assumptionBasis: e.target.value }))}
          />
          <button type="button" onClick={handleManualSave} disabled={!manual.assumptionBasis.trim()}>Save</button>
        </div>
      )}

      {state.status === 'ready' && (
        <div className="field-suggest-result">
          <div className="eol-impact-summary">
            {state.draft.recycledPct != null && <span>Recycled: {state.draft.recycledPct}%</span>}
            {state.draft.landfillPct != null && <span>Landfill: {state.draft.landfillPct}%</span>}
            {state.draft.incineratedPct != null && <span>Incinerated: {state.draft.incineratedPct}%</span>}
            {state.draft.c1 != null && <span>C1: {state.draft.c1} kg CO₂e</span>}
            {state.draft.c3 != null && <span>C3: {state.draft.c3} kg CO₂e</span>}
            {state.draft.c4 != null && <span>C4: {state.draft.c4} kg CO₂e</span>}
            {state.draft.moduleD != null && <span>D: {state.draft.moduleD} kg CO₂e (credit)</span>}
          </div>
          <div className="field-suggest-meta">
            <span className={`service-life-badge service-life-badge--${state.tier === 'manual-entry' ? 'verified' : 'unverified'}`}>
              {state.tier === 'manual-entry' ? 'Verified — manual' : 'Unverified — AI sourced'}
            </span>
            {state.sourceUrl && <a href={state.sourceUrl} target="_blank" rel="noreferrer">source</a>}
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
          No reliable source found{state.note && state.note !== 'no reliable source found' ? ` — ${state.note}` : ''} — enter manually.
        </p>
      )}
      {state.status === 'error' && <p className="field-suggest-note field-suggest-note--error">Search failed: {state.error}</p>}
    </div>
  )
}
