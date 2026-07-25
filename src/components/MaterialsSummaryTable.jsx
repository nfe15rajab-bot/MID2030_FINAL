import React, { useRef, useState } from 'react'
import {
  exportMaterialsSummaryExcel,
  parseMaterialsSummaryExcelFile,
  applyMaterialsSummaryImport,
} from '../lib/materialsSummaryExcel.js'
import { exportHinalMaterialAuditExcel } from '../lib/hinalMaterialAudit.js'

// Live, discipline-grouped, deduplicated materials table for the Materials
// and Providers tab, plus its Excel export/import controls. `rows` and
// `groupedRows` come from the parent (ProvidersTab.jsx via
// materialsSummary.js's dedupeMaterials/groupByDiscipline) rather than
// being recomputed here, so the table and the tab's own browse list can
// never show different data for the same underlying sections.
export default function MaterialsSummaryTable({ groupedRows, rows, materialById, enteredBy, onImported }) {
  const [expanded, setExpanded] = useState(true)
  const [importStatus, setImportStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef(null)

  const disciplines = Object.keys(groupedRows).sort()

  async function handleExport() {
    setBusy(true)
    try {
      await exportMaterialsSummaryExcel(rows, materialById)
    } finally {
      setBusy(false)
    }
  }

  async function handleHinalAuditExcel() {
    setBusy(true)
    try {
      await exportHinalMaterialAuditExcel()
    } finally {
      setBusy(false)
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleImportFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file next time
    if (!file) return

    setImportStatus(null)
    setBusy(true)
    try {
      const parsedRows = await parseMaterialsSummaryExcelFile(file)
      if (parsedRows.length === 0) {
        setImportStatus('No material rows found in that file.')
        return
      }
      const confirmMessage =
        `This file has ${parsedRows.length} material row(s). Importing will update the shared ` +
        `material database (λ/GWP/density) and push those values into any already-saved layers ` +
        `that use them, plus add any unmatched rows as new custom materials.\n\nContinue?`
      if (!window.confirm(confirmMessage)) return

      const summary = applyMaterialsSummaryImport(parsedRows, enteredBy)
      setImportStatus(
        `Updated ${summary.materialsUpdated} material(s), pushed to ${summary.layersUpdated} ` +
        `layer(s) across ${summary.sectionsTouched.join(', ') || 'no sections'}, created ` +
        `${summary.materialsCreated} new custom material(s)` +
        (summary.skipped > 0 ? `, skipped ${summary.skipped} row(s) with no match.` : '.')
      )
      onImported?.()
    } catch (err) {
      setImportStatus(`Couldn't import that file: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="materials-summary">
      <div className="materials-summary-header">
        <h3>Materials summary{rows.length ? ` (${rows.length} unique materials)` : ''}</h3>
        <div className="materials-summary-actions">
          <button type="button" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <button type="button" onClick={handleExport} disabled={busy || rows.length === 0}>
            {busy ? 'Working…' : 'Export to Excel'}
          </button>
          <button type="button" onClick={handleHinalAuditExcel} disabled={busy || rows.length === 0} style={{ background: '#059669', color: '#ffffff', fontWeight: 600 }}>
            📊 Hinal Audit Sheet
          </button>
          <button type="button" onClick={handleImportClick} disabled={busy}>
            Import Excel
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleImportFileChange}
            style={{ display: 'none' }}
          />
        </div>
      </div>
      {importStatus && <p className="materials-summary-hint">{importStatus}</p>}

      {expanded && (
        rows.length === 0 ? (
          <p className="empty-state">No materials in any saved section yet.</p>
        ) : (
          <div className="materials-summary-table-wrap">
            <table className="materials-summary-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Thickness (mm)</th>
                  <th>Density (kg/m³)</th>
                  <th>λ (W/mK)</th>
                  <th>GWP A1-A3</th>
                  <th>Sections</th>
                  <th>Layers</th>
                  <th>Owner(s)</th>
                </tr>
              </thead>
              <tbody>
                {disciplines.map((discipline) => (
                  <React.Fragment key={discipline}>
                    <tr className="materials-summary-discipline-row">
                      <td colSpan={8}>{discipline}</td>
                    </tr>
                    {groupedRows[discipline].map((row) => (
                      <tr key={row.key}>
                        <td>{row.name}</td>
                        <td>{row.thicknessMM ?? '—'}</td>
                        <td>{row.densityKgM3 ?? '—'}</td>
                        <td>{row.thermalConductivityWmK ?? '—'}</td>
                        <td>{row.gwpA1A3PerFunctionalUnit ?? '—'}</td>
                        <td>{row.sections.join(', ')}</td>
                        <td>{row.instanceCount}</td>
                        <td>{row.owners.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
