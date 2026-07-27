import React from 'react'
import { getSpreadsheetRows, getSpreadsheetMeta } from '../lib/spreadsheetData.js'
import { exportSpreadsheetExcel, exportReferenceMatchingExcel } from '../lib/spreadsheetExcelExport.js'
import './SpreadsheetTab.css'

function fmt(n, digits = 1) {
  return n != null && Number.isFinite(n) ? n.toFixed(digits) : '—'
}

// Live, read-only mirror of the class template — column-for-column the
// EXACT A→Y order of "LCA-Table-Project-Analysis_to be finlazied.xlsx",
// sheet group2 (same order the Excel export writes), so what's on screen
// is literally what lands in the class workbook. Every cell is pulled
// from whatever's actually saved in this app (sectionStorage, fiche
// research, Operational Energy settings) rather than typed in here.
//
// A4 (columns O/P/Q) is the CONSOLIDATED convention (DIN EN ISO 14083 /
// GLEC Framework) — the app's reported A4 since 2026-07-27. O is the
// truck's fleet-average t·km intensity, P is the live formula (=M×N×O),
// Q is the computed value (same "formula vs value" pairing as K/L for
// A1-A3) — P and Q agree by construction. The class template's alternate
// round-trip formula isn't computed here; see the "A4 methodology" A3
// sheet in Deliverables for that formula and the full comparison.
const TPL_COLS = [
  'Drawing', 'Group N° + type', 'Layer N°', 'wall components', 'material',
  'Thickness (mm)', 'Volume (m3)', 'Area (m2)', 'Mass (kg)', 'GWP unit value',
  'A1-A3 parametric (K)', 'A1-A3 (L)', 'Distance (km)', 'Weight (ton)',
  'GWP unit value_ (O, t·km)', 'A4 parametric (P)', 'A4 (Q)',
  'B4 (R)', 'Total A1-A3 (S)', 'Total A4 (T)', 'Total B4 (U)',
  'Total B6 stud. cal. (V)', 'Intensity load kWh (W)', 'B6 × 0.5894 (X)', 'Total (Y)',
]

