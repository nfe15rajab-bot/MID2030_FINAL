// Part B (A1-A3) + Part C (A4) + Parts D/E (B4, C&D, normalization) for
// the LCA and EPD tab. Pulls only from data that already exists in the
// app — sectionStorage layers, the materials catalog, providers.json/
// geo.js, the fiche's manual provider fallback — plus the two new
// manually-entered geometry fields (Part A). Never estimates a missing
// number; every gap is named per-layer rather than silently defaulted,
// since this feeds a graded Excel file.
import { loadSection } from './sectionStorage.js'
import { getAllMaterials } from './materialsCatalog.js'
import { loadAssemblyGeometry } from './assemblyGeometryStorage.js'
import { loadFicheDetail } from './ficheStorage.js'
import { findProvidersForMaterial } from './geo.js'
import { estimateTransportCO2, getDetmoldToHaarlemKm } from './transport.js'
import { loadOperationalEnergySettings } from './operationalEnergyStorage.js'
import providers from '../../database/providers.json'
import referenceLocations from '../../database/reference-locations.json'
import defaultLayersBySection from '../../database/defaultLayers.json'
import { DEFAULT_SECTION_OWNERS } from '../data/teamMembers.js'

const getMaterialById = (id) => getAllMaterials().find((m) => m.id === id)

// Door/Window/Skylight are single manufactured units, not layer stacks —
// they're stored as a `layers` array too (one "unit" layer,
// functionalUnit: 'unit', plus zero or more installation-membrane
// layers), specifically so this whole analysis pipeline works for them
// unchanged. See UnitAssemblyBuilder.jsx (the editor for these three) and
// deriveQuantity/deriveMassKg's 'unit' branches below.
export const ASSEMBLIES = [
  { key: 'wall', label: 'Wall', inScope: true },
  { key: 'roof', label: 'Roof', inScope: true },
  { key: 'floor', label: 'Floor', inScope: true },
  { key: 'door', label: 'Door', inScope: true },
  { key: 'window', label: 'Window', inScope: true },
  { key: 'skylight', label: 'Skylight', inScope: true },
]

// Door/Window/Skylight have no Part A floor area — their membrane layers
// (installation tape, flashing, sealing strips, etc.) are per-installation,
// not per-square-meter of the building, so deriveQuantity/deriveMassKg
// below use an implicit area of 1 for them instead of gating on a Part A
// entry that structurally can't exist for a single manufactured unit. Same
// convention gwpPerM2.js already uses on the UI side (LayerBuilder,
// AssemblyAnalysisTab, etc.) — kept consistent so the spreadsheet/LCA tab
// and the editor's own live numbers can't disagree.
export const UNIT_ASSEMBLY_KEYS = new Set(['door', 'window', 'skylight'])

/**
 * Quantity of the material actually present in this layer, in the units
 * its own GWP figure is declared per (m2/m3/kg/unit) — NOT a generic
 * physical quantity. Returns { quantity, missing } — missing is a short
 * reason string, never a guess.
 */
