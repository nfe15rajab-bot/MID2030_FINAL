import React, { useMemo, useState } from 'react'
import { loadSection } from '../lib/sectionStorage.js'
import { syncLocalDataToFirestore } from '../lib/aiMaterialDataStorage.js'
import { useCurrentUser } from '../context/CurrentUserContext.jsx'
import { getAllMaterials } from '../lib/materialsCatalog.js'
import { loadAssemblyGeometry } from '../lib/assemblyGeometryStorage.js'
import { gwpTotalForLayers } from '../lib/gwpPerM2.js'
import { TEAM_ROLES } from '../data/teamMembers.js'

const UNIT_SECTIONS = new Set(['door', 'window', 'skylight'])

// Every in-scope section sectionStorage saves independently (see
// SectionConfigurator.jsx) — Wall/Roof/Floor (LayerBuilder's layer
// stacks) plus Door/Window/Skylight (UnitAssemblyBuilder's single-unit
// records, same `layers`-array shape underneath). This view is purely
// data-driven off what's actually saved, not a hardcoded category list.
const SECTIONS = ['wall', 'roof', 'floor', 'door', 'window', 'skylight']

// Read-only rollup of every saved section across the team — no new save
// system, just pools the exact records LayerBuilder's "Save changes"
// button already writes (owner + savedAt + layers, one record per
// section). Mirrors the ANALYSIS tab in the class Excel file: grouped by
// section, subtotal per group, grand total at the bottom.
function useTeamSummary() {
  return useMemo(() => {
    const allMaterials = getAllMaterials()

    const groups = SECTIONS.map((section) => {
      const record = loadSection(section)
      if (!record) return null

      const rows = record.layers.map((layer) => ({
        instanceId: layer.instanceId,
        name: layer.name,
        thicknessMM: layer.thicknessMM,
        lambda: layer.thermalConductivityWmK,
        gwp: layer.gwpA1A3PerFunctionalUnit,
        author: record.owner,
        savedAt: record.savedAt,
      }))
      // Real area-scaled subtotal (matches lcaAnalysis.js's deriveQuantity
      // formula, via the shared gwpPerM2.js helper) — NOT a naive sum of
      // raw per-declared-unit values, which used to make a 260mm and a
      // 50mm layer of the same m3-declared material contribute equally.
      // See assemblyAnalysis.js's computeFromLayers for the same fix
      // applied to the Assembly Analysis card/hotspot popup — this was a
      // fourth, independent copy of the identical bug.
      const geometry = UNIT_SECTIONS.has(section) ? null : loadAssemblyGeometry(section)
      const { total: subtotal, known: knownGwpRows } = gwpTotalForLayers(record.layers, allMaterials, geometry?.surfaceAreaM2)

      return {
        section: typeof section === 'string' && section ? (section.charAt(0).toUpperCase() + section.slice(1)) : '',
        rows,
        subtotal,
        knownGwpCount: knownGwpRows.length,
      }
    }).filter(Boolean)

    const grandTotal = groups.reduce((sum, g) => sum + g.subtotal, 0)
    const grandKnownGwp = groups.reduce((sum, g) => sum + g.knownGwpCount, 0)
    const grandRows = groups.reduce((sum, g) => sum + g.rows.length, 0)

    return { groups, grandTotal, grandKnownGwp, grandRows, hasAnySaved: groups.length > 0 }
  }, [])
}

