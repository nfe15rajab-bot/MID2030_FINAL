import React, { useState, useMemo, useRef, useEffect } from 'react'
import { saveSection, loadSection } from '../lib/sectionStorage.js'
import { loadCustomMaterials } from '../lib/customMaterialStorage.js'
import { acquireLock, releaseLock, heartbeat, useSectionLock } from '../lib/sectionLocks.js'
import { gwpTotalForLayers } from '../lib/gwpPerM2.js'
import { useCurrentUser } from '../context/CurrentUserContext.jsx'
import { componentSpecs } from '../data/componentSpecs.js'
import defaultLayersBySection from '../../database/defaultLayers.json'
import MaterialSearchPanel from './MaterialSearchPanel.jsx'
import CustomMaterialForm from './CustomMaterialForm.jsx'
import FieldSuggest from './FieldSuggest.jsx'
import ServiceLifeField from './ServiceLifeField.jsx'
import EndOfLifeImpactField from './EndOfLifeImpactField.jsx'
import SharedDataBanner from './SharedDataBanner.jsx'
import './MaterialSearchPanel.css'
import './FicheTechnique.css'

// Door/Window/Skylight's editor — LayerBuilder.jsx's sibling for single
// manufactured units instead of a layer stack. Reuses the exact same
// storage shape (a `layers` array, see sectionStorage.js/lcaAnalysis.js's
// module comments) so the whole calc engine and every downstream tab
// works unchanged — just a very short array: one `role: 'unit'` layer
// (the product itself, functionalUnit 'unit') plus zero or more
// `role: 'membrane'` layers (installation tape/DPC/sealant — ordinary
// layer objects, same shape as a wall layer). `role` is a UI-only tag;
// the calc engine never reads it.

function isLayerDataComplete(layer) {
  return layer.gwpA1A3PerFunctionalUnit != null
}

function hasEolImpactData(layer) {
  return (
    layer.eolC1 != null ||
    layer.eolC3 != null ||
    layer.eolC4 != null ||
    layer.eolModuleD != null ||
    layer.eolRecycledPct != null ||
    layer.eolLandfillPct != null ||
    layer.eolIncineratedPct != null
  )
}

// Same shape LayerBuilder.jsx's own materialToLayerFields/
// okobaudatPickToLayerFields produce — kept as a local duplicate rather
// than shared, matching this codebase's existing convention for small
// per-file helpers (see aiMaterialDataStorage.js's normalize()). Mirrors
// LayerBuilder.jsx's own materialToLayerFields exactly (including the
// gwpSource-is-a-real-URL / gwpSourceNote-is-descriptive-text split —
// see that file's comment for why they're never the same field) so a
// catalog pick surfaces the same EOL/service-life/confidence data
// regardless of which of the two builders it's picked through.
function materialToLayerFields(material) {
  const hasEolData =
    material.eolC1 != null || material.eolC3 != null || material.eolC4 != null || material.eolModuleD != null
  return {
    materialId: material.id,
    name: material.name,
    thermalConductivityWmK: material.thermalConductivityWmK,
    densityKgM3: material.densityKgM3,
    gwpA1A3PerFunctionalUnit: material.gwpA1A3PerFunctionalUnit ?? null,
    gwpSource: material.gwpSourceUrl ?? null,
    gwpSourceNote: material.epdSource ?? null,
    gwpConfidence: material.gwpConfidence ?? null,
    gwpConfidenceLabel: material.gwpConfidenceLabel ?? null,
    serviceLifeYears: material.serviceLifeYears ?? null,
    serviceLifeSource: material.serviceLifeYears != null ? (material.gwpConfidence === 'high' ? 'epd' : 'manual') : null,
    eolC1: material.eolC1 ?? null,
    eolC3: material.eolC3 ?? null,
    eolC4: material.eolC4 ?? null,
    eolModuleD: material.eolModuleD ?? null,
    eolEpcC2: material.eolC2 ?? null,
    eolAssumptionBasis: material.eolConfidenceLabel ?? null,
    eolSource: hasEolData ? (material.eolConfidence === 'high' ? 'epd' : 'manual') : null,
  }
}

