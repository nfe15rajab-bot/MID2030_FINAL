import ExcelJS from 'exceljs'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import providers from '../../database/providers.json'
import referenceLocations from '../../database/reference-locations.json'
import defaultLayersBySection from '../../database/defaultLayers.json'
import { loadSection } from './sectionStorage.js'
import { getAllMaterials } from './materialsCatalog.js'
import { findProvidersForMaterial } from './geo.js'
import { SECTIONS, UNCLASSIFIED_DISCIPLINE } from './materialsSummary.js'

function providerInfoFor(materialId) {
  if (!materialId) return { name: null, distanceToDetmoldKm: null }
  const { closestToSite } = findProvidersForMaterial(materialId, providers, referenceLocations)
  return {
    name: closestToSite?.name ?? null,
    distanceToDetmoldKm: closestToSite?.distanceToDetmoldKm != null ? Math.round(closestToSite.distanceToDetmoldKm) : null,
  }
}

/**
 * Pools layers across all 6 sections (using saved records or default fallback layers)
 * and evaluates complete value provenance (Referenced vs Assumed vs Missing).
 */
export function getHinalMaterialAuditData() {
  const materials = getAllMaterials()
  const materialById = Object.fromEntries(materials.map((m) => [m.id, m]))

  const pooledLayers = []
  for (const section of SECTIONS) {
    const record = loadSection(section)
    const layers = record?.layers && record.layers.length > 0 ? record.layers : (defaultLayersBySection[section] ?? [])
    for (const layer of layers) {
      const material = layer.materialId ? materialById[layer.materialId] : null
      pooledLayers.push({
        ...layer,
        section,
        owner: record?.owner || null,
        discipline: material?.discipline ?? UNCLASSIFIED_DISCIPLINE,
      })
    }
  }

  // Deduplicate materials by key
  const byKey = new Map()
  for (const layer of pooledLayers) {
    const key = layer.materialId ?? layer.okobaudatUrl ?? `instance:${layer.instanceId}`
    let row = byKey.get(key)
    if (!row) {
      const material = layer.materialId ? materialById[layer.materialId] : null
      const provider = providerInfoFor(layer.materialId)

      // Determine GWP status and source
      const gwpVal = layer.gwpA1A3PerFunctionalUnit ?? material?.gwpA1A3PerFunctionalUnit ?? null
      const gwpSource = layer.okobaudatUrl || layer.gwpSource || material?.gwpSourceUrl || material?.epdSource || null
      let gwpProvenance = 'Missing'
      let gwpStatusLabel = 'MISSING GWP'
      if (layer.okobaudatUrl || material?.okobaudatUUID) {
        gwpProvenance = 'Referenced'
        gwpStatusLabel = 'Referenced (Ökobaudat EPD)'
      } else if (layer.gwpSource || material?.gwpSourceUrl || (material?.epdSource && String(material.epdSource).toLowerCase().includes('epd'))) {
        gwpProvenance = 'Referenced'
        gwpStatusLabel = 'Referenced (EPD / Source)'
      } else if (gwpVal != null) {
        gwpProvenance = 'Assumed'
        gwpStatusLabel = 'Assumed (Generic / AI)'
      }

      // Determine Lambda status
      const lambdaVal = layer.thermalConductivityWmK ?? material?.thermalConductivityWmK ?? null
      let lambdaProvenance = 'Missing'
      let lambdaStatusLabel = 'MISSING LAMBDA'
      if (lambdaVal != null) {
        if (material?.thermalConductivityWmK != null) {
          lambdaProvenance = 'Referenced'
          lambdaStatusLabel = 'Referenced (Datasheet)'
        } else {
          lambdaProvenance = 'Assumed'
          lambdaStatusLabel = 'Assumed (Standard)'
        }
      }

      // Determine Density status
      const densityVal = layer.densityKgM3 ?? material?.densityKgM3 ?? null
      let densityProvenance = 'Missing'
      let densityStatusLabel = 'MISSING DENSITY'
      if (densityVal != null) {
        if (material?.densityKgM3 != null) {
          densityProvenance = 'Referenced'
          densityStatusLabel = 'Referenced (Datasheet)'
        } else {
          densityProvenance = 'Assumed'
          densityStatusLabel = 'Assumed (Estimated)'
        }
      }

      // Manufacturer status
      const mfr = material?.manufacturer || null
      const isMfrReferenced = mfr && !String(mfr).toLowerCase().includes('generic') && !String(mfr).toLowerCase().includes('unassigned')
      const mfrStatusLabel = isMfrReferenced ? `Referenced (${mfr})` : (mfr ? `Assumed (${mfr})` : 'Assumed (Unassigned Brand)')

      // Provider status
      let providerProvenance = 'Missing'
      let providerStatusLabel = 'MISSING PROVIDER — Action required'
      if (provider.name) {
        providerProvenance = 'Referenced'
        providerStatusLabel = `${provider.name} (${provider.distanceToDetmoldKm} km)`
      } else if (material?.providerLocation) {
        providerProvenance = 'Assumed'
        providerStatusLabel = `Location: ${material.providerLocation} (Supplier missing)`
      }

      // Missing values checklist & action plan
      const actionItems = []
      if (providerProvenance === 'Missing') actionItems.push('Add Provider & Distance')
      if (gwpProvenance === 'Missing' || gwpProvenance === 'Assumed') actionItems.push('Find EPD / Verify GWP')
      if (lambdaProvenance === 'Missing') actionItems.push('Add Lambda λ')
      if (densityProvenance === 'Missing') actionItems.push('Add Density')
      actionItems.push('Search Material Image')

      // Overall material status
      let overallStatus = 'Assumed / Needs Verification'
      if (gwpProvenance === 'Referenced' && lambdaProvenance === 'Referenced' && providerProvenance === 'Referenced') {
        overallStatus = 'Fully Referenced (Verified)'
      } else if (gwpProvenance === 'Referenced' || lambdaProvenance === 'Referenced' || providerProvenance === 'Referenced') {
        overallStatus = 'Partially Referenced'
      }

      row = {
        key,
        materialId: layer.materialId ?? null,
        name: layer.name,
        discipline: layer.discipline,
        category: material?.category ?? '',
        thicknessMM: layer.thicknessMM ?? material?.thicknessMM ?? null,
        densityKgM3: densityVal,
        densityProvenance,
        densityStatusLabel,
        thermalConductivityWmK: lambdaVal,
        lambdaProvenance,
        lambdaStatusLabel,
        gwpA1A3PerFunctionalUnit: gwpVal,
        gwpProvenance,
        gwpStatusLabel,
        gwpSourceUrl: gwpSource,
        functionalUnit: material?.functionalUnit ?? 'm³',
        manufacturer: mfr ?? 'Generic / Unassigned',
        manufacturerStatus: mfrStatusLabel,
        enNorm: material?.enNorm ?? '—',
        providerName: provider.name ?? 'Unassigned',
        providerDistanceKm: provider.distanceToDetmoldKm,
        providerStatus: providerProvenance,
        providerStatusLabel,
        sections: [],
        owners: [],
        imageSearchStatus: 'Pending Image Search (Hinal)',
        actionItems,
        overallStatus,
        notes: material?.notes ?? '',
      }
      byKey.set(key, row)
    }

    if (!row.sections.includes(layer.section)) row.sections.push(layer.section)
    if (layer.owner && !row.owners.includes(layer.owner)) row.owners.push(layer.owner)
  }

  const allRows = Array.from(byKey.values()).sort(
    (a, b) => (a.discipline || '').localeCompare(b.discipline || '') || (a.name || '').localeCompare(b.name || '')
  )

  // Group by discipline
  const groupedByDiscipline = {}
  for (const r of allRows) {
    groupedByDiscipline[r.discipline] ??= []
    groupedByDiscipline[r.discipline].push(r)
  }

  // Calculate summary stats
  const totalMaterials = allRows.length
  const fullyReferencedCount = allRows.filter((r) => r.overallStatus.startsWith('Fully Referenced')).length
  const partiallyReferencedCount = allRows.filter((r) => r.overallStatus.startsWith('Partially Referenced')).length
  const assumedCount = allRows.filter((r) => r.overallStatus.startsWith('Assumed')).length
  const missingProvidersCount = allRows.filter((r) => r.providerStatus === 'Missing').length
  const missingEpdCount = allRows.filter((r) => r.gwpProvenance !== 'Referenced').length

  return {
    rows: allRows,
    groupedByDiscipline,
    stats: {
      totalMaterials,
      fullyReferencedCount,
      partiallyReferencedCount,
      assumedCount,
      missingProvidersCount,
      missingEpdCount,
    },
  }
}

