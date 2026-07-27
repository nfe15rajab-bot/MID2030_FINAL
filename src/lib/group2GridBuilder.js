// Builds the group2-template layout (class file "LCA-Table-Project-
// Analysis_to be finlazied.xlsx", sheet `group2`, columns A-Y verbatim)
// as a plain 2D array of cell values/formula strings — a
// destination-agnostic version of the exact same layout
// spreadsheetExcelExport.js's exportSpreadsheetExcel writes into an
// ExcelJS workbook. googleSheetsSync.js consumes this to push the same
// data into a live Google Sheet. Keep this in sync with
// exportSpreadsheetExcel if the column layout/formulas ever change there
// — same column order, same formulas, same legend, just two delivery
// mechanisms (a downloaded .xlsx vs. a live Sheet) for one dataset.

export const TPL_HEADERS_GROUP2 = [
  'Drawing', 'Group N° +\nWall type (A,B,C)', 'Layer N°', 'wall components', 'material',
  'Thickness\n(mm)', 'Volume (m3)', 'Area(m2)', 'Mass(kg)', 'GWP unit value',
  'A1-A3 (GWP) (kgCO2e) \nFor Component (parametric)', 'A1-A3 (GWP) (kgCO2e) \nFor Component',
  'Distance (km)', 'Weight(ton)', 'GWP unit value_',
  'A4 (Transportaion) (kgCO2e) \nFor Component (parametric)', 'A4 (Transportaion) (kgCO2e) \nFor Component',
  'B4 (Replacement)\n(kgCO2e) \nFor Component', 'Total \nA1-A3\n(kgCO2e)', 'Total\nA4\n(kgCO2e)',
  'Total\nB4\n(kgCO2e)', 'Total\nB6 (Oper. Energy)\n(kgCO2e)\n(stud. cal.)',
  'Total\nIntensity \nload \n(kwh)', 'Total\nB6\nenergy factor (0.5894)\n(kgCO2e)', 'Total\n(kgCO2e)',
]

const COL = Object.fromEntries(
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y']
    .map((letter, i) => [letter, i])
)

function n(v, digits = null) {
  if (v == null || !Number.isFinite(v)) return null
  return digits != null ? Number(v.toFixed(digits)) : v
}

/**
 * @returns {Array<Array<string|number|null>>} row 0 = headers, formula
 *   cells are plain strings starting with "=" (Sheets/Excel USER_ENTERED
 *   convention), ready to hand to either the Sheets API or a generic
 *   cell-writer.
 */