// One-time push of this browser's locally-accepted λ/GWP Suggest values up
// to the shared Firestore document — separate concern from the section
// summary above (aiMaterialDataStorage.js predates Firestore support, and
// this dataset isn't gated on any section being saved), so it renders
// regardless of hasAnySaved.
function FirestoreSyncPanel() {
  const { currentUser } = useCurrentUser()
  const [status, setStatus] = useState({ state: 'idle' })

  async function handleSync() {
    setStatus({ state: 'syncing' })
    try {
      const count = await syncLocalDataToFirestore(currentUser || null)
      setStatus({ state: 'done', count })
    } catch (err) {
      setStatus({ state: 'error', error: err.message })
    }
  }

  return (
    <div className="firestore-sync-panel">
      <button type="button" onClick={handleSync} disabled={status.state === 'syncing'}>
        {status.state === 'syncing' ? 'Syncing…' : 'Sync local λ/GWP data to Firestore'}
      </button>
      <p className="section-save-hint">
        One-time push of whatever λ/GWP values you've accepted in this browser up to the shared
        Firestore doc, so they're not left behind now that Suggest/Accept syncs live across the team.
        Safe to click more than once — it merges, never overwrites a teammate's entries.
      </p>
      {status.state === 'done' && (
        <p className="section-save-hint">Synced {status.count} entr{status.count === 1 ? 'y' : 'ies'}.</p>
      )}
      {status.state === 'error' && (
        <p className="section-save-hint shared-data-banner--offline">Sync failed: {status.error}</p>
      )}
    </div>
  )
}

function TeamRolesGrid() {
  return (
    <div className="team-roles-card" style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>Group 2 Team Roles & Assembly Ownership</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        {Object.entries(TEAM_ROLES).map(([key, member]) => (
          <div key={key} style={{ padding: '0.6rem 0.8rem', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
              {member.name} {member.isAdmin && <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#dbeafe', color: '#1e40af', borderRadius: '4px', marginLeft: '4px' }}>App Admin</span>}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#0284c7', fontWeight: 500, marginTop: '2px' }}>{member.role}</div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>{member.scope}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TeamSummaryTab() {
  const { groups, grandTotal, grandKnownGwp, grandRows, hasAnySaved } = useTeamSummary()

  if (!hasAnySaved) {
    return (
      <div className="team-summary">
        <TeamRolesGrid />
        <p className="empty-state">
          No sections saved yet — go to Section Configurator, build a wall/roof/floor assembly, and
          click "Save changes" first. This view reads from those saved sections.
        </p>
        <FirestoreSyncPanel />
      </div>
    )
  }

  return (
    <div className="team-summary">
      <TeamRolesGrid />
      <FirestoreSyncPanel />
      <table className="team-summary-table">
        <thead>
          <tr>
            <th>Author</th>
            <th>Layer / Material</th>
            <th>Thickness</th>
            <th>λ</th>
            <th>GWP A1-A3</th>
            <th>Last saved</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <React.Fragment key={group.section}>
              <tr className="team-summary-group-header">
                <td colSpan={6}>{group.section}</td>
              </tr>
              {group.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="team-summary-empty-row">No layers saved for this section.</td>
                </tr>
              ) : (
                group.rows.map((row) => (
                  <tr key={row.instanceId}>
                    <td>{row.author}</td>
                    <td>{row.name}</td>
                    <td>{row.thicknessMM != null ? `${row.thicknessMM} mm` : '—'}</td>
                    <td>{row.lambda != null ? row.lambda : '—'}</td>
                    <td>{row.gwp != null ? row.gwp.toFixed(1) : '—'}</td>
                    <td>{new Date(row.savedAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
              <tr className="team-summary-subtotal-row">
                <td colSpan={4}>Subtotal — {group.section}</td>
                <td>{group.knownGwpCount > 0 ? `${group.subtotal.toFixed(1)} kg CO₂e` : '—'}</td>
                <td />
              </tr>
            </React.Fragment>
          ))}
          <tr className="team-summary-total-row">
            <td colSpan={4}>Grand total</td>
            <td>{grandKnownGwp > 0 ? `${grandTotal.toFixed(1)} kg CO₂e` : '—'}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <p className="team-summary-caveat">
        Per-layer GWP A1-A3 figures (table rows) are each material's raw declared-unit value, same as
        its EPD source — thickness/density/area scaling happens per assembly. Subtotal and Grand total
        rows ARE thickness- and area-scaled (each assembly's real Part A floor area, or a per-1m²
        fallback if none entered yet — see Section Configurator). {grandKnownGwp}/{grandRows} saved
        layers have a GWP figure.
      </p>
    </div>
  )
}
