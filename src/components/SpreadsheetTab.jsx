import React from 'react'
import { getSpreadsheetRows, getSpreadsheetMeta } from '../lib/spreadsheetData.js'
import { exportSpreadsheetExcel, exportReferenceMatchingExcel } from '../lib/spreadsheetExcelExport.js'
import './SpreadsheetTab.css'

function fmt(n, digits = 1) {
  return n != null && Number.isFinite(n) ? n.toFixed(digits) : '—'
}

// Live, read-only mirror of the class's own "Architectural Elements
// Description" + LCA-phase spreadsheet layout (group2_v2-style) — same
// column grouping and header bands, but every cell is pulled from
// whatever's actually saved in this app (sectionStorage, fiche research,
// Operational Energy settings) rather than typed in here. Export buttons
// produce real .xlsx workbooks (flat list or separate assembly worksheets).
export default function SpreadsheetTab() {
  const rows = getSpreadsheetRows()
  const meta = getSpreadsheetMeta()

  const totalA1A3 = rows.reduce((sum, r) => sum + (r.a1a3 ?? 0), 0)
  const totalA4 = rows.reduce((sum, r) => sum + (r.a4 ?? 0), 0)
  const totalB4 = rows.length > 0 && rows.every((r) => r.b4 != null) ? rows.reduce((sum, r) => sum + r.b4, 0) : null
  const totalDistanceRoundTrip = rows.reduce((sum, r) => sum + (r.distanceKm != null ? r.distanceKm * 2 : 0), 0)
  const totalWeight = rows.reduce((sum, r) => sum + (r.weightKg ?? 0), 0)

  async function handleExport() {
    await exportSpreadsheetExcel(rows, meta)
  }

  async function handleReferenceExport() {
    await exportReferenceMatchingExcel(rows, meta)
  }

  return (
    <div className="spreadsheet-tab">
      <h2 className="spreadsheet-heading">Spreadsheet (group2_v2 layout)</h2>
      <p className="spreadsheet-intro">
        Live mirror of the class template's column layout — auto-filled from saved layers, providers,
        and fiche research; nothing typed in here. Export produces the identical layout as a real .xlsx.
      </p>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button type="button" className="spreadsheet-export-button" onClick={handleExport} disabled={rows.length === 0}>
          Export .xlsx (Integrated)
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
                <th colSpan={12} className="band band--description">Architectural Elements Description</th>
                <th colSpan={3} className="band band--gwp">LCA Production Stage (GWP)</th>
                <th colSpan={2} className="band band--transport">Transportation</th>
                <th colSpan={3} className="band band--replacement">Replacement Stage</th>
                <th colSpan={5} className="band band--eol">End-of-life (C1-C4/D)</th>
                <th colSpan={5} className="band band--energy">Operation Energy Use Stage</th>
              </tr>
              <tr>
                <th>Assembly Drawing</th>
                <th>Layer N°</th>
                <th>Layer Name</th>
                <th>Layer Description</th>
                <th>Material</th>
                <th>Company</th>
                <th>EPD Type/Link</th>
                <th>Thickness (mm)</th>
                <th>Density (kg/m³)</th>
                <th>Volume (m³)</th>
                <th>Area (m²)</th>
                <th>Weight (kg)</th>
                <th>Funct. Unit</th>
                <th>GWP unit value</th>
                <th>A1-A3 (kgCO2e)</th>
                <th>Distance (km)</th>
                <th>A4 (kgCO2e)</th>
                <th>Life Span (yr)</th>
                <th>Replacements /50yr</th>
                <th>B4 (kgCO2e)</th>
                <th>C1</th>
                <th>C2</th>
                <th>C3</th>
                <th>C4</th>
                <th>D (credit)</th>
                <th>Intensity (kWh/m²/yr)</th>
                <th>Electricity factor</th>
                <th>B6/m²/yr</th>
                <th>Cond. floor area (m²)</th>
                <th>B6 yearly, whole space (kgCO2e)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.assemblyDrawing}</td>
                  <td>{r.layerNo}</td>
                  <td>{r.layerName}</td>
                  <td className="spreadsheet-cell--wide">{r.layerDescription || '—'}</td>
                  <td className="spreadsheet-cell--wide">{r.material}</td>
                  <td>{r.company}</td>
                  <td className="spreadsheet-cell--wide">{r.epdTypeLink}</td>
                  <td>{r.thicknessMM ?? '—'}</td>
                  <td>{r.densityKgM3 ?? '—'}</td>
                  <td>{fmt(r.volumeM3, 4)}</td>
                  <td>{r.areaM2 ?? '—'}</td>
                  <td>{fmt(r.weightKg, 1)}</td>
                  <td>{r.functionalUnit ?? '—'}</td>
                  <td>{r.gwpUnitValue ?? '—'}</td>
                  <td>{fmt(r.a1a3, 1)}</td>
                  <td>{fmt(r.distanceKm, 0)}</td>
                  <td>{fmt(r.a4, 1)}</td>
                  <td>{r.lifeSpanYears ?? '—'}</td>
                  <td>{r.replacementCount ?? '—'}</td>
                  <td>{fmt(r.b4, 1)}</td>
                  <td>{fmt(r.c1, 1)}</td>
                  <td>{fmt(r.c2, 1)}</td>
                  <td>{fmt(r.c3, 1)}</td>
                  <td>{fmt(r.c4, 1)}</td>
                  <td>{fmt(r.moduleD, 1)}</td>
                  <td>{r.intensityLoad ?? '—'}</td>
                  <td>{r.electricityFactor ?? '—'}</td>
                  <td>{fmt(r.b6PerM2Yearly, 3)}</td>
                  <td>{r.conditionedFloorAreaM2 ?? '—'}</td>
                  <td>{fmt(r.b6YearlySpace, 1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={14}><strong>Total</strong></td>
                <td>{fmt(totalA1A3, 1)}</td>
                <td />
                <td>{fmt(totalA4, 1)}</td>
                <td colSpan={2} />
                <td>{totalB4 != null ? fmt(totalB4, 1) : 'not yet assessed'}</td>
                <td colSpan={5} />
                <td colSpan={4} />
                <td>{fmt(rows[0]?.b6YearlySpace, 1)}</td>
              </tr>
              <tr>
                <td colSpan={30} className="spreadsheet-total-weight">
                  Total distance (round trip): {fmt(totalDistanceRoundTrip, 0)} km · Total weight: {fmt(totalWeight, 1)} kg ·
                  {' '}B6 over 50yr: {fmt(meta.b6Total, 1)} kg CO₂e
                </td>
              </tr>
            </tfoot>
          </table>

          <h3 className="spreadsheet-subheading">Transport vehicle assumptions (group2_v2!B2:B7)</h3>
          <table className="spreadsheet-table spreadsheet-table--assumptions">
            <thead>
              <tr>
                <th>Consume empty vehicle (l/100km)</th>
                <th>Diff fully loaded − empty (l/100km)</th>
                <th>Payload capacity (tonnes)</th>
                <th>Diesel density (kg/l)</th>
                <th>Diesel GHG factor (kg CO2e/kg)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{meta.transportAssumptions.emptyConsumptionLPer100Km}</td>
                <td>{meta.transportAssumptions.loadedVsEmptyDiffLPer100Km}</td>
                <td>{meta.transportAssumptions.payloadCapacityTonnes}</td>
                <td>{meta.transportAssumptions.dieselDensityKgPerL}</td>
                <td>{meta.transportAssumptions.dieselGhgFactorKgCo2ePerKg}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