export function buildGroup2Grid(rows, meta) {
  const T = meta.transportAssumptions ?? {}
  const empty = T.emptyConsumptionLPer100Km ?? 16.6
  const diff = T.loadedVsEmptyDiffLPer100Km ?? 2.4
  const payload = T.payloadCapacityTonnes ?? 6
  const density = T.dieselDensityKgPerL ?? 0.832
  const ghg = T.dieselGhgFactorKgCo2ePerKg ?? 3.74
  const consolidatedIntensity = Number(((2 * (empty + diff) / payload) / 100 * density * ghg).toFixed(4))

  const blocks = []
  rows.forEach((r) => {
    const last = blocks[blocks.length - 1]
    if (!last || last.key !== r.assemblyKey) blocks.push({ key: r.assemblyKey, label: r.assemblyDrawing, rows: [] })
    blocks[blocks.length - 1].rows.push(r)
  })

  const grid = [[...TPL_HEADERS_GROUP2]]
  let rowCursor = 2 // 1-based sheet row number (row 1 = header)

  blocks.forEach((block, blockIdx) => {
    const startRow = rowCursor
    const endRow = startRow + block.rows.length - 1

    block.rows.forEach((r, i) => {
      const rn = rowCursor
      const isUnitRow = r.functionalUnit === 'unit'
      const line = new Array(TPL_HEADERS_GROUP2.length).fill(null)
      const set = (col, value) => { line[COL[col]] = value }

      if (i === 0) set('B', `2/${block.label}`)
      set('C', r.layerNo ?? i + 1)
      set('D', r.layerName ?? null)
      set('E', r.material ?? null)
      set('F', r.thicknessMM ?? null)

      const cov = r.linearCoverage != null && r.linearCoverage !== 1 ? `*${r.linearCoverage}` : ''
      if (!isUnitRow && (r.functionalUnit === 'm3' || r.functionalUnit === 'kg')) {
        set('G', `=IF(OR(H${rn}="",F${rn}=""),"",H${rn}*F${rn}/1000${cov})`)
      }
      if (!isUnitRow) set('H', r.areaM2 ?? null)
      set('I', n(r.weightKg, 1))
      set('J', r.gwpUnitValue ?? null)

      const kFormula = r.functionalUnit === 'm2' ? `=IF(OR(H${rn}="",J${rn}=""),"",H${rn}*J${rn}${cov})`
        : r.functionalUnit === 'm3' ? `=IF(OR(G${rn}="",J${rn}=""),"",G${rn}*J${rn})`
          : r.functionalUnit === 'kg' ? `=IF(OR(I${rn}="",J${rn}=""),"",I${rn}*J${rn})`
            : isUnitRow ? `=IF(J${rn}="","",J${rn}*${r.unitCount ?? 1})` : null
      if (kFormula) set('K', kFormula)

      set('L', n(r.a1a3, 2))
      set('M', n(r.distanceKm, 1))
      set('N', `=IF(I${rn}="","",I${rn}/1000)`)
      set('O', consolidatedIntensity)
      set('P', `=IF(OR(M${rn}="",N${rn}="",O${rn}=""),"",M${rn}*N${rn}*O${rn})`)
      set('Q', n(r.a4, 2))
      set('R', n(r.b4, 2))

      grid.push(line)
      rowCursor += 1
    })

    // Block totals on the block's first row.
    const first = grid[startRow - 1] // grid is 0-indexed, sheet rows are 1-indexed
    first[COL.S] = `=SUM(L${startRow}:L${endRow})`
    first[COL.T] = `=SUM(Q${startRow}:Q${endRow})`
    const allB4Known = block.rows.every((r) => r.b4 != null)
    first[COL.U] = allB4Known ? `=SUM(R${startRow}:R${endRow})` : 'not yet assessed'
    if (blockIdx === 0) {
      first[COL.V] = n(meta.b6Total, 1)
      const kwhYearly = meta.settings?.intensityLoad != null && meta.settings?.conditionedFloorAreaM2 != null
        ? meta.settings.intensityLoad * meta.settings.conditionedFloorAreaM2
        : null
      first[COL.W] = n(kwhYearly, 2)
      first[COL.X] = `=IF(W${startRow}="","",W${startRow}*0.5894)`
    }
    first[COL.Y] = `=SUM(S${startRow},T${startRow},U${startRow},X${startRow})`
  })

  // Legend, same sheet, below the data — identical to the xlsx export's.
  const legendRows = [
    ['LEGEND & ASSUMPTIONS (all formulas on this sheet reference this sheet only — no external sheet/workbook links)'],
    [`Transport vehicle (class template B2:B7): empty consumption ${empty} L/100km · fully-loaded diff ${diff} L/100km · payload ${payload} t · diesel density ${density} kg/L · diesel GHG factor ${ghg} kg CO2e/kg`],
    [`Columns O/P/Q = CONSOLIDATED convention (DIN EN ISO 14083 / GLEC Framework), the app's reported A4 as of 2026-07-27: O = ${consolidatedIntensity} kg CO2e/t·km, the same truck's fleet-average intensity, full both ways, shared across its whole payload — 2×(${empty}+${diff})/${payload}/100×${density}×${ghg}. P (=M×N×O) is the live formula; Q is the computed value (same "formula vs value" pairing as K/L for A1-A3) — P and Q agree by construction.`],
    [`The class template's alternate ROUND-TRIP formula (a dedicated truck delivers and returns empty: (2×M)×(${empty}+${diff}×(N/2)/${payload})/100×${density}×${ghg}) is NOT on this sheet — see the "A4 methodology — round trip vs consolidated" A3 sheet in the app's Deliverables for that formula and the full step-by-step comparison of both conventions.`],
    ['Column M = one-way distance routed manufacturer → Detmold hub → Haarlem (real OpenRouteService route where fetched, road-route estimate = straight-line × 1.2 otherwise).'],
    ['Columns V/W/X (first row only): B6 is a single whole-building figure — V = student-calculated B6 over the 50-yr study period; W = intensity load × conditioned floor area (kWh/yr); X = W × 0.5894 (professor\'s electricity factor). Y = SUM(S,T,U,X) per the template.'],
    ['Generated by the MID 2030 Model 1 Assembly Builder — values mirror the app\'s LCA Summary/Deliverables tabs.'],
  ]
  grid.push([]) // one blank spacer row, matches the xlsx export's rowCursor + 2 gap
  legendRows.forEach((l) => {
    const line = new Array(TPL_HEADERS_GROUP2.length).fill(null)
    line[0] = l[0]
    grid.push(line)
  })

  return grid
}
