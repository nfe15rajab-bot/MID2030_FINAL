import React, { useState } from 'react'
import { LCA_MODULES, NORMALIZATION, U_VALUE, GLOSSARY } from '../data/lcaMethodology.js'
import './LcaMethodologyTab.css'

const GROUP_ORDER = ['Product stage', 'Use stage', 'End of life', 'Beyond the system boundary']

// Three distinct states, never collapsed into one another: `computed`
// (a real formula or per-material researched figure exists), `inScope
// && !computed` (addressed in the report as written discussion, but
// deliberately assigned no invented number), and `!inScope` (not
// addressed anywhere, calculated or discussed — only A5 today). Same
// "never silently imply a module was calculated when it wasn't"
// convention as the rest of this app's confidence/attribution UI.
const SCOPE_BADGE = {
  computed: { className: 'in', label: 'Calculated here' },
  discussed: { className: 'discussed', label: 'Discussed, not calculated' },
  none: { className: 'out', label: 'Not addressed' },
}

function scopeBadgeFor(m) {
  if (m.computed) return SCOPE_BADGE.computed
  if (m.inScope) return SCOPE_BADGE.discussed
  return SCOPE_BADGE.none
}

function ModuleCard({ m }) {
  const badge = scopeBadgeFor(m)
  return (
    <div className={`methodology-module${m.inScope ? '' : ' methodology-module--out-of-scope'}`}>
      <div className="methodology-module-header">
        <span className="methodology-module-code">{m.code}</span>
        <h4>{m.label}</h4>
        <span className={`methodology-scope-badge methodology-scope-badge--${badge.className}`}>
          {badge.label}
        </span>
      </div>
      <p className="methodology-module-standard">{m.standard}</p>
      <p className="methodology-module-desc">{m.description}</p>
      {m.formula && <pre className="methodology-formula">{m.formula}</pre>}
      {m.formulaNote && <p className="methodology-module-note">{m.formulaNote}</p>}
      {m.dataSource && <p className="methodology-module-source">Data source: {m.dataSource}</p>}
      {!m.inScope && m.scopeNote && <p className="methodology-module-scopenote">{m.scopeNote}</p>}
    </div>
  )
}

// LCA Methodology — a reference tab, not a calculator: explains the
// standard lifecycle-module system phase by phase (which this project
// calculates and how, which are standard-but-out-of-scope here) plus a
// glossary of recurring terms. A condensed version of this same content
// feeds the A4 Written Report's Methodology section (A4ReportDraft.jsx /
// a4DocxExport.js) — kept as one shared data file (lcaMethodology.js) so
// the tab and the report can't drift apart or disagree on a formula.
export default function LcaMethodologyTab() {
  const [scopeFilter, setScopeFilter] = useState('all')

  const visibleModules = scopeFilter === 'computed' ? LCA_MODULES.filter((m) => m.computed) : LCA_MODULES

  return (
    <div className="lca-methodology-tab">
      <h2 className="lca-methodology-heading">LCA Methodology</h2>
      <p className="lca-methodology-intro">
        The EN 15804/15978 lifecycle-module system this project's LCA is built on, phase by phase — which
        modules this project actually calculates (and exactly how), which are in scope for written discussion
        only (no invented number), and which are entirely out of scope, plus a glossary of the recurring terms
        and abbreviations. A condensed version of this feeds the A4 Written Report's Methodology section.
        Every formula below is imported straight from the same lib files (transport.js, uvalue.js,
        lcaAnalysis.js) the rest of the app computes from — this can't drift into describing a different
        calculation than the one actually running.
      </p>

      <div className="lca-methodology-filter">
        <button type="button" className={scopeFilter === 'all' ? 'active' : ''} onClick={() => setScopeFilter('all')}>
          All standard modules
        </button>
        <button type="button" className={scopeFilter === 'computed' ? 'active' : ''} onClick={() => setScopeFilter('computed')}>
          Only what this project calculates
        </button>
      </div>

      {GROUP_ORDER.map((group) => {
        const modules = visibleModules.filter((m) => m.group === group)
        if (modules.length === 0) return null
        return (
          <section key={group} className="lca-methodology-group">
            <h3>{group}</h3>
            <div className="lca-methodology-modules">
              {modules.map((m) => <ModuleCard key={m.code} m={m} />)}
            </div>
          </section>
        )
      })}

      <section className="lca-methodology-group">
        <h3>Normalization</h3>
        <div className="methodology-module">
          <pre className="methodology-formula">{NORMALIZATION.formula}</pre>
          <p className="methodology-module-note">{NORMALIZATION.note}</p>
          <p className="methodology-module-standard">Unit: {NORMALIZATION.unit}</p>
        </div>
      </section>

      <section className="lca-methodology-group">
        <h3>U-value (building physics)</h3>
        <div className="methodology-module">
          <p className="methodology-module-standard">{U_VALUE.standard}</p>
          <pre className="methodology-formula">{U_VALUE.formula}</pre>
          <div className="lca-methodology-table-wrapper">
            <table className="lca-methodology-table">
              <thead><tr><th>Element</th><th>Rsi (m²K/W)</th><th>Rse (m²K/W)</th></tr></thead>
              <tbody>
                {Object.entries(U_VALUE.surfaceResistances).map(([key, r]) => (
                  <tr key={key}><td>{key}</td><td>{r.rsi}</td><td>{r.rse}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="methodology-module-note">{U_VALUE.note}</p>
        </div>
      </section>

      <section className="lca-methodology-group">
        <h3>Glossary</h3>
        <dl className="lca-methodology-glossary">
          {GLOSSARY.map((g) => (
            <div key={g.term} className="lca-methodology-glossary-entry">
              <dt>{g.name}</dt>
              <dd>
                <p>{g.definition}</p>
                {g.note && <p className="methodology-module-note">{g.note}</p>}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
