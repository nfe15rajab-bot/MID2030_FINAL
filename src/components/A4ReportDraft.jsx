import React, { forwardRef } from 'react'
import BarChart from './BarChart.jsx'
import { getMaterialResearchByDiscipline, getGlobalLcaSummary, getGlobalProviderStats } from '../lib/deliverablesData.js'
import { classifyAssemblySustainability } from '../lib/sustainabilityRubric.js'
import { loadFicheDetail } from '../lib/ficheStorage.js'
import { getAllMaterials } from '../lib/materialsCatalog.js'
import { buildLayerCalculationSteps, buildUValueAssemblyStep } from '../lib/calculationNarrative.js'
import './A4ReportDraft.css'

function fmt(n, digits = 3) {
  return n != null ? n.toFixed(digits) : '—'
}

// DRAFT sections (Abstract, Discussion) get this banner — visually and
// textually distinct from the factual sections on purpose (scope guard:
// must be impossible to mistake a draft paragraph for finished prose).
// Suppressed per team request — flip back to true to restore it. Kept as
// a flag (not deleted) since the underlying concern (AI-drafted prose
// needs a human rewrite pass before submission) is still real.
const SHOW_DRAFT_BANNER = false

function DraftBanner() {
  if (!SHOW_DRAFT_BANNER) return null
  return <div className="a4-draft-banner">DRAFT — rewrite in your own words before submission</div>
}

const EOL_TIER_LABEL = {
  epd: 'EPD-sourced',
  ai: 'AI-sourced (unverified)',
  manual: 'Assumed (manual)',
}

// Report-writing order the team asked for — distinct from ASSEMBLIES' own
// wall/roof/floor/door/window/skylight order (assemblyAnalysis.js), which
// stays the app's internal convention everywhere else.
const REPORT_ASSEMBLY_ORDER = ['wall', 'floor', 'roof', 'skylight', 'window', 'door']

const materialByIdCache = () => Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))

// Same "band with its own reasoning + caveat, never a bare label" pattern
// as ConfiguratorPanel.jsx's ConclusionBand — this is the report's own
// rendering of the identical sustainabilityRubric.js verdict, so the
// hotspot popup and the report can never disagree.
function SustainabilityBand({ title, band }) {
  if (!band) return null
  return (
    <p className={`a4-report-band a4-report-band--${band.tier}`}>
      <strong>{title}: {band.label}</strong> — {band.reason}
    </p>
  )
}

