import React, { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'
import { ASSEMBLIES, analyzeLcaAssembly, calculateB6 } from '../lib/lcaAnalysis.js'
import { useSharedData } from '../hooks/useSharedData.js'
import OperationalEnergySettings from './OperationalEnergySettings.jsx'
import AiFeedbackPanel from './AiFeedbackPanel.jsx'
import LcaConclusionsPanel from './LcaConclusionsPanel.jsx'
import RevitExportPanel from './RevitExportPanel.jsx'
import './LcaSummaryTab.css'

const IN_SCOPE_SECTIONS = ASSEMBLIES.filter((a) => a.inScope).map((a) => a.key)

// recharts (verified directly, v3.9.2) silently skips drawing a bar
// shape entirely for a data point whose value is null/undefined OR 0 —
// not just here, it's a longstanding upstream quirk across recharts
// versions with sparse/zero-valued bar data. Since "not yet modeled"
// (null) is exactly the state this chart most needs to show clearly (not
// hide), every bar gets a tiny non-zero floor height purely for
// rendering; the REAL value (possibly null, possibly negative for module
// D's credit) drives the label/tooltip text via a separate `realValue`
// field, so nothing here ever claims a number that isn't real. Sign is
// preserved so D still renders as a below-the-axis bar, not flipped
// positive.
const RENDER_FLOOR = 2
function toBarValue(v) {
  if (v == null) return RENDER_FLOOR
  const sign = v < 0 ? -1 : 1
  return sign * Math.max(Math.abs(v), RENDER_FLOOR)
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Pools every in-scope assembly's already-computed layerResults (A1-A3,
// A4, B4 — see lcaAnalysis.js) rather than re-deriving anything from
// sectionStorage directly. Re-derived fresh on every render (no memo with
// an empty dep array) so edits made elsewhere in the app show up here
// without a stale cache — same "always reflects what's actually saved"
// reasoning as AssemblyAnalysisTab/LcaEpdTab.
function usePooledLcaLayers() {
  const bySection = {}
  const pooled = []
  for (const key of IN_SCOPE_SECTIONS) {
    const result = analyzeLcaAssembly(key)
    bySection[key] = result
    if (!result.hasData) continue
    for (const layer of result.layerResults) {
      pooled.push({ ...layer, section: key, assemblyLabel: result.label })
    }
  }
  return { bySection, pooled }
}

function PhaseTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="lca-summary-tooltip">
      <strong>{p.phase}</strong>
      <div>{p.unmodeled ? 'Not yet modeled' : p.realValue != null ? `${p.realValue.toFixed(1)} kg CO₂e` : 'Not yet assessed'}</div>
      <div className="lca-summary-tooltip-status">{p.status}</div>
    </div>
  )
}

function AssemblyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="lca-summary-tooltip">
      <strong>{p.assembly}</strong>
      <div>{p.realValue != null ? `${p.realValue.toFixed(1)} kg CO₂e` : 'no data'}</div>
      <div className="lca-summary-tooltip-status">
        {p.realValue == null ? 'no saved layers' : p.favorable === true ? 'below median — favorable' : p.favorable === false ? 'above median — unfavorable' : 'at median'}
      </div>
    </div>
  )
}