function okobaudatPickToLayerFields(picked) {
  return {
    materialId: null,
    name: picked.name,
    thermalConductivityWmK: picked.lambda,
    densityKgM3: picked.density ?? null,
    gwpA1A3PerFunctionalUnit: picked.gwpA1A3,
    lambdaSource: picked.lambdaSource,
    okobaudatUrl: picked.okobaudatUrl,
    serviceLifeYears: picked.serviceLifeYears ?? null,
    serviceLifeSource: picked.serviceLifeYears != null ? 'epd' : null,
    eolC1: picked.eolC1 ?? null,
    eolC3: picked.eolC3 ?? null,
    eolC4: picked.eolC4 ?? null,
    eolModuleD: picked.eolModuleD ?? null,
    eolEpcC2: picked.eolC2 ?? null,
    eolSource: (picked.eolC1 != null || picked.eolC3 != null || picked.eolC4 != null || picked.eolModuleD != null) ? 'epd' : null,
  }
}

// Shared field-suggest row for GWP/service-life/end-of-life — used by
// both the unit product and every membrane, so "search if the provider
// already gave EPD values" (FieldSuggest's `gwp` field, already grounded
// in "a real EPD or Ökobaudat" — see material-autofill-server.js) is the
// exact same control everywhere in this component, not a one-off.
function ResearchFields({ layer, category, owner, onFieldAccept }) {
  return (
    <div className="unit-research-fields">
      <span className="layer-gwp">
        {layer.gwpA1A3PerFunctionalUnit != null ? `GWP=${layer.gwpA1A3PerFunctionalUnit}` : 'GWP missing'}
      </span>
      {layer.gwpA1A3PerFunctionalUnit == null && (
        <FieldSuggest
          field="gwp"
          materialName={layer.name}
          category={category}
          providerName={null}
          enteredBy={owner || null}
          allowManualEntry
          onAccept={(value, meta) => onFieldAccept(layer.instanceId, 'gwpA1A3PerFunctionalUnit', Number(value), meta)}
        />
      )}
      <span className="layer-service-life">
        {layer.serviceLifeYears != null ? (
          <>
            {layer.serviceLifeYears}yr{' '}
            <span className={`service-life-badge service-life-badge--${layer.serviceLifeSource === 'ai' ? 'unverified' : 'verified'}`}>
              {layer.serviceLifeSource === 'epd' && 'Verified — EPD sourced'}
              {layer.serviceLifeSource === 'ai' && 'Unverified — AI sourced'}
              {layer.serviceLifeSource === 'manual' && 'Verified — manual'}
            </span>
          </>
        ) : (
          <span className="layer-service-life--missing">Service life: not yet researched</span>
        )}
      </span>
      {layer.serviceLifeYears == null && (
        <ServiceLifeField
          materialName={layer.name}
          category={category}
          providerName={null}
          enteredBy={owner || null}
          onAccept={(value, source) => onFieldAccept(layer.instanceId, 'serviceLifeYears', Number(value), { source })}
        />
      )}
      <span className="layer-eol-impact">
        {hasEolImpactData(layer) ? (
          <>
            End of life:{' '}
            {layer.eolC1 != null && `C1=${layer.eolC1} `}
            {layer.eolC3 != null && `C3=${layer.eolC3} `}
            {layer.eolC4 != null && `C4=${layer.eolC4} `}
            {layer.eolModuleD != null && `D=${layer.eolModuleD} `}
            <span className={`service-life-badge service-life-badge--${layer.eolSource === 'ai' ? 'unverified' : 'verified'}`}>
              {layer.eolSource === 'epd' && 'Verified — EPD sourced'}
              {layer.eolSource === 'ai' && 'Unverified — AI sourced'}
              {layer.eolSource === 'manual' && 'Verified — manual assumption'}
            </span>
          </>
        ) : (
          <span className="layer-service-life--missing">End of life: not yet modeled</span>
        )}
      </span>
      {!hasEolImpactData(layer) && (
        <EndOfLifeImpactField
          materialName={layer.name}
          category={category}
          providerName={null}
          enteredBy={owner || null}
          onAccept={(value, source) => onFieldAccept(layer.instanceId, 'eolImpact', value, { source })}
        />
      )}
    </div>
  )
}

