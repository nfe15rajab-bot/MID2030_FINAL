// Shared 3-tier completeness classification for a layer's researched
// material properties (GWP A1-A3, density, λ) — used by SectionPreview.jsx
// to color each layer band in the parametric section diagram green/amber/
// red. Same three fields LayerBuilder.jsx's own isLayerDataComplete checks
// for the layer-row green background, but as a tier (complete/partial/
// none) rather than a boolean, since a diagram band benefits from showing
// "some data" vs "no data at all" as distinct signals.
export function getLayerCompletenessTier(layer) {
  const knownCount = [
    layer.gwpA1A3PerFunctionalUnit,
    layer.densityKgM3,
    layer.thermalConductivityWmK,
  ].filter((v) => v != null).length

  if (knownCount === 3) return 'complete'
  if (knownCount === 0) return 'none'
  return 'partial'
}
