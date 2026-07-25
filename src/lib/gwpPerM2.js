// Properly thickness/density-scaled GWP A1-A3 per 1m² of an assembly —
// the real formula (matching deriveQuantity in lcaAnalysis.js), just with
// area pinned to 1m² instead of gated on Part A's real assembly area,
// which most people looking at a layer stack haven't entered yet. Shared
// by LayerBuilder.jsx's live summary table and AssemblyAnalysisTab.jsx's
// GWP bar chart (previously two separate call sites, one of which —
// the bar chart — was still using the raw, un-scaled
// gwpA1A3PerFunctionalUnit value directly, which is exactly what made a
// 50mm and a 260mm layer of the same m3-declared material chart as
// identical bars despite a 5.2x real difference; extracted here once so
// neither can drift back to that again).
//
// m² materials use the declared value as-is; m³ materials multiply by
// thickness; kg materials multiply by thickness × density. Ökobaudat
// picks and any layer whose catalog material lacks a functionalUnit are
// correctly left out (null) rather than guessed.
export function gwpPerM2ForLayer(layer, allMaterials) {
  const material = allMaterials.find((m) => m.id === layer.materialId)
  const functionalUnit = material?.functionalUnit ?? null
  const thicknessM = layer.thicknessMM != null ? layer.thicknessMM / 1000 : null
  const gwp = layer.gwpA1A3PerFunctionalUnit
  // A discrete/linear element (edge trim, counter-batten, etc.) declared
  // as if it uniformly covered the whole assembly — linearCoverage (0-1)
  // is the real area fraction it actually occupies, same field/reasoning
  // as lcaAnalysis.js's deriveQuantity, kept in sync so the UI's live
  // preview and the authoritative calc engine can't disagree. Defaults to
  // 1 (no discount) for every material that doesn't set it.
  const coverage = material?.linearCoverage ?? 1

  // Door/Window/Skylight's own product layer (role: 'unit') — no area
  // concept applies; this is already the layer's whole contribution
  // (gwp × how many are installed), not a "per m²" figure. Callers that
  // go on to multiply by assembly area (assemblyAnalysis.js) must skip
  // that step for 'unit' layers specifically — see gwpTotalForLayers.
  if (functionalUnit === 'unit' && gwp != null) return gwp * (layer.count ?? 1)
  if (functionalUnit === 'm2' && gwp != null) return gwp * coverage
  if (functionalUnit === 'm3' && gwp != null && thicknessM != null) return gwp * thicknessM * coverage
  if (functionalUnit === 'kg' && gwp != null && thicknessM != null) {
    const density = layer.densityKgM3 ?? material?.densityKgM3 ?? null
    return density != null ? gwp * thicknessM * density * coverage : null
  }
  return null
}

/** @returns {{ breakdown: {instanceId, name, perM2: number|null}[], known: same[], total: number }} */
export function gwpPerM2ForLayers(layers, allMaterials) {
  const breakdown = layers.map((l) => ({
    instanceId: l.instanceId,
    name: l.name,
    perM2: gwpPerM2ForLayer(l, allMaterials),
  }))
  const known = breakdown.filter((l) => l.perM2 != null)
  const total = known.reduce((sum, l) => sum + l.perM2, 0)
  return { breakdown, known, total }
}

/**
 * The assembly's real total GWP A1-A3 — gwpPerM2ForLayer's per-layer
 * figure, scaled by the assembly's real floor area for m2/m3/kg-declared
 * layers (wall/roof/floor), left as-is for 'unit'-declared layers
 * (door/window/skylight's own product, already a whole-unit figure that
 * an "area" would double-count). areaM2 null falls back to 1 — an
 * honest "per m²" figure, same convention as gwpPerM2ForLayers, rather
 * than silently treating unset geometry as zero.
 *
 * @returns {{ breakdown: {instanceId, name, value: number|null}[], known: same[], total: number, areaUsed: number }}
 */
export function gwpTotalForLayers(layers, allMaterials, areaM2) {
  const area = areaM2 != null && areaM2 !== '' && Number.isFinite(Number(areaM2)) ? Number(areaM2) : 1
  const breakdown = layers.map((l) => {
    const material = allMaterials.find((m) => m.id === l.materialId)
    const perM2 = gwpPerM2ForLayer(l, allMaterials)
    const value = perM2 == null ? null : (material?.functionalUnit === 'unit' ? perM2 : perM2 * area)
    return { instanceId: l.instanceId, name: l.name, value }
  })
  const known = breakdown.filter((l) => l.value != null)
  const total = known.reduce((sum, l) => sum + l.value, 0)
  return { breakdown, known, total, areaUsed: area }
}
