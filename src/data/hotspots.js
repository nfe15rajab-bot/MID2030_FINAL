// 3D hotspot positions, captured by clicking the model in ModelViewer's
// calibration tool (now removed). Coordinates are in the model's native
// units (millimeters, based on the magnitude of the numbers).
//
// `category` matches the "category" field in database/materials.json —
// used both to filter the editor to just that section's catalog
// materials and (via ConfiguratorPanel's AssemblyProgressView) to show
// live LCA progress. All six sections use the same `kind: 'layers'` now;
// Door/Window/Skylight are single manufactured units under the hood
// (UnitAssemblyBuilder.jsx, not LayerBuilder), but that distinction lives
// in SectionConfigurator's own UNIT_SECTIONS set, not in hotspot routing.
export const hotspots = [
  {
    id: 'floor',
    label: 'Floor',
    kind: 'layers', // opens the layer builder
    category: 'Floor',
    position: { x: 9963.1, y: 365.134, z: -2874.115 },
  },
  {
    id: 'wall',
    label: 'Wall',
    kind: 'layers',
    category: 'Wall',
    position: { x: 9970.4, y: 1892.871, z: -4235.315 },
  },
  {
    id: 'roof',
    label: 'Roof',
    kind: 'layers',
    category: 'Roof',
    position: { x: 9964.18, y: 3090.533, z: -2689.329 },
  },
  {
    id: 'skylight',
    label: 'Skylight',
    kind: 'layers',
    category: 'Skylight',
    position: { x: 8993.585, y: 3384.232, z: -3278.301 },
  },
  {
    id: 'door',
    label: 'Sliding Door',
    kind: 'layers',
    category: 'Door',
    position: { x: 9731.338, y: 1624.916, z: -1526.368 },
  },
  {
    id: 'window',
    label: 'Window',
    kind: 'layers',
    category: 'Window',
    position: { x: 8195.679, y: 2099.685, z: 227.0 },
  },
]