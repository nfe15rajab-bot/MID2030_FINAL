import React, { useRef, useState } from 'react'
import { getSpreadsheetRows, getSpreadsheetMeta } from '../lib/spreadsheetData.js'
import { exportMultiPagePdf } from '../lib/multiPagePdfExport.js'
import { downloadElementAsPng } from '../lib/pngExport.js'
import './AssemblyLcaReportSheet.css'

// A3-landscape methodology sheet: "A4 transport — round trip or
// consolidated, which is correct?" Both conventions walked step by step
// on the same real layer, compared per assembly, with a clear verdict.
// Same fiche visual language as the per-assembly LCA report sheets; both
// formulas shown are the EXACT ones the app/export compute with
// (transport.js estimateTransportCO2 = column Q; the consolidated t·km
// intensity behind spreadsheet columns O/P) — nothing here is a third,
// invented variant.

const GREEN = '#2d6a4f'
const RED = '#c0392b'
const AMBER = '#b0731f'
const BLUE = '#2f5f8a'

function r2(v, d = 2) {
  return v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(d)
}

export default function TransportMethodologyA3() {
  const rows = getSpreadsheetRows()
  const meta = getSpreadsheetMeta()
  const exportRef = useRef(null)
  const [exporting, setExporting] = useState(null)

  const T = meta.transportAssumptions
  const O = Number(((2 * (T.emptyConsumptionLPer100Km + T.loadedVsEmptyDiffLPer100Km) / T.payloadCapacityTonnes) / 100
    * T.dieselDensityKgPerL * T.dieselGhgFactorKgCo2ePerKg).toFixed(4))

  const ex = rows.find((r) => r.a4 != null && r.weightKg != null && r.distanceKm != null && r.functionalUnit !== 'unit') ?? null

  // Per-assembly totals under both conventions — Q (round trip) is the
  // app's own computed a4; P (consolidated) = t × km × O.
  const blocks = []
  rows.forEach((r) => {
    const last = blocks[blocks.length - 1]
    if (!last || last.key !== r.assemblyKey) blocks.push({ key: r.assemblyKey, label: r.assemblyDrawing, q: 0, p: 0, known: true })
    const b = blocks[blocks.length - 1]
    if (r.a4 == null || r.weightKg == null || r.distanceKm == null) { b.known = false; return }
    b.q += r.a4
    b.p += (r.weightKg / 1000) * r.distanceKm * O
  })
  const totalQ = blocks.every((b) => b.known) ? blocks.reduce((s, b) => s + b.q, 0) : null
  const totalP = blocks.every((b) => b.known) ? blocks.reduce((s, b) => s + b.p, 0) : null

  // Worked numbers for the example layer
  const tonnes = ex ? ex.weightKg / 1000 : null
  const lPer100 = ex ? T.emptyConsumptionLPer100Km + (T.loadedVsEmptyDiffLPer100Km * (tonnes / 2)) / T.payloadCapacityTonnes : null
  const litres = ex ? ((2 * ex.distanceKm) / 100) * lPer100 : null
  const consolidated = ex ? tonnes * ex.distanceKm * O : null

  async function handlePdf() {
    if (!exportRef.current) return
    setExporting('pdf')
    try {
      await exportMultiPagePdf(exportRef.current, 'MID2030_A4_Transport_Methodology_A3.pdf', { format: 'a3', orientation: 'landscape' })
    } finally {
      setExporting(null)
    }
  }

  async function handlePng() {
    if (!exportRef.current) return
    setExporting('png')
    try {
      await downloadElementAsPng(exportRef.current, 'MID2030_A4_Transport_Methodology_A3.png', { scale: 2 })
    } finally {
      setExporting(null)
    }
  }

  const sheet = (ref) => (
    <div className="fiche-sheet lca-report-sheet lca-a3-sheet" ref={ref}>
      <div className="fiche-header lca-sheet-header">
        <h2>A4 Transport Methodology : round trip or consolidated?</h2>
        <span className="lca-sheet-header-meta">MID 2030 · Group 02 · Model 1 · A3 methodology sheet</span>
      </div>
      <div className="lca-sheet-meta-line">
        Two internally consistent conventions exist for the same delivery — they answer different questions.
        Both are computed below, step by step, from the same class-template truck (empty {T.emptyConsumptionLPer100Km} L/100km ·
        loaded diff {T.loadedVsEmptyDiffLPer100Km} L/100km · payload {T.payloadCapacityTonnes} t · diesel {T.dieselDensityKgPerL} kg/L · {T.dieselGhgFactorKgCo2ePerKg} kg CO₂e/kg)
        {ex && <> and the same real layer: <strong>{ex.material}</strong> (m = {r2(ex.weightKg, 1)} kg, one-way route D = {r2(ex.distanceKm, 0)} km via the Detmold hub).</>}
      </div>

      <div className="lca-a3-columns">
        <div className="lca-sheet-calc-step">
          <div className="lca-sheet-calc-title" style={{ color: RED }}>
            Convention A — ROUND TRIP, dedicated truck (the class template's own formula → column Q, and every graded A4 total in this app)
          </div>
          <div className="lca-sheet-calc-line">Story: a truck is chartered just for this delivery. It drives out loaded and drives back empty — the shipment pays for both directions of the whole vehicle.</div>
          {ex && (
            <>
              <div className="lca-sheet-calc-line">1. Load as tonnes: m = {r2(ex.weightKg, 1)} kg = {r2(tonnes, 3)} t</div>
              <div className="lca-sheet-calc-line">2. Consumption at average load (full out, empty back → m/2): {T.emptyConsumptionLPer100Km} + ({T.loadedVsEmptyDiffLPer100Km} × ({r2(tonnes, 3)} ÷ 2)) ÷ {T.payloadCapacityTonnes} = {r2(lPer100, 3)} L/100km</div>
              <div className="lca-sheet-calc-line">3. Fuel over the round trip: (2 × {r2(ex.distanceKm, 0)} ÷ 100) × {r2(lPer100, 3)} = {r2(litres, 1)} L</div>
              <div className="lca-sheet-calc-line">4. A4 = {r2(litres, 1)} L × {T.dieselDensityKgPerL} kg/L × {T.dieselGhgFactorKgCo2ePerKg} kg CO₂e/kg = <strong style={{ color: RED }}>{r2(ex.a4, 1)} kg CO₂e</strong></div>
            </>
          )}
          <div className="lca-sheet-calc-line">Character: conservative upper bound — a 1-tonne pallet is billed the fuel of an entire 6-tonne truck, twice the distance. Prescribed by the class template (group2_v2 B2:B7 + column T), so it stays the graded figure.</div>
        </div>

        <div className="lca-sheet-calc-step">
          <div className="lca-sheet-calc-title" style={{ color: BLUE }}>
            Convention B — CONSOLIDATED freight, t·km share (ISO 14083 / GLEC-style attribution → spreadsheet columns O &amp; P)
          </div>
          <div className="lca-sheet-calc-line">Story: the shipment travels on a shared, fully-loaded truck. It bears only its tonnage share of the vehicle's emissions — empty running is spread across the full payload, not billed to one pallet.</div>
          <div className="lca-sheet-calc-line">1. Intensity of the same truck, full both ways, shared by {T.payloadCapacityTonnes} t: O = 2 × ({T.emptyConsumptionLPer100Km} + {T.loadedVsEmptyDiffLPer100Km}) ÷ {T.payloadCapacityTonnes} ÷ 100 × {T.dieselDensityKgPerL} × {T.dieselGhgFactorKgCo2ePerKg} = <strong>{O} kg CO₂e/t·km</strong></div>
          {ex && (
            <>
              <div className="lca-sheet-calc-line">2. Transport activity: N × M = {r2(tonnes, 3)} t × {r2(ex.distanceKm, 0)} km = {r2(tonnes * ex.distanceKm, 1)} t·km</div>
              <div className="lca-sheet-calc-line">3. A4 = {r2(tonnes * ex.distanceKm, 1)} t·km × {O} = <strong style={{ color: BLUE }}>{r2(consolidated, 1)} kg CO₂e</strong></div>
              <div className="lca-sheet-calc-line">Same layer, same truck, same route: {r2(ex.a4, 1)} vs {r2(consolidated, 1)} kg CO₂e — round trip is ×{r2(ex.a4 / consolidated, 1)} higher for this light load.</div>
            </>
          )}
          <div className="lca-sheet-calc-line">Character: the standard attribution for real (shared) freight under DIN EN ISO 14083 / the GLEC Framework — emissions = transport activity (t·km) × vehicle-category intensity.</div>
        </div>
      </div>

      <div className="fiche-label">Both conventions across every assembly (kg CO₂e)</div>
      <table className="lca-sheet-table">
        <thead>
          <tr><th>Assembly</th><th style={{ color: RED }}>Σ A4 — round trip (Q, graded)</th><th style={{ color: BLUE }}>Σ A4 — consolidated (P = M×N×O)</th><th>Round trip ÷ consolidated</th></tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr key={b.key}>
              <td>{b.label}</td>
              <td style={{ color: RED }}>{b.known ? r2(b.q, 1) : 'incomplete'}</td>
              <td style={{ color: BLUE }}>{b.known ? r2(b.p, 1) : 'incomplete'}</td>
              <td>{b.known && b.p > 0 ? `×${r2(b.q / b.p, 1)}` : '—'}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}>
            <td>Whole building</td>
            <td style={{ color: RED }}>{r2(totalQ, 1)}</td>
            <td style={{ color: BLUE }}>{r2(totalP, 1)}</td>
            <td>{totalQ != null && totalP > 0 ? `×${r2(totalQ / totalP, 1)}` : '—'}</td>
          </tr>
        </tbody>
      </table>

      <div className="fiche-label">Verdict</div>
      <ul className="lca-sheet-conclusions">
        <li style={{ borderLeftColor: BLUE }}>
          <strong style={{ color: BLUE }}>Methodologically, consolidated is the standard answer.</strong>{' '}
          DIN EN ISO 14083 and the GLEC Framework attribute freight emissions by transport activity (t·km) at a
          fleet-average intensity — real building materials ship consolidated, and no single pallet causes a
          dedicated truck to drive to Haarlem and back empty.
        </li>
        <li style={{ borderLeftColor: RED }}>
          <strong style={{ color: RED }}>For the graded deliverables, round trip is the correct figure to report.</strong>{' '}
          It is the professor's own template formula (group2_v2 B2:B7 + column T), and it is conservative — an
          honest worst case, never an understatement. All headline A4 totals in this app and the exports keep it.
        </li>
        <li style={{ borderLeftColor: AMBER }}>
          <strong style={{ color: AMBER }}>So: report round trip, show consolidated as sensitivity.</strong>{' '}
          The spreadsheet does exactly this — column Q carries the graded round-trip figure, columns O/P carry the
          consolidated t·km figure beside it, and this sheet documents why the two differ (×{totalQ != null && totalP > 0 ? r2(totalQ / totalP, 1) : '—'} at
          building level).
        </li>
        <li style={{ borderLeftColor: GREEN }}>
          <strong style={{ color: GREEN }}>Neither changes the ranking.</strong>{' '}
          Both conventions scale with mass × distance, so the heaviest/farthest layers dominate A4 either way —
          the design conclusions (which materials to source closer or lighter) are identical under both.
        </li>
      </ul>

      <div className="lca-sheet-footer">
        Distances: one-way manufacturer → Detmold hub → Haarlem, real OpenRouteService HGV routes where fetched,
        road-route estimate (straight-line × 1.2) otherwise · vehicle parameters from the class template B2:B7 ·
        generated {new Date().toLocaleDateString()}.
      </div>
    </div>
  )

  return (
    <div className="deliverable-block">
      <div className="deliverable-row">
        <span className="deliverable-name">A4 methodology — round trip vs consolidated (A3)</span>
        <button type="button" onClick={handlePdf} disabled={exporting != null || rows.length === 0}>
          {exporting === 'pdf' ? 'Generating…' : 'Export A3 PDF'}
        </button>
        <button type="button" onClick={handlePng} disabled={exporting != null || rows.length === 0}>
          {exporting === 'png' ? 'Exporting…' : 'Save PNG'}
        </button>
      </div>
      <p className="deliverable-note">
        Answers "which A4 convention is correct?" with both calculations walked step by step on a real layer,
        a per-assembly comparison, and the verdict — the spreadsheet's Q (round-trip, graded) vs O/P
        (consolidated t·km) columns come from exactly these two formulas.
      </p>
      <div className="deliverable-preview lca-report-preview">{sheet(null)}</div>
      <div style={{ position: 'fixed', left: 0, top: 0, width: '1420px', zIndex: -9999, opacity: 0.001, pointerEvents: 'none', background: '#ffffff' }}>
        {sheet(exportRef)}
      </div>
    </div>
  )
}
