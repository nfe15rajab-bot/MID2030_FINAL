import React, { useState } from 'react'
import materials from '../../database/materials.json'
import { analyzeLiveAssembly } from '../lib/assemblyAnalysis.js'
import { gwpPerM2ForLayers } from '../lib/gwpPerM2.js'
import { useCurrentUser } from '../context/CurrentUserContext.jsx'
import LayerBuilder from './LayerBuilder.jsx'
import UnitAssemblyBuilder from './UnitAssemblyBuilder.jsx'
import BarChart from './BarChart.jsx'
import LayerSharePieChart from './LayerSharePieChart.jsx'
import AiFeedbackPanel from './AiFeedbackPanel.jsx'
import LcaConclusionsPanel from './LcaConclusionsPanel.jsx'
import './AssemblyAnalysisTab.css'

const SECTIONS = ['wall', 'roof', 'floor', 'door', 'window', 'skylight']
// Door/Window/Skylight are single manufactured units (UnitAssemblyBuilder),
// not a layer stack — no U-value calc applies (see assemblyAnalysis.js).
const UNIT_SECTIONS = new Set(['door', 'window', 'skylight'])

// Part A: a live workbench, not a read-only rollup — left pane is the same
// LayerBuilder Section Configurator uses (add/reorder/edit layers), right
// pane recomputes U-value/GWP/completeness on every edit via
// analyzeLiveAssembly (no "Save changes" gate — that button still exists
// in the left pane for persisting to sectionStorage, but the numbers here
// don't wait on it). One assembly at a time (wall/roof/floor sub-tabs,
// same pattern as Section Configurator) rather than three simultaneous
// editors — cramped otherwise, and the per-layer GWP chart only makes
// sense for whichever assembly is actually open. Part C (AI feedback)
// lives in the right pane, same as before.
export default function AssemblyAnalysisTab() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0])
  const [liveLayers, setLiveLayers] = useState([])
  const { currentUser } = useCurrentUser()

  const strActiveSection = String(activeSection || '')
  const category = strActiveSection ? (strActiveSection.charAt(0).toUpperCase() + strActiveSection.slice(1)) : ''
  const categoryMaterials = materials.filter((m) => m.category === category)
  const isUnitSection = UNIT_SECTIONS.has(activeSection)
  const result = analyzeLiveAssembly(activeSection, liveLayers)

  // Thickness/density-scaled per-1m² value, NOT the raw declared-unit
  // value — a chart comparing layers of different thickness side by side
  // is exactly where an unscaled number is most misleading (a 260mm and
  // a 50mm layer of the same m3-declared material used to chart as
  // identical bars). Same formula as LayerBuilder's own corrected table
  // (gwpPerM2.js), so the two can never disagree again.
  const { breakdown: gwpPerM2 } = gwpPerM2ForLayers(liveLayers, categoryMaterials)
  const gwpBars = liveLayers.map((l, i) => {
    const perM2 = gwpPerM2.find((g) => g.instanceId === l.instanceId)?.perM2 ?? null
    const nameStr = l.name || ''
    return {
      label: nameStr.length > 14 ? `${nameStr.slice(0, 13)}…` : nameStr,
      value: perM2,
      formattedValue: perM2 != null ? perM2.toFixed(2) : null,
      tooltipNote: `${l.name} — GWP A1-A3 per 1m² (thickness-scaled)`, // full name, since the bar label itself may be truncated
      key: l.instanceId ?? i,
    }
  })
  // Same underlying gwpPerM2 numbers as gwpBars above — just full,
  // untruncated names, since the pie's legend has room the bar chart's
  // rotated labels don't.
  const gwpShareSlices = liveLayers.map((l, i) => {
    const perM2 = gwpPerM2.find((g) => g.instanceId === l.instanceId)?.perM2 ?? null
    return {
      label: l.name || 'Unnamed layer',
      value: perM2,
      formattedValue: perM2 != null ? perM2.toFixed(2) : null,
      key: l.instanceId ?? i,
    }
  })

  return (
    <div className="assembly-analysis-tab">
      <h2 className="assembly-analysis-heading">Assembly Analysis Preview</h2>
      <p className="assembly-analysis-intro">
        Part A: edit a section here and the results on the right recompute immediately — no separate
        calculate step. "Save changes" in the left pane still persists to Section Configurator/Team
        Summary same as before; the numbers here don't wait on that.
      </p>

      <div className="section-tabs">
        {SECTIONS.map((s) => (
          <button
            key={s}
            className={s === activeSection ? 'active' : ''}
            onClick={() => setActiveSection(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="split-pane assembly-analysis-split">
        <div className="split-pane-left split-pane-scroll">
          {isUnitSection ? (
            <UnitAssemblyBuilder
              key={`assembly-analysis-${activeSection}`}
              materials={categoryMaterials}
              elementType={activeSection}
              owner={currentUser}
              onLayersChange={setLiveLayers}
            />
          ) : (
            <LayerBuilder
              key={`assembly-analysis-${activeSection}`}
              materials={categoryMaterials}
              elementType={activeSection}
              owner={currentUser}
              onLayersChange={setLiveLayers}
            />
          )}
        </div>

        <div className="split-pane-right split-pane-scroll">
          {!result.hasData ? (
            <p className="assembly-card-note">No layers yet — add one in the left pane.</p>
          ) : (
            <div className="assembly-card">
              <h3>{result.label}</h3>
              {!isUnitSection && (
                <div className="assembly-card-row">
                  <span className="assembly-card-label">U-value</span>
                  {result.uValue != null ? (
                    <span className="assembly-card-value">{result.uValue.toFixed(3)} W/m²K</span>
                  ) : (
                    <span className="assembly-card-incomplete">
                      incomplete — add thickness + λ for every layer
                    </span>
                  )}
                </div>
              )}
              <div className="assembly-card-row">
                <span className="assembly-card-label">GWP A1-A3</span>
                <span className="assembly-card-value">
                  {result.gwpKnownCount > 0 ? `${result.gwpTotal.toFixed(1)} kg CO₂e` : '—'}
                </span>
                <span className="assembly-card-sub">({result.gwpKnownCount}/{result.totalCount} layers have data)</span>
              </div>
              <div className="assembly-card-row">
                <span className="assembly-card-label">Completeness</span>
                <span className={`assembly-card-completeness${result.completeCount === result.totalCount ? ' assembly-card-completeness--full' : ''}`}>
                  {result.completeCount}/{result.totalCount} layers complete
                </span>
              </div>

              <BarChart title={`${result.label} — GWP A1-A3 by layer (per 1m², thickness-scaled)`} unit="kg CO₂e/m²" bars={gwpBars} exportable />
              <LayerSharePieChart title={`${result.label} — share of GWP A1-A3 by layer`} unit="kg CO₂e/m²" slices={gwpShareSlices} />

              <AiFeedbackPanel assemblyResult={result} />
              <LcaConclusionsPanel assemblyKey={activeSection} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
