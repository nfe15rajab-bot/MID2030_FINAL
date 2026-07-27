import React, { forwardRef } from 'react'
import { classifyAssemblySustainability } from '../lib/sustainabilityRubric.js'
import { getDetmoldToHaarlemKm } from '../lib/transport.js'
import referenceLocations from '../../database/reference-locations.json'
import './AssemblyLcaReportSheet.css'

// One-page LCA report sheet per assembly — same visual language as the
// fiche technique (Oswald, white sheet, 3px frame, red section labels)
// so the exported PDFs read as one document family. Read-only plain text
// throughout for the same html2canvas reason as FicheTechnique.jsx.
//
// Everything shown is already computed elsewhere (getAssemblySummaries /
// calculateB6 / classifyAssemblySustainability) — this file formats, it
// never re-derives an LCA number. The few roll-ups computed locally
// (b4Total, C totals) follow lcaAnalysis.js's exact "null unless every
// layer is known" rule via the same reduce shape.

// Print-safe fixed palette (CSS vars resolve at capture time anyway, but
// these also carry meaning: green = carbon storage / favorable, red =
// emission burden, amber = needs attention, blue = module D credit).
const COLOR = {
  burden: '#c0392b',
  storage: '#2d6a4f',
  amber: '#b0731f',
  credit: '#2f5f8a',
  missing: '#b5b0a6',
  neutral: '#555555',
}

const TIER_COLOR = {
  very: COLOR.storage,
  sustainable: COLOR.storage,
  moderate: COLOR.amber,
  less: COLOR.burden,
}

function fmtKg(v, { sign = false } = {}) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  const prefix = v < 0 ? '−' : sign && v > 0 ? '+' : ''
  if (abs >= 10000) return `${prefix}${(abs / 1000).toFixed(1)} t`
  return `${prefix}${abs.toFixed(abs < 10 ? 1 : 0)} kg`
}

