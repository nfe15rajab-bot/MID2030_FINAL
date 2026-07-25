// Pools saved layer stacks across all 6 sections and derives a
// deduplicated, discipline-grouped view of every material actually used in
// the project. The "Materials and Providers" tab's browse list and the
// materials summary Excel export (materialsSummaryExcel.js) both read
// through this single implementation, so they can never drift from each
// other — same "one pooling loop, many consumers" reasoning sectionStorage
// data has always needed, just not previously factored out of
// ProvidersTab.jsx's own local usePooledLayers.
import { loadSection, saveSection } from './sectionStorage.js'

export const SECTIONS = ['wall', 'roof', 'floor', 'door', 'window', 'skylight']
export const UNCLASSIFIED_DISCIPLINE = 'Unclassified (live search)'

/**
 * @param {Record<string, object>} materialById
 * @returns {{ bySection: Record<string, object|null>, pooled: Array }}
 */
export function poolAllLayers(materialById) {
  const bySection = {}
  const pooled = []
  for (const section of SECTIONS) {
    const record = loadSection(section)
    bySection[section] = record
    if (!record) continue
    for (const layer of record.layers) {
      const material = layer.materialId ? materialById[layer.materialId] : null
      pooled.push({
        ...layer,
        section,
        owner: record.owner,
        discipline: material?.discipline ?? UNCLASSIFIED_DISCIPLINE,
      })
    }
  }
  return { bySection, pooled }
}

// One-off Ökobaudat picks (materialId == null) still need a stable dedup
// key — okobaudatUrl identifies the actual dataset picked, so two layers
// that picked the exact same Ökobaudat entry really are the same material
// and should merge; two different picks that just happen to render the
// same free-text name must NOT merge, which is why this never falls back
// to name alone (database/materials.json itself has genuine name
// collisions — e.g. two different ids both named "Kronoply OSB/3 Panel" —
// so name is never a safe identity key on its own).
function dedupeKey(layer) {
  return layer.materialId ?? layer.okobaudatUrl ?? `instance:${layer.instanceId}`
}

/**
 * Collapses pooled layer instances down to one row per unique material —
 * the "no duplicates" view: a material used in both the wall and the roof
 * shows up once, with both uses recorded in `sections`/`owners`.
 * @param {Array} pooled - from poolAllLayers().pooled
 * @returns {Array} deduped rows, each carrying the fields of its first-seen
 *   layer instance plus aggregated sections/owners/instanceCount.
 */
export function dedupeMaterials(pooled) {
  const byKey = new Map()
  for (const layer of pooled) {
    const key = dedupeKey(layer)
    let row = byKey.get(key)
    if (!row) {
      row = {
        key,
        instanceId: layer.instanceId,
        materialId: layer.materialId ?? null,
        name: layer.name,
        discipline: layer.discipline,
        thicknessMM: layer.thicknessMM,
        densityKgM3: layer.densityKgM3,
        thermalConductivityWmK: layer.thermalConductivityWmK,
        gwpA1A3PerFunctionalUnit: layer.gwpA1A3PerFunctionalUnit,
        gwpConfidenceLabel: layer.gwpConfidenceLabel ?? null,
        instanceCount: 0,
        sections: [],
        owners: [],
      }
      byKey.set(key, row)
    }
    row.instanceCount += 1
    if (!row.sections.includes(layer.section)) row.sections.push(layer.section)
    if (layer.owner && !row.owners.includes(layer.owner)) row.owners.push(layer.owner)
  }
  return Array.from(byKey.values())
}

/** Groups deduped rows by discipline — same grouping key the tab has always used. */
export function groupByDiscipline(rows) {
  const grouped = {}
  for (const row of rows) {
    grouped[row.discipline] ??= []
    grouped[row.discipline].push(row)
  }
  return grouped
}

/**
 * Patches every already-saved layer instance (across all 6 sections) whose
 * materialId matches, with new λ/GWP/density values. This is what makes a
 * correction reach layers that were saved BEFORE the correction existed —
 * materialsCatalog.js's getAllMaterials() override merge only affects
 * layers picked AFTER. Only re-saves sections that actually changed.
 * @param {string} materialId
 * @param {{ thermalConductivityWmK?: number|null, gwpA1A3PerFunctionalUnit?: number|null, densityKgM3?: number|null }} patch
 * @returns {{ layersUpdated: number, sectionsTouched: string[] }}
 */
export function pushMaterialValuesToLayers(materialId, patch) {
  let layersUpdated = 0
  const sectionsTouched = []
  for (const section of SECTIONS) {
    const record = loadSection(section)
    if (!record) continue
    let changed = false
    const nextLayers = record.layers.map((layer) => {
      if (layer.materialId !== materialId) return layer
      changed = true
      layersUpdated += 1
      return { ...layer, ...patch }
    })
    if (changed) {
      saveSection(section, { ...record, layers: nextLayers })
      sectionsTouched.push(section)
    }
  }
  return { layersUpdated, sectionsTouched }
}