function MembraneRow({ layer, index, category, owner, onThicknessChange, onFieldAccept, onRemove }) {
  return (
    <div className={`layer-row${isLayerDataComplete(layer) ? ' layer-row--complete' : ''}`}>
      <span className="layer-order">{index + 1}</span>
      <span className="layer-name">{layer.name}</span>
      <input
        type="number"
        className={`layer-thickness${layer.thicknessMM == null ? ' layer-thickness--missing' : ''}`}
        value={layer.thicknessMM ?? ''}
        placeholder="?"
        min={1}
        onChange={(e) => onThicknessChange(layer.instanceId, e.target.value === '' ? null : Number(e.target.value))}
      />
      <span className="layer-unit">mm</span>
      <ResearchFields layer={layer} category={category} owner={owner} onFieldAccept={onFieldAccept} />
      <button className="layer-remove" onClick={() => onRemove(layer.instanceId)}>✕</button>
    </div>
  )
}

export default function UnitAssemblyBuilder({ materials, elementType, owner = '', onLayersChange, onDirtyChange }) {
  const strElementType = String(elementType || '')
  const category = strElementType ? (strElementType.charAt(0).toUpperCase() + strElementType.slice(1)) : ''

  // Nothing saved yet -> seed one unit layer from the first catalog
  // material (Schüco door/window, Fakro skylight) so there's a real
  // starting point, same "display-only until Save changes" rule
  // LayerBuilder's own default-seeding follows.
  const [layers, setLayers] = useState(() => {
    const saved = loadSection(elementType)?.layers
    if (saved && saved.length > 0) return saved
    const defaults = defaultLayersBySection[elementType]
    if (defaults && defaults.length > 0) return defaults
    const seedMaterial = materials[0] ?? null
    if (!seedMaterial) return []
    return [{ instanceId: `${seedMaterial.id}-${Date.now()}`, role: 'unit', count: 1, massKgPerUnit: null, ...materialToLayerFields(seedMaterial) }]
  })

  // Spec fields (dimensions, key characteristics, performance) — seeded
  // once from the old static componentSpecs.js placeholder on first
  // load, editable and saved from here on.
  const [unitSpec, setUnitSpec] = useState(() => {
    const saved = loadSection(elementType)?.unitSpec
    if (saved) return saved
    const seed = componentSpecs[elementType]
    return {
      manufacturer: seed?.provider ?? '',
      location: seed?.location ?? '',
      dimensions: seed?.dimensions ?? '',
      keyCharacteristics: seed?.keyCharacteristics ?? [],
      performanceText: seed?.performance ? Object.entries(seed.performance).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
    }
  })

  const persistedSnapshotRef = useRef(
    JSON.stringify({
      layers: loadSection(elementType)?.layers ?? null,
      unitSpec: loadSection(elementType)?.unitSpec ?? null,
    })
  )

  useEffect(() => {
    onLayersChange?.(layers)
  }, [layers, onLayersChange])

  const hasUnsavedChanges = JSON.stringify({ layers, unitSpec }) !== persistedSnapshotRef.current
  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, onDirtyChange])

  // Section-level editing lock — identical pattern to LayerBuilder.jsx,
  // see sectionLocks.js.
  const { isAdmin } = useCurrentUser()
  const { heldBy } = useSectionLock(elementType)
  useEffect(() => {
    if (!owner) return
    let cancelled = false
    let haveLock = false
    let heartbeatId = null
    const lockedAt = new Date().toISOString()

    acquireLock(elementType, { name: owner, isAdmin }).then((result) => {
      if (cancelled || !result.ok) return
      haveLock = true
      heartbeatId = setInterval(() => heartbeat(elementType, { name: owner, lockedAt }), 20_000)
    })

    return () => {
      cancelled = true
      if (heartbeatId) clearInterval(heartbeatId)
      if (haveLock) releaseLock(elementType, owner)
    }
  }, [elementType, owner, isAdmin])
  const isLockedByOther = heldBy != null && heldBy !== owner && !isAdmin

  const [customMaterialsVersion, setCustomMaterialsVersion] = useState(0)
  const allMaterials = useMemo(
    () => [...materials, ...loadCustomMaterials().filter((m) => m.category === category)],
    [materials, category, customMaterialsVersion]
  )

  const unitLayer = layers.find((l) => l.role === 'unit') ?? null
  const membraneLayers = layers.filter((l) => l.role === 'membrane')

  const [selectedUnitMaterialId, setSelectedUnitMaterialId] = useState(unitLayer?.materialId ?? materials[0]?.id ?? '')
  const [showOkobaudatSearchUnit, setShowOkobaudatSearchUnit] = useState(false)
  const [showCustomMaterialFormUnit, setShowCustomMaterialFormUnit] = useState(false)

  const [selectedMembraneMaterialId, setSelectedMembraneMaterialId] = useState(materials[0]?.id ?? '')
  const [showOkobaudatSearchMembrane, setShowOkobaudatSearchMembrane] = useState(false)
  const [showCustomMaterialFormMembrane, setShowCustomMaterialFormMembrane] = useState(false)

  const [lastSaved, setLastSaved] = useState(() => {
    const record = loadSection(elementType)
    return record ? { owner: record.owner, savedAt: record.savedAt } : null
  })

  function replaceUnitLayer(fields) {
    setLayers((prev) => [
      { instanceId: `unit-${Date.now()}`, role: 'unit', count: unitLayer?.count ?? 1, massKgPerUnit: unitLayer?.massKgPerUnit ?? null, ...fields },
      ...prev.filter((l) => l.role !== 'unit'),
    ])
  }

  function handlePickUnitFromCatalog(id) {
    setSelectedUnitMaterialId(id)
    const material = allMaterials.find((m) => m.id === id)
    if (!material) return
    replaceUnitLayer(materialToLayerFields(material))
  }

  function handleUnitOkobaudatSelect(picked) {
    replaceUnitLayer(okobaudatPickToLayerFields(picked))
    setShowOkobaudatSearchUnit(false)
  }

  function handleUnitCustomMaterialCreate(material) {
    setCustomMaterialsVersion((v) => v + 1)
    replaceUnitLayer(materialToLayerFields(material))
    setSelectedUnitMaterialId(material.id)
    setShowCustomMaterialFormUnit(false)
  }

  function addMembrane() {
    const material = allMaterials.find((m) => m.id === selectedMembraneMaterialId)
    if (!material) return
    setLayers((prev) => [
      ...prev,
      { instanceId: `${material.id}-${Date.now()}`, role: 'membrane', thicknessMM: material.thicknessMM ?? null, ...materialToLayerFields(material) },
    ])
  }

  function handleMembraneOkobaudatSelect(picked) {
    setLayers((prev) => [
      ...prev,
      { instanceId: `okobaudat-${Date.now()}`, role: 'membrane', thicknessMM: null, ...okobaudatPickToLayerFields(picked) },
    ])
    setShowOkobaudatSearchMembrane(false)
  }

  function handleMembraneCustomMaterialCreate(material) {
    setCustomMaterialsVersion((v) => v + 1)
    setLayers((prev) => [
      ...prev,
      { instanceId: `${material.id}-${Date.now()}`, role: 'membrane', thicknessMM: material.thicknessMM ?? null, ...materialToLayerFields(material) },
    ])
    setSelectedMembraneMaterialId(material.id)
    setShowCustomMaterialFormMembrane(false)
  }

  function onFieldAccept(instanceId, field, value, meta) {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.instanceId !== instanceId) return l
        if (field === 'eolImpact') {
          return {
            ...l,
            eolRecycledPct: value.recycledPct ?? null,
            eolLandfillPct: value.landfillPct ?? null,
            eolIncineratedPct: value.incineratedPct ?? null,
            eolC1: value.c1 ?? null,
            eolC3: value.c3 ?? null,
            eolC4: value.c4 ?? null,
            eolModuleD: value.moduleD ?? null,
            eolAssumptionBasis: value.assumptionBasis ?? null,
            eolSource: meta?.source ?? null,
          }
        }
        const next = { ...l, [field]: value }
        if (field === 'gwpA1A3PerFunctionalUnit' && meta) {
          next.gwpSource = meta.sourceUrl ?? null
          next.gwpConfidence = meta.confidence ?? null
          next.gwpConfidenceLabel = meta.confidenceLabel ?? null
        }
        if (field === 'serviceLifeYears' && meta) {
          next.serviceLifeSource = meta.source
        }
        return next
      })
    )
  }

  function onCountChange(value) {
    setLayers((prev) => prev.map((l) => (l.role === 'unit' ? { ...l, count: value } : l)))
  }
  function onMassPerUnitChange(value) {
    setLayers((prev) => prev.map((l) => (l.role === 'unit' ? { ...l, massKgPerUnit: value } : l)))
  }
  function onThicknessChange(instanceId, value) {
    setLayers((prev) => prev.map((l) => (l.instanceId === instanceId ? { ...l, thicknessMM: value } : l)))
  }
  function onRemoveMembrane(instanceId) {
    setLayers((prev) => prev.filter((l) => l.instanceId !== instanceId))
  }

  function handleSave() {
    const record = saveSection(elementType, { layers, owner: owner || 'Unassigned', unitSpec })
    setLastSaved({ owner: record.owner, savedAt: record.savedAt })
    persistedSnapshotRef.current = JSON.stringify({ layers, unitSpec })
  }

  // Real thickness/density-scaled total (see gwpPerM2.js) — the unit
  // layer's own gwp is already a whole-unit figure (left as-is), but
  // membrane layers (m2/m3/kg-declared) need the same scaling every other
  // assembly type gets. No Part A floor area applies to a single
  // manufactured unit, so this always uses the honest "per 1m²"/area=1
  // fallback, same as assemblyAnalysis.js's UNIT_ASSEMBLY_KEYS treatment.
  const { total: gwpTotal, known: gwpKnown } = gwpTotalForLayers(layers, allMaterials, null)

  return (
    <div className="unit-assembly-builder">
      {heldBy && heldBy !== owner && (
        <div className={isLockedByOther ? 'lock-banner lock-banner--locked' : 'lock-banner lock-banner--admin-override'}>
          {isLockedByOther
            ? `🔒 In use by ${heldBy} — read-only. Option is used by another user.`
            : `🔓 Locked by ${heldBy} — editing here will take over.`}
        </div>
      )}
      <div className={isLockedByOther ? 'unit-assembly-content unit-assembly-content--locked' : 'unit-assembly-content'}>
        <SharedDataBanner />

        <h3 className="unit-section-heading">Product</h3>
        <div className="add-layer-controls">
          <select value={selectedUnitMaterialId} onChange={(e) => handlePickUnitFromCatalog(e.target.value)}>
            {allMaterials.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => setShowOkobaudatSearchUnit((s) => !s)}>
            {showOkobaudatSearchUnit ? 'Hide Ökobaudat search' : 'Search Ökobaudat'}
          </button>
          <button type="button" onClick={() => setShowCustomMaterialFormUnit((s) => !s)}>
            {showCustomMaterialFormUnit ? 'Hide custom material form' : '+ Create custom product'}
          </button>
        </div>

        {showOkobaudatSearchUnit && (
          <div className="okobaudat-search-section">
            <MaterialSearchPanel onSelect={handleUnitOkobaudatSelect} />
          </div>
        )}
        {showCustomMaterialFormUnit && (
          <div className="okobaudat-search-section">
            <CustomMaterialForm category={category} onCreate={handleUnitCustomMaterialCreate} onCancel={() => setShowCustomMaterialFormUnit(false)} />
          </div>
        )}

        {unitLayer && (
          <div className="unit-product-panel">
            <p className="unit-product-name"><strong>{unitLayer.name}</strong></p>
            <div className="unit-product-row">
              <label className="fiche-editor-field">
                Count (how many installed)
                <input type="number" min={1} value={unitLayer.count ?? 1} onChange={(e) => onCountChange(e.target.value === '' ? 1 : Number(e.target.value))} />
              </label>
              <label className="fiche-editor-field">
                Mass per unit (kg)
                <input
                  type="number"
                  min={0}
                  value={unitLayer.massKgPerUnit ?? ''}
                  placeholder="?"
                  onChange={(e) => onMassPerUnitChange(e.target.value === '' ? null : Number(e.target.value))}
                />
              </label>
            </div>
            <ResearchFields layer={unitLayer} category={category} owner={owner} onFieldAccept={onFieldAccept} />
          </div>
        )}

        <h3 className="unit-section-heading">Specs</h3>
        <div className="unit-spec-form">
          <div className="custom-material-row">
            <label className="fiche-editor-field">
              Manufacturer
              <input type="text" value={unitSpec.manufacturer} onChange={(e) => setUnitSpec((s) => ({ ...s, manufacturer: e.target.value }))} />
            </label>
            <label className="fiche-editor-field">
              Provider location
              <input type="text" value={unitSpec.location} onChange={(e) => setUnitSpec((s) => ({ ...s, location: e.target.value }))} />
            </label>
          </div>
          <label className="fiche-editor-field">
            Dimensions
            <input type="text" value={unitSpec.dimensions} onChange={(e) => setUnitSpec((s) => ({ ...s, dimensions: e.target.value }))} />
          </label>
          <label className="fiche-editor-field">
            Key characteristics (one per line)
            <textarea
              rows={4}
              value={unitSpec.keyCharacteristics.join('\n')}
              onChange={(e) => setUnitSpec((s) => ({ ...s, keyCharacteristics: e.target.value.split('\n') }))}
            />
          </label>
          <label className="fiche-editor-field">
            Performance (one "label: value" per line — e.g. U-value, sound reduction)
            <textarea
              rows={4}
              value={unitSpec.performanceText}
              onChange={(e) => setUnitSpec((s) => ({ ...s, performanceText: e.target.value }))}
            />
          </label>
        </div>

        <h3 className="unit-section-heading">Additional membranes</h3>
        <p className="unit-membranes-hint">Installation tape, DPC membrane, sealant — anything extra needed to install this unit.</p>
        <div className="add-layer-controls">
          <select value={selectedMembraneMaterialId} onChange={(e) => setSelectedMembraneMaterialId(e.target.value)}>
            {allMaterials.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button onClick={addMembrane}>+ Add membrane</button>
          <button type="button" onClick={() => setShowOkobaudatSearchMembrane((s) => !s)}>
            {showOkobaudatSearchMembrane ? 'Hide Ökobaudat search' : 'Search Ökobaudat'}
          </button>
          <button type="button" onClick={() => setShowCustomMaterialFormMembrane((s) => !s)}>
            {showCustomMaterialFormMembrane ? 'Hide custom material form' : '+ Create custom material'}
          </button>
        </div>

        {showOkobaudatSearchMembrane && (
          <div className="okobaudat-search-section">
            <MaterialSearchPanel onSelect={handleMembraneOkobaudatSelect} />
          </div>
        )}
        {showCustomMaterialFormMembrane && (
          <div className="okobaudat-search-section">
            <CustomMaterialForm category={category} onCreate={handleMembraneCustomMaterialCreate} onCancel={() => setShowCustomMaterialFormMembrane(false)} />
          </div>
        )}

        <div className="layer-stack">
          {membraneLayers.length === 0 && <p className="empty-state">No membranes added yet.</p>}
          {membraneLayers.map((layer, index) => (
            <MembraneRow
              key={layer.instanceId}
              layer={layer}
              index={index}
              category={category}
              owner={owner}
              onThicknessChange={onThicknessChange}
              onFieldAccept={onFieldAccept}
              onRemove={onRemoveMembrane}
            />
          ))}
        </div>

        <div className="uvalue-summary">
          <p>
            <strong>GWP A1-A3 sum: {gwpKnown.length > 0 ? `${gwpTotal.toFixed(1)} kg CO₂e` : '—'}</strong>
            {layers.length > 0 && ` (${gwpKnown.length}/${layers.length} items have data)`}
          </p>
          <p className="gwp-caveat">
            Product row is count-multiplied; membrane rows are thickness/density-scaled (same formula
            as Wall/Roof/Floor) — A4 transport is separate and lives in LCA and EPD / LCA Summary once
            this is saved.
          </p>
        </div>

        <div className="section-save-bar">
          <button type="button" onClick={handleSave} disabled={!owner}>
            Save changes
          </button>
          {!owner && <span className="section-save-hint">Pick who's logged in above to save.</span>}
          {owner && lastSaved && (
            <span className="section-save-hint">
              Last saved by {lastSaved.owner} · {new Date(lastSaved.savedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
