// Step-by-step calculation narration for the A4 report and EPD deliverable
// — "show the formula with the real numbers substituted in", not just the
// final result. Deliberately reuses lcaAnalysis.js's own exported
// deriveQuantity plus each layerResult's already-computed fields (a1a3,
// massKg, distanceKm, a4CO2Kg, b4, c1/c2/c3/c4/moduleD) rather than
// recomputing any of the math a second time — narration can never drift
// from the real numbers because it's built FROM them, not alongside them.
import { deriveQuantity, UNIT_ASSEMBLY_KEYS } from './lcaAnalysis.js'
import { getAllMaterials } from './materialsCatalog.js'
import { loadAssemblyGeometry } from './assemblyGeometryStorage.js'
import { TRANSPORT_ASSUMPTIONS } from './transport.js'
import { SURFACE_RESISTANCE } from './uvalue.js'

// Fixed 'en-US' locale (not `undefined`/the browser's own locale) — this
// report already formats every other number with a period decimal
// (toFixed(), used throughout A4ReportDraft.jsx/deliverablesData.js), and
// letting toLocaleString fall back to the browser's locale produced a
// comma decimal ("0,0125") that looked like a second, disagreeing number
// format in the same document.
function fmt(n, digits = 2) {
  if (n == null || !Number.isFinite(n)) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

const FUNCTIONAL_UNIT_LABEL = { m2: 'm²', m3: 'm³', kg: 'kg', unit: 'unit(s)' }

/**
 * One layer's full worked calculation — U-value contribution, then every
 * lifecycle module that has a formula (Quantity, A1-A3, A4, B4). C1-C4/D
 * are researched figures rather than formulas (except C2, itself a
 * transport-formula calc), so they get one summary row instead of a
 * derivation.
 *
 * @param {string} assemblyKey
 * @param {object} layerResult - one entry from analyzeLcaAssembly(assemblyKey).layerResults
 * @returns {Array<{module: string, formula: string|null, substituted: string|null, result: string, note: string|null}>}
 */
export function buildLayerCalculationSteps(assemblyKey, layerResult) {
  const allMaterials = getAllMaterials()
  const material = layerResult.materialId ? allMaterials.find((m) => m.id === layerResult.materialId) : null
  const functionalUnit = material?.functionalUnit ?? null
  const unitLabel = FUNCTIONAL_UNIT_LABEL[functionalUnit] ?? functionalUnit ?? '?'
  const isUnitAssembly = UNIT_ASSEMBLY_KEYS.has(assemblyKey)
  const geometry = loadAssemblyGeometry(assemblyKey)
  const areaM2 = isUnitAssembly ? 1 : (geometry?.surfaceAreaM2 !== '' && geometry?.surfaceAreaM2 != null ? Number(geometry.surfaceAreaM2) : null)
  const thicknessM = layerResult.thicknessMM != null ? layerResult.thicknessMM / 1000 : null

  const { quantity, missing: quantityMissing } = deriveQuantity(
    { thicknessMM: layerResult.thicknessMM, densityKgM3: layerResult.densityKgM3, count: layerResult.count },
    material,
    geometry,
    isUnitAssembly
  )

  const steps = []

  // --- U-value contribution (R = thickness / λ, DIN EN ISO 6946) ---
  if (!isUnitAssembly) {
    if (thicknessM != null && layerResult.thermalConductivityWmK > 0) {
      const r = thicknessM / layerResult.thermalConductivityWmK
      steps.push({
        module: 'R-value',
        formula: 'R = thickness / λ',
        substituted: `R = ${fmt(thicknessM, 4)} m / ${fmt(layerResult.thermalConductivityWmK, 3)} W/mK`,
        result: `${fmt(r, 4)} m²K/W`,
        note: 'Added to Rsi + Rse + every other layer\'s R for the assembly U-value — see Section 4\'s U-value line.',
      })
    } else {
      steps.push({ module: 'R-value', formula: null, substituted: null, result: '—', note: 'Missing thickness or λ' })
    }
  }

  // --- Quantity ---
  if (functionalUnit === 'unit') {
    steps.push({
      module: 'Quantity',
      formula: 'Quantity = count installed',
      substituted: `Quantity = ${layerResult.count ?? 1}`,
      result: `${fmt(quantity, 0)} unit(s)`,
      note: null,
    })
  } else if (functionalUnit === 'm2') {
    const coverage = material?.linearCoverage ?? 1
    const coverageSuffix = coverage !== 1 ? ` × ${fmt(coverage, 4)} linear coverage` : ''
    steps.push({
      module: 'Quantity',
      formula: coverage !== 1 ? 'Quantity = declared area basis × linear coverage' : 'Quantity = declared area basis',
      substituted: isUnitAssembly
        ? `Quantity = 1 m²${coverageSuffix} (per-installation basis — no Part A floor area applies to Door/Window/Skylight)`
        : `Quantity = assembly floor area = ${fmt(areaM2, 1)} m²${coverageSuffix} (Part A)`,
      result: quantity != null ? `${fmt(quantity, 3)} m²` : '—',
      note: quantityMissing,
    })
  } else if (functionalUnit === 'm3') {
    const coverage = material?.linearCoverage ?? 1
    const coverageSuffix = coverage !== 1 ? ` × ${fmt(coverage, 4)} linear coverage` : ''
    steps.push({
      module: 'Quantity',
      formula: coverage !== 1 ? 'Quantity = Area × Thickness × linear coverage' : 'Quantity = Area × Thickness',
      substituted: areaM2 != null && thicknessM != null ? `Quantity = ${fmt(areaM2, 1)} m² × ${fmt(thicknessM, 4)} m${coverageSuffix}` : null,
      result: quantity != null ? `${fmt(quantity, 4)} m³` : '—',
      note: quantityMissing,
    })
  } else if (functionalUnit === 'kg') {
    const coverage = material?.linearCoverage ?? 1
    const coverageSuffix = coverage !== 1 ? ` × ${fmt(coverage, 4)} linear coverage` : ''
    steps.push({
      module: 'Quantity',
      formula: coverage !== 1 ? 'Quantity = Area × Thickness × Density × linear coverage' : 'Quantity = Area × Thickness × Density',
      substituted: areaM2 != null && thicknessM != null && layerResult.densityKgM3 != null
        ? `Quantity = ${fmt(areaM2, 1)} m² × ${fmt(thicknessM, 4)} m × ${fmt(layerResult.densityKgM3, 0)} kg/m³${coverageSuffix}`
        : null,
      result: quantity != null ? `${fmt(quantity, 1)} kg` : '—',
      note: quantityMissing,
    })
  } else {
    steps.push({ module: 'Quantity', formula: null, substituted: null, result: '—', note: quantityMissing ?? 'functional unit unknown' })
  }

  // --- A1-A3 ---
  if (layerResult.a1a3 != null) {
    steps.push({
      module: 'A1-A3',
      formula: 'A1-A3 = GWP unit value × Quantity',
      substituted: `A1-A3 = ${fmt(layerResult.gwpA1A3PerFunctionalUnit, 3)} kg CO₂e/${unitLabel} × ${fmt(quantity, 3)} ${unitLabel}`,
      result: `${fmt(layerResult.a1a3, 1)} kg CO₂e`,
      note: null,
    })
  } else {
    steps.push({ module: 'A1-A3', formula: null, substituted: null, result: '—', note: `Not computed: ${layerResult.a1a3Missing ?? 'missing input'}` })
  }

  // --- A4 (DIN EN ISO 14083 — real formula, transport.js) ---
  if (layerResult.a4CO2Kg != null && layerResult.massKg != null && layerResult.distanceKm != null) {
    const tonnes = layerResult.massKg / 1000
    const { emptyConsumptionLPer100Km, loadedVsEmptyDiffLPer100Km, payloadCapacityTonnes, dieselDensityKgPerL, dieselGhgFactorKgCo2ePerKg } = TRANSPORT_ASSUMPTIONS
    const litresPer100Km = emptyConsumptionLPer100Km + (loadedVsEmptyDiffLPer100Km * (tonnes / 2)) / payloadCapacityTonnes
    const roundTripKm = 2 * layerResult.distanceKm
    const litres = (roundTripKm / 100) * litresPer100Km
    steps.push({
      module: 'A4',
      formula: 'Rate = Empty L/100km + (Δload × (t/2) / payload t); Litres = (2×distance/100) × Rate; A4 = Litres × diesel density × diesel GHG factor',
      substituted: `Rate = ${emptyConsumptionLPer100Km} + (${loadedVsEmptyDiffLPer100Km} × (${fmt(tonnes, 3)}/2) / ${payloadCapacityTonnes}) = ${fmt(litresPer100Km, 3)} L/100km · ` +
        `Litres = (2 × ${fmt(layerResult.distanceKm, 1)} / 100) × ${fmt(litresPer100Km, 3)} = ${fmt(litres, 2)} L · ` +
        `A4 = ${fmt(litres, 2)} L × ${dieselDensityKgPerL} kg/L × ${dieselGhgFactorKgCo2ePerKg} kg CO₂e/kg`,
      result: `${fmt(layerResult.a4CO2Kg, 1)} kg CO₂e`,
      note: `Mass = ${fmt(layerResult.massKg, 1)} kg · one-way routed distance = ${fmt(layerResult.distanceKm, 1)} km (${layerResult.distanceSource ?? 'source not recorded'})`,
    })
  } else {
    steps.push({ module: 'A4', formula: null, substituted: null, result: '—', note: `Not computed: ${layerResult.massMissing ?? layerResult.distanceMissing ?? 'missing input'}` })
  }

  // --- B4 (replacement) ---
  if (layerResult.b4 != null) {
    steps.push({
      module: 'B4',
      formula: 'Replacements = CEILING(50 / service life) − 1; B4 = Replacements × (A1-A3 + A4)',
      substituted: `Replacements = CEILING(50 / ${layerResult.serviceLifeYears}) − 1 = ${layerResult.b4ReplacementCount} · ` +
        `B4 = ${layerResult.b4ReplacementCount} × (${fmt(layerResult.a1a3, 1)} + ${fmt(layerResult.a4CO2Kg, 1)})`,
      result: `${fmt(layerResult.b4, 1)} kg CO₂e`,
      note: null,
    })
  } else {
    steps.push({ module: 'B4', formula: null, substituted: null, result: '—', note: `Not computed: ${layerResult.b4Missing ?? 'missing input'}` })
  }

  // --- End-of-life (C1-C4, Module D) — researched figures, not derived
  // formulas, except C2 which reuses the exact A4 transport formula above
  // with the shared waste-facility distance instead of the provider route.
  const eolParts = []
  const eolTierLabel = layerResult.eolSource === 'epd' ? 'EPD-sourced' : layerResult.eolSource === 'ai' ? 'AI-sourced' : 'manual assumption'
  if (layerResult.c1 != null) eolParts.push(`C1 = ${fmt(layerResult.c1, 2)} kg CO₂e (${eolTierLabel})`)
  if (layerResult.c2 != null) eolParts.push(`C2 = ${fmt(layerResult.c2, 2)} kg CO₂e (${layerResult.c2Source ?? 'computed'})`)
  if (layerResult.c3 != null) eolParts.push(`C3 = ${fmt(layerResult.c3, 2)} kg CO₂e (${eolTierLabel})`)
  if (layerResult.c4 != null) eolParts.push(`C4 = ${fmt(layerResult.c4, 2)} kg CO₂e (${eolTierLabel})`)
  if (layerResult.moduleD != null) eolParts.push(`Module D = ${fmt(layerResult.moduleD, 2)} kg CO₂e (recovery credit, ${eolTierLabel})`)
  steps.push({
    module: 'C1-C4/D',
    formula: 'Researched per material (EPD or reasoned assumption); C2 uses the same DIN EN ISO 14083 formula as A4 above, with the shared waste-facility distance instead of the provider route',
    substituted: eolParts.length > 0 ? eolParts.join(' · ') : null,
    result: eolParts.length > 0 ? 'see substituted values' : '—',
    note: eolParts.length === 0 ? 'Not yet modeled' : null,
  })

  return steps
}

/**
 * Assembly-level U-value roll-up: Rsi + Rse + Σ(layer R) → U = 1/R_total.
 * Recomputes R_total itself from each layer's thickness/λ (same formula
 * uvalue.js uses, same imported Rsi/Rse constants) purely to narrate the
 * breakdown — the displayed U-value is still the real one passed in via
 * `uValue`, never a second independently-derived figure.
 */
export function buildUValueAssemblyStep(assemblyKey, layerResults, uValue) {
  const { rsi, rse } = SURFACE_RESISTANCE[assemblyKey] ?? SURFACE_RESISTANCE.wall
  const validLayers = layerResults.filter((l) => l.thicknessMM != null && l.thermalConductivityWmK > 0)
  const layerRs = validLayers.map((l) => l.thicknessMM / 1000 / l.thermalConductivityWmK)
  const rTotal = rsi + rse + layerRs.reduce((sum, r) => sum + r, 0)
  const layerRLabels = validLayers.map((l) => `${fmt(l.thicknessMM / 1000, 4)}/${fmt(l.thermalConductivityWmK, 3)}`)
  return {
    formula: 'R_total = Rsi + Rse + Σ(thickness / λ); U = 1 / R_total',
    substituted: `R_total = ${rsi} + ${rse} + (${layerRLabels.join(' + ')}) = ${fmt(rTotal, 3)} m²K/W`,
    result: uValue != null ? `U = 1 / ${fmt(rTotal, 3)} = ${fmt(uValue, 3)} W/m²K` : '—',
  }
}
