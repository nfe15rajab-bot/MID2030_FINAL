import React, { useState } from 'react'
import materials from '../../database/materials.json'
import LayerBuilder from './LayerBuilder.jsx'
import UnitAssemblyBuilder from './UnitAssemblyBuilder.jsx'
import SectionPreview from './SectionPreview.jsx'
import { calculateUValue } from '../lib/uvalue.js'
import { getAllMaterials } from '../lib/materialsCatalog.js'
import { loadAssemblyGeometry } from '../lib/assemblyGeometryStorage.js'
import { gwpTotalForLayers, gwpPerM2ForLayer } from '../lib/gwpPerM2.js'
import { useCurrentUser } from '../context/CurrentUserContext.jsx'
import './SectionPreview.css'

const SECTIONS = ['wall', 'roof', 'floor', 'door', 'window', 'skylight']
// Single manufactured units (UnitAssemblyBuilder) rather than a layer
// stack (LayerBuilder) — see lcaAnalysis.js's ASSEMBLIES comment for why
// they still share the same `layers`-array storage shape underneath.
const UNIT_SECTIONS = new Set(['door', 'window', 'skylight'])

// Live mirror of whatever LayerBuilder currently holds in memory (via its
// onLayersChange/onPitchChange callbacks) — recomputes U-value/GWP the
// same way LayerBuilder's own bottom preview does, so the left pane shows
// a real preview of what "Save changes" would persist, updating on every
// edit rather than only after a save.
function LiveSectionPreview({ section, layers, pitchDeg, owner }) {
  const strSection = String(section || '')
  const category = strSection ? (strSection.charAt(0).toUpperCase() + strSection.slice(1)) : ''
  const { uValue, rTotal, missingData } = calculateUValue(layers, section)
  // Real area-scaled total (see gwpPerM2.js) — not a naive sum of raw
  // per-declared-unit values. This is the live preview shown while
  // actively editing Wall/Roof/Floor, so it's the single most-visible
  // spot this bug used to show up in.
  const allMaterials = getAllMaterials()
  const geometry = loadAssemblyGeometry(section)
  const { total: gwpTotal, known: gwpKnownRows } = gwpTotalForLayers(layers, allMaterials, geometry?.surfaceAreaM2)

  return (
    <SectionPreview
      section={category}
      owner={owner}
      savedAt={null}
      layers={layers}
      uValue={uValue}
      rTotal={rTotal}
      missingData={missingData}
      gwpTotal={gwpTotal}
      gwpKnownCount={gwpKnownRows.length}
      pitchDeg={pitchDeg}
    />
  )
}

// Door/Window/Skylight have no cross-section drawing to preview (they're
// a single manufactured unit, not a construction layer stack) — a short
// live list instead of SectionPreview's wall-diagram rendering.
function LiveUnitPreview({ layers }) {
  const allMaterials = getAllMaterials()
  const unit = layers.find((l) => l.role === 'unit')
  const membranes = layers.filter((l) => l.role === 'membrane')

  if (!unit) return <p className="empty-state">No product selected yet.</p>

  return (
    <div className="unit-preview">
      <h4>{unit.name}</h4>
      <p>Count: {unit.count ?? 1}</p>
      <p>GWP A1-A3: {unit.gwpA1A3PerFunctionalUnit != null ? `${unit.gwpA1A3PerFunctionalUnit} kg CO₂e/unit` : '—'}</p>
      <h4>Membranes ({membranes.length})</h4>
      {membranes.length === 0 ? (
        <p className="empty-state">None added yet.</p>
      ) : (
        <ul>
          {membranes.map((m) => {
            // Thickness/density-scaled, not the raw declared-unit value —
            // same fix as everywhere else this pattern showed up.
            const scaled = gwpPerM2ForLayer(m, allMaterials)
            return (
              <li key={m.instanceId}>
                {m.name} — {scaled != null ? `GWP=${scaled.toFixed(2)}` : 'GWP missing'}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// Full-page configurator: each section (wall/roof/floor/door/window/
// skylight) gets its own independent editor instance — own state, own
// save state — switching tabs never mixes their data (see
// LayerBuilder/UnitAssemblyBuilder's load-from-storage-by-elementType
// behavior). Provider map lives only in the Providers tab now
// (ProvidersTab.jsx) — not duplicated here.
//
// Two-pane layout: left is a live preview (parametric layer-stack diagram
// for wall/roof/floor, a short product/membrane list for door/window/
// skylight), right is the editor itself.
export default function SectionConfigurator({ activeSection, onSectionChange, owner, onDirtyChange }) {
  const strActiveSection = String(activeSection || '')
  const category = strActiveSection ? (strActiveSection.charAt(0).toUpperCase() + strActiveSection.slice(1)) : ''
  const categoryMaterials = materials.filter((m) => m.category === category)
  const isUnitSection = UNIT_SECTIONS.has(activeSection)
  const [liveLayers, setLiveLayers] = useState([])
  const [livePitchDeg, setLivePitchDeg] = useState(30)
  // sessionId in the key too, not just activeSection — switching sessions
  // (Group 2 <-> an Other group) must force the editor to remount and
  // re-read loadSection() from that session's own storage, the same way
  // switching wall/roof/floor already does; otherwise it keeps showing
  // whatever the previous session's layers were sitting in memory.
  const { sessionId } = useCurrentUser()
  // Bubbled up from the editor's own unsaved-changes tracking — guards
  // both this component's own sub-tabs (below) and, via onDirtyChange,
  // App.jsx's top-level tab switcher / hotspot navigation (see App.jsx's
  // handleTabClick/handleOpenSectionConfigurator).
  const [isDirty, setIsDirty] = useState(false)

  function handleDirtyChange(dirty) {
    setIsDirty(dirty)
    onDirtyChange?.(dirty)
  }

  function handleSectionTabClick(nextSection) {
    if (nextSection === activeSection) return
    if (
      isDirty &&
      !window.confirm(
        `You have unsaved changes in ${category}. Leaving now will discard them (they won't be saved or synced). Leave anyway?`
      )
    ) {
      return
    }
    onSectionChange(nextSection)
  }

  return (
    <div className="section-configurator">
      <div className="section-tabs">
        {SECTIONS.map((s) => (
          <button
            key={s}
            className={s === activeSection ? 'active' : ''}
            onClick={() => handleSectionTabClick(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="split-pane sections-split">
        <div className="split-pane-left">
          <h2>{isUnitSection ? 'Product preview' : 'Section preview'}</h2>
          {isUnitSection ? (
            <LiveUnitPreview layers={liveLayers} />
          ) : (
            <LiveSectionPreview
              section={activeSection}
              layers={liveLayers}
              pitchDeg={livePitchDeg}
              owner={owner}
            />
          )}
        </div>
        <div className="split-pane-right split-pane-scroll">
          {isUnitSection ? (
            <UnitAssemblyBuilder
              key={`unit-assembly-builder-${activeSection}-${sessionId}`}
              materials={categoryMaterials}
              elementType={activeSection}
              owner={owner}
              onLayersChange={setLiveLayers}
              onDirtyChange={handleDirtyChange}
            />
          ) : (
            <LayerBuilder
              key={`layer-builder-${activeSection}-${sessionId}`}
              materials={categoryMaterials}
              elementType={activeSection}
              owner={owner}
              onLayersChange={setLiveLayers}
              onPitchChange={setLivePitchDeg}
              onDirtyChange={handleDirtyChange}
            />
          )}
        </div>
      </div>
    </div>
  )
}