export default function SpreadsheetTab() {
  const rows = getSpreadsheetRows()
  const meta = getSpreadsheetMeta()

  const T = meta.transportAssumptions
  const consolidatedIntensity = Number(
    ((2 * (T.emptyConsumptionLPer100Km + T.loadedVsEmptyDiffLPer100Km) / T.payloadCapacityTonnes) / 100
      * T.dieselDensityKgPerL * T.dieselGhgFactorKgCo2ePerKg).toFixed(4)
  )

  // Group into assembly blocks — totals sit on each block's first row,
  // same placement as the template's own S..Y columns.
  const blocks = []
  rows.forEach((r) => {
    const last = blocks[blocks.length - 1]
    if (!last || last.key !== r.assemblyKey) blocks.push({ key: r.assemblyKey, label: r.assemblyDrawing, rows: [] })
    blocks[blocks.length - 1].rows.push(r)
  })

  const kwhYearly = meta.settings?.intensityLoad != null && meta.settings?.conditionedFloorAreaM2 != null
    ? meta.settings.intensityLoad * meta.settings.conditionedFloorAreaM2
    : null
  const b6Prof = kwhYearly != null ? kwhYearly * 0.5894 : null

  async function handleExport() {
    await exportSpreadsheetExcel(rows, meta)
  }

  async function handleReferenceExport() {
    await exportReferenceMatchingExcel(rows, meta)
  }

  return (
    <div className="spreadsheet-tab">
      <h2 className="spreadsheet-heading">Spreadsheet (class template layout — group2, columns A→Y)</h2>
      <p className="spreadsheet-intro">
        Live mirror of the class template's exact column order — auto-filled from saved layers, providers,
        and fiche research; nothing typed in here. The export writes one self-contained <code>group2</code>
        sheet (formulas reference this sheet only — no external sheet/workbook links), so the tab can be
        pasted straight into the class master file.
      </p>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button type="button" className="spreadsheet-export-button" onClick={handleExport} disabled={rows.length === 0}>
          Export .xlsx (class template group2)
        </button>
        <button type="button" className="spreadsheet-export-button" style={{ backgroundColor: '#2d6a4f' }} onClick={handleReferenceExport} disabled={rows.length === 0}>
          Export Excel Matching Reference
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="empty-state">
          No saved layers yet — go to Section Configurator, build a wall/roof/floor assembly, and
          click "Save changes" first.
        </p>
      ) : (
        <div className="spreadsheet-scroll">
          <table className="spreadsheet-table">
            <thead>
              <tr>
                {TPL_COLS.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {blocks.map((block, blockIdx) => {
                const sTotal = block.rows.reduce((sum, r) => sum + (r.a1a3 ?? 0), 0)
                const tTotal = block.rows.reduce((sum, r) => sum + (r.a4 ?? 0), 0)
                const uKnown = block.rows.every((r) => r.b4 != null)
                const uTotal = uKnown ? block.rows.reduce((sum, r) => sum + r.b4, 0) : null
                const xVal = blockIdx === 0 ? b6Prof : null
                const yTotal = sTotal + tTotal + (uTotal ?? 0) + (xVal ?? 0)

                return block.rows.map((r, i) => {
                  const isUnitRow = r.functionalUnit === 'unit'
                  const cov = r.linearCoverage ?? 1
                  const volume = !isUnitRow && (r.functionalUnit === 'm3' || r.functionalUnit === 'kg') && r.areaM2 != null && r.thicknessMM != null
                    ? r.areaM2 * r.thicknessMM / 1000 * cov
                    : null
                  const kParametric = r.gwpUnitValue == null ? null
                    : r.functionalUnit === 'm2' && r.areaM2 != null ? r.areaM2 * r.gwpUnitValue * cov
                      : r.functionalUnit === 'm3' && volume != null ? volume * r.gwpUnitValue
                        : r.functionalUnit === 'kg' && r.weightKg != null ? r.weightKg * r.gwpUnitValue
                          : isUnitRow ? r.gwpUnitValue * (r.unitCount ?? 1) : null
                  const weightTon = r.weightKg != null ? r.weightKg / 1000 : null
                  const pConsolidated = r.distanceKm != null && weightTon != null
                    ? r.distanceKm * weightTon * consolidatedIntensity
                    : null

                  return (
                    <tr key={`${block.key}-${i}`}>
                      <td />
                      <td>{i === 0 ? `2/${block.label}` : ''}</td>
                      <td>{r.layerNo}</td>
                      <td>{r.layerName}</td>
                      <td className="spreadsheet-cell--wide">{r.material}</td>
                      <td>{r.thicknessMM ?? '—'}</td>
                      <td>{fmt(volume, 4)}</td>
                      <td>{isUnitRow ? '—' : (r.areaM2 ?? '—')}</td>
                      <td>{fmt(r.weightKg, 1)}</td>
                      <td>{r.gwpUnitValue ?? '—'}</td>
                      <td>{fmt(kParametric, 2)}</td>
                      <td>{fmt(r.a1a3, 2)}</td>
                      <td>{fmt(r.distanceKm, 1)}</td>
                      <td>{fmt(weightTon, 3)}</td>
                      <td>{consolidatedIntensity}</td>
                      <td>{fmt(pConsolidated, 2)}</td>
                      <td>{fmt(r.a4, 2)}</td>
                      <td>{fmt(r.b4, 2)}</td>
                      <td className="spreadsheet-cell--total">{i === 0 ? fmt(sTotal, 1) : ''}</td>
                      <td className="spreadsheet-cell--total">{i === 0 ? fmt(tTotal, 1) : ''}</td>
                      <td className="spreadsheet-cell--total">{i === 0 ? (uKnown ? fmt(uTotal, 1) : 'not yet assessed') : ''}</td>
                      <td className="spreadsheet-cell--total">{i === 0 && blockIdx === 0 ? fmt(meta.b6Total, 1) : ''}</td>
                      <td className="spreadsheet-cell--total">{i === 0 && blockIdx === 0 ? fmt(kwhYearly, 2) : ''}</td>
                      <td className="spreadsheet-cell--total">{i === 0 && blockIdx === 0 ? fmt(xVal, 1) : ''}</td>
                      <td className="spreadsheet-cell--total">{i === 0 ? fmt(yTotal, 1) : ''}</td>
                    </tr>
                  )
                })
              })}
            </tbody>
          </table>

          <h3 className="spreadsheet-subheading">Transport vehicle assumptions (class template B2:B7)</h3>
          <table className="spreadsheet-table spreadsheet-table--assumptions">
            <thead>
              <tr>
                <th>Consume empty vehicle (l/100km)</th>
                <th>Diff fully loaded − empty (l/100km)</th>
                <th>Payload capacity (tonnes)</th>
                <th>Diesel density (kg/l)</th>
                <th>Diesel GHG factor (kg CO2e/kg)</th>
                <th>Consolidated intensity O (kg CO2e/t·km, derived)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{T.emptyConsumptionLPer100Km}</td>
                <td>{T.loadedVsEmptyDiffLPer100Km}</td>
                <td>{T.payloadCapacityTonnes}</td>
                <td>{T.dieselDensityKgPerL}</td>
                <td>{T.dieselGhgFactorKgCo2ePerKg}</td>
                <td>{consolidatedIntensity}</td>
              </tr>
            </tbody>
          </table>
          <p className="spreadsheet-intro">
            A4 (O/P/Q) uses the CONSOLIDATED convention (DIN EN ISO 14083 / GLEC Framework: transport activity
            in t·km × the truck's fleet-average intensity) — adopted app-wide 2026-07-27 in place of the class
            template's round-trip formula. Why, and how the two compare — full step-by-step on the A3
            methodology sheet in Deliverables → LCA Reports. B6 (V/W/X) is a single whole-building figure,
            shown once on the first block, never split per assembly.
          </p>
        </div>
      )}
    </div>
  )
}
