// Excel round-trip for the Materials and Providers tab's deduplicated
// materials summary — a SEPARATE workbook from spreadsheetExcelExport.js's
// group2_v2-locked push (never touch that layout, see its own header
// comment). One row per unique material (materialsSummary.js's
// dedupeMaterials output), grouped by discipline.
//
// Round-trip scope: importing this file back in only decomposes
// material-level data — it updates the shared material database (via
// aiMaterialDataStorage.js overrides, or a brand new custom material) and
// propagates λ/GWP/density into layers that ALREADY reference that
// material. It deliberately does not attempt to reconstruct whole
// wall/roof/etc. layer stacks from a flat table — sessionExport.js's JSON
// export/import already covers full-session backup/restore.
import ExcelJS from 'exceljs'
import providers from '../../database/providers.json'
import referenceLocations from '../../database/reference-locations.json'
import { findProvidersForMaterial } from './geo.js'
import { getAllMaterials } from './materialsCatalog.js'
import { saveMaterialData } from './aiMaterialDataStorage.js'
import { addCustomMaterial, buildCustomMaterial } from './customMaterialStorage.js'
import { pushMaterialValuesToLayers } from './materialsSummary.js'

const HEADERS = [
  'Material ID', 'Discipline', 'Category', 'Material Name', 'Manufacturer', 'EN Norm',
  'Thickness (mm)', 'Density (kg/m3)', 'Lambda (W/mK)', 'GWP A1-A3', 'Functional Unit',
  'Provider Name', 'Distance to Detmold (km)', 'Sections Used', 'Layer Count', 'Owner(s)', 'Notes',
]

function providerInfoFor(materialId) {
  if (!materialId) return { name: '', distanceToDetmoldKm: '' }
  const { closestToSite } = findProvidersForMaterial(materialId, providers, referenceLocations)
  return {
    name: closestToSite?.name ?? '',
    distanceToDetmoldKm: closestToSite?.distanceToDetmoldKm != null ? Math.round(closestToSite.distanceToDetmoldKm) : '',
  }
}

/**
 * @param {Array} rows - dedupeMaterials() output
 * @param {Record<string, object>} materialById - id -> merged material record (getAllMaterials()-sourced)
 */
export async function exportMaterialsSummaryExcel(rows, materialById, filename = 'materials-and-providers-summary.xlsx') {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'MID 2030 — Model 1 Assembly Builder'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Materials Summary')
  sheet.columns = HEADERS.map((header) => ({ header, width: Math.max(header.length + 2, 12) }))
  sheet.getRow(1).font = { bold: true }
  // Kept for re-import matching, not meant to be read/edited by hand.
  sheet.getColumn(1).hidden = true

  const sorted = [...rows].sort(
    (a, b) => (a.discipline || '').localeCompare(b.discipline || '') || (a.name || '').localeCompare(b.name || '')
  )

  for (const row of sorted) {
    const material = row.materialId ? materialById[row.materialId] : null
    const provider = providerInfoFor(row.materialId)
    sheet.addRow([
      row.materialId ?? '',
      row.discipline ?? '',
      material?.category ?? '',
      row.name ?? '',
      material?.manufacturer ?? '',
      material?.enNorm ?? '',
      row.thicknessMM ?? '',
      row.densityKgM3 ?? '',
      row.thermalConductivityWmK ?? '',
      row.gwpA1A3PerFunctionalUnit ?? '',
      material?.functionalUnit ?? '',
      provider.name,
      provider.distanceToDetmoldKm,
      row.sections.join(', '),
      row.instanceCount,
      row.owners.join(', '),
      material?.notes ?? '',
    ])
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

// Cell values can come back as plain primitives, Date objects, hyperlink
// objects ({text, hyperlink}), or formula-result objects ({formula,
// result}) — unwrap defensively rather than trusting a plain string/number,
// since a hand-edited cell in Excel can end up any of these shapes.
function cellText(value) {
  if (value == null) return ''
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString()
    if ('result' in value) return cellText(value.result)
    if ('text' in value) return cellText(value.text)
    return ''
  }
  return String(value).trim()
}

/** Reads and parses a materials summary .xlsx File. Throws if it doesn't look like one of our own exports. */
export async function parseMaterialsSummaryExcelFile(file) {
  const buffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('No worksheet found in this file.')

  const colForHeader = {}
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const header = cellText(cell.value)
    if (header) colForHeader[header] = colNumber
  })
  for (const required of ['Material ID', 'Discipline', 'Category', 'Material Name']) {
    if (!colForHeader[required]) {
      throw new Error(`Missing expected column "${required}" — is this a Materials and Providers export?`)
    }
  }

  function get(row, header) {
    const col = colForHeader[header]
    return col ? cellText(row.getCell(col).value) : ''
  }
  function getNum(row, header) {
    const v = get(row, header)
    if (v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const rows = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const name = get(row, 'Material Name')
    if (!name) return // skip blank rows
    rows.push({
      materialId: get(row, 'Material ID') || null,
      discipline: get(row, 'Discipline'),
      category: get(row, 'Category'),
      name,
      manufacturer: get(row, 'Manufacturer'),
      enNorm: get(row, 'EN Norm'),
      thicknessMM: getNum(row, 'Thickness (mm)'),
      densityKgM3: getNum(row, 'Density (kg/m3)'),
      thermalConductivityWmK: getNum(row, 'Lambda (W/mK)'),
      gwpA1A3PerFunctionalUnit: getNum(row, 'GWP A1-A3'),
      functionalUnit: get(row, 'Functional Unit') || 'm3',
      notes: get(row, 'Notes'),
    })
  })
  return rows
}

