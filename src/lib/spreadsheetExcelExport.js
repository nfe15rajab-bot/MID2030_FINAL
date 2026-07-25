// Excel export for the group2_v2-style spreadsheet tab (SpreadsheetTab.jsx)
// — mirrors that table's exact 30-column layout, band groups, and totals
// row cell-for-cell, plus the transport vehicle assumptions as a second
// small table. This REPLACES the old standalone-summary-workbook export
// (lcaExcelExport.js) per the user's explicit choice; that file is no
// longer wired into DeliverablesTab.jsx.
//
// Derived (Volume, Weight, A1-A3, A4, Replacements, B4, C2, B6) columns are
// written as REAL Excel formulas, not pre-computed numbers — so the pushed
// workbook recalculates live if someone edits an input cell in Excel. The
// A1-A3 and A4 formulas mirror LCA-Table-Project-Analysis_v2_2_3.xlsx's own
// group2_v2 sheet (columns O and T) exactly — see transport.js/lcaAnalysis.js
// for the JS versions these are kept in sync with. Only genuinely
// externally-sourced or manually-researched cells (Distance, C1/C3/C4,
// Module D, and the row-label/description columns) stay as plain input
// values.
import ExcelJS from 'exceljs'

const BAND_FILL = {
  description: 'FFE4E4E0',
  gwp: 'FFD9ECDF',
  transport: 'FFDBE8F3',
  replacement: 'FFECDCF0',
  eol: 'FFF3E6D9',
  energy: 'FFF7F0C9',
}

const INPUT_FONT_COLOR = 'FF0000CC' // blue — marks cells safe/expected to hand-edit in Excel

// [header label, row key, band] — order and grouping must match
// SpreadsheetTab.jsx's <thead>/<tbody> exactly.
const COLUMNS = [
  ['Assembly Drawing', 'assemblyDrawing', 'description'],
  ['Layer N°', 'layerNo', 'description'],
  ['Layer Name', 'layerName', 'description'],
  ['Layer Description', 'layerDescription', 'description'],
  ['Material', 'material', 'description'],
  ['Company', 'company', 'description'],
  ['EPD Type/Link', 'epdTypeLink', 'description'],
  ['Thickness (mm)', 'thicknessMM', 'description'],
  ['Density (kg/m³)', 'densityKgM3', 'description'],
  ['Volume (m³)', 'volumeM3', 'description'],
  ['Area (m²)', 'areaM2', 'description'],
  ['Weight (kg)', 'weightKg', 'description'],
  ['Funct. Unit', 'functionalUnit', 'gwp'],
  ['GWP unit value', 'gwpUnitValue', 'gwp'],
  ['A1-A3 (kgCO2e)', 'a1a3', 'gwp'],
  ['Distance (km)', 'distanceKm', 'transport'],
  ['A4 (kgCO2e)', 'a4', 'transport'],
  ['Life Span (yr)', 'lifeSpanYears', 'replacement'],
  ['Replacements /50yr', 'replacementCount', 'replacement'],
  ['B4 (kgCO2e)', 'b4', 'replacement'],
  ['C1', 'c1', 'eol'],
  ['C2', 'c2', 'eol'],
  ['C3', 'c3', 'eol'],
  ['C4', 'c4', 'eol'],
  ['D (credit)', 'moduleD', 'eol'],
  ['Intensity (kWh/m²/yr)', 'intensityLoad', 'energy'],
  ['Electricity factor', 'electricityFactor', 'energy'],
  ['B6/m²/yr', 'b6PerM2Yearly', 'energy'],
  ['Cond. floor area (m²)', 'conditionedFloorAreaM2', 'energy'],
  ['B6 yearly, whole space (kgCO2e)', 'b6YearlySpace', 'energy'],
]

const BAND_SPANS = [
  ['Architectural Elements Description', 12, 'description'],
  ['LCA Production Stage (GWP)', 3, 'gwp'],
  ['Transportation', 2, 'transport'],
  ['Replacement Stage', 3, 'replacement'],
  ['End-of-life (C1-C4/D)', 5, 'eol'],
  ['Operation Energy Use Stage', 5, 'energy'],
]

