// EPD (Environmental Product Declaration) reference list — the
// "Environmental Product Declarations" deliverable: a short, citable
// list of materials with a REAL source (an actual Ökobaudat process, or
// an AI-suggested GWP value the user accepted with its grounded source
// URL kept). Deliberately NOT the same thing as raw material research
// notes — a material whose GWP was just typed in from a datasheet by
// hand (materials.json's epdSource text field, e.g. "STEICO technical
// data sheet") has no clickable/checkable source and is excluded here,
// even though it's a legitimate value elsewhere in the app.
import { loadSection } from './sectionStorage.js'
import { getAllMaterials } from './materialsCatalog.js'
import { analyzeLcaAssembly } from './lcaAnalysis.js'
import { buildLayerCalculationSteps } from './calculationNarrative.js'
import defaultLayersBySection from '../../database/defaultLayers.json'

const SECTIONS = ['wall', 'roof', 'floor', 'door', 'window', 'skylight']

// One usage's worked A1-A3 calculation — "how this EPD's declared value
// became this project's actual number", the same step buildLayerCalculationSteps
// produces for the A4 report's per-assembly table, just picked out here
// since A1-A3 is the one figure every EPD entry always has.
function usageFromLayerResult(section, layerResult) {
  if (!layerResult) return { section, layerName: null, calc: null }
  const a1a3Step = buildLayerCalculationSteps(section, layerResult).find((s) => s.module === 'A1-A3')
  return { section, layerName: layerResult.name, calc: a1a3Step ?? null }
}

export function getEpdReferenceList() {
  const materialById = Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))
  const entriesByKey = new Map()

  for (const section of SECTIONS) {
    const record = loadSection(section)
    const layers = record?.layers && record.layers.length > 0 ? record.layers : (defaultLayersBySection[section] ?? [])
    if (layers.length === 0) continue
    const lcaResult = analyzeLcaAssembly(section)
    const layerResultByInstanceId = Object.fromEntries((lcaResult.layerResults ?? []).map((l) => [l.instanceId, l]))

    for (const layer of layers) {
      const layerResult = layerResultByInstanceId[layer.instanceId]

      // Ökobaudat-sourced (live search pick) — okobaudatUrl is set directly
      // on the layer by onOkobaudatSelect (LayerBuilder.jsx), a real citable
      // process page.
      if (layer.okobaudatUrl) {
        const key = `okobaudat:${layer.okobaudatUrl}`
        if (!entriesByKey.has(key)) {
          entriesByKey.set(key, {
            material: layer.name,
            sourceUrl: layer.okobaudatUrl,
            sourceType: 'Ökobaudat',
            gwpValue: layer.gwpA1A3PerFunctionalUnit,
            declaredUnit: null, // not currently stored on the layer — see materialAutofillClient/onOkobaudatSelect
            section,
            usages: [],
          })
        }
        entriesByKey.get(key).usages.push(usageFromLayerResult(section, layerResult))
        continue
      }

      // A real clickable source URL, either from an AI-Suggest value the
      // user accepted (LayerBuilder.jsx's onFieldAccept — meta.sourceUrl)
      // or from a catalog material's own researched gwpSourceUrl
      // (materialToLayerFields, database/materials.json) — same field,
      // two legitimate origins, so the label reflects gwpConfidenceLabel's
      // own real description (both paths set it) rather than assuming
      // "AI-verified" unconditionally.
      if (layer.gwpSource) {
        const key = `src:${layer.gwpSource}:${layer.name}`
        if (!entriesByKey.has(key)) {
          const material = layer.materialId ? materialById[layer.materialId] : null
          entriesByKey.set(key, {
            material: layer.name,
            sourceUrl: layer.gwpSource,
            sourceType: layer.gwpConfidenceLabel || 'Verified source',
            gwpValue: layer.gwpA1A3PerFunctionalUnit,
            declaredUnit: material?.functionalUnit ?? null,
            section,
            usages: [],
          })
        }
        // A single citable source can back several layer instances (e.g.
        // the same Kronoply OSB EPD used 3× in Wall at the same thickness,
        // or reused across assemblies at a different one) — every usage
        // gets its own worked calculation, not just the first instance
        // found, since a later one may have a different thickness/quantity.
        entriesByKey.get(key).usages.push(usageFromLayerResult(section, layerResult))
      }
    }
  }

  return Array.from(entriesByKey.values())
}