/**
 * Decomposes parsed rows back into app state — see this file's header
 * comment for exactly what "decompose" means here (material database +
 * existing layers, not whole section reconstruction).
 * @returns {{ materialsUpdated: number, materialsCreated: number, layersUpdated: number, sectionsTouched: string[], skipped: number }}
 */
export function applyMaterialsSummaryImport(rows, enteredBy) {
  const materialById = Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))

  let materialsUpdated = 0
  let materialsCreated = 0
  let layersUpdated = 0
  let skipped = 0
  const sectionsTouched = new Set()

  for (const row of rows) {
    const existing = row.materialId ? materialById[row.materialId] : null

    if (existing) {
      const patch = {}
      if (row.thermalConductivityWmK != null && row.thermalConductivityWmK !== existing.thermalConductivityWmK) {
        saveMaterialData({ id: existing.id, name: existing.name }, 'lambda', {
          value: row.thermalConductivityWmK, tier: 'manual-entry', enteredBy,
        })
        patch.thermalConductivityWmK = row.thermalConductivityWmK
      }
      if (row.gwpA1A3PerFunctionalUnit != null && row.gwpA1A3PerFunctionalUnit !== existing.gwpA1A3PerFunctionalUnit) {
        saveMaterialData({ id: existing.id, name: existing.name }, 'gwp', {
          value: row.gwpA1A3PerFunctionalUnit, tier: 'manual-entry', enteredBy,
        })
        patch.gwpA1A3PerFunctionalUnit = row.gwpA1A3PerFunctionalUnit
      }
      if (row.densityKgM3 != null && row.densityKgM3 !== existing.densityKgM3) {
        saveMaterialData({ id: existing.id, name: existing.name }, 'density', {
          value: row.densityKgM3, tier: 'manual-entry', enteredBy,
        })
        patch.densityKgM3 = row.densityKgM3
      }
      if (Object.keys(patch).length > 0) {
        materialsUpdated += 1
        const result = pushMaterialValuesToLayers(existing.id, patch)
        layersUpdated += result.layersUpdated
        result.sectionsTouched.forEach((s) => sectionsTouched.add(s))
      }
      continue
    }

    if (row.materialId) {
      // Had an id, but it's not in the current catalog (e.g. exported from
      // a different session/browser) — safer to skip than to guess and
      // silently create a near-duplicate under a stale id.
      skipped += 1
      continue
    }

    if (row.name && row.category && row.discipline) {
      addCustomMaterial(buildCustomMaterial({
        name: row.name,
        category: row.category,
        discipline: row.discipline,
        manufacturer: row.manufacturer,
        enNorm: row.enNorm,
        thicknessMM: row.thicknessMM,
        densityKgM3: row.densityKgM3,
        thermalConductivityWmK: row.thermalConductivityWmK,
        gwpA1A3PerFunctionalUnit: row.gwpA1A3PerFunctionalUnit,
        functionalUnit: row.functionalUnit,
      }))
      materialsCreated += 1
    } else {
      skipped += 1
    }
  }

  return {
    materialsUpdated,
    materialsCreated,
    layersUpdated,
    sectionsTouched: Array.from(sectionsTouched),
    skipped,
  }
}