export function deriveQuantity(layer, material, geometry, isUnitAssembly) {
  const functionalUnit = material?.functionalUnit ?? null
  const thicknessM = layer.thicknessMM != null ? layer.thicknessMM / 1000 : null

  if (!functionalUnit) {
    return { quantity: null, missing: 'functional unit unknown (not in local catalog — likely a live Ökobaudat pick)' }
  }

  // Door/Window/Skylight's own "unit" layer — quantity is how many are
  // actually installed, not a geometry-derived figure, so this branch
  // deliberately doesn't touch Part A's surface area at all.
  if (functionalUnit === 'unit') {
    return { quantity: layer.count ?? 1, missing: null }
  }

  // A Door/Window/Skylight's own membrane layers (see UNIT_ASSEMBLY_KEYS
  // above) — no Part A area applies, so quantity is this membrane's own
  // per-installation figure (area pinned to 1) rather than blocked on an
  // entry that can never be made for these assemblies.
  const areaM2 = isUnitAssembly
    ? 1
    : (geometry.surfaceAreaM2 !== '' ? Number(geometry.surfaceAreaM2) : null)
  if (areaM2 == null) {
    return { quantity: null, missing: 'assembly surface area not entered (Part A)' }
  }

  // A discrete/linear element (edge trim, counter-batten, etc.) declared
  // per m2/m3/kg "as if" it uniformly covered the whole assembly area —
  // linearCoverage (0-1) is the real fraction of the area it actually
  // occupies, set on a material that documents its own coverage estimate
  // in `notes` (e.g. roof-aluminum-profile-3mm). Defaults to 1 (no
  // discount) for every material that doesn't set it.
  const coverage = material?.linearCoverage ?? 1

  if (functionalUnit === 'm2') {
    return { quantity: areaM2 * coverage, missing: null }
  }
  if (functionalUnit === 'm3') {
    if (thicknessM == null) return { quantity: null, missing: 'thickness' }
    return { quantity: areaM2 * thicknessM * coverage, missing: null }
  }
  if (functionalUnit === 'kg') {
    if (thicknessM == null) return { quantity: null, missing: 'thickness' }
    const density = layer.densityKgM3 ?? material?.densityKgM3 ?? null
    if (density == null) return { quantity: null, missing: 'density' }
    return { quantity: areaM2 * thicknessM * density * coverage, missing: null }
  }
  return { quantity: null, missing: `unsupported functional unit "${functionalUnit}"` }
}

/**
 * Mass in kg for the transport calc — physical, independent of the
 * material's own declared GWP unit. For a 'unit' layer (Door/Window/
 * Skylight's own product, or their membrane sub-layers if one happens to
 * be unit-declared too) there's no area/thickness to derive it from, so
 * this is a directly-entered per-unit weight × count instead.
 */
function deriveMassKg(layer, material, geometry, isUnitAssembly) {
  const functionalUnit = material?.functionalUnit ?? null

  if (functionalUnit === 'unit') {
    const massKgPerUnit = layer.massKgPerUnit ?? material?.massKgPerUnit ?? null
    if (massKgPerUnit == null) return { massKg: null, missing: 'mass per unit' }
    return { massKg: massKgPerUnit * (layer.count ?? 1), missing: null }
  }

  // Same Part-A-doesn't-apply reasoning as deriveQuantity above, for a
  // Door/Window/Skylight's own membrane layers.
  const areaM2 = isUnitAssembly
    ? 1
    : (geometry.surfaceAreaM2 !== '' ? Number(geometry.surfaceAreaM2) : null)
  const thicknessM = (layer.thicknessMM ?? material?.thicknessMM) != null ? (layer.thicknessMM ?? material.thicknessMM) / 1000 : null
  const density = layer.densityKgM3 ?? material?.densityKgM3 ?? null
  // Same linearCoverage discount as deriveQuantity above, applied to mass
  // too — a trim that's only "really there" over 1.5% of the area
  // shouldn't be transported/land-filled as if it weighed 100%'s worth.
  const coverage = material?.linearCoverage ?? 1

  if (areaM2 == null) return { massKg: null, missing: 'assembly surface area not entered (Part A)' }
  if (thicknessM == null) return { massKg: null, missing: 'thickness' }
  if (density == null) return { massKg: null, missing: 'density' }
  return { massKg: areaM2 * thicknessM * density * coverage, missing: null }
}

/**
 * Total ONE-WAY routed distance for A4 (manufacturer -> Detmold ->
 * Haarlem), matching group2_v2's own R = P + Q (mfr->Detmold + the fixed
 * Detmold->Haarlem leg) — NOT a direct manufacturer->Haarlem distance,
 * since the real transport formula (transport.js) assumes routing
 * through Detmold.
 */
