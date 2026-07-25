// Assembles one row per saved layer, matching the exact column layout of
// the class's own "Architectural Elements Description" / LCA phase
// spreadsheet (see SpreadsheetTab.jsx / spreadsheetExcelExport.js) —
// reuses lcaAnalysis.js's already-computed A1-A3/A4/B4/C1-C4/D per layer
// rather than re-deriving any of it, so this can never drift from what
// the LCA Summary / LCA and EPD tabs show for the same layer. The
// computed layerResult alone doesn't carry raw fields this table also
// needs (thickness, density, materialId, the per-unit GWP value) — those
// come from the matching raw saved layer, zipped in by index (layerResults
// is built via layers.map(), so the order always lines up).
import { ASSEMBLIES, analyzeLcaAssembly, calculateB6 } from './lcaAnalysis.js'
import { loadSection } from './sectionStorage.js'
import { getAllMaterials } from './materialsCatalog.js'
import { loadFicheDetail } from './ficheStorage.js'
import { findProvidersForMaterial } from './geo.js'
import { loadOperationalEnergySettings } from './operationalEnergyStorage.js'
import { TRANSPORT_ASSUMPTIONS } from './transport.js'
import providers from '../../database/providers.json'
import referenceLocations from '../../database/reference-locations.json'
import defaultLayersBySection from '../../database/defaultLayers.json'

const IN_SCOPE_SECTIONS = ASSEMBLIES.filter((a) => a.inScope).map((a) => a.key)

/**
 * One row per saved layer across Wall/Roof/Floor, in the exact shape the
 * spreadsheet tab/export need. Re-derived fresh on every call (no
 * caching) — same "always reflects what's actually saved" rule as every
 * other analysis function in this app.
 */
export function getSpreadsheetRows() {
  const materialById = Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))
  const settings = loadOperationalEnergySettings()
  const rows = []

  for (const key of IN_SCOPE_SECTIONS) {
    const result = analyzeLcaAssembly(key)
    if (!result.hasData) continue
    const recordLayers = loadSection(key)?.layers
    const rawLayers = recordLayers && recordLayers.length > 0 ? recordLayers : (defaultLayersBySection[key] ?? [])

    result.layerResults.forEach((layer, index) => {
      const raw = rawLayers[index] ?? {}
      const material = raw.materialId ? materialById[raw.materialId] : null
      const fiche = raw.materialId ? loadFicheDetail(raw.materialId) : null
      const { closestToSite } = raw.materialId
        ? findProvidersForMaterial(raw.materialId, providers, referenceLocations)
        : { closestToSite: null }

      const areaM2 = result.geometry?.surfaceAreaM2 !== '' ? Number(result.geometry?.surfaceAreaM2) : null
      const thicknessM = raw.thicknessMM != null ? raw.thicknessMM / 1000 : null
      const volumeM3 = areaM2 != null && thicknessM != null ? areaM2 * thicknessM : null

      const intensityLoad = settings.intensityLoad
      const electricityFactor = settings.electricityGwpFactor
      const b6PerM2Yearly = intensityLoad != null && electricityFactor != null ? intensityLoad * electricityFactor : null
      const b6YearlySpace = b6PerM2Yearly != null && settings.conditionedFloorAreaM2 != null
        ? b6PerM2Yearly * settings.conditionedFloorAreaM2
        : null

      rows.push({
        assemblyKey: key,
        assemblyDrawing: result.label,
        layerNo: index + 1,
        // "Layer Name" = the role/category (e.g. "Cladding"), "Material"
        // = the specific product — matches the template's own example
        // row ("Wind Barrier" as layer name vs. an actual product as
        // material), not this app's own layer.name (which is really the
        // material name, no separate role concept exists here).
        layerName: material?.discipline || material?.category || '—',
        layerDescription: fiche?.specs || '',
        material: layer.name,
        company: closestToSite?.name || fiche?.providerName || '—',
        epdTypeLink: raw.okobaudatUrl || (fiche?.endOfLifeSource ?? 'specific'),
        thicknessMM: raw.thicknessMM ?? null,
        densityKgM3: raw.densityKgM3 ?? null,
        volumeM3,
        areaM2,
        weightKg: layer.massKg,
        functionalUnit: material?.functionalUnit ?? null,
        gwpUnitValue: raw.gwpA1A3PerFunctionalUnit ?? null,
        a1a3: layer.a1a3,
        distanceKm: layer.distanceKm,
        a4: layer.a4CO2Kg,
        lifeSpanYears: layer.serviceLifeYears,
        replacementCount: layer.b4ReplacementCount,
        b4: layer.b4,
        c1: layer.c1,
        c2: layer.c2,
        c2Source: layer.c2Source,
        c3: layer.c3,
        c4: layer.c4,
        moduleD: layer.moduleD,
        intensityLoad,
        electricityFactor,
        b6PerM2Yearly,
        conditionedFloorAreaM2: settings.conditionedFloorAreaM2,
        b6YearlySpace,
      })
    })
  }

  return rows
}

/** Shared constants shown once (not per-row) — Operational Energy settings + the fixed transport vehicle assumptions (group2_v2!B2:B7, see transport.js). */
export function getSpreadsheetMeta() {
  const settings = loadOperationalEnergySettings()
  const b6Result = calculateB6()
  return {
    settings,
    b6Total: b6Result.b6,
    transportAssumptions: TRANSPORT_ASSUMPTIONS,
  }
}
