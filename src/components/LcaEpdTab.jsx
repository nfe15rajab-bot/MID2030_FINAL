import React, { useState } from 'react'
import { ASSEMBLIES, analyzeLcaAssembly, getFullCompletenessReport } from '../lib/lcaAnalysis.js'
import { saveAssemblyGeometry } from '../lib/assemblyGeometryStorage.js'
import EpdReferenceListPanel from './EpdReferenceListPanel.jsx'
import LcaConclusionsPanel from './LcaConclusionsPanel.jsx'
import './LcaEpdTab.css'

function GeometryFields({ assemblyKey, geometry, onChange }) {
  function update(field, value) {
    const next = { ...geometry, [field]: value }
    saveAssemblyGeometry(assemblyKey, next)
    onChange(next)
  }
  return (
    <div className="lca-geometry-row">
      <label className="lca-geometry-field">
        Surface area (m²)
        <input
          type="number"
          min={0}
          step="0.01"
          value={geometry.surfaceAreaM2}
          onChange={(e) => update('surfaceAreaM2', e.target.value)}
        />
      </label>
      <label className="lca-geometry-field">
        Volume (m³)
        <input
          type="number"
          min={0}
          step="0.01"
          value={geometry.volumeM3}
          onChange={(e) => update('volumeM3', e.target.value)}
        />
      </label>
    </div>
  )
}