function deriveDistanceKm(layer, material) {
  if (!layer.materialId) return { distanceKm: null, missing: 'no material id (live Ökobaudat pick — no provider link possible)' }

  // Detmold->Haarlem is a single fixed leg shared by every material — real
  // routed distance if someone's fetched it once (OperationalEnergySettings.jsx's
  // "Get real route" button), else the class spreadsheet's own 370km
  // assumption. Computed once here rather than per-branch below.
  const detmoldToHaarlem = getDetmoldToHaarlemKm()
  const detmoldToHaarlemLabel = detmoldToHaarlem.source === 'routed'
    ? 'real road route via OpenRouteService'
    : "the class spreadsheet's 370km assumption — use \"Get real route\" in Operational Energy settings for the real figure"

  const { closestToSite } = findProvidersForMaterial(layer.materialId, providers, referenceLocations)
  if (closestToSite) {
    const legLabel = closestToSite.distanceToDetmoldKmSource === 'routed'
      ? 'real road route via OpenRouteService'
      : 'straight-line estimate — use "Get real route" in Materials and Providers tab for an accurate figure'
    return {
      distanceKm: closestToSite.distanceToDetmoldKm + detmoldToHaarlem.distanceKm,
      missing: null,
      source: `providers.json, manufacturer→Detmold leg is a ${legLabel}; Detmold→Haarlem leg is ${detmoldToHaarlemLabel}`,
    }
  }

  // Materials seeded from group2_v2 (see database/defaultLayers.json)
  // carry their own manufacturer->Detmold distance directly on the
  // catalog record (column P in the source sheet) — no providers.json
  // entry needed for these to feed a real, routed-via-Detmold A4.
  if (material?.distanceToDetmoldKm != null) {
    return {
      distanceKm: material.distanceToDetmoldKm + detmoldToHaarlem.distanceKm,
      missing: null,
      source: `materials.json (from group2_v2), Detmold→Haarlem leg is ${detmoldToHaarlemLabel}`,
    }
  }

  const fiche = loadFicheDetail(layer.materialId)

  // FicheTechniquePanel.jsx auto-computes this (haversine, geo.js) the
  // moment a provider location is pinned — manufacturer->Detmold leg,
  // same routing shape as the providers.json/materials.json cases above.
  // Prefer it over the direct-to-Haarlem fallback below whenever it's
  // available, since it's the real routed distance, not an
  // acknowledged-inaccurate stand-in for it.
  const detmoldLegKm = fiche?.providerDistanceToDetmoldKm !== '' && fiche?.providerDistanceToDetmoldKm != null
    ? Number(fiche.providerDistanceToDetmoldKm)
    : null
  if (detmoldLegKm != null && Number.isFinite(detmoldLegKm)) {
    return {
      distanceKm: detmoldLegKm + detmoldToHaarlem.distanceKm,
      missing: null,
      source: `fiche (manual/AI-researched provider location), Detmold→Haarlem leg is ${detmoldToHaarlemLabel}`,
    }
  }

  // Fallback for fiches saved before providerDistanceToDetmoldKm existed,
  // or where only a manually-typed Haarlem figure was ever entered (no
  // pinned location to compute the Detmold leg from) — a DIRECT distance,
  // not routed via Detmold. Using it as-is understates the real routed
  // distance; flagged rather than silently treated as equivalent to the
  // cases above.
  const manualKm = fiche?.providerDistanceKm !== '' && fiche?.providerDistanceKm != null ? Number(fiche.providerDistanceKm) : null
  if (manualKm != null && Number.isFinite(manualKm)) {
    return {
      distanceKm: manualKm,
      missing: null,
      source: 'fiche (manual/AI-researched) — direct to Haarlem, NOT routed via Detmold, likely understates A4',
    }
  }

  return {
    distanceKm: null,
    missing: 'no provider match in providers.json, and no manual/AI-researched distance in the fiche — use "Suggest provider" there',
  }
}

// Reference study period — same 50 years already used for the
// normalized (kg CO2e/m²/yr) total below, per the class brief.
export const REFERENCE_STUDY_PERIOD_YEARS = 50

/**
 * B4 (replacement) per layer: replacementCount = CEILING(50/serviceLife) - 1
 * (0 once a material's own service life already covers the full 50-year
 * period — a real zero, not "not assessed"), then B4 = replacementCount ×
 * (A1-A3 + A4) for that layer. Needs both A1-A3 and A4 already resolved —
 * computing B4 from a partial/zero A1-A3 or A4 would silently understate
 * it, same "never estimate a missing number" rule as everywhere else here.
 */
