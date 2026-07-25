import React, { useState } from 'react'
import { addCustomMaterial, buildCustomMaterial } from '../lib/customMaterialStorage.js'
import FieldSuggest from './FieldSuggest.jsx'

// Same discipline taxonomy used everywhere else in the app (Providers tab
// grouping, database/schema.md) — kept as one list here rather than
// re-derived, since a custom material needs the user to pick one.
const DISCIPLINES = [
  'Structure',
  'Insulation',
  'Sheathing',
  'Membrane',
  'Cladding',
  'Finishing',
  'Roofing',
  'Fixed Unit',
]
const FUNCTIONAL_UNITS = ['m3', 'm2', 'kg', 'unit']

const EMPTY_FORM = {
  name: '',
  discipline: DISCIPLINES[0],
  manufacturer: '',
  enNorm: '',
  thicknessMM: '',
  densityKgM3: '',
  thermalConductivityWmK: '',
  gwpA1A3PerFunctionalUnit: '',
  functionalUnit: 'm3',
}

// For materials that are in neither database/materials.json nor findable
// on Ökobaudat — lets the user type in whatever they actually know (often
// just λ off a datasheet) instead of being blocked from adding the layer
// at all. Saved via customMaterialStorage.js (localStorage, additive,
// never touches the bundled JSON) and immediately usable as a normal
// layer — same as picking from the catalog dropdown.
export default function CustomMaterialForm({ category, onCreate, onCancel }) {
  const [form, setForm] = useState(EMPTY_FORM)

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return

    const material = buildCustomMaterial({
      name: form.name.trim(),
      category,
      discipline: form.discipline,
      manufacturer: form.manufacturer.trim(),
      enNorm: form.enNorm.trim(),
      thicknessMM: form.thicknessMM === '' ? null : Number(form.thicknessMM),
      densityKgM3: form.densityKgM3 === '' ? null : Number(form.densityKgM3),
      thermalConductivityWmK: form.thermalConductivityWmK === '' ? null : Number(form.thermalConductivityWmK),
      gwpA1A3PerFunctionalUnit: form.gwpA1A3PerFunctionalUnit === '' ? null : Number(form.gwpA1A3PerFunctionalUnit),
      functionalUnit: form.functionalUnit,
    })
    addCustomMaterial(material)
    onCreate(material)
    setForm(EMPTY_FORM)
  }

  return (
    <form className="custom-material-form" onSubmit={handleSubmit}>
      <p className="custom-material-hint">
        Not in the catalog and not on Ökobaudat? Add it here — type in whatever you actually know
        from a datasheet (λ especially, for the U-value calc); leave the rest blank rather than
        guessing.
      </p>
      <label className="fiche-editor-field">
        Name *
        <input
          type="text"
          value={form.name}
          onChange={(e) => setField('name', e.target.value)}
          placeholder="e.g. Acme Vapour Barrier, 0.3mm"
          required
        />
      </label>
      <label className="fiche-editor-field">
        Discipline
        <select value={form.discipline} onChange={(e) => setField('discipline', e.target.value)}>
          {DISCIPLINES.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="fiche-editor-field">
        Manufacturer
        <input
          type="text"
          value={form.manufacturer}
          onChange={(e) => setField('manufacturer', e.target.value)}
          placeholder="optional"
        />
      </label>
      <label className="fiche-editor-field">
        EN norm
        <input
          type="text"
          value={form.enNorm}
          onChange={(e) => setField('enNorm', e.target.value)}
          placeholder="optional"
        />
      </label>
      <div className="custom-material-row">
        <label className="fiche-editor-field">
          Thickness (mm)
          <input
            type="number"
            min={0}
            value={form.thicknessMM}
            onChange={(e) => setField('thicknessMM', e.target.value)}
          />
        </label>
        <label className="fiche-editor-field">
          Density (kg/m³)
          <input
            type="number"
            min={0}
            value={form.densityKgM3}
            onChange={(e) => setField('densityKgM3', e.target.value)}
          />
        </label>
      </div>
      <div className="custom-material-row">
        <label className="fiche-editor-field">
          λ (W/mK)
          <input
            type="number"
            step="0.001"
            min={0}
            value={form.thermalConductivityWmK}
            onChange={(e) => setField('thermalConductivityWmK', e.target.value)}
            placeholder="from datasheet"
          />
        </label>
      </div>
      {form.name.trim() && (
        <FieldSuggest
          field="lambda"
          materialName={form.name.trim()}
          category={category}
          providerName={form.manufacturer.trim() || null}
          onAccept={(value) => setField('thermalConductivityWmK', value)}
        />
      )}
      <div className="custom-material-row">
        <label className="fiche-editor-field">
          GWP A1-A3
          <input
            type="number"
            step="0.1"
            value={form.gwpA1A3PerFunctionalUnit}
            onChange={(e) => setField('gwpA1A3PerFunctionalUnit', e.target.value)}
          />
        </label>
        <label className="fiche-editor-field">
          per
          <select value={form.functionalUnit} onChange={(e) => setField('functionalUnit', e.target.value)}>
            {FUNCTIONAL_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="custom-material-actions">
        <button type="submit">Add custom material + layer</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
