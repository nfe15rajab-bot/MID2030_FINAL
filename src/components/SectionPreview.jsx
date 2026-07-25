import React, { forwardRef } from 'react'
import { getLayerCompletenessTier } from '../lib/layerCompleteness.js'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Orientation per assembly type — a real construction section always reads
// consistently from one side to the other, so each gets its own axis and
// edge labels. Layer array order is taken as-is (index 0 = the label at
// the "start" edge below) — the drag-and-drop reordering already in the
// layer list is how a team fixes this if their current layer order
// doesn't match interior→exterior yet, rather than this component
// guessing/reversing anything.
//   wall:  horizontal, left→right,  index 0 = Interior, last = Exterior
//   floor: vertical,   top→bottom,  index 0 = Interior, last = Ground
//   roof:  vertical (then rotated to pitch), top→bottom, index 0 = Sky
//          (outermost roofing layer), last = Interior
const SECTION_ORIENTATION = {
  wall: { row: true, startLabel: 'Interior', endLabel: 'Exterior' },
  floor: { row: false, startLabel: 'Interior', endLabel: 'Ground' },
  roof: { row: false, startLabel: 'Sky', endLabel: 'Interior', pitched: true },
}

// Measured from the professor's real Revit model (DWFx "wall and roof"
// section, dwf/documents/.../ePlot_FE021772.../FixedPage.fpage): 230 of
// 318 diagonal roofline segments came out at exactly 20.0° — the actual
// designed pitch, not a guess. Only used as a fallback when no pitchDeg
// prop is passed at all; the real per-project value lives in
// sectionStorage's roof record (see LayerBuilder.jsx's pitchDeg state).
const DEFAULT_PITCH_DEG = 20

function BarsStack({ className, style, layers, totalThickness }) {
  return (
    <div className={className} style={style}>
      {layers.map((layer) => (
        <div
          key={layer.instanceId}
          className={`section-sheet-bar section-sheet-bar--${getLayerCompletenessTier(layer)}`}
          style={{ flexBasis: `${((layer.thicknessMM || 0) / totalThickness) * 100}%` }}
          title={layer.name}
        >
          <span className="section-sheet-bar-thickness">
            {layer.thicknessMM != null ? `${layer.thicknessMM}mm` : '?'}
          </span>
          <span className="section-sheet-bar-name">{layer.name}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Simple "typical section" technical sheet — bordered drawing-sheet layout
 * with a proportional, orientation-aware layer-stack diagram, a data
 * table, and a title block. Rendered on-screen as the live preview, and
 * captured 1:1 (via html2canvas, see LayerBuilder's "Export PDF") for the
 * exported file — this component IS the template, there's no separate PDF
 * layout to drift. The diagram is a parametric 2D layout (proportional
 * flexbox bands), not derived from the 3D model mesh — consistent with
 * how the true-to-scale DXF export also builds its drawing from the same
 * layer data rather than cutting the .glb.
 */
const SectionPreview = forwardRef(function SectionPreview(
  { section, owner, savedAt, layers, uValue, rTotal, missingData, gwpTotal, gwpKnownCount, pitchDeg },
  ref
) {
  const orientation = SECTION_ORIENTATION[section?.toLowerCase()] ?? SECTION_ORIENTATION.wall
  const totalThickness = layers.reduce((sum, l) => sum + (l.thicknessMM || 0), 0) || 1
  const barsClassName = `section-sheet-bars section-sheet-bars--${orientation.row ? 'row' : 'column'}`
  const barsStyle = orientation.pitched
    ? { transform: `rotate(${pitchDeg ?? DEFAULT_PITCH_DEG}deg)` }
    : undefined

  return (
    <div className="section-sheet" ref={ref}>
      <div className="section-sheet-header">
        <div>
          <div className="section-sheet-project">MID 2030 — Model 1 Assembly Builder</div>
          <div className="section-sheet-subtitle">Group 02 · Batavierenplantsoen, Haarlem</div>
        </div>
        <div className="section-sheet-heading">{section} — TYPICAL SECTION</div>
      </div>

      <div className={`section-sheet-diagram${orientation.row ? '' : ' section-sheet-diagram--column'}`}>
        {layers.length === 0 ? (
          <p className="empty-state">No layers yet — add one to see the section diagram.</p>
        ) : (
          <div className={`section-sheet-orientation section-sheet-orientation--${orientation.row ? 'row' : 'column'}`}>
            <span className="section-sheet-edge-label">{orientation.startLabel}</span>
            {/* Column layouts (Floor/Roof) center the bars in a fixed
                square "stage" sized to the stack's own diagonal — a
                rotated rectangle's bounding box is bigger than the
                rectangle itself and isn't centered the same way, so
                without this a pitched roof stack drifts toward one
                corner and clips against the diagram's border (seen
                directly: the bottom-most layer's label was getting cut
                off at 30°). The stage guarantees no clipping at any
                pitch 0-90° and keeps the stack visually centered. */}
            {orientation.row ? (
              <BarsStack className={barsClassName} style={barsStyle} layers={layers} totalThickness={totalThickness} />
            ) : (
              <div className="section-sheet-pitch-stage">
                <BarsStack className={barsClassName} style={barsStyle} layers={layers} totalThickness={totalThickness} />
              </div>
            )}
            <span className="section-sheet-edge-label">{orientation.endLabel}</span>
          </div>
        )}
      </div>

      <table className="section-sheet-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Material</th>
            <th>Thickness (mm)</th>
            <th>λ (W/mK)</th>
            <th>GWP A1-A3</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((layer, i) => (
            <tr key={layer.instanceId}>
              <td>{i + 1}</td>
              <td>{layer.name}</td>
              <td>{layer.thicknessMM}</td>
              <td>{layer.thermalConductivityWmK ?? '—'}</td>
              <td>{layer.gwpA1A3PerFunctionalUnit ?? '—'}</td>
            </tr>
          ))}
          {layers.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-state">No layers yet</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="section-sheet-summary">
        <span>R_total: {missingData ? '—' : `${rTotal.toFixed(3)} m²K/W`}</span>
        <span>U-value: {missingData ? '—' : `${uValue.toFixed(3)} W/m²K`}</span>
        <span>
          GWP A1-A3: {gwpKnownCount > 0 ? `${gwpTotal.toFixed(1)} kg CO₂e` : '—'}
          {layers.length > 0 && ` (${gwpKnownCount}/${layers.length} layers)`}
        </span>
      </div>

      <div className="section-sheet-titleblock">
        <div><span className="tb-label">Project</span>MID 2030 — Model 1</div>
        <div><span className="tb-label">Section</span>{section}</div>
        <div><span className="tb-label">Drawn by</span>{owner || 'Unassigned'}</div>
        <div><span className="tb-label">Saved</span>{formatDate(savedAt)}</div>
        <div><span className="tb-label">Sheet</span>1 of 1</div>
      </div>
    </div>
  )
})

export default SectionPreview
