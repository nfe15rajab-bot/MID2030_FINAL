// Part A primitives for the Assembly Analysis Preview tab — pure
// calculation, no UI. Pools the exact same sectionStorage records
// LayerBuilder/Team Summary already read (no new save system), computes
// U-value (reusing uvalue.js's calculateUValue as-is — its Rsi/Rse
// already match DIN EN ISO 6946: wall 0.13/0.04, roof 0.10/0.04, floor
// 0.17/0.04) and GWP A1-A3 (same sum logic as TeamSummaryTab.jsx).
import { loadSection } from './sectionStorage.js'
import { calculateUValue } from './uvalue.js'
import { getAllMaterials } from './materialsCatalog.js'
import { loadAssemblyGeometry } from './assemblyGeometryStorage.js'
import { gwpTotalForLayers } from './gwpPerM2.js'
import defaultLayersBySection from '../../database/defaultLayers.json'
import { DEFAULT_SECTION_OWNERS } from '../data/teamMembers.js'

export const ASSEMBLIES = [
  { key: 'wall', label: 'Wall', inScope: true },
  { key: 'roof', label: 'Roof', inScope: true },
  { key: 'floor', label: 'Floor', inScope: true },
  { key: 'door', label: 'Door', inScope: true },
  { key: 'window', label: 'Window', inScope: true },
  { key: 'skylight', label: 'Skylight', inScope: true },
]

// Door/Window/Skylight are single manufactured units edited via
// UnitAssemblyBuilder.jsx, not a layer-stack's thickness+λ physics — a
// U-value computed by summing R-values across a door frame + membrane
// layers would be meaningless, so this tab skips that calc for them
// entirely (see computeFromLayers below) rather than showing a wrong
// number silently.
const UNIT_ASSEMBLY_KEYS = new Set(['door', 'window', 'skylight'])

/** Which specific fields are missing, per layer — not just a boolean. */
function findMissingFields(layers) {
  const missing = []
  for (const layer of layers) {
    const fields = []
    if (layer.thicknessMM == null) fields.push('thickness')
    if (!layer.thermalConductivityWmK || layer.thermalConductivityWmK <= 0) fields.push('λ')
    if (fields.length > 0) missing.push({ layerName: layer.name, fields })
  }
  return missing
}

// Shared by analyzeAssembly (saved sectionStorage data) and
// analyzeLiveAssembly (live in-memory layers, no save gate) below — same
// computation either way, just a different source for `layers`.
function computeFromLayers(assemblyKey, label, layers, owner, savedAt) {
  if (layers.length === 0) {
    return { key: assemblyKey, label, inScope: true, hasData: false, owner: null, savedAt: null }
  }

  const isUnitAssembly = UNIT_ASSEMBLY_KEYS.has(assemblyKey)
  const { uValue, missingData } = isUnitAssembly ? { uValue: null, missingData: true } : calculateUValue(layers, assemblyKey)
  const missingFields = isUnitAssembly ? [] : findMissingFields(layers)

  // Real area-scaled GWP (matches lcaAnalysis.js's deriveQuantity formula
  // exactly, via the shared gwpPerM2.js helper) — NOT a naive sum of raw
  // per-declared-unit values. That used to make a 260mm and a 50mm layer
  // of the same m3-declared material contribute equally to this total,
  // and it's what fed the headline "GWP A1-A3" figure shown on the
  // Assembly Analysis card, the 3D hotspot popup (ConfiguratorPanel.jsx),
  // and Team Summary — all three now get the corrected number from this
  // one shared fix. Uses the real assembly floor area (Part A,
  // assemblyGeometryStorage.js) when it's been entered; falls back to a
  // "per 1m²" figure otherwise, same honest-fallback convention as
  // LayerBuilder's own corrected table.
  const allMaterials = getAllMaterials()
  const geometry = isUnitAssembly ? null : loadAssemblyGeometry(assemblyKey)
  const { total: gwpTotal, known: gwpKnownLayersScaled } = gwpTotalForLayers(layers, allMaterials, geometry?.surfaceAreaM2)
  const gwpKnownLayers = gwpKnownLayersScaled

  // "Complete" = has everything this whole analysis needs — for a layer
  // stack that's thickness, λ, AND gwp (a stricter bar than U-value
  // alone, since a layer missing only its GWP still counts toward
  // U-value but not toward "done"); for a unit assembly, just gwp (no
  // thickness/λ concept applies).
  const completeCount = isUnitAssembly
    ? layers.filter((l) => l.gwpA1A3PerFunctionalUnit != null).length
    : layers.filter(
        (l) => l.thicknessMM != null && l.thermalConductivityWmK > 0 && l.gwpA1A3PerFunctionalUnit != null
      ).length

  return {
    key: assemblyKey,
    label,
    inScope: true,
    hasData: true,
    owner,
    savedAt,
    layerCount: layers.length,
    uValue: missingData ? null : uValue,
    missingFields, // [{ layerName, fields: ['thickness'|'λ', ...] }]
    gwpTotal,
    gwpKnownCount: gwpKnownLayers.length,
    completeCount,
    totalCount: layers.length,
    // Raw layers — used by AiFeedbackPanel.jsx to describe the actual
    // stack, and by the Deliverables tab's report generator.
    layers: layers.map((l) => ({
      name: l.name,
      thicknessMM: l.thicknessMM,
      lambda: l.thermalConductivityWmK,
      gwp: l.gwpA1A3PerFunctionalUnit,
    })),
  }
}

/**
 * @param {string} assemblyKey - 'wall' | 'roof' | 'floor' | 'door' | 'window' | 'skylight'
 * @returns {object|null} null only for out-of-scope assemblies with nothing to compute
 */
export function analyzeAssembly(assemblyKey) {
  const assembly = ASSEMBLIES.find((a) => a.key === assemblyKey)
  if (!assembly?.inScope) {
    return { key: assemblyKey, label: assembly?.label ?? assemblyKey, inScope: false, hasData: false }
  }

  const record = loadSection(assemblyKey)
  const layers = record?.layers && record.layers.length > 0 ? record.layers : (defaultLayersBySection[assemblyKey] ?? [])
  const defaultOwner = DEFAULT_SECTION_OWNERS[assemblyKey] ?? null
  const owner = record?.owner && record.owner.trim() !== '' ? record.owner : defaultOwner
  return computeFromLayers(assemblyKey, assembly.label, layers, owner, record?.savedAt ?? null)
}

export function analyzeAllAssemblies() {
  return ASSEMBLIES.map((a) => analyzeAssembly(a.key))
}

// Assembly Analysis Preview's split-pane workbench feeds this straight
// from LayerBuilder's own in-memory layers state (via its onLayersChange
// callback) — same shape/computation as analyzeAssembly, but with no
// "Save changes" gate, so the right pane recomputes on every keystroke.
// owner/savedAt are always null here since unsaved edits have neither.
export function analyzeLiveAssembly(assemblyKey, layers) {
  const assembly = ASSEMBLIES.find((a) => a.key === assemblyKey)
  return computeFromLayers(assemblyKey, assembly.label, layers, null, null)
}

/** Human-readable "incomplete — missing X for Y[, missing Z for W]" message. */
export function formatMissingMessage(missingFields) {
  return missingFields
    .map(({ layerName, fields }) => `missing ${fields.join(' & ')} for "${layerName}"`)
    .join('; ')
}
