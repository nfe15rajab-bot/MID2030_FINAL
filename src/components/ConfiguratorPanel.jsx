import React from 'react'
import { getAssemblySummaries } from '../lib/deliverablesData.js'
import { getFullCompletenessReport } from '../lib/lcaAnalysis.js'
import { classifyAssemblySustainability } from '../lib/sustainabilityRubric.js'

function fmt(n, digits = 1) {
  return n != null ? n.toFixed(digits) : '—'
}

// Wall/roof/floor's own B4 total — same "null unless every layer has one"
// aggregation A3PosterDraft.jsx's AssemblyColumn already does locally
// (there's no separate assembly-level b4Total exposed by
// getAssemblySummaries(), only per-layer b4 inside layerResults).
function b4Total(summary) {
  const results = summary.layerResults ?? []
  if (results.length === 0 || !results.every((l) => l.b4 != null)) return null
  return results.reduce((sum, l) => sum + l.b4, 0)
}

// A snapshot of that assembly's own analysis progress (same numbers the
// LCA and EPD / LCA Summary tabs compute, not a re-derivation), so
// clicking a hotspot answers "how far along is this section" without
// leaving the 3D view — for wall/roof/floor that's U-value/A1-A3/A4/B4/
// completeness off a layer stack; for door/window/skylight (single
// manufactured units, no U-value calc — see assemblyAnalysis.js) it's the
// same completeness/GWP figures, just without a U-value. Every hotspot
// has its own save/preview/edit workflow in the Section Configurator tab
// — the "Open in Section Configurator" button below is how you get there.
export default function ConfiguratorPanel({ hotspot, onClose, onOpenSectionConfigurator }) {
  if (!hotspot) return null

  return (
    <div className="configurator-overlay" onClick={onClose}>
      {/* stopPropagation so clicking inside the panel doesn't trigger the
          overlay's onClose (which closes when you click the dark backdrop) */}
      <div className="configurator-panel" onClick={(e) => e.stopPropagation()}>
        <div className="configurator-header">
          <h2>{hotspot.label}</h2>
          <button className="configurator-close" onClick={onClose}>✕</button>
        </div>

        <AssemblyProgressView
          sectionKey={hotspot.category.toLowerCase()}
          onOpen={() => onOpenSectionConfigurator?.(hotspot.category.toLowerCase())}
        />
      </div>
    </div>
  )
}

// One pill per band (U-value, embodied-carbon intensity) — see
// sustainabilityRubric.js for the researched thresholds and their own
// caveats, surfaced here via a title tooltip rather than inline text so
// the panel stays scannable; the full reasoning is always one hover away,
// never hidden entirely (same "never silently apply a judgment call"
// rule as everywhere else in this app).
function ConclusionBand({ title, band }) {
  if (!band) return null
  return (
    <div className={`conclusion-band conclusion-band--${band.tier}`}>
      <span className="conclusion-band-title">{title}</span>
      <span className="conclusion-band-label">{band.label}</span>
      <p className="conclusion-band-reason">{band.reason}</p>
      <p className="conclusion-band-caveat" title={band.caveat}>{band.caveat}</p>
    </div>
  )
}

// "Conclusion" — this app's own sustainability read on the saved
// assembly, not just raw numbers. Two independent bands (U-value,
// embodied-carbon intensity) rather than one collapsed score, since they
// measure different things and an assembly can score well on one and
// poorly on the other — see sustainabilityRubric.js for the researched
// thresholds behind each label.
function AssemblyConclusion({ summary }) {
  const { uValue, gwp } = classifyAssemblySustainability(summary.key, summary.uValue, summary.normalized)
  if (!uValue && !gwp) {
    return (
      <div className="configurator-conclusion">
        <h4>Conclusion</h4>
        <p className="empty-state">
          Not enough data yet to evaluate — {summary.uValue == null ? 'U-value' : 'normalized GWP'} is still missing.
        </p>
      </div>
    )
  }
  return (
    <div className="configurator-conclusion">
      <h4>Conclusion</h4>
      <ConclusionBand title="Thermal performance (U-value)" band={uValue} />
      <ConclusionBand title="Embodied carbon intensity" band={gwp} />
      {!uValue && (
        <p className="assembly-card-note">
          U-value/Uw comparison isn't wired up for door/window/skylight yet — their declared Uw lives in
          the spec text, not a comparable computed number.
        </p>
      )}
    </div>
  )
}

function AssemblyProgressView({ sectionKey, onOpen }) {
  const summary = getAssemblySummaries().find((s) => s.key === sectionKey)
  const completeness = getFullCompletenessReport().find(
    (r) => r.assembly.toLowerCase() === sectionKey
  )

  if (!summary || !summary.hasData) {
    return (
      <div className="configurator-progress">
        <p className="empty-state">No layers saved yet for this section.</p>
        <button type="button" className="configurator-progress-open" onClick={onOpen}>
          Open in Section Configurator →
        </button>
      </div>
    )
  }

  const b4 = b4Total(summary)

  return (
    <div className="configurator-progress">
      <div className="configurator-progress-figures">
        <div><span className="tb-label">U-value</span>{fmt(summary.uValue, 3)} W/m²K</div>
        <div><span className="tb-label">A1-A3</span>{summary.a1a3KnownCount > 0 ? `${fmt(summary.a1a3Total)} kg CO₂e` : '—'}</div>
        <div><span className="tb-label">A4</span>{summary.a4KnownCount > 0 ? `${fmt(summary.a4Total)} kg CO₂e` : '—'}</div>
        <div><span className="tb-label">B4</span>{b4 != null ? `${fmt(b4)} kg CO₂e` : 'not yet assessed'}</div>
        <div><span className="tb-label">Completeness</span>{summary.completeCount}/{summary.totalCount} layers</div>
      </div>

      <h4>Progress</h4>
      {completeness?.status === 'complete' || (completeness?.items.length ?? 0) === 0 ? (
        <p className="configurator-progress-done">Nothing missing — every layer has GWP/density/λ, A4, B4, and end-of-life data.</p>
      ) : (
        <ul className="configurator-progress-list">
          {completeness.items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}

      <AssemblyConclusion summary={summary} />

      <button type="button" className="configurator-progress-open" onClick={onOpen}>
        Open in Section Configurator →
      </button>
    </div>
  )
}