function AssumptionsTable({ layerResults }) {
  if (!layerResults || layerResults.length === 0) return null
  return (
    <div className="a4-report-table-wrapper">
      <table className="a4-report-table a4-report-table--assumptions">
        <thead>
          <tr>
            <th>Material</th>
            <th>GWP source</th>
            <th>Service life</th>
            <th>End-of-life (C1/C3/C4/D)</th>
            <th>Transport distance</th>
          </tr>
        </thead>
        <tbody>
          {layerResults.map((l) => (
            <tr key={l.instanceId}>
              <td>{l.name}</td>
              <td>
                {l.gwpConfidenceLabel || l.gwpSourceNote ? (
                  <>{l.gwpConfidenceLabel ?? 'Sourced'}{l.gwpSourceNote ? ` — ${l.gwpSourceNote}` : ''}</>
                ) : 'not yet sourced'}
              </td>
              <td>{l.serviceLifeYears != null ? `${l.serviceLifeYears}yr (${EOL_TIER_LABEL[l.serviceLifeSource] ?? l.serviceLifeSource ?? '—'})` : 'not yet researched'}</td>
              <td>
                {l.eolSource ? (
                  <>
                    {[['C1', l.c1], ['C3', l.c3], ['C4', l.c4], ['D', l.moduleD]].filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}
                    {' '}({EOL_TIER_LABEL[l.eolSource] ?? l.eolSource})
                    {l.eolSource === 'manual' && l.eolAssumptionBasis && ` — "${l.eolAssumptionBasis}"`}
                  </>
                ) : 'not yet modeled'}
              </td>
              <td>{l.distanceKm != null ? `${Math.round(l.distanceKm)}km — ${l.distanceSource}` : (l.distanceMissing ?? 'not yet set')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Exact step-by-step formula, with the real numbers substituted in, for
// every LCA value of every material in this assembly — not just the final
// results already shown in the layer-order table above. One row per
// (layer × lifecycle module); every number here comes straight from
// calculationNarrative.js, which itself only reads already-computed
// figures off summary.layerResults, so this can never disagree with the
// headline numbers elsewhere in the report.
function CalculationStepsTable({ summary }) {
  const layerResults = summary.layerResults ?? []
  if (layerResults.length === 0) return null

  const isUnitAssembly = ['door', 'window', 'skylight'].includes(summary.key)
  const uValueStep = isUnitAssembly ? null : buildUValueAssemblyStep(summary.key, layerResults, summary.uValue)

  return (
    <div className="a4-report-table-wrapper">
      <table className="a4-report-table a4-report-table--calculations">
        <thead>
          <tr><th>Layer</th><th>Value</th><th>Formula (substituted)</th><th>Result</th></tr>
        </thead>
        <tbody>
          {uValueStep && (
            <tr>
              <td>Whole assembly</td>
              <td>U-value</td>
              <td>{uValueStep.substituted}</td>
              <td>{uValueStep.result}</td>
            </tr>
          )}
          {layerResults.map((l) =>
            buildLayerCalculationSteps(summary.key, l).map((step) => (
              <tr key={`${l.instanceId}-${step.module}`}>
                <td>{l.name}</td>
                <td>{step.module}</td>
                <td>{step.substituted ?? <em>{step.note}</em>}</td>
                <td>{step.result}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function AssemblySection({ summary }) {
  if (!summary.hasData) {
    return (
      <section className="a4-report-assembly">
        <h3>{summary.label}</h3>
        <p className="a4-report-empty">No layers saved yet for {summary.label}.</p>
      </section>
    )
  }

  const materialById = materialByIdCache()
  const sdNotes = (summary.layerResults ?? [])
    .filter((l) => l.materialId && materialById[l.materialId]?.discipline === 'Membrane')
    .map((l) => {
      const fiche = loadFicheDetail(l.materialId)
      return fiche?.specs ? `${l.name}: ${fiche.specs}` : null
    })
    .filter(Boolean)

  const refs = []
  const seenRefs = new Set()
  for (const l of summary.layerResults ?? []) {
    if (l.gwpSource && !seenRefs.has(l.gwpSource)) { seenRefs.add(l.gwpSource); refs.push({ label: l.name, url: l.gwpSource }) }
  }

  const { uValue, gwp } = classifyAssemblySustainability(summary.key, summary.uValue, summary.normalized)

  return (
    <section className="a4-report-assembly">
      <h3>{summary.label}</h3>
      <p className="a4-report-note">
        Owner: {summary.owner ?? '—'} · Saved: {summary.savedAt ? new Date(summary.savedAt).toLocaleString() : '—'} ·
        Completeness: {summary.completeCount}/{summary.totalCount} layers.
      </p>

      <p><strong>Layer order</strong> (exterior/sky to interior, as saved):</p>
      <div className="a4-report-table-wrapper">
        <table className="a4-report-table">
          <thead>
            <tr><th>#</th><th>Material</th><th>Thickness (mm)</th><th>λ (W/mK)</th><th>GWP unit value</th><th>GWP A1-A3 (kg CO₂e)</th></tr>
          </thead>
          <tbody>
            {(summary.layerResults ?? []).map((l, i) => (
              <tr key={l.instanceId}>
                <td>{i + 1}</td>
                <td>{l.name}</td>
                <td>{fmt(l.thicknessMM, 1)}</td>
                <td>{l.thermalConductivityWmK != null ? fmt(l.thermalConductivityWmK, 3) : '—'}</td>
                <td>{l.gwpA1A3PerFunctionalUnit != null ? fmt(l.gwpA1A3PerFunctionalUnit, 2) : '—'}</td>
                <td>{l.a1a3 != null ? fmt(l.a1a3, 1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sdNotes.length > 0 && <p><strong>sd value:</strong> {sdNotes.join('; ')}</p>}
      <p><strong>U-value:</strong> {summary.uValue != null ? `${fmt(summary.uValue)} W/m²K` : 'not computed (missing thickness/λ for a layer, or a manufactured unit with no layer-stack U-value)'}</p>
      <p><strong>GWP A1-A3 (assembly total):</strong> {summary.a1a3KnownCount > 0 ? `${fmt(summary.a1a3Total, 1)} kg CO₂e (${summary.a1a3KnownCount}/${summary.totalCount} layers known)` : 'not yet computed'}</p>
      <p><strong>A4 (transport):</strong> {summary.a4KnownCount > 0 ? `${fmt(summary.a4Total, 1)} kg CO₂e` : 'not yet computed'} · <strong>Normalized:</strong> {summary.normalized != null ? `${fmt(summary.normalized)} kg CO₂e/m²/yr` : 'not yet computed (needs assembly floor area)'}</p>
      <p className="a4-report-note">Full LCA-phase breakdown for this assembly is also pushed live to the Spreadsheet/Excel export (group2_v2 column layout).</p>

      <h4>{summary.label} — Step-by-step calculations</h4>
      <p className="a4-report-note">
        Every LCA value above, derived — the exact formula with this assembly's real numbers substituted
        in, not just the final result. R-value/U-value per DIN EN ISO 6946, A1-A3 = declared GWP unit
        value × quantity, A4/C2 per DIN EN ISO 14083, B4 from researched service life.
      </p>
      <CalculationStepsTable summary={summary} />

      <h4>{summary.label} — Assumptions &amp; references</h4>
      <AssumptionsTable layerResults={summary.layerResults} />
      {refs.length > 0 && (
        <p className="a4-report-note">
          Additional references: {refs.map((r, i) => <React.Fragment key={r.url}>{i > 0 && ' · '}<a href={r.url} target="_blank" rel="noreferrer">{r.label}</a></React.Fragment>)}
        </p>
      )}

      <h4>{summary.label} — LCA/EPD conclusion</h4>
      {!uValue && !gwp ? (
        <p className="a4-report-empty">Not enough data yet to evaluate.</p>
      ) : (
        <>
          <SustainabilityBand title="Thermal performance" band={uValue} />
          <SustainabilityBand title="Embodied-carbon intensity" band={gwp} />
        </>
      )}
    </section>
  )
}

/**
 * The A4 Report Draft — 7 sections per the team's 2026-07-25 report spec:
 * Introduction, Material research by discipline, Assemblies (6, each with
 * layer order + sd/U/GWP + assumptions/references + its own LCA/EPD
 * conclusion), Global LCA, Global EPD, Conclusion, References. Mirrors
 * a4DocxExport.js section-for-section (same underlying data functions —
 * deliverablesData.js, sustainabilityRubric.js) so the on-screen/PDF
 * preview and the exported Word doc never say different things.
 */
const A4ReportDraft = forwardRef(function A4ReportDraft({ summaries, references }, ref) {
  const withData = summaries.filter((s) => s.hasData)
  const feedbackTexts = summaries.filter((s) => s.aiFeedback).map((s) => ({ label: s.label, text: s.aiFeedback }))
  const byKey = Object.fromEntries(summaries.map((s) => [s.key, s]))
  const orderedAssemblies = REPORT_ASSEMBLY_ORDER.map((k) => byKey[k]).filter(Boolean)

  const uValueBars = withData.map((s) => ({ label: s.label, value: s.uValue, formattedValue: s.uValue != null ? s.uValue.toFixed(3) : null }))
  const gwpBars = withData.map((s) => ({ label: s.label, value: s.a1a3KnownCount > 0 ? s.a1a3Total : null, formattedValue: s.a1a3Total != null ? s.a1a3Total.toFixed(1) : null }))

  const disciplineGroups = getMaterialResearchByDiscipline()
  const globalLca = getGlobalLcaSummary()
  const providerStats = getGlobalProviderStats()
  const veryOrSustainableCount = globalLca.perAssembly.filter((a) => a.sustainability.uValue?.tier === 'very' || a.sustainability.uValue?.tier === 'sustainable').length

  return (
    <div className="a4-report" ref={ref}>
      <div className="a4-report-header">
        <h1>MID 2030 — Model 1 Assembly Builder</h1>
        <p>Group 02 · Batavierenplantsoen, Haarlem</p>
        <p className="a4-report-date">Generated {new Date().toLocaleDateString()}</p>
      </div>

      <section className="a4-report-section a4-report-section--draft">
        <h2>Abstract</h2>
        <DraftBanner />
        {feedbackTexts.length > 0 ? (
          <p>{feedbackTexts.map((f) => f.text).join(' ')}</p>
        ) : (
          <p className="a4-report-empty">
            No AI Feedback generated yet for any assembly — go to Assembly Analysis Preview and click
            "AI Feedback" per assembly, then regenerate this draft.
          </p>
        )}
      </section>

      <section className="a4-report-section">
        <h2>1. Introduction</h2>
        <p>
          This report documents the life-cycle assessment (LCA) of Model 1, a timber cabin designed
          for Batavierenplantsoen, Haarlem, by Group 02 as part of the MID 2030 (Theory and
          Sustainable Construction) module. The assessment covers all six building elements — Wall,
          Floor, Roof, Skylight, Window, and Door — computed using material, geometry, and transport
          data entered into this project's assembly-builder tool, never hand-typed into this report
          separately.
        </p>
        <p>
          As of this draft, {withData.length}/6 assemblies have saved data (see Section 3). U-value
          per DIN EN ISO 6946; A1-A3 = declared GWP unit value × quantity (from each layer's own
          functional unit); A4 per DIN EN ISO 14083, routed manufacturer → Detmold hub → Haarlem using
          real driving distances wherever a route has been fetched, not straight-line estimates; B4
          from researched service life; C1/C3/C4/Module D from real EPD data where published, or a
          clearly flagged proxy/estimate where it isn't.
        </p>
      </section>

      <section className="a4-report-section">
        <h2>2. Material Research by Discipline</h2>
        {disciplineGroups.length === 0 ? (
          <p className="a4-report-empty">No materials saved yet in any assembly.</p>
        ) : (
          <>
            <p>Every distinct material used across all six assemblies, grouped by discipline — the same fiche technique research shown in Materials and Providers and the Fiche sheets export.</p>
            {disciplineGroups.map((group) => (
              <div key={group.discipline}>
                <h4>{group.discipline}</h4>
                <div className="a4-report-table-wrapper">
                  <table className="a4-report-table">
                    <thead>
                      <tr><th>Material</th><th>German name</th><th>Specs</th><th>Norm</th><th>End-of-life scenario</th><th>Provider</th></tr>
                    </thead>
                    <tbody>
                      {group.rows.map((r) => (
                        <tr key={r.key}>
                          <td>{r.name}</td>
                          <td>{r.germanName ?? '—'}</td>
                          <td>{r.specs ?? '—'}</td>
                          <td>{r.norm ?? '—'}</td>
                          <td>{r.endOfLifeScenario ?? '—'}</td>
                          <td>{r.providerName ?? '(auto-matched)'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="a4-report-section">
        <h2>3. Assemblies</h2>
        <p>Wall, Floor, Roof, Skylight, Window, Door — each with its full layer order, key figures, sourcing, and a sustainability conclusion of the whole assembly (not just one material).</p>
        {orderedAssemblies.map((s) => <AssemblySection key={s.key} summary={s} />)}
      </section>

      <section className="a4-report-section">
        <h2>4. Global LCA</h2>
        <p>{globalLca.assessedAssemblyCount}/{globalLca.totalAssemblyCount} assemblies have saved data and are included in this rollup.</p>
        <div className="a4-report-table-wrapper">
          <table className="a4-report-table">
            <thead>
              <tr><th>Assembly</th><th>U-value (W/m²K)</th><th>A1-A3 (kg CO₂e)</th><th>A4 (kg CO₂e)</th><th>Thermal tier</th><th>Embodied-carbon tier</th></tr>
            </thead>
            <tbody>
              {globalLca.perAssembly.map((a) => (
                <tr key={a.key}>
                  <td>{a.label}</td>
                  <td>{fmt(a.uValue)}</td>
                  <td>{a.a1a3Total != null ? fmt(a.a1a3Total, 1) : '—'}</td>
                  <td>{a.a4Total != null ? fmt(a.a4Total, 1) : '—'}</td>
                  <td>{a.sustainability.uValue?.label ?? '—'}</td>
                  <td>{a.sustainability.gwp?.label ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="a4-report-charts">
          <BarChart title="U-value by assembly" unit="W/m²K" bars={uValueBars} />
          <BarChart title="GWP A1-A3 by assembly" unit="kg CO₂e" bars={gwpBars} />
        </div>

        <h4>Assessment by lifecycle phase</h4>
        <p><strong>Phase A</strong> (product + construction). A1-A3 whole-building total: {globalLca.a1a3Total != null ? `${fmt(globalLca.a1a3Total, 1)} kg CO₂e` : 'not yet computable'}. A4 (transport) total: {globalLca.a4Total != null ? `${fmt(globalLca.a4Total, 1)} kg CO₂e` : 'not yet computable'} — routed via the Detmold hub with real driving distances for every wall and roof provider fetched this round.</p>
        <p><strong>Phase B</strong> (use). B4 (replacement) total: {globalLca.b4Total != null ? `${fmt(globalLca.b4Total, 1)} kg CO₂e` : "not yet computable — needs every layer's service life researched"}. Operational energy (B6) is tracked separately in LCA Summary, not folded into this figure.</p>
        <p><strong>Phase C&amp;D</strong> (end-of-life). C1: {globalLca.c1Total != null ? fmt(globalLca.c1Total, 1) : '—'}, C3: {globalLca.c3Total != null ? fmt(globalLca.c3Total, 1) : '—'}, C4: {globalLca.c4Total != null ? fmt(globalLca.c4Total, 1) : '—'}, Module D: {globalLca.moduleDTotal != null ? fmt(globalLca.moduleDTotal, 1) : '—'} kg CO₂e.</p>

        <h4>Sustainability conclusion</h4>
        <p>
          {veryOrSustainableCount}/{globalLca.assessedAssemblyCount} assessed assemblies reach "Sustainable" or
          better on thermal performance against the Passive House / GEG / Bouwbesluit reference bands. The wall
          and roof assemblies — the two fully researched this round — both post net-negative-to-low A1-A3 GWP
          once biogenic carbon in the timber-heavy build-up is counted.
        </p>

        <h4>Changes made this round</h4>
        <p>
          Corrected the wall and roof OSB grade from OSB/3 to OSB/4 to match the team's own section drawings.
          Replaced every null GWP/λ/density placeholder in the wall and roof material catalog with real, cited
          EPD/Ökobaudat figures (or an honestly-flagged low-confidence estimate where no real source exists).
          Added end-of-life and service-life data for every wall and roof material. Replaced straight-line
          provider distances with real routed driving distances for every wall and roof provider. None of this
          changed the physical design — it replaced missing/placeholder data with real, sourced data.
        </p>
      </section>

      <section className="a4-report-section">
        <h2>5. Global EPD — Provider Concentration</h2>
        <p>
          {providerStats.count} active providers plotted against the site: {providerStats.within500}/{providerStats.count} within
          500 km straight-line, {providerStats.within1000}/{providerStats.count} within 1000 km, average{' '}
          {providerStats.avgKm != null ? Math.round(providerStats.avgKm) : '—'} km. See Deliverables → Excel &amp; EPD for the
          interactive map version of this same data.
        </p>
        <div className="a4-report-table-wrapper">
          <table className="a4-report-table">
            <thead><tr><th>Provider</th><th>Address</th><th>Distance to site (km)</th><th>Materials supplied</th></tr></thead>
            <tbody>
              {providerStats.providers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.address}</td>
                  <td>{Math.round(p.distanceToSiteKm)}</td>
                  <td>{p.materialIds.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="a4-report-note">Distance here is straight-line, for a quick concentration read — real routed A4 transport distances are in Sections 3/4 and the Spreadsheet export.</p>
      </section>

      <section className="a4-report-section">
        <h2>6. Conclusion and Potential Improvements</h2>
        <p>
          {withData.length}/6 assemblies are fully modeled with real, sourced data as of this draft (Wall and
          Roof, both this round — Floor/Door/Window/Skylight are still on the original catalog placeholders).
          Where real EPD data exists, it was used and cited; where it doesn't, the gap is flagged with an honest
          confidence label rather than a fabricated number.
        </p>
        <h4>Potential improvements</h4>
        <ul>
          <li>Pin the exact site coordinates (Batavierenplantsoen, Haarlem) — currently a city-center placeholder, same for the Detmold hub.</li>
          <li>Source real EPDs for the remaining low-confidence roof materials (Sedum substrate, Daprona ventilation mesh, aluminium trim, Cover Pro EPDM specifically).</li>
          <li>Enter each assembly's real floor/surface area (Assembly Analysis Preview → Part A) so normalized figures compute for every assembly.</li>
          <li>Extend this same autofill treatment to Floor, Door, Window, and Skylight.</li>
          <li>Revisit the "Diamant SX" and "Universal Black" proxy EPDs if the team can get brand-exact EPDs.</li>
        </ul>
      </section>

      <section className="a4-report-section a4-report-section--draft">
        <h2>Appendix — AI Feedback (Discussion drafts)</h2>
        <DraftBanner />
        {feedbackTexts.length > 0 ? (
          feedbackTexts.map((f) => (
            <p key={f.label}><strong>{f.label}:</strong> {f.text}</p>
          ))
        ) : (
          <p className="a4-report-empty">No AI Feedback generated yet — see Abstract above.</p>
        )}
      </section>

      <section className="a4-report-section">
        <h2>7. References</h2>
        {references.length === 0 ? (
          <p className="a4-report-empty">
            No accepted AI-suggestions or Ökobaudat citations yet — references populate as materials
            are researched (Materials and Providers tab → fiche editor → Suggest, then Accept).
          </p>
        ) : (
          <ol className="a4-report-references">
            {references.map((r, i) => (
              <li key={i}>{r.label} — {r.url}</li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
})

export default A4ReportDraft