// Numeric input columns a team member might reasonably hand-edit in Excel
// (drives the formula columns below) — everything else in COLUMNS is
// either a formula result or a plain text/label field.
const INPUT_KEYS = new Set([
  'thicknessMM', 'densityKgM3', 'areaM2', 'functionalUnit', 'gwpUnitValue',
  'distanceKm', 'lifeSpanYears', 'c1', 'c3', 'c4', 'moduleD',
  'intensityLoad', 'electricityFactor', 'conditionedFloorAreaM2',
])

const colIndex = Object.fromEntries(COLUMNS.map(([, key], i) => [key, i + 1]))

function colLetter(n) {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function ref(key, row) {
  return `${colLetter(colIndex[key])}${row}`
}

function num(v, digits = null) {
  if (v == null || !Number.isFinite(v)) return null
  return digits != null ? Number(v.toFixed(digits)) : v
}

export async function exportSpreadsheetExcel(rows, meta, filename = 'group2_v2-spreadsheet.xlsx') {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'MID 2030 — Model 1 Assembly Builder'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Spreadsheet')
  sheet.columns = COLUMNS.map(([header]) => ({ header, width: Math.max(header.length + 2, 12) }))

  // Row layout, computed up front so formulas can reference the
  // assumptions table (written near the bottom) via fixed absolute
  // addresses — Excel doesn't care about forward references, only that
  // the addresses are right.
  const dataStartRow = 3
  const dataEndRow = dataStartRow + rows.length - 1
  const totalsRowNum = dataEndRow + 1
  const assumptionsValueRow = totalsRowNum + 5 // +1 summary row, +2 blank rows, +1 header row, +1 value row

  const A = (r) => `$A$${r}`
  const B = (r) => `$B$${r}`
  const C = (r) => `$C$${r}`
  const D = (r) => `$D$${r}`
  const E = (r) => `$E$${r}`
  const F = (r) => `$F$${r}`

  // Band row (row 1) — merge cells across each group, matching the table's
  // colored header bands.
  let colCursor = 1
  const bandRow = sheet.getRow(1)
  for (const [label, span, band] of BAND_SPANS) {
    sheet.mergeCells(1, colCursor, 1, colCursor + span - 1)
    const cell = bandRow.getCell(colCursor)
    cell.value = label
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL[band] } }
    colCursor += span
  }
  bandRow.commit()

  // Column-label row (row 2)
  const labelRow = sheet.getRow(2)
  COLUMNS.forEach(([header, , band], i) => {
    const cell = labelRow.getCell(i + 1)
    cell.value = header
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL[band] } }
  })
  labelRow.commit()

  // Data rows — derived columns are real formulas (see module comment);
  // everything else is a plain input/label value.
  rows.forEach((r, i) => {
    const row = dataStartRow + i
    const c2IsEpdPublished = r.c2Source === 'EPD-published'
    // Door/Window/Skylight's own "unit" layer — count × per-unit weight,
    // not area/volume/density, and there's no count/massKgPerUnit column
    // in this layout (CLAUDE.md: write into group2_v2's exact column
    // layout, don't redesign it). The live in-sheet formulas below have
    // no valid inputs to work from for these rows, so weight/A1-A3/A4/C2
    // fall back to the already-correct JS-computed value (lcaAnalysis.js's
    // deriveQuantity/deriveMassKg 'unit' branches) instead of a formula —
    // wall/roof/floor rows are completely unaffected, still live formulas.
    const isUnitRow = r.functionalUnit === 'unit'

    const cells = {
      assemblyDrawing: r.assemblyDrawing ?? null,
      layerNo: r.layerNo ?? null,
      layerName: r.layerName ?? null,
      layerDescription: r.layerDescription ?? null,
      material: r.material ?? null,
      company: r.company ?? null,
      epdTypeLink: r.epdTypeLink ?? null,
      thicknessMM: r.thicknessMM ?? null,
      densityKgM3: r.densityKgM3 ?? null,
      volumeM3: isUnitRow ? null : {
        formula: `IF(OR(${ref('areaM2', row)}="",${ref('thicknessMM', row)}=""),"",${ref('areaM2', row)}*${ref('thicknessMM', row)}/1000)`,
      },
      areaM2: r.areaM2 ?? null,
      weightKg: isUnitRow ? num(r.weightKg, 1) : {
        formula: `IF(OR(${ref('volumeM3', row)}="",${ref('densityKgM3', row)}=""),"",${ref('volumeM3', row)}*${ref('densityKgM3', row)})`,
      },
      functionalUnit: r.functionalUnit ?? null,
      gwpUnitValue: r.gwpUnitValue ?? null,
      a1a3: isUnitRow ? num(r.a1a3, 1) : {
        formula: `IF(${ref('gwpUnitValue', row)}="","TBD (need Ökobaudat value)",`
          + `IF(${ref('functionalUnit', row)}="m2",${ref('areaM2', row)}*${ref('gwpUnitValue', row)},`
          + `IF(${ref('functionalUnit', row)}="m3",${ref('volumeM3', row)}*${ref('gwpUnitValue', row)},`
          + `IF(${ref('functionalUnit', row)}="kg",${ref('weightKg', row)}*${ref('gwpUnitValue', row)},"check FU"))))`,
      },
      distanceKm: r.distanceKm ?? null,
      a4: isUnitRow ? num(r.a4, 1) : {
        formula: `IF(OR(${ref('distanceKm', row)}="",${ref('weightKg', row)}=""),"TBD",`
          + `(2*${ref('distanceKm', row)})*(${A(assumptionsValueRow)}+(${B(assumptionsValueRow)}*((${ref('weightKg', row)}/1000)/2)/${C(assumptionsValueRow)}))`
          + `/100*${D(assumptionsValueRow)}*${E(assumptionsValueRow)})`,
      },
      lifeSpanYears: r.lifeSpanYears ?? null,
      replacementCount: {
        formula: `IF(OR(${ref('lifeSpanYears', row)}="",${ref('lifeSpanYears', row)}<=0),"",MAX(ROUNDUP(50/${ref('lifeSpanYears', row)},0)-1,0))`,
      },
      b4: {
        formula: `IF(OR(${ref('replacementCount', row)}="",ISTEXT(${ref('a1a3', row)}),ISTEXT(${ref('a4', row)})),"not yet assessed",`
          + `${ref('replacementCount', row)}*(${ref('a1a3', row)}+${ref('a4', row)}))`,
      },
      c1: r.c1 != null ? num(r.c1, 3) : null,
      c2: c2IsEpdPublished
        ? (r.c2 != null ? num(r.c2, 3) : null)
        : {
          formula: `IF(OR(${F(assumptionsValueRow)}="",${ref('weightKg', row)}=""),"TBD",`
            + `(2*${F(assumptionsValueRow)})*(${A(assumptionsValueRow)}+(${B(assumptionsValueRow)}*((${ref('weightKg', row)}/1000)/2)/${C(assumptionsValueRow)}))`
            + `/100*${D(assumptionsValueRow)}*${E(assumptionsValueRow)})`,
        },
      c3: r.c3 != null ? num(r.c3, 3) : null,
      c4: r.c4 != null ? num(r.c4, 3) : null,
      moduleD: r.moduleD != null ? num(r.moduleD, 3) : null,
      intensityLoad: r.intensityLoad ?? null,
      electricityFactor: r.electricityFactor ?? null,
      b6PerM2Yearly: {
        formula: `IF(OR(${ref('intensityLoad', row)}="",${ref('electricityFactor', row)}=""),"",${ref('intensityLoad', row)}*${ref('electricityFactor', row)})`,
      },
      conditionedFloorAreaM2: r.conditionedFloorAreaM2 ?? null,
      b6YearlySpace: {
        formula: `IF(OR(${ref('b6PerM2Yearly', row)}="",${ref('conditionedFloorAreaM2', row)}=""),"",${ref('b6PerM2Yearly', row)}*${ref('conditionedFloorAreaM2', row)})`,
      },
    }

    const excelRow = sheet.getRow(row)
    COLUMNS.forEach(([, key]) => {
      const cell = excelRow.getCell(colIndex[key])
      const v = cells[key]
      if (v && typeof v === 'object' && 'formula' in v) {
        cell.value = { formula: v.formula }
      } else {
        cell.value = v
        if (v != null && INPUT_KEYS.has(key)) cell.font = { color: { argb: INPUT_FONT_COLOR } }
      }
    })
    excelRow.commit()
  })

  // Totals row — SUM/aggregate formulas over the data range rather than
  // JS-precomputed numbers, so they track live edits too. SUM already
  // ignores non-numeric ("TBD"/"not yet assessed") cells on its own.
  const dataRange = (key) => `${ref(key, dataStartRow)}:${ref(key, dataEndRow)}`
  const totalsRow = sheet.getRow(totalsRowNum)
  totalsRow.getCell(1).value = 'Total'
  totalsRow.getCell(1).font = { bold: true }
  totalsRow.getCell(colIndex.a1a3).value = { formula: `SUM(${dataRange('a1a3')})` }
  totalsRow.getCell(colIndex.a4).value = { formula: `SUM(${dataRange('a4')})` }
  totalsRow.getCell(colIndex.b4).value = {
    formula: `IF(COUNTIF(${dataRange('b4')},"not yet assessed")>0,"not yet assessed",SUM(${dataRange('b4')}))`,
  }
  totalsRow.getCell(colIndex.b6YearlySpace).value = { formula: `${ref('b6YearlySpace', dataStartRow)}` }
  totalsRow.eachCell((cell) => { cell.font = { ...(cell.font || {}), bold: true } })
  totalsRow.commit()

  // Distance/weight/B6 summary line — also formulas, so it stays correct
  // if rows are edited directly in the pushed workbook.
  const summaryRow = sheet.getRow(totalsRowNum + 1)
  summaryRow.getCell(1).value = {
    formula: `"Total distance (round trip): "&TEXT(2*SUM(${dataRange('distanceKm')}),"0")&" km"`,
  }
  summaryRow.getCell(colIndex.weightKg).value = {
    formula: `"Total weight: "&TEXT(SUM(${dataRange('weightKg')}),"0.0")&" kg"`,
  }
  summaryRow.getCell(colIndex.b6YearlySpace).value = {
    formula: `"B6 over 50yr: "&TEXT(${ref('b6YearlySpace', dataStartRow)}*50,"0.0")&" kg CO2e"`,
  }
  summaryRow.commit()

  // Transport vehicle assumptions — small second table, a couple of rows
  // below the main one. A4 and C2 formulas above reference this table's
  // value row by absolute address ($A$/$B$/.../$F$<assumptionsValueRow>).
  sheet.addRow([])
  sheet.addRow([])
  const assumptionsHeaderRow = sheet.addRow([
    'Consume empty vehicle (l/100km)',
    'Diff fully loaded − empty (l/100km)',
    'Payload capacity (tonnes)',
    'Diesel density (kg/l)',
    'Diesel GHG factor (kg CO2e/kg)',
    'Waste facility distance (km)',
  ])
  assumptionsHeaderRow.font = { bold: true }
  const assumptionsRow = sheet.addRow([
    meta.transportAssumptions.emptyConsumptionLPer100Km,
    meta.transportAssumptions.loadedVsEmptyDiffLPer100Km,
    meta.transportAssumptions.payloadCapacityTonnes,
    meta.transportAssumptions.dieselDensityKgPerL,
    meta.transportAssumptions.dieselGhgFactorKgCo2ePerKg,
    meta.settings?.wasteFacilityDistanceKm ?? null,
  ])
  assumptionsRow.eachCell((cell) => { cell.font = { color: { argb: INPUT_FONT_COLOR } } })
  // Sanity check — if row math above ever drifts from this literal layout,
  // formulas would silently point at the wrong cells.
  if (assumptionsRow.number !== assumptionsValueRow) {
    throw new Error(`spreadsheetExcelExport: assumptions row landed at ${assumptionsRow.number}, formulas expect ${assumptionsValueRow}`)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
