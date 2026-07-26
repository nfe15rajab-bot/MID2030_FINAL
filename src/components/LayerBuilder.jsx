import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { calculateUValue } from '../lib/uvalue.js'
import { gwpPerM2ForLayers, gwpTotalForLayers } from '../lib/gwpPerM2.js'
import { loadAssemblyGeometry } from '../lib/assemblyGeometryStorage.js'
import { saveSection, loadSection } from '../lib/sectionStorage.js'
import { exportTrueScaleSection } from '../lib/sectionExportClient.js'
import { loadCustomMaterials } from '../lib/customMaterialStorage.js'
import { acquireLock, releaseLock, heartbeat, useSectionLock } from '../lib/sectionLocks.js'
import { readSectionDataFromPdf } from '../lib/pdfSessionAttachment.js'
import { useCurrentUser } from '../context/CurrentUserContext.jsx'
import defaultLayersBySection from '../../database/defaultLayers.json'
import MaterialSearchPanel from './MaterialSearchPanel.jsx'
import SectionPreview from './SectionPreview.jsx'
import CustomMaterialForm from './CustomMaterialForm.jsx'
import FieldSuggest from './FieldSuggest.jsx'
import ServiceLifeField from './ServiceLifeField.jsx'
import EndOfLifeImpactField from './EndOfLifeImpactField.jsx'
import SharedDataBanner from './SharedDataBanner.jsx'
import './MaterialSearchPanel.css'
import './SectionPreview.css'
import './FicheTechnique.css'

// LayerBuilder's elementType ('wall' | 'roof' | 'floor' | 'window') to the
// discipline keys used by lambdaProviders.json / MaterialSearchPanel.
const DISCIPLINE_BY_ELEMENT_TYPE = {
  wall: 'Wall',
  roof: 'Roof',
  floor: 'Floor',
  window: 'Roof windows',
}

// Completeness indicator: green once GWP, density, and λ are ALL
// populated — verified or not, since verification is a separate concern
// (field-suggest-badge) from "is there a number here at all" for the A4
// mass calc (needs density) and A1-A3/A4 calcs (need GWP/λ). Thickness is
// deliberately excluded — it's geometry the user always types by hand,
// not a research/Suggest field, so it doesn't belong in the same signal
// as the three researched material properties.
function isLayerDataComplete(layer) {
  return (
    layer.gwpA1A3PerFunctionalUnit != null &&
    layer.densityKgM3 != null &&
    layer.thermalConductivityWmK != null
  )
}

// "Has some end-of-life impact data" — any ONE of C1/C3/C4/D or the route
// percentages counts (see EndOfLifeImpactField.jsx: every sub-field is
// independently gettable, not all-or-nothing), same reasoning as
// endOfLifeImpact's server-side normalizeSuggestions accepting a partial
// result rather than requiring every field.
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

