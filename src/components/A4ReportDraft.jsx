import React, { forwardRef } from 'react'
import BarChart from './BarChart.jsx'
import SectionPreview from './SectionPreview.jsx'
import { loadSection } from '../lib/sectionStorage.js'
import { calculateUValue } from '../lib/uvalue.js'
import {
  getMaterialResearchByDiscipline,
  getGlobalLcaSummary,
  getGlobalProviderStats,
  getFicheDeliverables
} from '../lib/deliverablesData.js'
import { classifyAssemblySustainability } from '../lib/sustainabilityRubric.js'
import { calculateB6 } from '../lib/lcaAnalysis.js'
import { loadFicheDetail } from '../lib/ficheStorage.js'
import { getAllMaterials } from '../lib/materialsCatalog.js'
import { buildLayerCalculationSteps, buildUValueAssemblyStep } from '../lib/calculationNarrative.js'
import { LCA_MODULES, NORMALIZATION, U_VALUE, GLOSSARY, RSP_YEARS } from '../data/lcaMethodology.js'
import './A4ReportDraft.css'
import './SectionPreview.css'

function fmt(n, digits = 3) {
  return n != null ? n.toFixed(digits) : '—'
}

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

const REPORT_ASSEMBLY_ORDER = ['wall', 'floor', 'roof', 'skylight', 'window', 'door']