function deriveB4(serviceLifeYears, a1a3, a4CO2Kg) {
  if (serviceLifeYears == null || !Number.isFinite(serviceLifeYears) || serviceLifeYears <= 0) {
    return { b4: null, replacementCount: null, missing: 'service life' }
  }
  if (a1a3 == null || a4CO2Kg == null) {
    return { b4: null, replacementCount: null, missing: 'A1-A3/A4 (needed to compute B4)' }
  }
  const replacementCount = Math.max(Math.ceil(REFERENCE_STUDY_PERIOD_YEARS / serviceLifeYears) - 1, 0)
  return { b4: replacementCount * (a1a3 + a4CO2Kg), replacementCount, missing: null }
}

/**
 * End-of-life modules C1 (deconstruction), C2 (transport to waste
 * processing), C3 (waste processing), C4 (disposal), and D (recycling/
 * reuse credit) per layer — see EndOfLifeImpactField.jsx for the 3-tier
 * fill (EPD/AI/manual) that produces C1/C3/C4/D. Each is independently
 * "not yet modeled" (null) rather than zero until its own tier fills it
 * in — same rule B4 follows. C2 is the one exception: it's never
 * researched, always computed here from real mass + the shared
 * waste-facility distance using the identical DIN EN ISO 14083 formula
 * A4 already uses (transport.js) — unless a real EPD happened to publish
 * its own C2 figure, which takes priority since it's grounded in the
 * product's actual data rather than this app's generic distance estimate.
 */
function deriveEolImpact(layer, material, massKg, wasteFacilityDistanceKm) {
  const c1 = layer.eolC1 ?? material?.eolC1 ?? 0
  const c3 = layer.eolC3 ?? material?.eolC3 ?? 0
  const c4 = layer.eolC4 ?? material?.eolC4 ?? 0
  const rawModuleD = layer.eolModuleD ?? material?.eolModuleD ?? 0
  // Defensive re-check — the server already rejects a positive module D,
  // and the manual entry input caps at 0, but neither is a hard guarantee
  // (e.g. an older saved layer from before that validation existed).
  const moduleD = rawModuleD != null && rawModuleD <= 0 ? rawModuleD : 0
  const eolEpcC2 = layer.eolEpcC2 ?? material?.eolEpcC2 ?? null

  let c2 = null
  let c2Missing = null
  let c2Source = null
  if (eolEpcC2 != null) {
    c2 = eolEpcC2
    c2Source = 'EPD-published'
  } else if (massKg == null) {
    c2Missing = 'mass unknown (needs thickness/density/area — see A4)'
  } else if (wasteFacilityDistanceKm == null) {
    c2Missing = 'waste facility distance not set (Operational Energy settings)'
  } else {
    const result = estimateTransportCO2({ distanceKm: wasteFacilityDistanceKm, massKg })
    c2 = result.pending ? null : result.co2Kg
    c2Source = 'computed — DIN EN ISO 14083, shared waste facility distance'
  }

  return {
    c1, c1Missing: c1 == null ? 'not yet modeled' : null,
    c2, c2Missing, c2Source,
    c3, c3Missing: c3 == null ? 'not yet modeled' : null,
    c4, c4Missing: c4 == null ? 'not yet modeled' : null,
    moduleD, moduleDMissing: moduleD == null ? 'not yet modeled' : null,
    eolSource: layer.eolSource ?? (material?.epdSource ? 'epd' : null),
    eolAssumptionBasis: layer.eolAssumptionBasis ?? (material?.notes ? material.notes : null),
    eolRecycledPct: layer.eolRecycledPct ?? null,
    eolLandfillPct: layer.eolLandfillPct ?? null,
    eolIncineratedPct: layer.eolIncineratedPct ?? null,
  }
}

/**
 * @param {string} assemblyKey
 * @returns {object}
 */
