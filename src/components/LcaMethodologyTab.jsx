import React, { useState } from 'react'
import { LCA_MODULES, NORMALIZATION, U_VALUE, GLOSSARY } from '../data/lcaMethodology.js'
import './LcaMethodologyTab.css'

const GROUP_ORDER = ['Product stage', 'Use stage', 'End of life', 'Beyond the system boundary']

// One card per EN 15804/15978 module — same "in scope, here's the exact
// formula" vs. "out of scope, here's why" split as the rest of this app's
// confidence/attribution conventions (never silently implying a module
// was calculated when it wasn't).
function ModuleCard({ m }) {
  return (
    <div className={`methodology-module${m.inScope ? '' : ' methodology-module--out-of-scope'}`}>
      <div className="methodology-module-header">
        <span className="methodology-module-code">{m.code}</span>
        <h4>{m.label}</h4>
        <span className={`methodology-scope-badge methodology-scope-badge--${m.inScope ? 'in' : 'out'}`}>
          {m.inScope ? 'Calculated here' : 'Not calculated here'}
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

  const visibleModules = scopeFilter === 'inScope' ? LCA_MODULES.filter((m) => m.inScope) : LCA_MODULES

  return (
    <div className="lca-methodology-tab">
      <h2 className="lca-methodology-heading">LCA Methodology</h2>
      <p className="lca-methodology-intro">
        The EN 15804/15978 lifecycle-module system this project's LCA is built on, phase by phase — which
        modules this project actually calculates (and exactly how), which are standard-but-out-of-scope for
        this assignment, plus a glossary of the recurring terms and abbreviations. A condensed version of
        this feeds the A4 Written Report's Methodology section. Every formula below is imported straight from
        the same lib files (transport.js, uvalue.js, lcaAnalysis.js) the rest of the app computes from — this
        can't drift into describing a different calculation than the one actually running.
      </p>

      <div className="lca-methodology-filter">
        <button type="button" className={scopeFilter === 'all' ? 'active' : ''} onClick={() => setScopeFilter('all')}>
          All standard modules
        </button>
        <button type="button" className={scopeFilter === 'inScope' ? 'active' : ''} onClick={() => setScopeFilter('inScope')}>
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