function trimLabel(name, max = 24) {
  if (!name) return ''
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

// Vertical bar chart with a real zero line — BarChart.jsx (positive-only)
// can't draw this sheet's data: per-layer A1-A3 swings from -760 (OSB
// biogenic storage) to +144 (plasterboard), and module D is a negative
// credit by definition. Null renders as a dashed outline, never a fake 0.
function SignedBarChart({ title, unit, bars, plotHeight = 170, labelHeight = 84 }) {
  const slot = Math.max(44, Math.min(64, Math.floor(720 / Math.max(bars.length, 1))))
  const barW = Math.min(26, slot - 16)
  const width = bars.length * slot + 24
  const values = bars.filter((b) => b.value != null).map((b) => b.value)
  const rawMax = Math.max(0, ...values)
  const rawMin = Math.min(0, ...values)
  const span = rawMax - rawMin || 1
  const pad = span * 0.14
  const max = rawMax + (rawMax > 0 ? pad : 0)
  const min = rawMin - (rawMin < 0 ? pad : 0)
  const domain = max - min || 1
  const y = (v) => 6 + ((max - v) / domain) * (plotHeight - 12)
  const zeroY = y(0)
  const totalHeight = plotHeight + labelHeight

  return (
    <div className="lca-sheet-chart">
      <div className="lca-sheet-chart-title">{title}{unit ? ` (${unit})` : ''}</div>
      <svg viewBox={`0 0 ${width} ${totalHeight}`} width="100%" role="img" aria-label={title}>
        <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="#222" strokeWidth={1} />
        {bars.map((bar, i) => {
          const x = 12 + i * slot + (slot - barW) / 2
          const isKnown = bar.value != null
          if (!isKnown) {
            return (
              <g key={i}>
                <rect x={x} y={zeroY - 22} width={barW} height={22} fill="none" stroke={COLOR.missing} strokeWidth={1.2} strokeDasharray="3 3" rx={3} />
                <text x={x + barW / 2} y={zeroY - 27} textAnchor="middle" fontSize="8.5" fill={COLOR.missing}>n/a</text>
                <text x={x + barW / 2} y={plotHeight + 12} textAnchor="end" fontSize="9" fill="#666" transform={`rotate(-46 ${x + barW / 2} ${plotHeight + 12})`}>{bar.label}</text>
              </g>
            )
          }
          const vy = y(bar.value)
          const top = Math.min(vy, zeroY)
          const h = Math.max(Math.abs(vy - zeroY), 1.5)
          const labelY = bar.value >= 0 ? top - 4 : top + h + 10
          return (
            <g key={i}>
              <rect x={x} y={top} width={barW} height={h} rx={3} fill={bar.color ?? COLOR.neutral} />
              <text x={x + barW / 2} y={labelY} textAnchor="middle" fontSize="8.5" fill="#333">{bar.formatted}</text>
              <text x={x + barW / 2} y={plotHeight + 12} textAnchor="end" fontSize="9" fill="#666" transform={`rotate(-46 ${x + barW / 2} ${plotHeight + 12})`}>{bar.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// Same "total only if every layer has a value" rule as lcaAnalysis.js's
// own b4Total/eolTotal — a partial sum silently presented as the total
// would understate the phase.
function totalIfComplete(layerResults, key) {
  const known = layerResults.filter((l) => l[key] != null)
  return known.length === layerResults.length && layerResults.length > 0
    ? known.reduce((sum, l) => sum + l[key], 0)
    : null
}

function StatTile({ label, value, sub, color }) {
  return (
    <div className="lca-sheet-stat">
      <div className="lca-sheet-stat-label">{label}</div>
      <div className="lca-sheet-stat-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="lca-sheet-stat-sub">{sub}</div>}
    </div>
  )
}

const AssemblyLcaReportSheet = forwardRef(function AssemblyLcaReportSheet({ summary, b6Result }, ref) {
  const { site } = referenceLocations
  const detmoldLeg = getDetmoldToHaarlemKm()
  const layers = summary.layerResults ?? []

  const b4Total = totalIfComplete(layers, 'b4')
  const c1 = totalIfComplete(layers, 'c1')
  const c3 = totalIfComplete(layers, 'c3')
  const c4 = totalIfComplete(layers, 'c4')
  const cTotal = c1 != null && c3 != null && c4 != null ? c1 + c3 + c4 : null
  const moduleD = totalIfComplete(layers, 'moduleD')
  const a1a3Total = summary.a1a3KnownCount > 0 ? summary.a1a3Total : null
  const a4Total = summary.a4KnownCount > 0 ? summary.a4Total : null

  const verdict = classifyAssemblySustainability(summary.key, summary.uValue, summary.normalized)
  const areaM2 = summary.geometry?.surfaceAreaM2 !== '' && summary.geometry?.surfaceAreaM2 != null
    ? Number(summary.geometry.surfaceAreaM2)
    : null

  const layerBars = layers.map((l) => ({
    label: trimLabel(l.name),
    value: l.a1a3,
    formatted: l.a1a3 != null ? Math.round(l.a1a3).toString() : null,
    color: l.a1a3 != null ? (l.a1a3 < 0 ? COLOR.storage : COLOR.burden) : null,
  }))

  const phaseBars = [
    { label: 'A1-A3 product', value: a1a3Total, formatted: a1a3Total != null ? Math.round(a1a3Total).toString() : null, color: a1a3Total != null && a1a3Total < 0 ? COLOR.storage : COLOR.burden },
    { label: 'A4 transport', value: a4Total, formatted: a4Total != null ? Math.round(a4Total).toString() : null, color: COLOR.burden },
    { label: 'B4 replacement', value: b4Total, formatted: b4Total != null ? Math.round(b4Total).toString() : null, color: COLOR.amber },
    { label: 'B6 building (whole)', value: b6Result?.b6 ?? null, formatted: b6Result?.b6 != null ? Math.round(b6Result.b6).toString() : null, color: COLOR.neutral },
    { label: 'C1+C3+C4 end-of-life', value: cTotal, formatted: cTotal != null ? Math.round(cTotal).toString() : null, color: COLOR.burden },
    { label: 'D credit', value: moduleD, formatted: moduleD != null ? Math.round(moduleD).toString() : null, color: COLOR.credit },
  ]

  // Colored conclusions — every statement below is derived from the real
  // computed figures on this same sheet, nothing hand-written per assembly.
  const emitters = layers.filter((l) => l.a1a3 != null && l.a1a3 > 0)
  const stores = layers.filter((l) => l.a1a3 != null && l.a1a3 < 0)
  const biggestEmitter = emitters.length > 0 ? emitters.reduce((a, b) => (a.a1a3 > b.a1a3 ? a : b)) : null
  const biggestStore = stores.length > 0 ? stores.reduce((a, b) => (a.a1a3 < b.a1a3 ? a : b)) : null
  const shortestLife = layers.filter((l) => l.serviceLifeYears != null).sort((a, b) => a.serviceLifeYears - b.serviceLifeYears)[0] ?? null

  const gaps = []
  for (const l of layers) {
    if (l.a1a3 == null) gaps.push(`A1-A3 missing for "${l.name}"`)
    if (l.a4CO2Kg == null) gaps.push(`A4 missing for "${l.name}"`)
    if (l.b4 == null) gaps.push(`B4 missing for "${l.name}"`)
    if (l.c1 == null || l.c3 == null || l.c4 == null || l.moduleD == null) gaps.push(`End-of-life not fully researched for "${l.name}"`)
  }

  const conclusions = []
  if (verdict?.uValue && summary.uValue != null) {
    conclusions.push({ color: TIER_COLOR[verdict.uValue.tier], strong: `U-value ${summary.uValue.toFixed(3)} W/m²K — ${verdict.uValue.label}.`, text: verdict.uValue.reason })
  }
  if (verdict?.gwp && summary.normalized != null) {
    conclusions.push({ color: TIER_COLOR[verdict.gwp.tier], strong: `Embodied carbon ${summary.normalized.toFixed(2)} kg CO₂e/m²/yr — ${verdict.gwp.label}.`, text: verdict.gwp.reason })
  }
  if (biggestStore) {
    conclusions.push({ color: COLOR.storage, strong: `Largest carbon store: ${biggestStore.name}`, text: `${fmtKg(biggestStore.a1a3, { sign: true })} CO₂e — biogenic carbon locked into the timber content over the building's life.` })
  }
  if (biggestEmitter) {
    conclusions.push({ color: COLOR.burden, strong: `Largest emitter: ${biggestEmitter.name}`, text: `${fmtKg(biggestEmitter.a1a3, { sign: true })} CO₂e (A1-A3) — the first candidate to substitute if this assembly needs to cut embodied carbon.` })
  }
  if (a4Total != null) {
    conclusions.push({ color: COLOR.amber, strong: `Transport (A4) adds ${fmtKg(a4Total, { sign: true })} CO₂e`, text: `routed manufacturer → Detmold hub → Haarlem (${Math.round(detmoldLeg.distanceKm)} km final leg, ${detmoldLeg.source === 'routed' ? 'real HGV route' : 'class-spreadsheet assumption'}).` })
  }
  if (b4Total != null && shortestLife) {
    conclusions.push({ color: COLOR.amber, strong: `Replacements (B4) add ${fmtKg(b4Total, { sign: true })} CO₂e over 50 yr`, text: `driven by the shortest-lived layer (${shortestLife.name}, ${shortestLife.serviceLifeYears} yr service life).` })
  }
  if (moduleD != null && moduleD < 0) {
    conclusions.push({ color: COLOR.credit, strong: `End-of-life recycling/reuse credit ${fmtKg(moduleD, { sign: true })} CO₂e (Module D)`, text: 'potential benefit beyond the system boundary — reported separately, never netted into A-C.' })
  }
  conclusions.push(
    gaps.length === 0
      ? { color: COLOR.storage, strong: `Data completeness: ${layers.length}/${layers.length} layers fully researched.`, text: 'A1-A3, A4, B4 and C1/C3/C4/D are all sourced for every layer — no missing data on this sheet.' }
      : { color: COLOR.amber, strong: `Data completeness: ${gaps.length} gap${gaps.length === 1 ? '' : 's'} remaining.`, text: gaps.slice(0, 3).join('; ') + (gaps.length > 3 ? ` (+${gaps.length - 3} more — see Deliverables → Assumptions)` : '') }
  )

  return (
    <div className="fiche-sheet lca-report-sheet" ref={ref}>
      <div className="fiche-header lca-sheet-header">
        <h2>LCA Report : {summary.label} assembly</h2>
        <span className="lca-sheet-header-meta">MID 2030 · Group 02 · Model 1</span>
      </div>
      <div className="lca-sheet-meta-line">
        Owner: {summary.owner ?? '—'} · Saved {summary.savedAt ? new Date(summary.savedAt).toLocaleDateString() : '—'} ·
        Reference study period 50 yr · {layers.length} layer{layers.length === 1 ? '' : 's'}
      </div>

      <div className="lca-sheet-top">
        <div className="lca-sheet-site">
          <div className="fiche-label">Site data</div>
          <ul className="fiche-bullet-list">
            <li>Site: Batavierenplantsoen, Haarlem (NL) — {site.lat.toFixed(4)}° N, {site.lng.toFixed(4)}° E</li>
            <li>Assembly area: {areaM2 != null ? `${areaM2} m²` : 'not entered'}{summary.uValue != null ? ` · U = ${summary.uValue.toFixed(3)} W/m²K` : ''}</li>
            <li>Transport hub: Detmold (DE) → site {Math.round(detmoldLeg.distanceKm)} km ({detmoldLeg.source === 'routed' ? 'real HGV route, OpenRouteService' : 'class-spreadsheet assumption'})</li>
            <li>Provider legs: real routed distance where fetched, road-route estimate (straight-line × 1.2) otherwise</li>
          </ul>
        </div>
        <div className="lca-sheet-stats">
          <StatTile label="A1-A3 product" value={fmtKg(a1a3Total, { sign: true })} sub="CO₂e, whole assembly" color={a1a3Total != null && a1a3Total < 0 ? COLOR.storage : COLOR.burden} />
          <StatTile label="A4 transport" value={fmtKg(a4Total, { sign: true })} sub="CO₂e via Detmold hub" color={COLOR.burden} />
          <StatTile label="B4 replacement" value={fmtKg(b4Total, { sign: true })} sub="CO₂e over 50 yr" color={COLOR.amber} />
          <StatTile
            label="B6 operational"
            value={fmtKg(b6Result?.b6 ?? null, { sign: true })}
            sub={b6Result?.b6 != null ? 'CO₂e, whole building · 50 yr' : `missing ${b6Result?.missing?.join(', ') ?? 'settings'}`}
            color={COLOR.neutral}
          />
        </div>
      </div>

      <SignedBarChart title="A1-A3 embodied carbon per layer" unit="kg CO₂e" bars={layerBars} />
      <SignedBarChart title="Lifecycle phases — whole assembly" unit="kg CO₂e" bars={phaseBars} plotHeight={150} labelHeight={70} />
      <p className="lca-sheet-chart-note">
        Green = net carbon storage (biogenic), red = emission burden, amber = replacement burden, blue = Module D
        credit (reported separately per EN 15978). B6 is a whole-building figure by definition — shown for context
        on every assembly's sheet, never apportioned. Dashed outline = not yet researched, never a fake zero.
      </p>

      <div className="fiche-label">Per-layer results (exterior → interior)</div>
      <table className="lca-sheet-table">
        <thead>
          <tr>
            <th>#</th><th>Material</th><th>mm</th><th>A1-A3</th><th>A4</th><th>B4</th><th>C1+C3+C4</th><th>D</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((l, i) => {
            const cSum = l.c1 != null && l.c3 != null && l.c4 != null ? l.c1 + l.c3 + l.c4 : null
            return (
              <tr key={l.instanceId ?? i}>
                <td>{i + 1}</td>
                <td className="lca-sheet-table-name">{l.name}</td>
                <td>{l.thicknessMM ?? '—'}</td>
                <td style={{ color: l.a1a3 == null ? undefined : l.a1a3 < 0 ? COLOR.storage : COLOR.burden }}>{l.a1a3 != null ? Math.round(l.a1a3) : '—'}</td>
                <td>{l.a4CO2Kg != null ? l.a4CO2Kg.toFixed(1) : '—'}</td>
                <td>{l.b4 != null ? Math.round(l.b4) : '—'}</td>
                <td>{cSum != null ? Math.round(cSum) : '—'}</td>
                <td style={{ color: l.moduleD != null && l.moduleD < 0 ? COLOR.credit : undefined }}>{l.moduleD != null ? Math.round(l.moduleD) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="fiche-label">Conclusions</div>
      <ul className="lca-sheet-conclusions">
        {conclusions.map((c, i) => (
          <li key={i} style={{ borderLeftColor: c.color }}>
            <strong style={{ color: c.color }}>{c.strong}</strong> {c.text}
          </li>
        ))}
      </ul>

      <div className="lca-sheet-footer">
        Values in kg CO₂e per whole assembly. Sources: Ökobaudat / manufacturer EPDs per layer (see Deliverables →
        Assumptions for the full source-and-confidence audit) · A4 per DIN EN ISO 14083 · generated {new Date().toLocaleDateString()}.
      </div>
    </div>
  )
})

export default AssemblyLcaReportSheet