/**
 * Generates an Excel spreadsheet (.xlsx) specifically tailored for Hinal's Material Audit & Image Research.
 */
export async function exportHinalMaterialAuditExcel(filename = 'Hinal_Material_Audit_and_Image_Research_Sheet.xlsx') {
  const { rows, groupedByDiscipline, stats } = getHinalMaterialAuditData()

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'MID 2030 — Material Audit Tool for Hinal'
  workbook.created = new Date()

  // Sheet 1: Material Audit & Image Search Checklist
  const sheet = workbook.addWorksheet('Material Audit & Images')

  // Add Header Metadata Box
  sheet.mergeCells('A1:U1')
  sheet.getCell('A1').value = "MID 2030 — HINAL'S MATERIAL AUDIT, VALUE PROVENANCE & IMAGE RESEARCH SHEET"
  sheet.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' }
  sheet.getRow(1).height = 32

  sheet.mergeCells('A2:U2')
  sheet.getCell('A2').value =
    `Project: Batavierenplantsoen, Haarlem | Total Unique Materials: ${stats.totalMaterials} | ` +
    `Fully Referenced: ${stats.fullyReferencedCount} | Partially Referenced: ${stats.partiallyReferencedCount} | ` +
    `Assumed/Needs Review: ${stats.assumedCount} | Missing Providers: ${stats.missingProvidersCount}`
  sheet.getCell('A2').font = { size: 10, italic: true, color: { argb: 'FF334155' } }
  sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' }
  sheet.getRow(2).height = 22

  // Table Column Headers
  const HEADERS = [
    'Discipline',
    'Material Name',
    'Category / Role',
    'Thickness (mm)',
    'Density (kg/m³)',
    'Density Provenance',
    'Lambda λ (W/mK)',
    'Lambda Provenance',
    'GWP A1-A3 (kg CO₂e/unit)',
    'Unit',
    'GWP Provenance & Source',
    'EPD / Source Link',
    'Manufacturer',
    'EN Norm',
    'Closest Provider',
    'Distance to Detmold (km)',
    'Provider Status',
    'Sections Used In',
    'Material Image Search Status',
    'Missing Values & Action Items',
    'Overall Status',
  ]

  sheet.getRow(4).values = HEADERS
  sheet.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }
  sheet.getRow(4).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  sheet.getRow(4).height = 28

  let rowIndex = 5
  const disciplines = Object.keys(groupedByDiscipline).sort()

  for (const disc of disciplines) {
    // Discipline Section Header
    const discRow = sheet.getRow(rowIndex)
    discRow.values = [`DISCIPLINE: ${disc.toUpperCase()}`]
    sheet.mergeCells(`A${rowIndex}:U${rowIndex}`)
    discRow.font = { bold: true, color: { argb: 'FF0F172A' }, size: 11 }
    discRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
    discRow.height = 24
    rowIndex++

      for (const r of groupedByDiscipline[disc]) {
        const row = sheet.getRow(rowIndex)
        const sectionsStr = Array.isArray(r.sections) ? r.sections.join(', ') : ''
        const actionItemsStr = Array.isArray(r.actionItems) ? r.actionItems.join(' | ') : ''
        const overallStatusStr = String(r.overallStatus || '')

        row.values = [
          r.discipline ?? '',
          r.name ?? '',
          r.category ?? '',
          r.thicknessMM ?? '—',
          r.densityKgM3 ?? '—',
          r.densityStatusLabel ?? '',
          r.thermalConductivityWmK ?? '—',
          r.lambdaStatusLabel ?? '',
          r.gwpA1A3PerFunctionalUnit ?? '—',
          r.functionalUnit ?? '—',
          r.gwpStatusLabel ?? '',
          r.gwpSourceUrl || r.notes || '—',
          r.manufacturer ?? '—',
          r.enNorm ?? '—',
          r.providerName ?? '—',
          r.providerDistanceKm ?? '—',
          r.providerStatusLabel ?? '',
          sectionsStr,
          r.imageSearchStatus ?? '',
          actionItemsStr,
          overallStatusStr,
        ]

        // Highlight status cells
        const overallCell = row.getCell(21)
        if (overallStatusStr.startsWith('Fully Referenced')) {
          overallCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } } // Green
          overallCell.font = { color: { argb: 'FF166534' }, bold: true }
        } else if (overallStatusStr.startsWith('Partially Referenced')) {
          overallCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } } // Yellow
          overallCell.font = { color: { argb: 'FF854D0E' }, bold: true }
        } else {
          overallCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } } // Red
          overallCell.font = { color: { argb: 'FF991B1B' }, bold: true }
        }

        // Highlight provider cell if missing
        const providerCell = row.getCell(17)
        if (r.providerStatus === 'Missing') {
          providerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
          providerCell.font = { color: { argb: 'FF991B1B' } }
        }

        row.height = 20
        rowIndex++
      }
  }

  // Adjust column widths
  sheet.columns.forEach((col, i) => {
    col.width = Math.max(HEADERS[i].length + 4, 15)
  })
  sheet.getColumn(2).width = 30 // Material Name
  sheet.getColumn(11).width = 28 // GWP Status
  sheet.getColumn(12).width = 32 // Link
  sheet.getColumn(20).width = 35 // Action Items

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