export function analyzeLcaAssembly(assemblyKey) {
  const assembly = ASSEMBLIES.find((a) => a.key === assemblyKey)
  if (!assembly?.inScope) {
    return { key: assemblyKey, label: assembly?.label ?? assemblyKey, inScope: false, hasData: false }
  }

  const record = loadSection(assemblyKey)
  const layers = record?.layers && record.layers.length > 0 ? record.layers : (defaultLayersBySection[assemblyKey] ?? [])
  const geometry = loadAssemblyGeometry(assemblyKey)
  const isUnitAssembly = UNIT_ASSEMBLY_KEYS.has(assemblyKey)
  const materialById = Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))
  const { wasteFacilityDistanceKm } = loadOperationalEnergySettings()

  if (layers.length === 0) {
    return { key: assemblyKey, label: assembly.label, inScope: true, hasData: false, geometry }
  }

  const layerResults = layers.map((layer) => {
    const material = layer.materialId ? materialById[layer.materialId] : null

    // Part B — A1-A3
    const { quantity, missing: quantityMissing } = deriveQuantity(layer, material, geometry, isUnitAssembly)
    const gwpA1A3Unit = layer.gwpA1A3PerFunctionalUnit ?? material?.gwpA1A3PerFunctionalUnit ?? null
    let a1a3 = null
    let a1a3Missing = quantityMissing
    if (!quantityMissing) {
      if (gwpA1A3Unit == null) {
        a1a3Missing = 'GWP unit value'
      } else {
        a1a3 = gwpA1A3Unit * quantity
      }
    }

    // Part C — A4 (real DIN EN ISO 14083 formula, see transport.js)
    const { massKg, missing: massMissing } = deriveMassKg(layer, material, geometry, isUnitAssembly)
    const { distanceKm, missing: distanceMissing, source: distanceSource } = deriveDistanceKm(layer, material)
    const transportInputsReady = massMissing == null && distanceMissing == null
    const transportResult = transportInputsReady
      ? estimateTransportCO2({ distanceKm, transportMode: material?.transportMode ?? 'road', massKg })
      : null
    const a4CO2Kg = transportResult?.co2Kg ?? null

    // Part D — B4 (replacement)
    const serviceLifeYears = layer.serviceLifeYears ?? material?.serviceLifeYears ?? null
    const { b4, replacementCount, missing: b4Missing } = deriveB4(serviceLifeYears, a1a3, a4CO2Kg)

    // End-of-life — C1-C4 + D (see deriveEolImpact above)
    const eol = deriveEolImpact(layer, material, massKg, wasteFacilityDistanceKm)

    return {
      instanceId: layer.instanceId,
      materialId: layer.materialId ?? null,
      name: layer.name,
      // Raw geometry, not just derived results — the A4 report's per-
      // assembly layer-order table needs the real thickness/λ, and
      // nothing upstream of this loop currently surfaces them (deliberate
      // before now: everything else here is a computed LCA figure, not a
      // pass-through). Cheap to add since `layer` is already in scope.
      thicknessMM: layer.thicknessMM ?? material?.thicknessMM ?? null,
      thermalConductivityWmK: layer.thermalConductivityWmK ?? material?.thermalConductivityWmK ?? null,
      densityKgM3: layer.densityKgM3 ?? material?.densityKgM3 ?? null,
      gwpA1A3PerFunctionalUnit: layer.gwpA1A3PerFunctionalUnit ?? material?.gwpA1A3PerFunctionalUnit ?? null,
      a1a3,
      a1a3Missing,
      // Surfaced for Deliverables → Assumptions (deliverablesData.js just
      // passes layerResults through as-is) — same "never silently apply a
      // lower-confidence number" rule as the eol*/serviceLife* fields
      // below, now extended to A1-A3 GWP provenance too.
      gwpSource: layer.gwpSource ?? material?.epdSource ?? null,
      gwpSourceNote: layer.gwpSourceNote ?? null,
      gwpConfidence: layer.gwpConfidence ?? material?.gwpConfidence ?? null,
      gwpConfidenceLabel: layer.gwpConfidenceLabel ?? material?.gwpConfidenceLabel ?? null,
      massKg,
      massMissing,
      distanceKm,
      distanceMissing,
      distanceSource,
      a4CO2Kg,
      a4Pending: transportInputsReady && transportResult?.pending === true,
      serviceLifeYears: layer.serviceLifeYears ?? material?.serviceLifeYears ?? null,
      serviceLifeSource: layer.serviceLifeSource ?? (material?.serviceLifeYears ? 'epd' : null),
      b4,
      b4ReplacementCount: replacementCount,
      b4Missing,
      ...eol,
    }
  })

  const a1a3Known = layerResults.filter((l) => l.a1a3 != null)
  const a1a3Total = a1a3Known.reduce((sum, l) => sum + l.a1a3, 0)

  const a4Known = layerResults.filter((l) => l.a4CO2Kg != null)
  const a4Total = a4Known.length > 0 ? a4Known.reduce((sum, l) => sum + l.a4CO2Kg, 0) : null
  const a4AnyPending = layerResults.some((l) => l.a4Pending)

  // Part D — B4 (replacement): computed per layer above (deriveB4) from
  // service life + that layer's own A1-A3/A4 — null ("not yet assessed",
  // not a real zero) whenever ANY layer is still missing an input, same
  // "don't silently treat a gap as zero" rule as A1-A3/A4's own totals
  // below. C&D (end-of-life): still qualitative-only, no computed number
  // — see endOfLifeFlags.
  const b4Known = layerResults.filter((l) => l.b4 != null)
  const b4Total = b4Known.length === layerResults.length ? b4Known.reduce((sum, l) => sum + l.b4, 0) : null
  const endOfLifeFlags = layers.map((l) => {
    const fiche = loadFicheDetail(l.materialId)
    const material = getMaterialById(l.materialId)
    const scenario = fiche?.endOfLifeScenario || material?.endOfLifeScenario || l.endOfLifeScenario || 'Energy recovery (incineration)'
    return { layerName: l.name, scenario }
  })

  // End-of-life modules (C1-C4, D) — same "null total unless every layer
  // has a value" rule as B4 above, computed independently per module
  // since a layer can have e.g. C1+C4 researched but not C3/D yet (see
  // EndOfLifeImpactField.jsx's independent-sub-fields design).
  const eolTotal = (key) => {
    const known = layerResults.filter((l) => l[key] != null)
    return known.length === layerResults.length ? known.reduce((sum, l) => sum + l[key], 0) : null
  }
  const c1Total = eolTotal('c1')
  const c2Total = eolTotal('c2')
  const c3Total = eolTotal('c3')
  const c4Total = eolTotal('c4')
  const moduleDTotal = eolTotal('moduleD')

  // Part E — partial total (excludes B4 and C&D — see A4ReportDraft.jsx's
  // own note on why B4 isn't folded in here even once computed: it's a
  // separate lifecycle stage, not additional A1-A3/A4, and this total
  // feeds the graded report's Methodology section as written) +
  // normalization.
  const surfaceAreaM2 = geometry.surfaceAreaM2 !== '' ? Number(geometry.surfaceAreaM2) : null
  const partialTotalKg = a1a3Total + (a4Total ?? 0)
  const normalized = surfaceAreaM2 ? partialTotalKg / surfaceAreaM2 / 50 : null

  const missingSummary = []
  for (const l of layerResults) {
    if (l.a1a3Missing) missingSummary.push(`A1-A3: missing ${l.a1a3Missing} for "${l.name}"`)
    if (l.distanceMissing) missingSummary.push(`A4: ${l.distanceMissing} ("${l.name}")`)
    else if (l.massMissing) missingSummary.push(`A4: missing ${l.massMissing} for "${l.name}"`)
    else if (l.distanceSource?.includes('NOT routed via Detmold')) {
      missingSummary.push(`A4: "${l.name}" uses a direct-to-Haarlem fallback distance, not routed via Detmold — likely understates A4 for this layer`)
    }
    if (l.b4Missing === 'service life') missingSummary.push(`B4: missing service life for "${l.name}"`)
    else if (l.b4Missing) missingSummary.push(`B4: ${l.b4Missing} for "${l.name}"`)
    // One line per layer, not one per module — C1/C3/C4/D are all
    // researched together via the same EndOfLifeImpactField (see
    // missingSummary's B4 precedent above for the same "name the root
    // cause once, don't spam a line per sub-component" reasoning). C2 is
    // excluded from this check since it's usually just a settings gap
    // (waste facility distance), already named separately if relevant.
    if (l.c1Missing || l.c3Missing || l.c4Missing || l.moduleDMissing) {
      missingSummary.push(`C1-C4/D: end-of-life impact not yet researched for "${l.name}"`)
    }
  }
  if (surfaceAreaM2 == null) missingSummary.push('Surface area not entered (Part A) — normalized value cannot be computed')

  return {
    key: assemblyKey,
    label: assembly.label,
    inScope: true,
    hasData: true,
    owner: record?.owner && record.owner.trim() !== '' ? record.owner : (DEFAULT_SECTION_OWNERS[assemblyKey] ?? null),
    savedAt: record?.savedAt ?? null,
    geometry,
    layerResults,
    a1a3Total,
    a1a3KnownCount: a1a3Known.length,
    a4Total,
    a4KnownCount: a4Known.length,
    a4AnyPending,
    b4Total,
    b4KnownCount: b4Known.length,
    c1Total,
    c2Total,
    c3Total,
    c4Total,
    moduleDTotal,
    endOfLifeFlags,
    partialTotalKg,
    normalized,
    layerCount: layers.length,
    missingSummary,
  }
}

