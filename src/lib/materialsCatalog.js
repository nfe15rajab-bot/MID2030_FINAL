// Single place that merges the bundled database/materials.json catalog
// with whatever the user has added locally via customMaterialStorage.js.
// Both LayerBuilder (the "add layer" dropdown) and ProvidersTab (the
// discipline pooling + fiche technique) need the merged list so a custom
// material behaves exactly like a catalog one everywhere — real id,
// shows up in materialById, can carry a fiche technique, etc.
import baseMaterials from '../../database/materials.json'
import { loadCustomMaterials } from './customMaterialStorage.js'
import { findMaterialDataMatch } from './aiMaterialDataStorage.js'

// aiMaterialDataStorage field name -> material record field name.
const OVERRIDE_FIELDS = [
  ['lambda', 'thermalConductivityWmK'],
  ['gwp', 'gwpA1A3PerFunctionalUnit'],
  ['density', 'densityKgM3'],
]

// Applies any team-entered correction (Materials and Providers tab's
// MaterialCoreValuesEditor, or a re-imported materials summary Excel row —
// see aiMaterialDataStorage.js) on top of a material record, keyed
// precisely by id (never by name alone — database/materials.json has
// genuine name collisions, e.g. two different "Kronoply OSB/3 Panel"
// entries for different layer roles). Applied here, once, so every future
// layer pick anywhere (LayerBuilder's dropdown, UnitAssemblyBuilder, etc.)
// already reflects the correction instead of requiring a per-layer manual
// "Suggest -> Accept".
function withOverrides(material) {
  let result = material
  for (const [field, key] of OVERRIDE_FIELDS) {
    const entry = findMaterialDataMatch({ id: material.id, name: material.name }, field)
    if (entry && entry.value != null && entry.value !== result[key]) {
      if (result === material) result = { ...material }
      result[key] = entry.value
    }
  }
  return result
}

export function getAllMaterials() {
  return [...baseMaterials, ...loadCustomMaterials()].map(withOverrides)
}

export function getMaterialById(materials, id) {
  return materials.find((m) => m.id === id) ?? null
}
