import React, { useEffect, useState } from 'react'
import { saveMaterialData } from '../lib/aiMaterialDataStorage.js'
import { pushMaterialValuesToLayers } from '../lib/materialsSummary.js'

function toNum(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Editable λ/GWP/density for the selected material, backed by
// aiMaterialDataStorage.js (the same store FieldSuggest.jsx reads/writes,
// keyed precisely by material id here rather than name — see that
// module's keyFor). Editing a field corrects it for every FUTURE layer
// pick (materialsCatalog.js's getAllMaterials() merges the override in
// automatically). "Push to layers" is a separate, explicit action because
// a layer already saved to a section copied these values in at pick time
// and won't re-read the catalog on its own — it needs its own patch.
export default function MaterialCoreValuesEditor({ material, usage, enteredBy, onChanged }) {
  const [values, setValues] = useState(() => ({
    thermalConductivityWmK: material.thermalConductivityWmK ?? '',
    gwpA1A3PerFunctionalUnit: material.gwpA1A3PerFunctionalUnit ?? '',
    densityKgM3: material.densityKgM3 ?? '',
  }))
  const [pushStatus, setPushStatus] = useState(null)

  // Switching to a different material — reload its own values rather than
  // carrying over the previous material's edits.
  useEffect(() => {
    setValues({
      thermalConductivityWmK: material.thermalConductivityWmK ?? '',
      gwpA1A3PerFunctionalUnit: material.gwpA1A3PerFunctionalUnit ?? '',
      densityKgM3: material.densityKgM3 ?? '',
    })
    setPushStatus(null)
  }, [material.id])

  function updateValue(field, storageField, rawValue) {
    setValues((prev) => ({ ...prev, [field]: rawValue }))
    const num = toNum(rawValue)
    if (num == null) return
    saveMaterialData({ id: material.id, name: material.name }, storageField, {
      value: num,
      tier: 'manual-entry',
      enteredBy: enteredBy || null,
    })
    onChanged?.()
  }

  function handlePush() {
    const patch = {
      thermalConductivityWmK: toNum(values.thermalConductivityWmK),
      gwpA1A3PerFunctionalUnit: toNum(values.gwpA1A3PerFunctionalUnit),
      densityKgM3: toNum(values.densityKgM3),
    }
    const { layersUpdated, sectionsTouched } = pushMaterialValuesToLayers(material.id, patch)
    setPushStatus(
      layersUpdated > 0
        ? `Updated ${layersUpdated} layer${layersUpdated === 1 ? '' : 's'} across ${sectionsTouched.join(', ')}.`
        : 'No saved layers use this material yet — nothing to push.'
    )
    onChanged?.()
  }

  const instanceCount = usage?.instanceCount ?? 0
  const sections = usage?.sections ?? []

  return (
    <div className="material-core-values">
      <h4>Core LCA values for {material.name}</h4>
      <div className="material-core-values-grid">
        <label className="material-core-values-field">
          λ (W/mK)
          <input
            type="number"
            step="0.001"
            value={values.thermalConductivityWmK}
            onChange={(e) => updateValue('thermalConductivityWmK', 'lambda', e.target.value)}
          />
        </label>
        <label className="material-core-values-field">
          GWP A1-A3
          <input
            type="number"
            step="0.01"
            value={values.gwpA1A3PerFunctionalUnit}
            onChange={(e) => updateValue('gwpA1A3PerFunctionalUnit', 'gwp', e.target.value)}
          />
        </label>
        <label className="material-core-values-field">
          Density (kg/m³)
          <input
            type="number"
            step="1"
            value={values.densityKgM3}
            onChange={(e) => updateValue('densityKgM3', 'density', e.target.value)}
          />
        </label>
      </div>
      <button type="button" onClick={handlePush} disabled={instanceCount === 0}>
        {instanceCount > 0
          ? `Push to ${instanceCount} layer${instanceCount === 1 ? '' : 's'} (${sections.join(', ')})`
          : 'No saved layers to push to'}
      </button>
      {pushStatus && <p className="material-core-values-hint">{pushStatus}</p>}
      <p className="material-core-values-hint">
        Editing a value here also applies to every future layer pick of this material from the
        catalog. "Push" additionally rewrites layers already saved with it.
      </p>
    </div>
  )
}