// Shared by addLayer/handleCustomMaterialCreate/onOkobaudatSelect AND the
// "change material" swap path below — one place defining what fields a
// catalog material vs. an Ökobaudat pick contributes to a layer, so add
// and swap can never drift apart on what counts as "the material's data".
// Catalog materials now carry researched EOL/service-life data too (see
// database/materials.json's eolC1/eolC3/eolC4/eolModuleD/eolC2/
// serviceLifeYears fields) — mirrors okobaudatPickToLayerFields below so a
// catalog pick surfaces the same "Verified"/confidence badges an Ökobaudat
// pick already gets, instead of showing "not yet researched" for data that
// actually exists. eolSource/serviceLifeSource are tagged 'epd' only when
// the catalog record itself cites a real EPD/Ökobaudat source
// (gwpConfidence/eolConfidence present) — a lower-confidence proxy/generic
// dataset match is tagged 'manual' instead, per CLAUDE.md's rule to never
// silently present a lower-confidence number as if it were verified.
function materialToLayerFields(material) {
  const hasEolData =
    material.eolC1 != null || material.eolC3 != null || material.eolC4 != null || material.eolModuleD != null
  return {
    materialId: material.id,
    name: material.name,
    thermalConductivityWmK: material.thermalConductivityWmK,
    densityKgM3: material.densityKgM3,
    gwpA1A3PerFunctionalUnit: material.gwpA1A3PerFunctionalUnit ?? null,
    // gwpSource is a real clickable URL when we have one (epdReferenceList.js
    // treats it as exactly that, same contract as an AI-Suggest-accepted
    // value's meta.sourceUrl — never point it at descriptive text). The
    // human-readable "where this came from" note is a separate field,
    // gwpSourceNote, so the two can never be confused with each other.
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

function SortableLayerRow({
  layer,
  index,
  category,
  owner,
  onThicknessChange,
  onFieldAccept,
  onRemove,
  isChangingMaterial,
  onToggleChangeMaterial,
  changeMaterialPanel,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: layer.instanceId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <>
    <div
      ref={setNodeRef}
      style={style}
      className={`layer-row${isLayerDataComplete(layer) ? ' layer-row--complete' : ''}`}
    >
      <span className="drag-handle" {...attributes} {...listeners}>⠿</span>
      <span className="layer-order">{index + 1}</span>
      <span className="layer-name">{layer.name}</span>
      <input
        type="number"
        className={`layer-thickness${layer.thicknessMM == null ? ' layer-thickness--missing' : ''}`}
        value={layer.thicknessMM ?? ''}
        placeholder="?"
        min={1}
        onChange={(e) =>
          onThicknessChange(layer.instanceId, e.target.value === '' ? null : Number(e.target.value))
        }
      />
      <span className="layer-unit">mm</span>
      <span className="layer-lambda">
        {layer.thermalConductivityWmK ? `λ=${layer.thermalConductivityWmK}` : 'λ missing'}
      </span>
      {layer.thermalConductivityWmK == null && (
        <FieldSuggest
          field="lambda"
          materialName={layer.name}
          category={category}
          providerName={null}
          enteredBy={owner || null}
          allowManualEntry
          onAccept={(value) => onFieldAccept(layer.instanceId, 'thermalConductivityWmK', Number(value))}
        />
      )}
      <span className="layer-gwp">
        {layer.gwpA1A3PerFunctionalUnit != null
          ? `GWP=${layer.gwpA1A3PerFunctionalUnit}`
          : 'GWP missing'}
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
      <span className="layer-density">
        {layer.densityKgM3 != null ? `ρ=${layer.densityKgM3}` : 'density missing'}
      </span>
      {layer.densityKgM3 == null && (
        <FieldSuggest
          field="density"
          materialName={layer.name}
          category={category}
          providerName={null}
          enteredBy={owner || null}
          allowManualEntry
          onAccept={(value) => onFieldAccept(layer.instanceId, 'densityKgM3', Number(value))}
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
      <button
        type="button"
        className="layer-change-material"
        onClick={() => onToggleChangeMaterial(layer.instanceId)}
      >
        {isChangingMaterial ? 'Cancel' : 'Change material'}
      </button>
      <button className="layer-remove" onClick={() => onRemove(layer.instanceId)}>✕</button>
    </div>
    {isChangingMaterial && (
      <div className="layer-change-material-panel">{changeMaterialPanel}</div>
    )}
    </>
  )
}

export default function LayerBuilder({ materials, elementType = 'wall', owner = '', onLayersChange, onPitchChange, onDirtyChange }) {
  const safeElementType = typeof elementType === 'string' && elementType ? elementType : 'wall'
  const category = safeElementType.charAt(0).toUpperCase() + safeElementType.slice(1)
  // Nothing saved yet for this section -> show the real group2_v2-derived
  // defaults (database/defaultLayers.json, seeded from the midterm deck's
  // actual material choices) instead of an empty stack, so a fresh team
  // member sees a real starting point rather than nothing. Still requires
  // an explicit "Save changes" click to persist — this is display-only
  // until then, and never overwrites anything already saved for real.
  const [layers, setLayers] = useState(() => {
    const saved = loadSection(elementType)?.layers
    if (saved) return saved
    const defaults = defaultLayersBySection[elementType] ?? []
    return defaults.map((l) => ({ ...l, instanceId: `${l.materialId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }))
  })
  // Snapshot of what's actually persisted (loadSection's own layers, or
  // null if nothing's been saved yet — deliberately NOT the default-seeded
  // array above, so an untouched fresh section still counts as "unsaved"),
  // used to detect real edits for the leave-without-saving guard below.
  // Re-pointed to the just-saved state inside handleSave, not tracked via
  // useState — this only needs to be read, never trigger a render itself.
  const persistedSnapshotRef = useRef(
    JSON.stringify({
      layers: loadSection(elementType)?.layers ?? null,
      pitchDeg: elementType === 'roof' ? loadSection(elementType)?.pitchDeg ?? null : null,
    })
  )
  // Roof-only: the manual pitch angle SectionPreview rotates its layer
  // stack by. Lives here (not in SectionPreview itself) since it's an
  // editable input, not a derived/display value — SectionPreview only
  // ever receives it as a prop. No 3D auto-detection; the team types the
  // real pitch in. Default (20°) is measured from the professor's actual
  // Revit model, not a guess — see SectionPreview.jsx's DEFAULT_PITCH_DEG
  // comment for how it was derived.
  const [pitchDeg, setPitchDeg] = useState(() => loadSection(elementType)?.pitchDeg ?? 20)
  // Optional — lets a parent (Assembly Analysis Preview's split-pane
  // workbench, and now Section Configurator's own live diagram pane)
  // mirror this component's own in-memory layers/pitch on every edit,
  // with no "Save changes" gate, so a sibling preview can recompute live
  // instead of only reflecting whatever's last saved to sectionStorage.
  useEffect(() => {
    onLayersChange?.(layers)
  }, [layers, onLayersChange])
  useEffect(() => {
    onPitchChange?.(pitchDeg)
  }, [pitchDeg, onPitchChange])
  // Unsaved-changes guard (see SectionConfigurator.jsx/App.jsx) — lets a
  // parent warn before navigating away instead of silently losing
  // whatever's in `layers`/`pitchDeg` the way switching tabs always used
  // to. Compares against persistedSnapshotRef, not against `lastSaved`
  // (which only tracks who/when, not the actual saved content).
  const hasUnsavedChanges = JSON.stringify({
    layers,
    pitchDeg: elementType === 'roof' ? pitchDeg : null,
  }) !== persistedSnapshotRef.current
  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, onDirtyChange])
  const [customMaterialsVersion, setCustomMaterialsVersion] = useState(0)
  // Custom materials (created via the form below) merged on top of the
  // catalog materials passed in — same list shape, so the rest of this
  // component (dropdown, addLayer) doesn't need to know the difference.
  const allMaterials = useMemo(
    () => [...materials, ...loadCustomMaterials().filter((m) => m.category === category)],
    [materials, category, customMaterialsVersion]
  )
  const [selectedMaterialId, setSelectedMaterialId] = useState(materials[0]?.id ?? '')
  const [showOkobaudatSearch, setShowOkobaudatSearch] = useState(false)
  const [showCustomMaterialForm, setShowCustomMaterialForm] = useState(false)
  // Which existing layer's "change material" panel is open, if any — only
  // one at a time, same pattern as showOkobaudatSearch. Reuses the two
  // ways of picking a material addLayer already offers (catalog dropdown,
  // Ökobaudat search) rather than inventing a third.
  const [changingLayerId, setChangingLayerId] = useState(null)
  const [changeMaterialTargetId, setChangeMaterialTargetId] = useState(materials[0]?.id ?? '')
  const [showOkobaudatForChange, setShowOkobaudatForChange] = useState(false)
  const [pdfImportError, setPdfImportError] = useState(null)
  const pdfImportInputRef = useRef(null)
  const [lastSaved, setLastSaved] = useState(() => {
    const record = loadSection(elementType)
    return record ? { owner: record.owner, savedAt: record.savedAt } : null
  })
  const [exporting, setExporting] = useState(false)
  const [exportingScale, setExportingScale] = useState(false)
  const [scaleExportError, setScaleExportError] = useState(null)
  const previewRef = useRef(null)

  // Section-level editing lock (Group 2 only — see sectionLocks.js).
  // Mount = "entered this section", unmount = "left it", matching
  // SectionConfigurator's key={`layer-builder-${activeSection}-...`}
  // remount-per-section pattern exactly. Admins always force-acquire;
  // anyone else who loses the race just doesn't get a heartbeat/release
  // of their own — see haveLock below, and releaseLock's own no-op guard
  // for the case where an admin took over before this tab's cleanup runs.
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleSave() {
    const record = saveSection(elementType, {
      layers,
      owner: owner || 'Unassigned',
      pitchDeg: elementType === 'roof' ? pitchDeg : undefined,
    })
    setLastSaved({ owner: record.owner, savedAt: record.savedAt })
    persistedSnapshotRef.current = JSON.stringify({
      layers,
      pitchDeg: elementType === 'roof' ? pitchDeg : null,
    })
  }

  function handlePdfImportClick() {
    pdfImportInputRef.current?.click()
  }

  // Reads a section PDF this app generated (see pdfSessionAttachment.js /
  // SectionPdfButton in DeliverablesTab.jsx) and loads its embedded layers
  // in place of whatever's currently in the editor — same "display-only
  // until Save changes" rule as the default-seeded layers above, so this
  // is fully reversible until the user actually saves.
  async function handlePdfImportFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setPdfImportError(null)
    let payload
    try {
      payload = await readSectionDataFromPdf(await file.arrayBuffer())
    } catch (err) {
      setPdfImportError(`Couldn't read that PDF: ${err.message}`)
      return
    }
    if (!payload) {
      setPdfImportError("This PDF wasn't generated by this app (or predates this feature) — no embedded layer data found.")
      return
    }

    const importedLayers = payload.record?.layers ?? []
    const sectionNote = payload.section !== elementType ? ` (it was generated from the "${payload.section}" section, not "${elementType}")` : ''
    const confirmed = window.confirm(
      `Replace this section's ${layers.length} layer(s) with ${importedLayers.length} from the PDF${sectionNote}, ` +
        `saved by ${payload.record?.owner ?? 'someone'} on ${payload.record?.savedAt ? new Date(payload.record.savedAt).toLocaleString() : 'an unknown date'}? ` +
        'Nothing is saved until you click "Save changes" yourself.'
    )
    if (!confirmed) return

    setLayers(importedLayers)
    if (elementType === 'roof' && payload.record?.pitchDeg != null) {
      setPitchDeg(payload.record.pitchDeg)
    }
  }

  async function handleExportPdf() {
    if (!previewRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(previewRef.current, { scale: 2, backgroundColor: '#ffffff' })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height)
      pdf.save(`${elementType}-section.pdf`)
    } finally {
      setExporting(false)
    }
  }

  async function handleExportTrueScale() {
    setExportingScale(true)
    setScaleExportError(null)
    try {
      await exportTrueScaleSection({
        section: safeElementType.charAt(0).toUpperCase() + safeElementType.slice(1),
        owner: lastSaved?.owner ?? owner ?? '',
        savedAt: lastSaved?.savedAt ?? null,
        layers,
        // Roof-only — generate.py only actually rotates when section is
        // "Roof", so sending this for wall/floor is harmless.
        pitchDeg: elementType === 'roof' ? pitchDeg : undefined,
      })
    } catch (err) {
      setScaleExportError(err.message)
    } finally {
      setExportingScale(false)
    }
  }

  function addLayer() {
    const material = allMaterials.find((m) => m.id === selectedMaterialId)
    if (!material) return
    setLayers((prev) => [
      ...prev,
      {
        instanceId: `${material.id}-${Date.now()}`,
        // Don't invent a thickness the catalog doesn't have — leave it null
        // so the UI/U-value calc/section generator all flag it instead of
        // silently treating an unknown material as if it were 10mm.
        thicknessMM: material.thicknessMM ?? null,
        ...materialToLayerFields(material),
      },
    ])
  }

  // Custom material was just saved to localStorage (customMaterialStorage.js)
  // by the form — bump the version so allMaterials picks it up, then add it
  // as a layer immediately, same as picking an existing catalog material.
  function handleCustomMaterialCreate(material) {
    setCustomMaterialsVersion((v) => v + 1)
    setLayers((prev) => [
      ...prev,
      {
        instanceId: `${material.id}-${Date.now()}`,
        thicknessMM: material.thicknessMM ?? null,
        ...materialToLayerFields(material),
      },
    ])
    setSelectedMaterialId(material.id)
    setShowCustomMaterialForm(false)
  }

  function onOkobaudatSelect(picked) {
    setLayers((prev) => [
      ...prev,
      {
        instanceId: `okobaudat-${Date.now()}`,
        // Ökobaudat doesn't return a physical thickness (only GWP per
        // declared unit) — same reasoning as addLayer() above, leave it
        // unset rather than inventing 10mm.
        thicknessMM: null,
        ...okobaudatPickToLayerFields(picked),
      },
    ])
    setShowOkobaudatSearch(false)
  }

  // "Change material" on an existing layer — keeps instanceId and the
  // user-typed thicknessMM (geometry the user entered by hand), replaces
  // every material-specific researched field (λ/GWP/density/service
  // life/end-of-life + their provenance) with a clean slate, since
  // carrying the OLD material's research over would misattribute it to a
  // material it was never actually sourced for. This is the only way
  // fields not present in `fields` (e.g. eolC1 when swapping to a catalog
  // material, which has no end-of-life data at all) reliably end up null
  // instead of stale.
  function swapLayerMaterial(instanceId, fields) {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.instanceId !== instanceId) return l
        return {
          instanceId: l.instanceId,
          thicknessMM: l.thicknessMM,
          lambdaSource: null,
          okobaudatUrl: null,
          serviceLifeYears: null,
          serviceLifeSource: null,
          eolC1: null,
          eolC3: null,
          eolC4: null,
          eolModuleD: null,
          eolEpcC2: null,
          eolSource: null,
          eolRecycledPct: null,
          eolLandfillPct: null,
          eolIncineratedPct: null,
          eolAssumptionBasis: null,
          gwpSource: null,
          gwpConfidence: null,
          gwpConfidenceLabel: null,
          ...fields,
        }
      })
    )
    setChangingLayerId(null)
    setShowOkobaudatForChange(false)
  }

  function handleChangeMaterialFromCatalog(instanceId) {
    const material = allMaterials.find((m) => m.id === changeMaterialTargetId)
    if (!material) return
    swapLayerMaterial(instanceId, materialToLayerFields(material))
  }

  function handleChangeMaterialFromOkobaudat(instanceId, picked) {
    swapLayerMaterial(instanceId, okobaudatPickToLayerFields(picked))
  }

  function onToggleChangeMaterial(instanceId) {
    setChangingLayerId((prev) => (prev === instanceId ? null : instanceId))
    setShowOkobaudatForChange(false)
  }

  function onThicknessChange(instanceId, value) {
    setLayers((prev) =>
      prev.map((l) => (l.instanceId === instanceId ? { ...l, thicknessMM: value } : l))
    )
  }

  // Accepting a Suggest result for an existing layer's missing λ/GWP —
  // updates just this layer instance, same as thickness edits. Layers
  // already carry their own copy of these fields regardless of source
  // (catalog, Ökobaudat, or custom material), so this needs no new
  // storage — it's the same field, just filled in later.
  // meta is optional (FieldSuggest's second onAccept arg) — only the GWP
  // field persists it (as gwpSource/gwpConfidence/gwpConfidenceLabel on
  // the layer itself), since that's what the EPD reference list needs a
  // citable source for. A manual edit to the GWP number afterward isn't
  // routed through here, so it doesn't get a chance to leave stale
  // provenance behind the way the fiche's end-of-life/provider fields do.
  function onFieldAccept(instanceId, field, value, meta) {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.instanceId !== instanceId) return l
        // EndOfLifeImpactField.jsx's onAccept passes a whole structured
        // object (route % split + C1/C3/C4/D), not a single scalar — no
        // real `layer.eolImpact` field exists to assign it to; it's
        // spread into the same flat eol* fields onOkobaudatSelect already
        // uses for the EPD tier, so lcaAnalysis.js reads one consistent
        // shape regardless of which tier filled it.
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
        // ServiceLifeField's onAccept passes 'ai' | 'manual' as meta —
        // needed alongside the value itself so the row can render the
        // right one of its two post-fill badges (EPD tier is set
        // separately, at Ökobaudat-pick time — see onOkobaudatSelect).
        if (field === 'serviceLifeYears' && meta) {
          next.serviceLifeSource = meta.source
        }
        return next
      })
    )
  }

  function onRemove(instanceId) {
    setLayers((prev) => prev.filter((l) => l.instanceId !== instanceId))
  }

  function onDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setLayers((prev) => {
      const oldIndex = prev.findIndex((l) => l.instanceId === active.id)
      const newIndex = prev.findIndex((l) => l.instanceId === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  const { uValue, rTotal, missingData } = useMemo(
    () => calculateUValue(layers, elementType),
    [layers, elementType]
  )

  // Real thickness/area-scaled GWP total (see gwpPerM2.js) — uses this
  // assembly's actual Part A floor area when it's been entered
  // (assemblyGeometryStorage.js), falling back to a "per 1m²" figure
  // otherwise. This used to be a naive raw sum of per-declared-unit
  // values (a 260mm and a 50mm layer of the same m3-declared material
  // counted equally) — same bug independently fixed in
  // assemblyAnalysis.js/TeamSummaryTab.jsx/SectionConfigurator.jsx, all
  // now sharing this one formula so they can't drift apart again.
  const geometry = loadAssemblyGeometry(elementType)
  const { total: gwpTotal, known: gwpKnownLayers, areaUsed: gwpAreaUsed } = gwpTotalForLayers(layers, allMaterials, geometry?.surfaceAreaM2)

  // Per-layer breakdown at a pinned 1m² — same formula, just useful to see
  // each layer's own contribution regardless of whether Part A's real area
  // has been entered yet. Shared with AssemblyAnalysisTab.jsx's GWP bar
  // chart so the two can never independently drift on this again.
  const { breakdown: perM2Breakdown, known: perM2Known, total: perM2Total } = gwpPerM2ForLayers(layers, allMaterials)

  return (
    <div className="layer-builder">
      {heldBy && heldBy !== owner && (
        <div className={isLockedByOther ? 'lock-banner lock-banner--locked' : 'lock-banner lock-banner--admin-override'}>
          {isLockedByOther
            ? `🔒 In use by ${heldBy} — read-only. Option is used by another user.`
            : `🔓 Locked by ${heldBy} — editing here will take over.`}
        </div>
      )}
      <div className={isLockedByOther ? 'layer-builder-content layer-builder-content--locked' : 'layer-builder-content'}>
      <SharedDataBanner />
      <div className="add-layer-controls">
        <select value={selectedMaterialId} onChange={(e) => setSelectedMaterialId(e.target.value)}>
          {allMaterials.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <button onClick={addLayer}>+ Add layer</button>
        <button type="button" onClick={() => setShowOkobaudatSearch((s) => !s)}>
          {showOkobaudatSearch ? 'Hide Ökobaudat search' : 'Search Ökobaudat'}
        </button>
        <button type="button" onClick={() => setShowCustomMaterialForm((s) => !s)}>
          {showCustomMaterialForm ? 'Hide custom material form' : '+ Create custom material'}
        </button>
        <button type="button" onClick={handlePdfImportClick}>
          Generate layers from PDF
        </button>
        <input
          ref={pdfImportInputRef}
          type="file"
          accept="application/pdf"
          onChange={handlePdfImportFileChange}
          style={{ display: 'none' }}
        />
      </div>
      {pdfImportError && <p className="scale-export-error">{pdfImportError}</p>}

      {showOkobaudatSearch && (
        <div className="okobaudat-search-section">
          <MaterialSearchPanel
            defaultDiscipline={DISCIPLINE_BY_ELEMENT_TYPE[elementType] ?? 'Wall'}
            onSelect={onOkobaudatSelect}
          />
        </div>
      )}

      {showCustomMaterialForm && (
        <div className="okobaudat-search-section">
          <CustomMaterialForm
            category={category}
            onCreate={handleCustomMaterialCreate}
            onCancel={() => setShowCustomMaterialForm(false)}
          />
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={layers.map((l) => l.instanceId)} strategy={verticalListSortingStrategy}>
          <div className="layer-stack">
            {layers.length === 0 && <p className="empty-state">No layers yet — add one above.</p>}
            {layers.map((layer, index) => (
              <SortableLayerRow
                key={layer.instanceId}
                layer={layer}
                index={index}
                category={category}
                owner={owner}
                onThicknessChange={onThicknessChange}
                onFieldAccept={onFieldAccept}
                onRemove={onRemove}
                isChangingMaterial={changingLayerId === layer.instanceId}
                onToggleChangeMaterial={onToggleChangeMaterial}
                changeMaterialPanel={
                  changingLayerId === layer.instanceId ? (
                    <>
                      <div className="change-material-controls">
                        <select value={changeMaterialTargetId} onChange={(e) => setChangeMaterialTargetId(e.target.value)}>
                          {allMaterials.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => handleChangeMaterialFromCatalog(layer.instanceId)}>
                          Use this material
                        </button>
                        <button type="button" onClick={() => setShowOkobaudatForChange((s) => !s)}>
                          {showOkobaudatForChange ? 'Hide Ökobaudat search' : 'Search Ökobaudat instead'}
                        </button>
                      </div>
                      {showOkobaudatForChange && (
                        <MaterialSearchPanel
                          defaultDiscipline={DISCIPLINE_BY_ELEMENT_TYPE[elementType] ?? 'Wall'}
                          onSelect={(picked) => handleChangeMaterialFromOkobaudat(layer.instanceId, picked)}
                        />
                      )}
                      <p className="change-material-note">
                        Thickness ({layer.thicknessMM != null ? `${layer.thicknessMM}mm` : 'not set'}) is kept —
                        λ/GWP/density/service life/end-of-life will reset for the new material.
                      </p>
                    </>
                  ) : null
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="uvalue-summary">
        {missingData ? (
          <p>U-value: — (add layers with thickness + λ to calculate)</p>
        ) : (
          <>
            <p>R_total = {rTotal.toFixed(3)} m²K/W</p>
            <p><strong>U-value = {uValue.toFixed(3)} W/m²K</strong></p>
          </>
        )}
        <p>
          <strong>GWP A1-A3 total: {gwpKnownLayers.length > 0 ? `${gwpTotal.toFixed(1)} kg CO₂e` : '—'}</strong>
          {layers.length > 0 && ` (${gwpKnownLayers.length}/${layers.length} layers have data)`}
        </p>
        {gwpKnownLayers.length > 0 && (
          <p className="gwp-caveat">
            {geometry?.surfaceAreaM2
              ? `Thickness- and area-scaled for this assembly's real floor area (${gwpAreaUsed} m², Part A).`
              : `Thickness-scaled, but no real floor area entered yet for this assembly (Part A) — shown per 1m² as a placeholder.`}
          </p>
        )}
      </div>

      {layers.length > 0 && (
        <div className="gwp-per-m2-summary">
          <h4>GWP A1-A3, corrected per 1&nbsp;m² of this assembly</h4>
          <p className="gwp-caveat">
            Real thickness-scaled figure (m³-declared materials × thickness; kg-declared × thickness ×
            density; m² materials used as-is) — the same formula this app's actual LCA calc uses for
            the whole assembly (lcaAnalysis.js's deriveQuantity), just with area pinned to 1m² here so
            you get a real number before entering the assembly's actual floor area in Assembly Analysis
            Preview → Part A.
          </p>
          <table className="gwp-per-m2-table">
            <thead>
              <tr><th>Layer</th><th>GWP A1-A3 per 1m² (kg CO₂e)</th></tr>
            </thead>
            <tbody>
              {perM2Breakdown.map((l) => (
                <tr key={l.instanceId}>
                  <td>{l.name}</td>
                  <td>{l.perM2 != null ? l.perM2.toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Subtotal ({perM2Known.length}/{layers.length} layers)</strong></td>
                <td><strong>{perM2Known.length > 0 ? perM2Total.toFixed(2) : '—'}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

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

      <h3 className="section-preview-heading">Section preview</h3>
      {elementType === 'roof' && (
        <label className="roof-pitch-input">
          Roof pitch
          <input
            type="number"
            min={0}
            max={89}
            value={pitchDeg}
            onChange={(e) => setPitchDeg(e.target.value === '' ? 0 : Number(e.target.value))}
          />
          °
        </label>
      )}
      <SectionPreview
        ref={previewRef}
        section={safeElementType.charAt(0).toUpperCase() + safeElementType.slice(1)}
        owner={lastSaved?.owner ?? owner}
        savedAt={lastSaved?.savedAt}
        layers={layers}
        uValue={uValue}
        rTotal={rTotal}
        missingData={missingData}
        gwpTotal={gwpTotal}
        gwpKnownCount={gwpKnownLayers.length}
        pitchDeg={pitchDeg}
        areaM2={geometry?.surfaceAreaM2}
      />
      <div className="export-button-row">
        <button type="button" className="export-pdf-button" onClick={handleExportPdf} disabled={exporting}>
          {exporting ? 'Generating PDF…' : 'Export PDF (quick preview)'}
        </button>
        <button
          type="button"
          className="export-scale-button"
          onClick={handleExportTrueScale}
          disabled={exportingScale}
        >
          {exportingScale ? 'Generating scaled DXF/PDF…' : 'Export true-to-scale DXF + PDF'}
        </button>
      </div>
      {scaleExportError && (
        <p className="scale-export-error">
          True-to-scale export failed: {scaleExportError}
          {scaleExportError.includes('fetch') && ' — is "npm run dev" running the section-export server? See server/section_generator/README.md.'}
        </p>
      )}
      </div>
    </div>
  )
}