function AssemblyCard({ assemblyKey }) {
  // Re-derive on every render (geometry edits trigger this via a version
  // bump below) rather than memoizing — this tab's whole value is "always
  // reflects what's actually saved right now," same reasoning as
  // AssemblyAnalysisTab.
  const [version, setVersion] = useState(0)
  // Collapsed by default — a "4 items missing" summary reads as normal
  // in-progress state; the full stacked list (can be 6-8 lines) only
  // shows once the user actually wants to see what's missing.
  const [missingExpanded, setMissingExpanded] = useState(false)
  const result = analyzeLcaAssembly(assemblyKey)

  if (!result.inScope) {
    return (
      <div className="lca-card lca-card--out-of-scope">
        <h3>{result.label}</h3>
        <p className="lca-note">
          Not in scope — no Section Configurator tab exists for this assembly (see ASSEMBLIES in
          lcaAnalysis.js/CLAUDE.md for current scope).
        </p>
      </div>
    )
  }

  return (
    <div className="lca-card">
      <h3>{result.label}</h3>

      <GeometryFields
        assemblyKey={assemblyKey}
        geometry={result.geometry}
        onChange={() => setVersion((v) => v + 1)}
      />

      {!result.hasData ? (
        <p className="lca-note">No layers saved yet for this assembly.</p>
      ) : (
        <>
          <div className="lca-phase-row">
            <span className="lca-phase-label">A1-A3 (product)</span>
            <span className="lca-phase-value">
              {result.a1a3KnownCount > 0 ? `${result.a1a3Total.toFixed(1)} kg CO₂e` : '—'}
            </span>
            <span className="lca-phase-sub">({result.a1a3KnownCount}/{result.layerCount} layers computed)</span>
          </div>

          <div className="lca-phase-row">
            <span className="lca-phase-label">A4 (transport)</span>
            <span className="lca-phase-value">
              {result.a4Total != null ? `${result.a4Total.toFixed(1)} kg CO₂e` : '—'}
            </span>
            <span className="lca-phase-sub">({result.a4KnownCount}/{result.layerCount} layers computed)</span>
          </div>

          <div className="lca-phase-row">
            <span className="lca-phase-label">B4 (replacement)</span>
            <span className={`lca-phase-value${result.b4Total == null ? ' lca-phase-value--muted' : ''}`}>
              {result.b4Total != null ? `${result.b4Total.toFixed(1)} kg CO₂e` : 'not yet assessed'}
            </span>
            <span className="lca-phase-sub">({result.b4KnownCount}/{result.layerCount} layers computed)</span>
          </div>

          <div className="lca-phase-row">
            <span className="lca-phase-label">C&D (end-of-life)</span>
            <span className="lca-phase-value lca-phase-value--muted">
              {result.endOfLifeFlags.filter((f) => f.scenario).length}/{result.endOfLifeFlags.length} layers have a scenario (fiche)
            </span>
          </div>

          <div className="lca-phase-row">
            <span className="lca-phase-label">C1-C4/D (modules)</span>
            <span className="lca-phase-value lca-phase-value--muted">
              {[
                result.c1Total != null && `C1 ${result.c1Total.toFixed(1)}`,
                result.c2Total != null && `C2 ${result.c2Total.toFixed(1)}`,
                result.c3Total != null && `C3 ${result.c3Total.toFixed(1)}`,
                result.c4Total != null && `C4 ${result.c4Total.toFixed(1)}`,
                result.moduleDTotal != null && `D ${result.moduleDTotal.toFixed(1)}`,
              ].filter(Boolean).join(' · ') || 'not yet modeled'}
            </span>
            <span className="lca-phase-sub">per-material breakdown in LCA Summary</span>
          </div>

          <div className="lca-phase-row lca-phase-row--total">
            <span className="lca-phase-label">Partial total (excludes B4, C&D)</span>
            <span className="lca-phase-value">{result.partialTotalKg.toFixed(1)} kg CO₂e</span>
          </div>

          <div className="lca-phase-row">
            <span className="lca-phase-label">Normalized</span>
            <span className="lca-phase-value">
              {result.normalized != null ? `${result.normalized.toFixed(3)} kg CO₂e/m²/yr` : '—'}
            </span>
            <span className="lca-phase-sub">(over 50 years)</span>
          </div>

          {result.missingSummary.length > 0 && (
            <div className="lca-missing">
              <button
                type="button"
                className="lca-missing-label"
                onClick={() => setMissingExpanded((e) => !e)}
                aria-expanded={missingExpanded}
              >
                {result.missingSummary.length} item{result.missingSummary.length === 1 ? '' : 's'} missing
                <span className={`lca-missing-caret${missingExpanded ? ' lca-missing-caret--open' : ''}`}>▾</span>
              </button>
              {missingExpanded && (
                <ul>
                  {result.missingSummary.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              )}
            </div>
          )}

          <p className="lca-card-meta">Last saved by {result.owner} · {new Date(result.savedAt).toLocaleString()}</p>
        </>
      )}
    </div>
  )
}

const STATUS_LABEL = {
  'out-of-scope': 'Out of scope',
  'no-data': 'No layers saved',
  incomplete: 'Incomplete',
  complete: 'Complete',
}

// Aggregates every assembly's missingSummary (+ B4/C&D placeholders) into
// one list, ahead of anywhere a push button would live — nothing should
// ever be able to push as a silent blank/zero without this having named
// it first.
function CompletenessCheck() {
  const report = getFullCompletenessReport()
  // Keyed by assembly name — same "collapsed by default" treatment as
  // AssemblyCard's missing-list above, one open/closed state per row.
  const [expanded, setExpanded] = useState({})
  return (
    <div className="lca-completeness">
      <h3>Completeness check</h3>
      <p className="lca-note">
        Every field still incomplete or not-yet-researched, across all four assemblies — checked here
        before anything would be pushed anywhere.
      </p>
      {report.map((r) => (
        <div key={r.assembly} className={`lca-completeness-row lca-completeness-row--${r.status}`}>
          <div className="lca-completeness-header">
            <strong>{r.assembly}</strong>
            <span className={`lca-completeness-badge lca-completeness-badge--${r.status}`}>
              {STATUS_LABEL[r.status]}
            </span>
          </div>
          {r.items.length > 0 && (
            <>
              <button
                type="button"
                className="lca-missing-label"
                onClick={() => setExpanded((prev) => ({ ...prev, [r.assembly]: !prev[r.assembly] }))}
                aria-expanded={!!expanded[r.assembly]}
              >
                {r.items.length} item{r.items.length === 1 ? '' : 's'} missing
                <span className={`lca-missing-caret${expanded[r.assembly] ? ' lca-missing-caret--open' : ''}`}>▾</span>
              </button>
              {expanded[r.assembly] && (
                <ul>
                  {r.items.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// LCA and EPD tab — full lifecycle assessment per assembly, computed
// live from existing app data (material layers, GWP unit values, λ,
// provider/transport data) plus the two manual geometry fields above
// (Part A). No automated geometry bridge to the 3D model yet — stays
// manual for now, per earlier decision.
//
// Part F (push into the professor's group2_v2 template) IS built — see the
// Spreadsheet tab (SpreadsheetTab.jsx) and the Deliverables tab's "LCA
// Calculation Excel" button, both backed by spreadsheetData.js /
// spreadsheetExcelExport.js, matching group2_v2's own column layout.
export default function LcaEpdTab() {
  return (
    <div className="lca-epd-tab">
      <h2 className="lca-epd-heading">LCA and EPD</h2>
      <p className="lca-epd-intro">
        Full lifecycle assessment per assembly — A1-A3, A4, B4, C&D, and a normalized total — computed
        from whatever's already saved in Section Configurator, Providers, and each material's fiche.
        Surface area and volume below are the only values you type in here; everything else is pulled,
        never re-entered.
      </p>

      <div className="lca-cards">
        {ASSEMBLIES.map((a) => <AssemblyCard key={a.key} assemblyKey={a.key} />)}
      </div>

      <CompletenessCheck />
      <EpdReferenceListPanel />
      <LcaConclusionsPanel />
    </div>
  )
}