export default function LcaSummaryTab() {
  const { bySection, pooled } = usePooledLcaLayers()
  const [selectedInstanceId, setSelectedInstanceId] = useState(pooled[0]?.instanceId ?? null)
  const [assemblyFilter, setAssemblyFilter] = useState('all')

  const filteredMaterials = assemblyFilter === 'all' ? pooled : pooled.filter((l) => l.section === assemblyFilter)
  const selected = pooled.find((l) => l.instanceId === selectedInstanceId) ?? filteredMaterials[0] ?? null

  // OperationalEnergySettings (the electricity/intensity/floor-area/
  // waste-distance panel below) owns its own local state — a React child
  // updating its own state never re-renders its parent, so without this
  // subscription B6/C2 would silently show stale numbers computed before
  // whatever was just typed into that panel, until something else (a tab
  // switch, a reload) happened to force a re-render. Subscribing to the
  // same shared doc here means this component re-renders — and therefore
  // usePooledLcaLayers/calculateB6 (both read fresh from localStorage on
  // every render, not memoized) recompute — the moment that panel's write
  // round-trips through Firestore, same as any teammate's edit would.
  useSharedData('sharedData/operationalEnergy')

  // Not memoized — calculateB6() is a cheap localStorage read + a
  // multiplication, and memoizing it risks the exact staleness bug
  // described above (a memo only recomputes when ITS OWN dependency
  // array changes, which "the settings changed" doesn't cleanly map to
  // without re-deriving the same settings object as a dependency anyway).
  const b6Result = calculateB6()

  const phaseData = useMemo(() => {
    if (!selected) return []
    const distanceStatus = selected.distanceSource
      ? selected.distanceSource
      : selected.distanceMissing || 'distance not yet resolved'
    const serviceLifeStatus =
      selected.serviceLifeSource === 'epd' ? 'verified — EPD sourced'
      : selected.serviceLifeSource === 'ai' ? 'unverified — AI sourced'
      : selected.serviceLifeSource === 'manual' ? 'verified — manual'
      : 'service life not yet researched'
    const eolTierStatus =
      selected.eolSource === 'epd' ? 'verified — EPD sourced'
      : selected.eolSource === 'ai' ? 'unverified — AI sourced'
      : selected.eolSource === 'manual' ? `verified — manual assumption${selected.eolAssumptionBasis ? ` (${selected.eolAssumptionBasis})` : ''}`
      : 'not yet researched'

    return [
      {
        phase: 'A1-A3',
        realValue: selected.a1a3,
        value: toBarValue(selected.a1a3),
        label: selected.a1a3 != null ? selected.a1a3.toFixed(0) : '—',
        status: selected.a1a3 != null ? 'declared GWP × quantity (Ökobaudat/EPD)' : selected.a1a3Missing || 'missing',
      },
      {
        phase: 'A4',
        realValue: selected.a4CO2Kg,
        value: toBarValue(selected.a4CO2Kg),
        label: selected.a4CO2Kg != null ? selected.a4CO2Kg.toFixed(0) : '—',
        status: selected.a4CO2Kg != null ? `DIN EN ISO 14083 transport calc — ${distanceStatus}` : selected.distanceMissing || selected.massMissing || 'missing',
      },
      {
        phase: 'B4',
        realValue: selected.b4,
        value: toBarValue(selected.b4),
        label: selected.b4 != null ? selected.b4.toFixed(0) : '—',
        status: selected.b4 != null
          ? `${selected.b4ReplacementCount} replacement(s) over 50yr — ${serviceLifeStatus}`
          : selected.b4Missing === 'service life' ? serviceLifeStatus : (selected.b4Missing || 'missing'),
      },
      {
        phase: 'B6',
        realValue: b6Result.b6,
        value: toBarValue(b6Result.b6),
        label: b6Result.b6 != null ? b6Result.b6.toFixed(0) : '—',
        status: b6Result.b6 != null
          ? 'whole-building total (Operational Energy settings) — not apportioned to this material'
          : `not yet assessed — missing ${b6Result.missing?.join(', ')}`,
      },
      {
        phase: 'C1',
        realValue: selected.c1,
        value: toBarValue(selected.c1),
        label: selected.c1 != null ? selected.c1.toFixed(1) : 'n/m',
        unmodeled: selected.c1 == null,
        status: selected.c1 != null ? `deconstruction — ${eolTierStatus}` : 'not yet modeled — deconstruction impact not researched for this material',
      },
      {
        phase: 'C2',
        realValue: selected.c2,
        value: toBarValue(selected.c2),
        label: selected.c2 != null ? selected.c2.toFixed(1) : 'n/m',
        unmodeled: selected.c2 == null,
        status: selected.c2 != null ? selected.c2Source : selected.c2Missing || 'not yet modeled',
      },
      {
        phase: 'C3',
        realValue: selected.c3,
        value: toBarValue(selected.c3),
        label: selected.c3 != null ? selected.c3.toFixed(1) : 'n/m',
        unmodeled: selected.c3 == null,
        status: selected.c3 != null ? `waste processing — ${eolTierStatus}` : 'not yet modeled — waste processing impact not researched for this material',
      },
      {
        phase: 'C4',
        realValue: selected.c4,
        value: toBarValue(selected.c4),
        label: selected.c4 != null ? selected.c4.toFixed(1) : 'n/m',
        unmodeled: selected.c4 == null,
        status: selected.c4 != null ? `disposal — ${eolTierStatus}` : 'not yet modeled — disposal impact not researched for this material',
      },
      {
        phase: 'D',
        realValue: selected.moduleD,
        value: toBarValue(selected.moduleD),
        label: selected.moduleD != null ? selected.moduleD.toFixed(1) : 'n/m',
        unmodeled: selected.moduleD == null,
        isCredit: true,
        status: selected.moduleD != null ? `recycling/reuse credit — ${eolTierStatus}` : 'not yet modeled — no module D credit researched for this material',
      },
    ]
  }, [selected, b6Result])

  const assemblyData = useMemo(() => {
    const totals = IN_SCOPE_SECTIONS.map((key) => {
      const r = bySection[key]
      return { assembly: r.label, realValue: r.hasData ? r.partialTotalKg : null, key }
    })
    const known = totals.filter((t) => t.realValue != null).map((t) => t.realValue)
    const med = median(known)
    return totals.map((t) => ({
      ...t,
      value: toBarValue(t.realValue),
      label: t.realValue != null ? t.realValue.toFixed(0) : '—',
      favorable: t.realValue == null || med == null ? null : t.realValue < med ? true : t.realValue > med ? false : null,
    }))
  }, [bySection])

  const selectedAssemblyResult = selected ? bySection[selected.section] : null

  return (
    <div className="lca-summary-tab">
      <h2 className="lca-summary-heading">LCA Summary</h2>
      <p className="lca-summary-intro">
        Every phase together, per material and per assembly — pulled from the same computed data as
        the LCA and EPD / Assembly Analysis Preview tabs, nothing re-entered here.
      </p>

      <OperationalEnergySettings />

      {pooled.length === 0 ? (
        <p className="empty-state">
          No saved layers yet — go to Section Configurator, build a wall/roof/floor assembly, and
          click "Save changes" first.
        </p>
      ) : (
        <>
          <div className="lca-summary-controls">
            <label className="lca-summary-select">
              Assembly
              <select
                value={assemblyFilter}
                onChange={(e) => {
                  setAssemblyFilter(e.target.value)
                  setSelectedInstanceId(null)
                }}
              >
                <option value="all">All assemblies</option>
                {IN_SCOPE_SECTIONS.map((key) => (
                  <option key={key} value={key}>{bySection[key].label}</option>
                ))}
              </select>
            </label>
            <label className="lca-summary-select">
              Material
              <select
                value={selected?.instanceId ?? ''}
                onChange={(e) => setSelectedInstanceId(e.target.value)}
              >
                {filteredMaterials.map((l) => (
                  <option key={l.instanceId} value={l.instanceId}>{l.name} ({l.assemblyLabel})</option>
                ))}
              </select>
            </label>
          </div>

          {selected && (
            <div className="lca-summary-chart-block">
              <h3>{selected.name} — all phases ({selected.assemblyLabel})</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={phaseData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="phase" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} label={{ value: 'kg CO₂e', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                  <Tooltip content={<PhaseTooltip />} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {phaseData.map((d, i) => (
                      <Cell
                        key={i}
                        fill={
                          d.unmodeled ? '#eee'
                          : d.isCredit ? '#2f5f8a' // module D — a credit, not a burden, deliberately its own color (blue, matches this tab's own heading accent) rather than the amber/green/red status palette, which all mean something else
                          : 'var(--accent)'
                        }
                      />
                    ))}
                    <LabelList dataKey="label" position="top" fontSize={11} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="lca-summary-caveat">
                "n/m" = not yet researched for this material (C1/C3/C4/D — see the layer's row in
                Section Configurator). C2 is computed automatically once mass and the shared waste
                facility distance are known. D (blue) is a recycling/reuse credit, shown as a real
                negative value below the zero line — never a burden. B6 is a whole-building total,
                shown flat on every material's chart — not apportioned per material.
              </p>

              {selectedAssemblyResult?.hasData && (
                <div className="lca-summary-ai-feedback">
                  <h4>A4 / assembly-level commentary</h4>
                  <AiFeedbackPanel assemblyResult={selectedAssemblyResult} />
                </div>
              )}
            </div>
          )}

          <div className="lca-summary-chart-block">
            <h3>Total GWP by assembly (A1-A3 + A4, excludes B4/C&D)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={assemblyData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="assembly" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} label={{ value: 'kg CO₂e', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <Tooltip content={<AssemblyTooltip />} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {assemblyData.map((d, i) => (
                    <Cell key={i} fill={d.realValue == null ? '#eee' : d.favorable === true ? 'var(--status-complete)' : d.favorable === false ? 'var(--status-error)' : 'var(--accent)'} />
                  ))}
                  <LabelList dataKey="label" position="top" fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="lca-summary-caveat">
              Green = below the median of the three assemblies (favorable), red = above (unfavorable)
              — relative to each other, not an absolute target.
            </p>
          </div>

          <LcaConclusionsPanel />
          <RevitExportPanel />
        </>
      )}
    </div>
  )
}
