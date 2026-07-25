// Research-backed sustainability classification for a saved assembly —
// used by the "Conclusion" section in ConfiguratorPanel.jsx (the 3D
// hotspot popup) and mirrored in Assembly Analysis Preview / the A4
// report. Two independent bands, not one collapsed score, since U-value
// (operational-adjacent, envelope performance) and embodied carbon
// (upfront/A1-A3, material choice) measure genuinely different things —
// an assembly can score well on one and poorly on the other.
//
// U-value bands build directly on the reference figures already noted in
// uvalue.js's own comment (Passive House ~0.15 W/m²K; NL Bouwbesluit
// ~0.18-0.29 depending on element) rather than inventing new ones — see
// that file for the same "confirm exact figures before citing" caveat,
// repeated here since these are round, illustrative reference bands, not
// a verified legal citation.
//
// Embodied-carbon (GWP, normalized kg CO2e/m2/yr) bands are a literature-
// informed range comparing timber-frame vs. conventional (masonry/
// concrete/steel) construction — not a single authoritative regulatory
// standard the way a building code U-value minimum is. Flagged as
// "medium confidence" for that reason; the number itself (and its own
// A1-A3/normalization methodology) is unchanged, real, computed data —
// only the sustainability LABEL applied to it is a judgment call.

const U_VALUE_BANDS = {
  wall: [
    { max: 0.15, tier: 'very', label: 'Very sustainable', reason: 'Meets Passive House Institute criteria for opaque envelope elements (U ≤ 0.15 W/m²K).' },
    { max: 0.20, tier: 'sustainable', label: 'Sustainable', reason: 'Below typical German GEG (Gebäudeenergiegesetz) new-build reference U-values for walls (~0.20-0.24 W/m²K).' },
    { max: 0.29, tier: 'moderate', label: 'Moderately sustainable', reason: 'Within typical Dutch Bouwbesluit/BENG or German GEG new-build minimums (~0.21-0.29 W/m²K), but well short of Passive House performance.' },
    { max: Infinity, tier: 'less', label: 'Less sustainable', reason: 'Above typical current new-build minimums for a wall (Bouwbesluit/BENG and GEG both generally require ≤0.29 W/m²K or better).' },
  ],
  roof: [
    { max: 0.15, tier: 'very', label: 'Very sustainable', reason: 'Meets Passive House Institute criteria for opaque envelope elements (U ≤ 0.15 W/m²K).' },
    { max: 0.17, tier: 'sustainable', label: 'Sustainable', reason: 'Below typical German GEG new-build reference U-values for roofs (~0.17-0.20 W/m²K).' },
    { max: 0.24, tier: 'moderate', label: 'Moderately sustainable', reason: 'Within typical Dutch Bouwbesluit/BENG or German GEG new-build minimums for a roof (~0.17-0.24 W/m²K), but short of Passive House performance.' },
    { max: Infinity, tier: 'less', label: 'Less sustainable', reason: 'Above typical current new-build minimums for a roof.' },
  ],
  floor: [
    { max: 0.15, tier: 'very', label: 'Very sustainable', reason: 'Meets Passive House Institute criteria for opaque envelope elements (U ≤ 0.15 W/m²K).' },
    { max: 0.25, tier: 'sustainable', label: 'Sustainable', reason: 'Below typical German GEG new-build reference U-values for ground floors (~0.25-0.30 W/m²K).' },
    { max: 0.35, tier: 'moderate', label: 'Moderately sustainable', reason: 'Within typical Dutch Bouwbesluit/BENG or German GEG new-build minimums for a floor.' },
    { max: Infinity, tier: 'less', label: 'Less sustainable', reason: 'Above typical current new-build minimums for a floor.' },
  ],
}

const U_VALUE_CAVEAT =
  'Reference bands are round, illustrative figures (Passive House Institute criteria; typical German GEG and Dutch Bouwbesluit/BENG new-build minimums) — always confirm the exact current regulatory figure before citing this in a compliance context, same caveat as this app\'s own U-value calculator.'

// Literature-informed, not a single regulatory standard — see file header.
const GWP_BANDS = [
  { max: 0, tier: 'very', label: 'Very sustainable', reason: 'Net carbon storage — biogenic carbon retained in the timber content exceeds this assembly\'s process/manufacturing emissions.' },
  { max: 3, tier: 'sustainable', label: 'Sustainable', reason: 'Low embodied-carbon intensity, consistent with a timber-frame assembly.' },
  { max: 8, tier: 'moderate', label: 'Moderately sustainable', reason: 'Mid-range embodied-carbon intensity, typical of a mixed timber/mineral assembly.' },
  { max: Infinity, tier: 'less', label: 'Less sustainable', reason: 'Higher embodied-carbon intensity, more typical of masonry/concrete/steel-heavy assemblies than timber-frame construction.' },
]

const GWP_CAVEAT =
  'This band compares against general building-LCA literature on timber-frame vs. conventional (masonry/concrete/steel) construction, not a single authoritative regulatory standard the way a U-value building-code minimum is — treat as directional, not a certification threshold.'

function classify(value, bands) {
  if (value == null) return null
  for (const band of bands) {
    if (value <= band.max) return band
  }
  return bands[bands.length - 1]
}

/**
 * @param {'wall'|'roof'|'floor'} assemblyKey
 * @param {number|null} uValue
 * @param {number|null} normalizedGwp - kg CO2e/m2/yr (see lcaAnalysis.js's normalized figure)
 * @returns {{
 *   uValue: {tier:string,label:string,reason:string,caveat:string}|null,
 *   gwp: {tier:string,label:string,reason:string,caveat:string}|null,
 * }}
 */
export function classifyAssemblySustainability(assemblyKey, uValue, normalizedGwp) {
  const uBand = classify(uValue, U_VALUE_BANDS[assemblyKey] ?? U_VALUE_BANDS.wall)
  const gwpBand = classify(normalizedGwp, GWP_BANDS)
  return {
    uValue: uBand ? { ...uBand, caveat: U_VALUE_CAVEAT } : null,
    gwp: gwpBand ? { ...gwpBand, caveat: GWP_CAVEAT } : null,
  }
}

// Door/Window/Skylight (UnitAssemblyBuilder) have a manufacturer-declared
// Uw instead of a computed layer-stack U-value — same bands apply (a
// window's Uw is directly comparable to a wall/roof U-value physically),
// just sourced differently upstream.
export function classifyUnitSustainability(uw, normalizedGwp) {
  const uBand = classify(uw, [
    { max: 0.8, tier: 'very', label: 'Very sustainable', reason: 'Meets Passive House Institute criteria for glazed units (Uw ≤ 0.8 W/m²K).' },
    { max: 1.2, tier: 'sustainable', label: 'Sustainable', reason: 'Below typical German GEG new-build reference values for windows/doors (~1.3 W/m²K).' },
    { max: 1.8, tier: 'moderate', label: 'Moderately sustainable', reason: 'Within typical Dutch Bouwbesluit/BENG or German GEG new-build minimums for a glazed unit.' },
    { max: Infinity, tier: 'less', label: 'Less sustainable', reason: 'Above typical current new-build minimums for a glazed unit.' },
  ])
  const gwpBand = classify(normalizedGwp, GWP_BANDS)
  return {
    uValue: uBand ? { ...uBand, caveat: U_VALUE_CAVEAT } : null,
    gwp: gwpBand ? { ...gwpBand, caveat: GWP_CAVEAT } : null,
  }
}