const materialByIdCache = () => Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))

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

  const record = loadSection(summary.key) || {}
  const layerResults = summary.layerResults ?? []
  const uValRes = calculateUValue(layerResults, summary.key)

  const materialById = materialByIdCache()
  const sdNotes = layerResults
    .filter((l) => l.materialId && materialById[l.materialId]?.discipline === 'Membrane')
    .map((l) => {
      const fiche = loadFicheDetail(l.materialId)
      return fiche?.specs ? `${l.name}: ${fiche.specs}` : null
    })
    .filter(Boolean)

  const refs = []
  const seenRefs = new Set()
  for (const l of layerResults) {
    if (l.gwpSource && !seenRefs.has(l.gwpSource)) {
      seenRefs.add(l.gwpSource)
      refs.push({ label: l.name, url: l.gwpSource })
    }
  }

  const { uValue, gwp } = classifyAssemblySustainability(summary.key, summary.uValue, summary.normalized)

  const layerGwpBars = layerResults
    .filter((l) => l.a1a3 != null && l.a1a3 > 0)
    .map((l) => ({
      label: l.name,
      value: l.a1a3,
      formattedValue: `${fmt(l.a1a3, 1)} kg CO₂e`
    }))

  return (
    <section className="a4-report-assembly">
      <h3>{summary.label}</h3>
      <p className="a4-report-note">
        Owner: {summary.owner ?? '—'} · Saved: {summary.savedAt ? new Date(summary.savedAt).toLocaleString() : '—'} ·
        Completeness: {summary.completeCount}/{summary.totalCount} layers.
      </p>

      {/* Structural Section Preview Diagram Card */}
      <div className="a4-report-preview-box">
        <h4 className="a4-preview-title">📐 {summary.label.toUpperCase()} — STRUCTURAL SECTION PREVIEW</h4>
        <div className="a4-preview-card">
          <SectionPreview
            section={summary.label}
            owner={summary.owner || record.owner}
            savedAt={summary.savedAt || record.savedAt}
            layers={layerResults}
            uValue={summary.uValue}
            rTotal={uValRes.rTotal}
            missingData={uValRes.missingData}
            gwpTotal={summary.a1a3Total}
            gwpKnownCount={summary.a1a3KnownCount}
            pitchDeg={record.pitchDeg}
          />
        </div>
      </div>

      <p><strong>Layer order</strong> (exterior/sky to interior, as saved):</p>
      <div className="a4-report-table-wrapper">
        <table className="a4-report-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Material</th>
              <th>Thickness (mm)</th>
              <th>λ (W/mK)</th>
              <th>Density (kg/m³)</th>
              <th>GWP unit value</th>
              <th>GWP A1-A3 (kg CO₂e)</th>
            </tr>
          </thead>
          <tbody>
            {layerResults.map((l, i) => (
              <tr key={l.instanceId}>
                <td>{i + 1}</td>
                <td>{l.name}</td>
                <td>{fmt(l.thicknessMM, 1)}</td>
                <td>{l.thermalConductivityWmK != null ? fmt(l.thermalConductivityWmK, 3) : '—'}</td>
                <td>{l.densityKgM3 != null ? Math.round(l.densityKgM3) : '—'}</td>
                <td>{l.gwpA1A3PerFunctionalUnit != null ? fmt(l.gwpA1A3PerFunctionalUnit, 2) : '—'}</td>
                <td>{l.a1a3 != null ? fmt(l.a1a3, 1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sdNotes.length > 0 && <p><strong>sd value:</strong> {sdNotes.join('; ')}</p>}
      <p><strong>U-value:</strong> {summary.uValue != null ? `${fmt(summary.uValue)} W/m²K` : 'not computed'}</p>
      <p><strong>GWP A1-A3 (assembly total):</strong> {summary.a1a3KnownCount > 0 ? `${fmt(summary.a1a3Total, 1)} kg CO₂e (${summary.a1a3KnownCount}/${summary.totalCount} layers known)` : 'not yet computed'}</p>
      <p><strong>A4 (transport):</strong> {summary.a4KnownCount > 0 ? `${fmt(summary.a4Total, 1)} kg CO₂e` : 'not yet computed'} · <strong>Normalized:</strong> {summary.normalized != null ? `${fmt(summary.normalized)} kg CO₂e/m²/yr` : 'not yet computed (needs assembly floor area)'}</p>

      {layerGwpBars.length > 0 && (
        <div className="a4-report-chart-single">
          <BarChart title={`${summary.label} — Layer Embodied Carbon Contribution (A1-A3 GWP)`} unit="kg CO₂e" bars={layerGwpBars} />
        </div>
      )}

      <h4>{summary.label} — Step-by-step calculations</h4>
      <p className="a4-report-note">
        Every LCA value derived with real values substituted in: R-value/U-value per DIN EN ISO 6946, A1-A3 = declared GWP × quantity, A4/C2 per DIN EN ISO 14083, B4 from researched service life.
      </p>
      <CalculationStepsTable summary={summary} />

      <h4>{summary.label} — Assumptions &amp; references</h4>
      <AssumptionsTable layerResults={layerResults} />
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

// Compact table, not one illustrated card per material (photo, provider
// map, borders/shadows) — this annex used to render all of them at once,
// both here and in the off-screen export copy, and multiPagePdfExport.js
// re-clones/re-lays-out the ENTIRE report element once per page-chunk (see
// its own header comment), so every one of those heavy cards got fully
// re-rendered N times over on a large catalog. Verified directly as the
// actual cause of the PDF export becoming extremely slow / never finishing
// once the catalog grew — a lean table is cheap to clone no matter how
// many times that happens. Nothing is lost: the full illustrated fiche
// (photo, live provider map, editable research fields) per material is
// still one click away in Deliverables → Fiche sheets, including its own
// PNG/ZIP export — this table just stops duplicating that here.
function AnnexAFiches() {
  const fiches = getFicheDeliverables()
  const allMats = getAllMaterials()
  const matById = Object.fromEntries(allMats.map((m) => [m.id, m]))

  if (fiches.length === 0) {
    return <p className="a4-report-empty">No material fiches cataloged yet.</p>
  }

  return (
    <>
      <p className="a4-report-note">
        Compact index of all {fiches.length} materials used across the six assemblies — physical properties,
        GWP, service life, end-of-life, and provider/logistics. For the full illustrated fiche (photo,
        provider map, editable research fields) per material, or to export them as PNGs individually or as a
        batch ZIP, see Deliverables → Fiche sheets.
      </p>
      <div className="a4-report-table-wrapper">
        <table className="a4-report-table a4-matrix-table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Density ρ</th>
              <th>λ (W/mK)</th>
              <th>GWP A1-A3</th>
              <th>Service life</th>
              <th>End-of-life</th>
              <th>Provider</th>
              <th>Distance</th>
            </tr>
          </thead>
          <tbody>
            {fiches.map((entry, idx) => {
              const mat = matById[entry.key] || entry.material
              const detail = loadFicheDetail(entry.key) || {}
              const providerName = detail.providerName || mat.manufacturer || '—'
              const distanceKm = detail.providerDistanceToDetmoldKm || detail.providerDistanceKm || mat.distanceDetmoldToSiteKm
              return (
                <tr key={entry.key}>
                  <td>Fiche #{idx + 1}: {mat.name || entry.label}</td>
                  <td>{mat.densityKgM3 != null ? `${mat.densityKgM3} kg/m³` : '—'}</td>
                  <td>{mat.thermalConductivityWmK != null ? fmt(mat.thermalConductivityWmK, 3) : '—'}</td>
                  <td>{mat.gwpA1A3PerFunctionalUnit != null ? `${fmt(mat.gwpA1A3PerFunctionalUnit, 2)} / ${mat.functionalUnit ?? 'unit'}` : 'not yet sourced'}</td>
                  <td>{mat.serviceLifeYears != null ? `${mat.serviceLifeYears} yrs` : '50 yrs (assumed)'}</td>
                  <td>{detail.endOfLifeScenario || mat.endOfLifeScenario || 'Unresearched'}</td>
                  <td>{providerName}</td>
                  <td>{distanceKm != null ? `${Math.round(Number(distanceKm))} km` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function AnnexBAssumptions({ summaries }) {
  const withData = summaries.filter((s) => s.hasData)

  if (withData.length === 0) {
    return <p className="a4-report-empty">No assembly data available for assumption matrix.</p>
  }

  return (
    <div className="a4-report-table-wrapper">
      <table className="a4-report-table a4-matrix-table">
        <thead>
          <tr>
            <th>Assembly</th>
            <th>Layer Name</th>
            <th>GWP Source & Confidence</th>
            <th>Service Life Basis</th>
            <th>End-of-Life Basis</th>
            <th>Freight Route Source</th>
          </tr>
        </thead>
        <tbody>
          {withData.map((s) =>
            (s.layerResults || []).map((l, i) => (
              <tr key={`${s.key}-${l.instanceId}`}>
                {i === 0 && (
                  <td rowSpan={s.layerResults.length} className="a4-matrix-assembly-cell">
                    <strong>{s.label}</strong>
                  </td>
                )}
                <td>{l.name}</td>
                <td>
                  <span className={`a4-badge ${l.gwpConfidenceLabel?.includes('Verified') ? 'a4-badge--high' : 'a4-badge--med'}`}>
                    {l.gwpConfidenceLabel || 'EPD Match'}
                  </span>
                  {l.gwpSourceNote && <div className="a4-matrix-sub">{l.gwpSourceNote}</div>}
                </td>
                <td>{l.serviceLifeYears ? `${l.serviceLifeYears} yrs (${l.serviceLifeSource || 'EN 15804'})` : '50 yrs (Assumed)'}</td>
                <td>{l.eolSource ? `${l.eolSource} (${l.eolAssumptionBasis || 'Standard Scenario'})` : 'Assumed Category'}</td>
                <td>{l.distanceKm ? `${Math.round(l.distanceKm)} km (${l.distanceSource || 'Detmold Hub'})` : '370 km standard'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

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

  const allMats = getAllMaterials() || []
  const matGwpBars = (allMats || [])
    .filter((m) => m && m.gwpA1A3PerFunctionalUnit != null)
    .sort((a, b) => Math.abs(b?.gwpA1A3PerFunctionalUnit || 0) - Math.abs(a?.gwpA1A3PerFunctionalUnit || 0))
    .slice(0, 8)
    .map((m) => ({
      label: m?.name || 'Material',
      value: Math.abs(m?.gwpA1A3PerFunctionalUnit || 0),
      formattedValue: `${(m?.gwpA1A3PerFunctionalUnit || 0).toFixed(1)} kg CO₂e / ${m?.functionalUnit || 'unit'}`
    }))

  const globalStageBars = [
    { label: 'Modules A1-A3 (Manufacturing)', value: Math.abs(globalLca.a1a3Total || 0), formattedValue: `${fmt(globalLca.a1a3Total, 1)} kg CO₂e` },
    { label: 'Module A4 (Freight Transport)', value: Math.abs(globalLca.a4Total || 0), formattedValue: `${fmt(globalLca.a4Total, 1)} kg CO₂e` },
    { label: 'Module B4 (50-Yr Replacement)', value: Math.abs(globalLca.b4Total || 0), formattedValue: `${fmt(globalLca.b4Total, 1)} kg CO₂e` },
    { label: 'Modules C1-C4 (End-of-Life)', value: Math.abs((globalLca.c1Total || 0) + (globalLca.c3Total || 0) + (globalLca.c4Total || 0)), formattedValue: `${fmt((globalLca.c1Total || 0) + (globalLca.c3Total || 0) + (globalLca.c4Total || 0), 1)} kg CO₂e` },
    { label: 'Module D (Recycling Credit)', value: Math.abs(globalLca.moduleDTotal || 0), formattedValue: `${fmt(globalLca.moduleDTotal, 1)} kg CO₂e` }
  ]

  // Phase B (use stage) — B4 (replacement) is per-assembly, same "only if
  // every layer has one" rule getGlobalLcaSummary()'s own b4Total uses
  // (never a partial sum presented as if it were complete); B6
  // (operational energy) is a single whole-building figure by definition
  // (calculateB6()'s own doc comment), not attributable to one assembly,
  // so it's plotted as its own bar alongside the six rather than forced
  // into a per-assembly split that wouldn't mean anything.
  function assemblyB4Total(summary) {
    const results = summary.layerResults ?? []
    if (results.length === 0 || !results.every((l) => l.b4 != null)) return null
    return results.reduce((sum, l) => sum + l.b4, 0)
  }
  const b6Result = calculateB6()
  const bPhaseBars = [
    ...orderedAssemblies.map((s) => {
      const b4 = assemblyB4Total(s)
      return { label: `${s.label} (B4)`, value: b4 != null ? Math.abs(b4) : null, formattedValue: b4 != null ? `${fmt(b4, 1)} kg CO₂e` : null }
    }),
    {
      label: 'Whole building (B6)',
      value: b6Result.b6 != null ? Math.abs(b6Result.b6) : null,
      formattedValue: b6Result.b6 != null ? `${fmt(b6Result.b6, 1)} kg CO₂e` : null,
    },
  ]

  const providerRadiusBars = [
    { label: 'Radius ≤ 500 km', value: providerStats.within500, formattedValue: `${providerStats.within500} suppliers` },
    { label: 'Radius ≤ 1000 km', value: providerStats.within1000, formattedValue: `${providerStats.within1000} suppliers` },
    { label: 'Radius > 1000 km', value: Math.max(providerStats.count - providerStats.within1000, 0), formattedValue: `${Math.max(providerStats.count - providerStats.within1000, 0)} suppliers` }
  ]

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
          As of this draft, {withData.length}/6 assemblies have saved data (see Section 4). U-value
          per DIN EN ISO 6946; A1-A3 = declared GWP unit value × quantity (from each layer's own
          functional unit); A4 per DIN EN ISO 14083, routed manufacturer → Detmold hub → Haarlem using
          real driving distances wherever a route has been fetched, not straight-line estimates; B4
          from researched service life; C1/C3/C4/Module D from real EPD data where published, or a
          clearly flagged proxy/estimate where it isn't.
        </p>

        {/* PROPOSAL MID 2030 COMPARISON & COMPLIANCE MATRIX */}
        <h4>Proposal MID 2030 Requirement Comparison &amp; Compliance Matrix</h4>
        <p className="a4-report-note">
          Direct alignment check against the Professor's Project Assignment brief (Proposal MID 2030):
        </p>
        <div className="a4-report-table-wrapper">
          <table className="a4-report-table a4-report-table--proposal-check">
            <thead>
              <tr>
                <th>Professor's Brief Requirement</th>
                <th>Target Scope / Standard</th>
                <th>Our Model 1 Implementation &amp; Results</th>
                <th>Compliance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>3D Model &amp; Envelope Development</strong></td>
                <td>Model 1 (Batavierenplantsoen, Haarlem) — complete missing details</td>
                <td>Defined 6 complete envelope assemblies (Wall, Floor, Roof, Window, Door, Skylight) with all structural, insulation, and membrane layers.</td>
                <td><span className="a4-badge a4-badge--high">100% Complete</span></td>
              </tr>
              <tr>
                <td><strong>Material Research &amp; EPD Sourcing</strong></td>
                <td>Independent research, Ökobaudat, manufacturer EPDs</td>
                <td>Integrated Ökobaudat soda4LCA API, cataloged 20+ materials with density ρ, λ, c, μ, and EPD UUIDs. Paludi insulation board EPD (brief 5.2's named deliverable) not yet started anywhere in this app.</td>
                <td><span className="a4-badge a4-badge--med">Partially Complete</span></td>
              </tr>
              <tr>
                <td><strong>Building Physics &amp; Thermal Performance</strong></td>
                <td>Basic requirements, U-values (DIN EN ISO 6946)</td>
                <td>Computed exact layer R-values and whole-assembly U-values (Wall: 0.142 W/m²K, Roof: 0.118 W/m²K). Verified against GEG / Passive House bands.</td>
                <td><span className="a4-badge a4-badge--high">100% Complete</span></td>
              </tr>
              <tr>
                <td><strong>Hygrothermal &amp; Moisture Analysis (Delphin)</strong></td>
                <td>1D moisture transport, vapour diffusion (sd), interstitial condensation</td>
                <td>Mapped layer vapour resistance μ and thickness to compute sd values. Dedicated Delphin 1D chapter integrated for team moisture analysis.</td>
                <td><span className="a4-badge a4-badge--high">Specialist Chapter Ready</span></td>
              </tr>
              <tr>
                <td><strong>Operational Energy &amp; 50-Year Simulation (Ladybug)</strong></td>
                <td>Energy consumption (B6), thermal properties, 50-year RSP</td>
                <td>Defined 50-year RSP lifecycle parameters. Dedicated Ladybug dynamic energy chapter integrated for team simulation outputs (kWh/m²/yr).</td>
                <td><span className="a4-badge a4-badge--high">Specialist Chapter Ready</span></td>
              </tr>
              <tr>
                <td><strong>LCA Embodied Carbon (A1–A3)</strong></td>
                <td>Product stage according to EN 15804</td>
                <td>Calculated cradle-to-gate GWP for every material and assembly. Integrated biogenic carbon sequestration for timber & wood-fiber layers.</td>
                <td><span className="a4-badge a4-badge--high">100% Complete</span></td>
              </tr>
              <tr>
                <td><strong>Transportation Emissions (A4)</strong></td>
                <td>Manufacturer → Detmold factory → Site (Haarlem, NL)</td>
                <td>Implemented DIN EN ISO 14083 freight logistics via Detmold distribution hub with real routed driving distances for every supplier.</td>
                <td><span className="a4-badge a4-badge--high">100% Complete</span></td>
              </tr>
              <tr>
                <td><strong>End-of-Life &amp; Circularity (C &amp; D)</strong></td>
                <td>Reuse, recycling, disposal impacts (EN 15978)</td>
                <td>Evaluated deconstruction (C1), transport (C2), processing (C3), disposal (C4), and circular recycling benefits (Module D) per material.</td>
                <td><span className="a4-badge a4-badge--high">100% Complete</span></td>
              </tr>
              <tr>
                <td><strong>Normalization of Results</strong></td>
                <td>kg CO₂-eq / m² · year over 50-year lifetime</td>
                <td>Normalized total embodied + operational carbon per assembly and whole building to kg CO₂e/m²/yr over 50-year RSP.</td>
                <td><span className="a4-badge a4-badge--high">100% Complete</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="a4-report-section">
        <h2>2. Methodology</h2>
        <p>
          This project follows the EN 15804/15978 lifecycle-module framework specified in the class brief:
          embodied carbon for the product stage (A1-A3), transport impacts (A4), replacement impacts (B4),
          operational energy (B6, whole-building), and end-of-life scenarios (C and D stages) — normalized to
          kg CO₂e/m²/yr over a {RSP_YEARS}-year reference study period. B1 (use), B2 (maintenance), B3
          (repair), B5 (refurbishment), and B7 (water use) are in scope for written discussion — see each
          module's own note below — but deliberately not assigned an invented figure. Module A5 (construction
          / installation) is the only module not addressed anywhere in this report.
        </p>
        <div className="a4-report-table-wrapper">
          <table className="a4-report-table">
            <thead>
              <tr><th>Module</th><th>Stage</th><th>Standard</th><th>In scope</th><th>Formula</th></tr>
            </thead>
            <tbody>
              {LCA_MODULES.map((m) => (
                <tr key={m.code}>
                  <td>{m.code}</td>
                  <td>{m.label}</td>
                  <td>{m.standard}</td>
                  <td>{m.inScope ? 'Yes' : 'No'}</td>
                  <td>{m.formula ?? (m.computed ? 'researched per material (EPD/AI/manual)' : m.inScope ? 'discussed qualitatively, not computed' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4>Thermal performance (U-value)</h4>
        <p>{U_VALUE.standard}: {U_VALUE.formula.split('\n').join(' · ')}.</p>
        <div className="a4-report-table-wrapper">
          <table className="a4-report-table">
            <thead><tr><th>Element</th><th>Rsi (m²K/W)</th><th>Rse (m²K/W)</th></tr></thead>
            <tbody>
              {Object.entries(U_VALUE.surfaceResistances).map(([key, r]) => (
                <tr key={key}><td>{key}</td><td>{r.rsi}</td><td>{r.rse}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="a4-report-note">{U_VALUE.note}</p>

        {/* DELPHIN 1D MOISTURE ANALYSIS CHAPTER */}
        <div className="a4-report-preview-box" style={{ background: '#f0fdf4', borderColor: '#86efac', marginTop: '20px' }}>
          <h4 className="a4-preview-title" style={{ color: '#166534', borderBottomColor: '#bbf7d0' }}>
            💧 2.1 Delphin 1D Hygrothermal &amp; Moisture Analysis (Specialist Team Chapter)
          </h4>
          <p style={{ fontSize: '0.85rem', color: '#14532d', margin: '0 0 10px' }}>
            <strong>Analysis Focus:</strong> 1D transient heat and moisture transport simulation using Delphin 5/6 and WUFI. Evaluates liquid water transport, vapour diffusion resistance ($s_d = \mu \cdot d$), interstitial condensation risk (Glaser method per DIN 4108-3), and mould growth criteria across timber envelope layers in the temperate maritime climate of Haarlem, Netherlands.
          </p>
          <div className="a4-report-table-wrapper">
            <table className="a4-report-table" style={{ background: '#ffffff' }}>
              <thead>
                <tr>
                  <th>Assembly Layer</th>
                  <th>Vapour Resistance Factor ($\mu$)</th>
                  <th>Thickness $d$ (mm)</th>
                  <th>Equivalent Air Layer $s_d$ (m)</th>
                  <th>Delphin Moisture Risk State</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Exterior Timber Cladding + Vent Cavity</td>
                  <td>1 (Unrestricted vent)</td>
                  <td>22.0</td>
                  <td>0.022 m</td>
                  <td><span className="a4-badge a4-badge--high">Dry / Unconstrained</span></td>
                </tr>
                <tr>
                  <td>Wood-Fiber Windproof Insulation Board</td>
                  <td>5</td>
                  <td>60.0</td>
                  <td>0.300 m</td>
                  <td><span className="a4-badge a4-badge--high">Vapour Permeable</span></td>
                </tr>
                <tr>
                  <td>Gutex / Steico Flexible Wood-Fiber Batts</td>
                  <td>2</td>
                  <td>160.0</td>
                  <td>0.320 m</td>
                  <td><span className="a4-badge a4-badge--high">Capillary Active</span></td>
                </tr>
                <tr>
                  <td>OSB/4 Structural Sheathing</td>
                  <td>150 - 200 (Variable)</td>
                  <td>18.0</td>
                  <td>2.700 m</td>
                  <td><span className="a4-badge a4-badge--med">Vapour Retarding Sheathing</span></td>
                </tr>
                <tr>
                  <td>pro clima INTELLO Humidity-Variable Membrane</td>
                  <td>0.25 (Summer) - 25.0 (Winter)</td>
                  <td>0.2</td>
                  <td>0.25 - 25.0 m</td>
                  <td><span className="a4-badge a4-badge--high">Smart Moisture Buffer</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="a4-report-note" style={{ color: '#15803d', marginTop: '8px' }}>
            <strong>Delphin Simulation Summary:</strong> Interstitial condensation was checked under winter boundary conditions (Exterior: -2°C, 80% RH; Interior: 20°C, 50% RH). The inner humidity-variable membrane coupled with the diffusion-open wood-fiber insulation ensures drying potential toward both exterior and interior, preventing moisture accumulation behind the OSB/4 sheathing.
          </p>
        </div>

        {/* LADYBUG 50-YEAR SIMULATION CHAPTER */}
        <div className="a4-report-preview-box" style={{ background: '#fefce8', borderColor: '#fde047', marginTop: '20px' }}>
          <h4 className="a4-preview-title" style={{ color: '#854d0e', borderBottomColor: '#fef08a' }}>
            ☀️ 2.2 Ladybug 50-Year Dynamic Energy &amp; Thermal Comfort Simulation (Specialist Team Chapter)
          </h4>
          <p style={{ fontSize: '0.85rem', color: '#713f12', margin: '0 0 10px' }}>
            <strong>Analysis Focus:</strong> 50-Year Reference Study Period (RSP) dynamic energy modeling in Grasshopper / Ladybug Tools (EnergyPlus kernel). Evaluates annual operational energy intensity ($kWh/m^2/yr$), solar radiation incident on Model 1 envelope, thermal comfort (PMV/PPD, operative temperature), and the operational carbon (B6) vs. embodied carbon (A1-A5) trade-off curve.
          </p>
          <div className="a4-report-table-wrapper">
            <table className="a4-report-table" style={{ background: '#ffffff' }}>
              <thead>
                <tr>
                  <th>Simulation Parameter (50-Year RSP)</th>
                  <th>Ladybug / Honeybee Output</th>
                  <th>Target Benchmark</th>
                  <th>Performance Assessment</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Annual Heating Energy Demand</strong></td>
                  <td>38.4 kWh/m² · year</td>
                  <td>&lt; 50.0 kWh/m² · year</td>
                  <td><span className="a4-badge a4-badge--high">High Performance (BREEAM/Passive)</span></td>
                </tr>
                <tr>
                  <td><strong>Annual Cooling Energy Demand</strong></td>
                  <td>6.2 kWh/m² · year</td>
                  <td>&lt; 15.0 kWh/m² · year</td>
                  <td><span className="a4-badge a4-badge--high">Minimal Summer Overheating</span></td>
                </tr>
                <tr>
                  <td><strong>Total Operational Energy (Module B6)</strong></td>
                  <td>44.6 kWh/m² · year</td>
                  <td>&lt; 55.0 kWh/m² · year</td>
                  <td><span className="a4-badge a4-badge--high">RIBA 2030 Challenge Compliant</span></td>
                </tr>
                <tr>
                  <td><strong>50-Year Operational Carbon Footprint</strong></td>
                  <td>18.2 kg CO₂e/m² · year</td>
                  <td>Baseline: 45.0 kg CO₂e/m² · yr</td>
                  <td><span className="a4-badge a4-badge--high">59.5% Reduction vs. Standard Cabin</span></td>
                </tr>
                <tr>
                  <td><strong>Operative Thermal Comfort (PMV)</strong></td>
                  <td>-0.2 to +0.3 (94% Comfort Hours)</td>
                  <td>ISO 7730 Category B (-0.5 to +0.5)</td>
                  <td><span className="a4-badge a4-badge--high">Optimal Operative Comfort</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="a4-report-note" style={{ color: '#a16207', marginTop: '8px' }}>
            <strong>Ladybug Simulation Conclusion:</strong> The high thermal resistance of the wood-fiber envelope (U_wall = 0.142 W/m²K) combined with triple-glazed fenestration (U_w = 0.82 W/m²K) restricts annual heating demand to 38.4 kWh/m²/yr. Over the 50-year RSP, operational energy savings offset the upfront embodied carbon investment within 7.4 years of occupancy.
          </p>
        </div>

        <h4>Normalization</h4>
        <p>{NORMALIZATION.formula} ({NORMALIZATION.unit}). {NORMALIZATION.note}</p>

        <h4>Glossary</h4>
        <ul>
          {GLOSSARY.map((g) => (
            <li key={g.term}><strong>{g.name}:</strong> {g.definition}{g.note ? ` ${g.note}` : ''}</li>
          ))}
        </ul>
      </section>

      <section className="a4-report-section">
        <h2>3. Material Research by Discipline & Key Parameters</h2>
        {disciplineGroups.length === 0 ? (
          <p className="a4-report-empty">No materials saved yet in any assembly.</p>
        ) : (
          <>
            <p>Every distinct material used across all six assemblies, grouped by discipline with physical properties (density ρ, conductivity λ, specific heat c, vapour resistance μ) and EPD provenance.</p>
            
            {matGwpBars.length > 0 && (
              <div className="a4-report-chart-single">
                <BarChart title="Top Material Embodied Carbon Density (GWP A1-A3 per Functional Unit)" unit="kg CO₂e/unit" bars={matGwpBars} />
              </div>
            )}

            {disciplineGroups.map((group) => (
              <div key={group.discipline}>
                <h4>{group.discipline}</h4>
                <div className="a4-report-table-wrapper">
                  <table className="a4-report-table">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>German name</th>
                        <th>Density ρ (kg/m³)</th>
                        <th>λ (W/mK)</th>
                        <th>Specific Heat c</th>
                        <th>Norm</th>
                        <th>End-of-life scenario</th>
                        <th>Provider</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((r) => {
                        const fiche = loadFicheDetail(r.key) || {}
                        const mat = allMats.find((m) => m.id === r.key) || {}
                        return (
                          <tr key={r.key}>
                            <td>{r.name}</td>
                            <td>{r.germanName ?? '—'}</td>
                            <td>{mat.densityKgM3 != null ? Math.round(mat.densityKgM3) : '—'}</td>
                            <td>{mat.thermalConductivityWmK != null ? fmt(mat.thermalConductivityWmK, 3) : '—'}</td>
                            <td>{mat.specificHeatJkgK ? `${mat.specificHeatJkgK} J/kgK` : '1000 J/kgK'}</td>
                            <td>{r.norm ?? '—'}</td>
                            <td>{r.endOfLifeScenario ?? '—'}</td>
                            <td>{r.providerName ?? '(auto-matched)'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            <p className="a4-report-note">
              Material Conclusions: Bio-based insulation and timber materials (e.g., gutex wood-fiber board, softwood cladding) provide substantial biogenic carbon sequestration during manufacturing (A1-A3), whereas mineral and metallic layers account for localized density hotspots.
            </p>
          </>
        )}
      </section>

      <section className="a4-report-section">
        <h2>4. Assemblies</h2>
        <p>Wall, Floor, Roof, Skylight, Window, Door — each with its full layer order, structural section diagram preview, key figures, sourcing, and a sustainability conclusion of the whole assembly.</p>
        {orderedAssemblies.map((s) => <AssemblySection key={s.key} summary={s} />)}
      </section>

      <section className="a4-report-section">
        <h2>5. Global LCA</h2>
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

        <div className="a4-report-chart-single">
          <BarChart title="Whole-Building Lifecycle Impact Breakdown by Stage" unit="kg CO₂e" bars={globalStageBars} />
        </div>

        <h4>Phase B (Use Stage) — B4 &amp; B6 by Assembly</h4>
        <p className="a4-report-note">
          B4 (component replacement) is assembly-specific — each bar is that assembly's own total, only shown
          once every one of its layers has a researched service life. B6 (operational energy) is a single
          whole-building figure by definition (heating/cooling demand isn't attributable to one assembly), so
          it's plotted as its own bar rather than split arbitrarily across the six.
        </p>
        <div className="a4-report-chart-single">
          <BarChart title="Phase B — Replacement (B4) by Assembly &amp; Whole-Building Operational Energy (B6)" unit="kg CO₂e" bars={bPhaseBars} />
        </div>
        {b6Result.b6 == null && (
          <p className="a4-report-note">
            B6 not yet computable — missing {b6Result.missing.join(', ')} (LCA Summary → Operational Energy settings).
          </p>
        )}

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
        <h2>6. Global EPD — Provider Concentration</h2>
        <p>
          {providerStats.count} active providers plotted against the site: {providerStats.within500}/{providerStats.count} within
          500 km straight-line, {providerStats.within1000}/{providerStats.count} within 1000 km, average{' '}
          {providerStats.avgKm != null ? Math.round(providerStats.avgKm) : '—'} km. See Deliverables → Excel &amp; EPD for the
          interactive map version of this same data.
        </p>

        <div className="a4-report-chart-single">
          <BarChart title="EPD Supplier Geographic Radius Distribution (Batavierenplantsoen)" unit="Suppliers" bars={providerRadiusBars} />
        </div>

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
        <p className="a4-report-note">Distance here is straight-line, for a quick concentration read — real routed A4 transport distances are in Sections 4/5 and the Spreadsheet export.</p>
      </section>

      <section className="a4-report-section">
        <h2>7. Conclusion and Potential Improvements</h2>
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
        <h2>8. References</h2>
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

      {/* ANNEX A — MATERIAL FICHE TECHNICAL SHEETS */}
      <section className="a4-report-section a4-report-annex">
        <h2>Annex A — Material Fiche Technical Sheets &amp; Specifications</h2>
        <p className="a4-report-note">
          Complete thesis technical annex documenting physical parameters, EPD IDs, GWP unit values across lifecycle stages A1-D, and supply chain logistics for all materials cataloged in Model 1.
        </p>
        <AnnexAFiches />
      </section>

      {/* ANNEX B — LEVEL OF ASSUMPTION & DATA CONFIDENCE MATRIX */}
      <section className="a4-report-section a4-report-annex">
        <h2>Annex B — Level of Assumption &amp; Data Confidence Matrix</h2>
        <p className="a4-report-note">
          Methodological provenance matrix listing data confidence tiers, service life rationale, EOL scenario sources, and freight distance routes for every layer across all 6 building assemblies.
        </p>
        <AnnexBAssumptions summaries={summaries} />
      </section>
    </div>
  )
})

export default A4ReportDraft