export function analyzeAllLcaAssemblies() {
  return ASSEMBLIES.map((a) => analyzeLcaAssembly(a.key))
}

/**
 * Every incomplete/not-yet-researched item across every in-scope
 * assembly, in one place — the "completeness check" shown before any
 * Excel push, so nothing pushes as a silent blank/zero. An out-of-scope
 * assembly (none currently — all of ASSEMBLIES is in scope, but the
 * branch stays for whenever one gets dropped again) is called out
 * separately rather than folded in, since "no data" there means
 * something different (nothing to compute at all) than "incomplete"
 * (some data present, some missing).
 */
export function getFullCompletenessReport() {
  const results = analyzeAllLcaAssemblies()
  return results.map((r) => {
    if (!r.inScope) {
      return { assembly: r.label, status: 'out-of-scope', items: [] }
    }
    if (!r.hasData) {
      return { assembly: r.label, status: 'no-data', items: [] }
    }
    // B4 gaps are already named per-layer in missingSummary (see
    // deriveB4/analyzeLcaAssembly above) — no separate blanket line
    // needed here now that B4 is actually computed rather than always
    // "not yet assessed".
    const items = [...r.missingSummary]
    const undefinedEol = r.endOfLifeFlags.filter((f) => !f.scenario)
    if (undefinedEol.length > 0) {
      items.push(`C&D: end-of-life scenario not yet defined for ${undefinedEol.length}/${r.endOfLifeFlags.length} layers (${undefinedEol.map((f) => `"${f.layerName}"`).join(', ')})`)
    }
    return { assembly: r.label, status: items.length > 0 ? 'incomplete' : 'complete', items }
  })
}

/**
 * B6 (operational energy use stage) — a SINGLE whole-building figure, not
 * per-assembly/per-layer like A1-A3/A4/B4 above: electricity GWP factor ×
 * intensity load × conditioned floor area × the reference study period.
 * Reads its three inputs from operationalEnergyStorage.js's one-time
 * settings panel (see OperationalEnergySettings.jsx) — null ("not yet
 * assessed") whenever any of the three hasn't been filled in yet.
 */
export function calculateB6() {
  const settings = loadOperationalEnergySettings()
  const { electricityGwpFactor, intensityLoad, conditionedFloorAreaM2 } = settings

  const missing = []
  if (electricityGwpFactor == null) missing.push('electricity GWP factor')
  if (intensityLoad == null) missing.push('intensity load')
  if (conditionedFloorAreaM2 == null) missing.push('conditioned floor area')

  if (missing.length > 0) {
    return { b6: null, missing, settings }
  }

  return {
    b6: electricityGwpFactor * intensityLoad * conditionedFloorAreaM2 * REFERENCE_STUDY_PERIOD_YEARS,
    missing: null,
    settings,
  }
}
