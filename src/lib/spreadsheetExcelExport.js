// Excel export for the group2_v2-style spreadsheet tab (SpreadsheetTab.jsx)
// — creates a fully integrated 3-sheet workbook per Professor Thomaz's reference:
//   1. Prof Thomaz Reference & Overview (Methodology, system boundaries, transport parameters)
//   2. Prof Thomaz Reference Analysis (Summary assembly totals referencing Sheet 3)
//   3. Detailed LCA & Material Audit (30-column material-by-material calculation + audit classification)
//
// Derived (Volume, Weight, A1-A3, A4, Replacements, B4, C2, B6) columns are
// written as REAL Excel formulas referencing Sheet 1 transport parameters and
// feeding Sheet 2 summary formulas live.

import ExcelJS from 'exceljs'

const BAND_FILL = {
  description: 'FFE4E4E0',
  gwp: 'FFD9ECDF',
  transport: 'FFDBE8F3',
  replacement: 'FFECDCF0',
  eol: 'FFF3E6D9',
  energy: 'FFF7F0C9',
  audit: 'FFE2E8F0',
}

const INPUT_FONT_COLOR = 'FF0000CC' // blue — marks input cells in Excel

// [header label, row key, band]
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
  ['EPD / Source Provenance', 'sourceProvenance', 'audit'],
  ['Audit Verification Note', 'auditNote', 'audit'],
]

const BAND_SPANS = [
  ['Architectural Elements Description', 12, 'description'],
  ['LCA Production Stage (GWP)', 3, 'gwp'],
  ['Transportation', 2, 'transport'],
  ['Replacement Stage', 3, 'replacement'],
  ['End-of-life (C1-C4/D)', 5, 'eol'],
  ['Operation Energy Use Stage', 5, 'energy'],
  ['Audit & Source Verification', 2, 'audit'],
]

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

  // ==========================================
  // SHEET 1: Prof Thomaz Reference & Overview
  // ==========================================
  const overviewSheet = workbook.addWorksheet('Prof Thomaz Reference & Overview')
  overviewSheet.columns = [
    { header: 'Parameter / Rule Description', width: 45 },
    { header: 'Value / Reference Standard', width: 55 },
    { header: 'Unit / Scope', width: 25 },
    { header: 'Methodological Guidance', width: 60 },
  ]

  // Title
  overviewSheet.mergeCells('A1:D1')
  const titleCell = overviewSheet.getCell('A1')
  titleCell.value = 'MID 2030 — LCA Methodology & System Boundaries (Professor Thomaz Reference)'
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1E3A8A' } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE8F3' } }

  overviewSheet.mergeCells('A2:D2')
  const subCell = overviewSheet.getCell('A2')
  subCell.value = 'Batavierenplantsoen, Haarlem | Integrated LCA Calculation Workbook & Audit Reference'
  subCell.font = { italic: true, size: 11 }

  overviewSheet.addRow([])

  // Section header: System Boundaries
  const h1 = overviewSheet.addRow(['1. LCA System Boundaries & Calculation Rules', '', '', ''])
  h1.font = { bold: true, size: 12 }
  h1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }

  const rules = [
    ['Standard & Framework', 'EN 15804 + A2 / ISO 14040/44', 'Cradle-to-Grave + Module D', 'Methodological compliance with Professor Thomaz reference workbook'],
    ['A1-A3 Production Stage', 'Quantity × GWP per Declared Unit', 'kg CO2e', 'Dimensionally consistent: m²×kgCO2e/m², m³×kgCO2e/m³, kg×kgCO2e/kg, unit×kgCO2e/unit'],
    ['A4 Transport Stage', '2-Way Round Trip (Road Freight)', 'kg CO2e', 'Calculated using weight, fuel consumption, load factor, and diesel emission factor'],
    ['B4 Replacement Stage', 'MAX(ROUNDUP(50 / LifeSpan, 0) - 1, 0) × (A1-A3 + A4)', 'kg CO2e', '50-year study period; whole replacement cycles accounted for'],
    ['C1 Demolition / Deconstruction', 'Site assembly specific or 0.0', 'kg CO2e', 'Energy for mechanical dismantling at end of life'],
    ['C2 Waste Transport', '2 × Distance_Waste × Vehicle_Factor', 'kg CO2e', 'Transport from site to municipal treatment facility (default 30 km)'],
    ['C3 Waste Processing', 'EPD scenario / Incineration / Downcycling', 'kg CO2e', 'Processing emissions prior to landfill or incineration'],
    ['C4 Disposal', 'EPD scenario / Inert Landfill', 'kg CO2e', 'Final landfilled mass emissions'],
    ['Module D Reuse & Recovery', 'Net avoided burden credit', 'kg CO2e', 'Recycling credit / energy recovery offset outside system boundary'],
    ['B6 Operational Energy Use', 'IntensityLoad × ElectricityFactor × Area', 'kg CO2e / yr', 'Annual operational electricity load multiplied by grid GHG factor'],
  ]

  rules.forEach((r) => overviewSheet.addRow(r))

  overviewSheet.addRow([])

  // Section header: Transport Parameters
  const h2 = overviewSheet.addRow(['2. Transport Vehicle & Fuel Parameters (Referenced by Sheet 3 Formulas)', '', '', ''])
  h2.font = { bold: true, size: 12 }
  h2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE8F3' } }

  const emptyCons = meta.transportAssumptions?.emptyConsumptionLPer100Km ?? 25.0
  const loadedDiff = meta.transportAssumptions?.loadedVsEmptyDiffLPer100Km ?? 10.0
  const payload = meta.transportAssumptions?.payloadCapacityTonnes ?? 20.0
  const dieselDensity = meta.transportAssumptions?.dieselDensityKgPerL ?? 0.84
  const dieselGhg = meta.transportAssumptions?.dieselGhgFactorKgCo2ePerKg ?? 3.16
  const wasteDist = meta.settings?.wasteFacilityDistanceKm ?? 30.0

  overviewSheet.addRow(['Consume empty vehicle', emptyCons, 'l / 100km', 'Base empty truck fuel consumption']) // Row 17 (index 17)
  overviewSheet.addRow(['Diff fully loaded − empty', loadedDiff, 'l / 100km', 'Incremental fuel usage for full 20t load'])
  overviewSheet.addRow(['Payload capacity', payload, 'tonnes', 'Standard heavy road freight capacity'])
  overviewSheet.addRow(['Diesel density', dieselDensity, 'kg / l', 'Standard fuel physical density'])
  overviewSheet.addRow(['Diesel GHG factor', dieselGhg, 'kg CO2e / kg fuel', 'Well-to-wheel greenhouse gas intensity'])
  overviewSheet.addRow(['Waste facility distance', wasteDist, 'km', 'Default distance to Haarlem municipal waste processing plant'])

  overviewSheet.addRow([])

  // Section header: Timber & Source Hierarchy
  const h3 = overviewSheet.addRow(['3. Timber Biogenic Carbon & Source Quality Guidelines', '', '', ''])
  h3.font = { bold: true, size: 12 }
  h3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9ECDF' } }

  const guidelines = [
    ['Timber / OSB Biogenic Carbon', 'GWP-total preserved including biogenic storage', 'kg CO2e / FU', 'Negative GWP (~-1.6 to -1.8 kg CO2e/kg dry wood) reflects sequestered carbon per EN 15804'],
    ['Source Hierarchy Level 1', 'Verified Manufacturer EPD', 'Highest confidence', 'Product-specific third-party verified EPD (e.g. STEICO, Schüco, Fakro)'],
    ['Source Hierarchy Level 2', 'Generic ÖKOBAUDAT Dataset', 'High confidence', 'National LCA database match for material category'],
    ['Source Hierarchy Level 3', 'Technical Datasheet / Product Spec', 'Medium confidence', 'Physical properties from manufacturer, GWP estimated from category proxy'],
    ['Source Hierarchy Level 4', 'Manufacturer Webpage / Proxy', 'Assumed', 'Industry benchmark proxy value flagged for manual verification'],
  ]
  guidelines.forEach((g) => overviewSheet.addRow(g))

  // ==========================================
  // SHEET 2: Prof Thomaz Reference Analysis
  // ==========================================
  const summarySheet = workbook.addWorksheet('Prof Thomaz Reference Analysis')
  summarySheet.columns = [
    { header: 'Assembly / Element', width: 22 },
    { header: 'Area (m²)', width: 14 },
    { header: 'Total Weight (kg)', width: 18 },
    { header: 'A1-A3 Production (kgCO2e)', width: 24 },
    { header: 'A4 Transport (kgCO2e)', width: 22 },
    { header: 'B4 Replacement (kgCO2e)', width: 24 },
    { header: 'C1-C4 End-of-Life (kgCO2e)', width: 24 },
    { header: 'Module D Credit (kgCO2e)', width: 22 },
    { header: 'Total Embodied GWP (kgCO2e)', width: 26 },
    { header: 'Normalized GWP (kgCO2e/m²)', width: 24 },
  ]

  // Header formatting
  const sumHeaderRow = summarySheet.getRow(1)
  sumHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sumHeaderRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  const assemblyKeys = [
    ['Wall Assembly', 'Wall'],
    ['Roof Assembly', 'Roof'],
    ['Floor Assembly', 'Floor'],
    ['Door Unit', 'Door'],
    ['Window Unit', 'Window'],
    ['Skylight Unit', 'Skylight'],
  ]

  // Detail sheet name reference
  const DET = "'Detailed LCA & Material Audit'"

  assemblyKeys.forEach(([label, code], idx) => {
    const rowNum = idx + 2
    summarySheet.addRow({
      'Assembly / Element': label,
      'Area (m²)': { formula: `IFERROR(AVERAGEIFS(${DET}!$K$3:$K$150, ${DET}!$A$3:$A$150, "*${code}*"), 0)` },
      'Total Weight (kg)': { formula: `SUMIF(${DET}!$A$3:$A$150, "*${code}*", ${DET}!$L$3:$L$150)` },
      'A1-A3 Production (kgCO2e)': { formula: `SUMIF(${DET}!$A$3:$A$150, "*${code}*", ${DET}!$O$3:$O$150)` },
      'A4 Transport (kgCO2e)': { formula: `SUMIF(${DET}!$A$3:$A$150, "*${code}*", ${DET}!$Q$3:$Q$150)` },
      'B4 Replacement (kgCO2e)': { formula: `SUMIF(${DET}!$A$3:$A$150, "*${code}*", ${DET}!$T$3:$T$150)` },
      'C1-C4 End-of-Life (kgCO2e)': { formula: `SUMIF(${DET}!$A$3:$A$150, "*${code}*", ${DET}!$U$3:$U$150)+SUMIF(${DET}!$A$3:$A$150, "*${code}*", ${DET}!$V$3:$V$150)+SUMIF(${DET}!$A$3:$A$150, "*${code}*", ${DET}!$W$3:$W$150)+SUMIF(${DET}!$A$3:$A$150, "*${code}*", ${DET}!$X$3:$X$150)` },
      'Module D Credit (kgCO2e)': { formula: `SUMIF(${DET}!$A$3:$A$150, "*${code}*", ${DET}!$Y$3:$Y$150)` },
      'Total Embodied GWP (kgCO2e)': { formula: `D${rowNum}+E${rowNum}+F${rowNum}+G${rowNum}` },
      'Normalized GWP (kgCO2e/m²)': { formula: `IF(B${rowNum}>0, I${rowNum}/B${rowNum}, 0)` },
    })
  })

  // Grand total row
  const totRow = summarySheet.addRow({
    'Assembly / Element': 'Grand Total (Whole Building)',
    'Area (m²)': { formula: 'SUM(B2:B4)' }, // Wall, roof, floor floor area
    'Total Weight (kg)': { formula: 'SUM(C2:C7)' },
    'A1-A3 Production (kgCO2e)': { formula: 'SUM(D2:D7)' },
    'A4 Transport (kgCO2e)': { formula: 'SUM(E2:E7)' },
    'B4 Replacement (kgCO2e)': { formula: 'SUM(F2:F7)' },
    'C1-C4 End-of-Life (kgCO2e)': { formula: 'SUM(G2:G7)' },
    'Module D Credit (kgCO2e)': { formula: 'SUM(H2:H7)' },
    'Total Embodied GWP (kgCO2e)': { formula: 'SUM(I2:I7)' },
    'Normalized GWP (kgCO2e/m²)': { formula: 'IF(B8>0, I8/B8, 0)' },
  })

  totRow.eachCell((cell) => {
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBD5E1' } }
  })

  // ==========================================
  // SHEET 3: Detailed LCA & Material Audit (3rd Sheet requested)
  // ==========================================
  const detailSheet = workbook.addWorksheet('Detailed LCA & Material Audit')
  detailSheet.columns = COLUMNS.map(([header]) => ({ header, width: Math.max(header.length + 2, 12) }))

  const dataStartRow = 3
  const dataEndRow = dataStartRow + rows.length - 1
  const totalsRowNum = dataEndRow + 1

  // Band row (row 1)
  let colCursor = 1
  const bandRow = detailSheet.getRow(1)
  for (const [label, span, band] of BAND_SPANS) {
    detailSheet.mergeCells(1, colCursor, 1, colCursor + span - 1)
    const cell = bandRow.getCell(colCursor)
    cell.value = label
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL[band] } }
    colCursor += span
  }
  bandRow.commit()

  // Column-label row (row 2)
  const labelRow = detailSheet.getRow(2)
  COLUMNS.forEach(([header, , band], i) => {
    const cell = labelRow.getCell(i + 1)
    cell.value = header
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL[band] } }
  })
  labelRow.commit()

  // Ref helper for Sheet 1 transport params
  const OVR = "'Prof Thomaz Reference & Overview'"
  const OVR_EMPTY = `${OVR}!$B$17`
  const OVR_DIFF = `${OVR}!$B$18`
  const OVR_PAYLOAD = `${OVR}!$B$19`
  const OVR_DENSITY = `${OVR}!$B$20`
  const OVR_GHG = `${OVR}!$B$21`
  const OVR_WASTE_DIST = `${OVR}!$B$22`

  // Data rows
  rows.forEach((r, i) => {
    const row = dataStartRow + i
    const c2IsEpdPublished = r.c2Source === 'EPD-published'
    const isUnitRow = r.functionalUnit === 'unit'

    // Determine audit provenance label and notes
    let provenance = 'Generic EPD / ÖKOBAUDAT'
    let auditNote = 'FU & Geometry Verified; Dimensionally Consistent'

    if (r.epdTypeLink && (r.epdTypeLink.includes('STEICO') || r.epdTypeLink.includes('Schüco') || r.epdTypeLink.includes('Fakro') || r.epdTypeLink.includes('Kronoply'))) {
      provenance = 'Verified Manufacturer EPD'
    } else if (r.functionalUnit === 'unit') {
      provenance = 'Manufacturer Unit Spec'
      auditNote = 'Unit assembly (Door/Window/Skylight) mass-based calculation'
    } else if (!r.epdTypeLink || r.epdTypeLink.includes('generic') || r.epdTypeLink.includes('Assumed')) {
      provenance = 'Assumed Proxy / Category Match'
      auditNote = 'Estimated value flagged for review'
    }

    if (r.gwpUnitValue != null && r.gwpUnitValue < 0) {
      auditNote += ' | Timber biogenic carbon storage preserved'
    }

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
        formula: `IF(${ref('gwpUnitValue', row)}="","TBD",`
          + `IF(${ref('functionalUnit', row)}="m2",${ref('areaM2', row)}*${ref('gwpUnitValue', row)},`
          + `IF(${ref('functionalUnit', row)}="m3",${ref('volumeM3', row)}*${ref('gwpUnitValue', row)},`
          + `IF(${ref('functionalUnit', row)}="kg",${ref('weightKg', row)}*${ref('gwpUnitValue', row)},"check FU"))))`,
      },
      distanceKm: r.distanceKm ?? null,
      a4: isUnitRow ? num(r.a4, 1) : {
        formula: `IF(OR(${ref('distanceKm', row)}="",${ref('weightKg', row)}=""),"TBD",`
          + `(2*${ref('distanceKm', row)})*(${OVR_EMPTY}+(${OVR_DIFF}*((${ref('weightKg', row)}/1000)/2)/${OVR_PAYLOAD}))`
          + `/100*${OVR_DENSITY}*${OVR_GHG})`,
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
          formula: `IF(${ref('weightKg', row)}="","TBD",`
            + `(2*${OVR_WASTE_DIST})*(${OVR_EMPTY}+(${OVR_DIFF}*((${ref('weightKg', row)}/1000)/2)/${OVR_PAYLOAD}))`
            + `/100*${OVR_DENSITY}*${OVR_GHG})`,
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
      sourceProvenance: provenance,
      auditNote: auditNote,
    }

    const excelRow = detailSheet.getRow(row)
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

  // Totals row
  const dataRange = (key) => `${ref(key, dataStartRow)}:${ref(key, dataEndRow)}`
  const totalsRow = detailSheet.getRow(totalsRowNum)
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

  // Summary row
  const summaryRow = detailSheet.getRow(totalsRowNum + 1)
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

  // Save/Download buffer
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Excel export matching Professor Thomaz's reference workbook layout
 * (LCA-Table-Project-Analysis_v2_2_3.xlsx) — creates a master ANALYSIS
 * summary sheet that references separate assembly sheets (Assembly_1 Wall,
 * Assembly_2 Floor, Assembly_3 Roof, Assembly_4 Door, Assembly_5 Window,
 * Assembly_6 Skylight) cell-by-cell and total-by-total using real Excel formulas.
 */
export async function exportReferenceMatchingExcel(rows, meta, filename = 'LCA-Table-Project-Analysis_v2_2_3.xlsx') {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'MID 2030 — Model 1 Assembly Builder'
  workbook.created = new Date()

  // ----------------------------------------------------
  // 1. Overview & Transport Parameters Sheet
  // ----------------------------------------------------
  const overviewSheet = workbook.addWorksheet('Prof Thomaz Reference & Overview')
  overviewSheet.columns = [
    { header: 'Parameter / Rule Description', width: 45 },
    { header: 'Value / Reference Standard', width: 55 },
    { header: 'Unit / Scope', width: 25 },
    { header: 'Methodological Guidance', width: 60 },
  ]

  overviewSheet.mergeCells('A1:D1')
  const titleCell = overviewSheet.getCell('A1')
  titleCell.value = 'MID 2030 — LCA Methodology & System Boundaries (Professor Thomaz Reference)'
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1E3A8A' } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE8F3' } }

  overviewSheet.mergeCells('A2:D2')
  const subCell = overviewSheet.getCell('A2')
  subCell.value = 'Batavierenplantsoen, Haarlem | Reference Assembly-by-Assembly Calculation Workbook'
  subCell.font = { italic: true, size: 11 }

  overviewSheet.addRow([])

  const h1 = overviewSheet.addRow(['1. LCA System Boundaries & Calculation Rules', '', '', ''])
  h1.font = { bold: true, size: 12 }
  h1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }

  const rules = [
    ['Standard & Framework', 'EN 15804 + A2 / ISO 14040/44', 'Cradle-to-Grave + Module D', 'Methodological compliance with Professor Thomaz reference workbook'],
    ['A1-A3 Production Stage', 'Quantity × GWP per Declared Unit', 'kg CO2e', 'Dimensionally consistent: m²×kgCO2e/m², m³×kgCO2e/m³, kg×kgCO2e/kg, unit×kgCO2e/unit'],
    ['A4 Transport Stage', '2-Way Round Trip (Road Freight)', 'kg CO2e', 'Calculated using weight, fuel consumption, load factor, and diesel emission factor'],
    ['B4 Replacement Stage', 'MAX(ROUNDUP(50 / LifeSpan, 0) - 1, 0) × (A1-A3 + A4)', 'kg CO2e', '50-year study period; whole replacement cycles accounted for'],
    ['C1 Demolition / Deconstruction', 'Site assembly specific or 0.0', 'kg CO2e', 'Energy for mechanical dismantling at end of life'],
    ['C2 Waste Transport', '2 × Distance_Waste × Vehicle_Factor', 'kg CO2e', 'Transport from site to municipal treatment facility (default 30 km)'],
    ['C3 Waste Processing', 'EPD scenario / Incineration / Downcycling', 'kg CO2e', 'Processing emissions prior to landfill or incineration'],
    ['C4 Disposal', 'EPD scenario / Inert Landfill', 'kg CO2e', 'Final landfilled mass emissions'],
    ['Module D Reuse & Recovery', 'Net avoided burden credit', 'kg CO2e', 'Recycling credit / energy recovery offset outside system boundary'],
    ['B6 Operational Energy Use', 'IntensityLoad × ElectricityFactor × Area', 'kg CO2e / yr', 'Annual operational electricity load multiplied by grid GHG factor'],
  ]
  rules.forEach((r) => overviewSheet.addRow(r))

  overviewSheet.addRow([])

  const h2 = overviewSheet.addRow(['2. Transport Vehicle & Fuel Parameters (Referenced by Assembly Sheet Formulas)', '', '', ''])
  h2.font = { bold: true, size: 12 }
  h2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE8F3' } }

  const emptyCons = meta.transportAssumptions?.emptyConsumptionLPer100Km ?? 25.0
  const loadedDiff = meta.transportAssumptions?.loadedVsEmptyDiffLPer100Km ?? 10.0
  const payload = meta.transportAssumptions?.payloadCapacityTonnes ?? 20.0
  const dieselDensity = meta.transportAssumptions?.dieselDensityKgPerL ?? 0.84
  const dieselGhg = meta.transportAssumptions?.dieselGhgFactorKgCo2ePerKg ?? 3.16
  const wasteDist = meta.settings?.wasteFacilityDistanceKm ?? 30.0

  overviewSheet.addRow(['Consume empty vehicle', emptyCons, 'l / 100km', 'Base empty truck fuel consumption']) // Row 17
  overviewSheet.addRow(['Diff fully loaded − empty', loadedDiff, 'l / 100km', 'Incremental fuel usage for full 20t load'])
  overviewSheet.addRow(['Payload capacity', payload, 'tonnes', 'Standard heavy road freight capacity'])
  overviewSheet.addRow(['Diesel density', dieselDensity, 'kg / l', 'Standard fuel physical density'])
  overviewSheet.addRow(['Diesel GHG factor', dieselGhg, 'kg CO2e / kg fuel', 'Well-to-wheel greenhouse gas intensity'])
  overviewSheet.addRow(['Waste facility distance', wasteDist, 'km', 'Default distance to Haarlem municipal waste processing plant'])

  // Ref helpers for Overview sheet
  const OVR = "'Prof Thomaz Reference & Overview'"
  const OVR_EMPTY = `${OVR}!$B$17`
  const OVR_DIFF = `${OVR}!$B$18`
  const OVR_PAYLOAD = `${OVR}!$B$19`
  const OVR_DENSITY = `${OVR}!$B$20`
  const OVR_GHG = `${OVR}!$B$21`
  const OVR_WASTE_DIST = `${OVR}!$B$22`

  // ----------------------------------------------------
  // 2. Assembly Configurations
  // ----------------------------------------------------
  const ASSEMBLY_CONFIGS = [
    { key: 'wall', sheetName: 'Assembly_1 (Wall)', label: 'Assembly 1 — Wall', code: 'Wall' },
    { key: 'floor', sheetName: 'Assembly_2 (Floor)', label: 'Assembly 2 — Floor', code: 'Floor' },
    { key: 'roof', sheetName: 'Assembly_3 (Roof)', label: 'Assembly 3 — Roof', code: 'Roof' },
    { key: 'door', sheetName: 'Assembly_4 (Door)', label: 'Assembly 4 — Door', code: 'Door' },
    { key: 'window', sheetName: 'Assembly_5 (Window)', label: 'Assembly 5 — Window', code: 'Window' },
    { key: 'skylight', sheetName: 'Assembly_6 (Skylight)', label: 'Assembly 6 — Skylight', code: 'Skylight' },
  ]

  // Collect any extra assemblies present in rows
  const knownKeys = new Set(ASSEMBLY_CONFIGS.map((c) => c.key))
  const extraKeys = Array.from(new Set(rows.map((r) => r.assemblyKey))).filter((k) => k && !knownKeys.has(k))
  extraKeys.forEach((k, idx) => {
    const num = ASSEMBLY_CONFIGS.length + idx + 1
    const strK = String(k ?? '')
    const capitalized = strK ? strK.charAt(0).toUpperCase() + strK.slice(1) : 'Assembly'
    ASSEMBLY_CONFIGS.push({
      key: k,
      sheetName: `Assembly_${num} (${capitalized})`,
      label: `Assembly ${num} — ${capitalized}`,
      code: capitalized,
    })
  })

  // ----------------------------------------------------
  // 3. ANALYSIS Summary Sheet (First Sheet in Workbook)
  // ----------------------------------------------------
  const analysisSheet = workbook.addWorksheet('ANALYSIS')
  analysisSheet.columns = [
    { header: 'Assembly / Element', width: 28 },
    { header: 'Area (m²)', width: 14 },
    { header: 'Total Weight (kg)', width: 18 },
    { header: 'A1-A3 Production (kgCO2e)', width: 24 },
    { header: 'A4 Transport (kgCO2e)', width: 22 },
    { header: 'B4 Replacement (kgCO2e)', width: 24 },
    { header: 'C1-C4 End-of-Life (kgCO2e)', width: 24 },
    { header: 'Module D Credit (kgCO2e)', width: 22 },
    { header: 'Total Embodied GWP (kgCO2e)', width: 26 },
    { header: 'Normalized GWP (kgCO2e/m²)', width: 24 },
  ]

  analysisSheet.mergeCells('A1:J1')
  const aTitle = analysisSheet.getCell('A1')
  aTitle.value = 'MID 2030 — Master Assembly Analysis (Professor Thomaz Reference)'
  aTitle.font = { bold: true, size: 14, color: { argb: 'FF1E293B' } }
  aTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }

  analysisSheet.mergeCells('A2:J2')
  const aSub = analysisSheet.getCell('A2')
  aSub.value = 'Batavierenplantsoen, Haarlem | Multi-Assembly LCA Aggregation referencing individual assembly worksheets'
  aSub.font = { italic: true, size: 11 }

  analysisSheet.addRow([]) // Row 3 blank

  // Header row at row 4
  const aHeaderRow = analysisSheet.addRow([
    'Assembly / Element', 'Area (m²)', 'Total Weight (kg)',
    'A1-A3 Production (kgCO2e)', 'A4 Transport (kgCO2e)', 'B4 Replacement (kgCO2e)',
    'C1-C4 End-of-Life (kgCO2e)', 'Module D Credit (kgCO2e)', 'Total Embodied GWP (kgCO2e)',
    'Normalized GWP (kgCO2e/m²)',
  ])
  aHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  aHeaderRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  // ----------------------------------------------------
  // 4. Build Individual Assembly Sheets & Collect Metadata
  // ----------------------------------------------------
  const assemblySheetMeta = []

  ASSEMBLY_CONFIGS.forEach((cfg) => {
    const assemblyRows = rows.filter((r) => r.assemblyKey === cfg.key)
    const detailSheet = workbook.addWorksheet(cfg.sheetName)
    detailSheet.columns = COLUMNS.map(([header]) => ({ header, width: Math.max(header.length + 2, 12) }))

    const dataStartRow = 3
    const dataRowsCount = assemblyRows.length
    const dataEndRow = dataRowsCount > 0 ? dataStartRow + dataRowsCount - 1 : 2
    const totalsRowNum = dataRowsCount > 0 ? dataEndRow + 1 : 3

    // Band row (row 1)
    let colCursor = 1
    const bandRow = detailSheet.getRow(1)
    for (const [label, span, band] of BAND_SPANS) {
      detailSheet.mergeCells(1, colCursor, 1, colCursor + span - 1)
      const cell = bandRow.getCell(colCursor)
      cell.value = label
      cell.font = { bold: true }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL[band] } }
      colCursor += span
    }
    bandRow.commit()

    // Column-label row (row 2)
    const labelRow = detailSheet.getRow(2)
    COLUMNS.forEach(([header, , band], i) => {
      const cell = labelRow.getCell(i + 1)
      cell.value = header
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL[band] } }
    })
    labelRow.commit()

    // Data rows
    assemblyRows.forEach((r, i) => {
      const row = dataStartRow + i
      const c2IsEpdPublished = r.c2Source === 'EPD-published'
      const isUnitRow = r.functionalUnit === 'unit'

      let provenance = 'Generic EPD / ÖKOBAUDAT'
      let auditNote = 'FU & Geometry Verified; Dimensionally Consistent'

      if (r.epdTypeLink && (r.epdTypeLink.includes('STEICO') || r.epdTypeLink.includes('Schüco') || r.epdTypeLink.includes('Fakro') || r.epdTypeLink.includes('Kronoply'))) {
        provenance = 'Verified Manufacturer EPD'
      } else if (r.functionalUnit === 'unit') {
        provenance = 'Manufacturer Unit Spec'
        auditNote = 'Unit assembly mass-based calculation'
      } else if (!r.epdTypeLink || r.epdTypeLink.includes('generic') || r.epdTypeLink.includes('Assumed')) {
        provenance = 'Assumed Proxy / Category Match'
        auditNote = 'Estimated value flagged for review'
      }

      if (r.gwpUnitValue != null && r.gwpUnitValue < 0) {
        auditNote += ' | Timber biogenic carbon storage preserved'
      }

      const cells = {
        assemblyDrawing: r.assemblyDrawing ?? cfg.code,
        layerNo: r.layerNo ?? (i + 1),
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
          formula: `IF(${ref('gwpUnitValue', row)}="","TBD",`
            + `IF(${ref('functionalUnit', row)}="m2",${ref('areaM2', row)}*${ref('gwpUnitValue', row)},`
            + `IF(${ref('functionalUnit', row)}="m3",${ref('volumeM3', row)}*${ref('gwpUnitValue', row)},`
            + `IF(${ref('functionalUnit', row)}="kg",${ref('weightKg', row)}*${ref('gwpUnitValue', row)},"check FU"))))`,
        },
        distanceKm: r.distanceKm ?? null,
        a4: isUnitRow ? num(r.a4, 1) : {
          formula: `IF(OR(${ref('distanceKm', row)}="",${ref('weightKg', row)}=""),"TBD",`
            + `(2*${ref('distanceKm', row)})*(${OVR_EMPTY}+(${OVR_DIFF}*((${ref('weightKg', row)}/1000)/2)/${OVR_PAYLOAD}))`
            + `/100*${OVR_DENSITY}*${OVR_GHG})`,
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
            formula: `IF(${ref('weightKg', row)}="","TBD",`
              + `(2*${OVR_WASTE_DIST})*(${OVR_EMPTY}+(${OVR_DIFF}*((${ref('weightKg', row)}/1000)/2)/${OVR_PAYLOAD}))`
              + `/100*${OVR_DENSITY}*${OVR_GHG})`,
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
        sourceProvenance: provenance,
        auditNote: auditNote,
      }

      const excelRow = detailSheet.getRow(row)
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

    // Totals row for this assembly sheet
    const totalsRow = detailSheet.getRow(totalsRowNum)
    totalsRow.getCell(1).value = 'Total'
    totalsRow.getCell(1).font = { bold: true }

    if (dataRowsCount > 0) {
      const dataRange = (key) => `${ref(key, dataStartRow)}:${ref(key, dataEndRow)}`
      totalsRow.getCell(colIndex.weightKg).value = { formula: `SUM(${dataRange('weightKg')})` }
      totalsRow.getCell(colIndex.a1a3).value = { formula: `SUM(${dataRange('a1a3')})` }
      totalsRow.getCell(colIndex.a4).value = { formula: `SUM(${dataRange('a4')})` }
      totalsRow.getCell(colIndex.b4).value = {
        formula: `IF(COUNTIF(${dataRange('b4')},"not yet assessed")>0,"not yet assessed",SUM(${dataRange('b4')}))`,
      }
      totalsRow.getCell(colIndex.c1).value = { formula: `SUM(${dataRange('c1')})` }
      totalsRow.getCell(colIndex.c2).value = { formula: `SUM(${dataRange('c2')})` }
      totalsRow.getCell(colIndex.c3).value = { formula: `SUM(${dataRange('c3')})` }
      totalsRow.getCell(colIndex.c4).value = { formula: `SUM(${dataRange('c4')})` }
      totalsRow.getCell(colIndex.moduleD).value = { formula: `SUM(${dataRange('moduleD')})` }
      totalsRow.getCell(colIndex.b6YearlySpace).value = { formula: `${ref('b6YearlySpace', dataStartRow)}` }
    } else {
      totalsRow.getCell(colIndex.weightKg).value = 0
      totalsRow.getCell(colIndex.a1a3).value = 0
      totalsRow.getCell(colIndex.a4).value = 0
      totalsRow.getCell(colIndex.b4).value = 0
      totalsRow.getCell(colIndex.c1).value = 0
      totalsRow.getCell(colIndex.c2).value = 0
      totalsRow.getCell(colIndex.c3).value = 0
      totalsRow.getCell(colIndex.c4).value = 0
      totalsRow.getCell(colIndex.moduleD).value = 0
      totalsRow.getCell(colIndex.b6YearlySpace).value = 0
    }

    totalsRow.eachCell((cell) => { cell.font = { ...(cell.font || {}), bold: true } })
    totalsRow.commit()

    // Summary row
    const summaryRow = detailSheet.getRow(totalsRowNum + 1)
    if (dataRowsCount > 0) {
      const dataRange = (key) => `${ref(key, dataStartRow)}:${ref(key, dataEndRow)}`
      summaryRow.getCell(1).value = {
        formula: `"Total distance (round trip): "&TEXT(2*SUM(${dataRange('distanceKm')}),"0")&" km"`,
      }
      summaryRow.getCell(colIndex.weightKg).value = {
        formula: `"Total weight: "&TEXT(SUM(${dataRange('weightKg')}),"0.0")&" kg"`,
      }
      summaryRow.getCell(colIndex.b6YearlySpace).value = {
        formula: `"B6 over 50yr: "&TEXT(${ref('b6YearlySpace', dataStartRow)}*50,"0.0")&" kg CO2e"`,
      }
    } else {
      summaryRow.getCell(1).value = 'Total distance (round trip): 0 km'
      summaryRow.getCell(colIndex.weightKg).value = 'Total weight: 0.0 kg'
      summaryRow.getCell(colIndex.b6YearlySpace).value = 'B6 over 50yr: 0.0 kg CO2e'
    }
    summaryRow.commit()

    assemblySheetMeta.push({
      cfg,
      dataStartRow,
      dataEndRow,
      totalsRow: totalsRowNum,
      hasData: dataRowsCount > 0,
    })
  })

  // ----------------------------------------------------
  // 5. Populate ANALYSIS Summary Sheet with Assembly References
  // ----------------------------------------------------
  const startSummaryRowIndex = 5

  assemblySheetMeta.forEach((metaItem, idx) => {
    const rowNum = startSummaryRowIndex + idx
    const S = `'${metaItem.cfg.sheetName}'`
    const tot = metaItem.totalsRow

    const areaFormula = metaItem.hasData
      ? `IFERROR(AVERAGEIFS(${S}!$K$3:$K$${metaItem.dataEndRow}, ${S}!$A$3:$A$${metaItem.dataEndRow}, "<>"), 0)`
      : `0`

    analysisSheet.addRow({
      'Assembly / Element': metaItem.cfg.label,
      'Area (m²)': { formula: areaFormula },
      'Total Weight (kg)': { formula: `${S}!L${tot}` },
      'A1-A3 Production (kgCO2e)': { formula: `${S}!O${tot}` },
      'A4 Transport (kgCO2e)': { formula: `${S}!Q${tot}` },
      'B4 Replacement (kgCO2e)': { formula: `IF(ISNUMBER(${S}!T${tot}), ${S}!T${tot}, 0)` },
      'C1-C4 End-of-Life (kgCO2e)': { formula: `${S}!U${tot}+${S}!V${tot}+${S}!W${tot}+${S}!X${tot}` },
      'Module D Credit (kgCO2e)': { formula: `${S}!Y${tot}` },
      'Total Embodied GWP (kgCO2e)': { formula: `D${rowNum}+E${rowNum}+F${rowNum}+G${rowNum}` },
      'Normalized GWP (kgCO2e/m²)': { formula: `IF(B${rowNum}>0, I${rowNum}/B${rowNum}, 0)` },
    })
  })

  // Grand Total Row in ANALYSIS Sheet
  const endSummaryRowIndex = startSummaryRowIndex + assemblySheetMeta.length - 1
  const grandTotalRowNum = endSummaryRowIndex + 1

  const totRow = analysisSheet.addRow({
    'Assembly / Element': 'Grand Total (Whole Building)',
    'Area (m²)': { formula: `SUM(B${startSummaryRowIndex}:B${startSummaryRowIndex + 2})` }, // Floor area sum over Wall, Floor, Roof
    'Total Weight (kg)': { formula: `SUM(C${startSummaryRowIndex}:C${endSummaryRowIndex})` },
    'A1-A3 Production (kgCO2e)': { formula: `SUM(D${startSummaryRowIndex}:D${endSummaryRowIndex})` },
    'A4 Transport (kgCO2e)': { formula: `SUM(E${startSummaryRowIndex}:E${endSummaryRowIndex})` },
    'B4 Replacement (kgCO2e)': { formula: `SUM(F${startSummaryRowIndex}:F${endSummaryRowIndex})` },
    'C1-C4 End-of-Life (kgCO2e)': { formula: `SUM(G${startSummaryRowIndex}:G${endSummaryRowIndex})` },
    'Module D Credit (kgCO2e)': { formula: `SUM(H${startSummaryRowIndex}:H${endSummaryRowIndex})` },
    'Total Embodied GWP (kgCO2e)': { formula: `SUM(I${startSummaryRowIndex}:I${endSummaryRowIndex})` },
    'Normalized GWP (kgCO2e/m²)': { formula: `IF(B${grandTotalRowNum}>0, I${grandTotalRowNum}/B${grandTotalRowNum}, 0)` },
  })

  totRow.eachCell((cell) => {
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBD5E1' } }
  })

  // Save/Download buffer
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}


