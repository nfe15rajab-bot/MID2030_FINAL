import React, { useMemo, useRef, useState } from 'react'
import { getHinalMaterialAuditData, exportHinalMaterialAuditExcel } from '../lib/hinalMaterialAudit.js'
import { exportMultiPagePdf } from '../lib/multiPagePdfExport.js'
import './HinalMaterialAuditReport.css'

export default function HinalMaterialAuditReport() {
  const reportRef = useRef(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)

  const { rows, groupedByDiscipline, stats } = useMemo(() => getHinalMaterialAuditData(), [])
  const disciplines = Object.keys(groupedByDiscipline).sort()

  async function handlePdfExport() {
    if (!reportRef.current) return
    setExportingPdf(true)
    try {
      await exportMultiPagePdf(reportRef.current, 'Hinal_Material_Audit_and_Image_Research_Report.pdf', {
        format: 'a4',
        orientation: 'landscape',
      })
    } finally {
      setExportingPdf(false)
    }
  }

  async function handleExcelExport() {
    setExportingExcel(true)
    try {
      await exportHinalMaterialAuditExcel()
    } finally {
      setExportingExcel(false)
    }
  }

  return (
    <div className="hinal-audit-container">
      {/* Top Controls Bar */}
      <div className="hinal-audit-actions">
        <div className="hinal-audit-title-block">
          <h2>Material Audit & Image Research Deliverable</h2>
          <p>
            Complete project material catalog grouped by discipline. Highlights whether each value (GWP, Lambda, Density, Manufacturer, Provider) is <strong>Referenced</strong> or <strong>Assumed</strong>, and lists image search & missing value action items for Hinal.
          </p>
        </div>
        <div className="hinal-audit-buttons">
          <button
            type="button"
            className="hinal-btn hinal-btn--pdf"
            onClick={handlePdfExport}
            disabled={exportingPdf || rows.length === 0}
          >
            {exportingPdf ? 'Generating PDF…' : '📄 Export PDF Report'}
          </button>
          <button
            type="button"
            className="hinal-btn hinal-btn--excel"
            onClick={handleExcelExport}
            disabled={exportingExcel || rows.length === 0}
          >
            {exportingExcel ? 'Generating Sheet…' : '📊 Export Excel Sheet (.xlsx)'}
          </button>
        </div>
      </div>

      {/* Printable Report Document */}
      <div ref={reportRef} className="hinal-audit-doc">
        {/* Document Header */}
        <header className="hinal-doc-header">
          <div className="hinal-header-main">
            <h1>MID 2030 — Material Audit, Value Provenance & Image Research</h1>
            <p className="hinal-subtitle">
              Group 02 · Batavierenplantsoen, Haarlem | Material Research & Audit Report
            </p>
          </div>
          <div className="hinal-header-badge">
            <span>Prepared for Hinal</span>
          </div>
        </header>

        {/* Summary Dashboard Bar */}
        <div className="hinal-summary-grid">
          <div className="hinal-summary-card">
            <span className="hinal-summary-num">{stats.totalMaterials}</span>
            <span className="hinal-summary-label">Total Materials</span>
          </div>
          <div className="hinal-summary-card hinal-summary-card--green">
            <span className="hinal-summary-num">{stats.fullyReferencedCount}</span>
            <span className="hinal-summary-label">Fully Referenced</span>
          </div>
          <div className="hinal-summary-card hinal-summary-card--yellow">
            <span className="hinal-summary-num">{stats.partiallyReferencedCount}</span>
            <span className="hinal-summary-label">Partially Referenced</span>
          </div>
          <div className="hinal-summary-card hinal-summary-card--amber">
            <span className="hinal-summary-num">{stats.assumedCount}</span>
            <span className="hinal-summary-label">Assumed / Needs Review</span>
          </div>
          <div className="hinal-summary-card hinal-summary-card--red">
            <span className="hinal-summary-num">{stats.missingProvidersCount}</span>
            <span className="hinal-summary-label">Missing Providers</span>
          </div>
        </div>

        {/* Legend */}
        <div className="hinal-legend-bar">
          <span className="hinal-legend-title">Provenance Status Guide:</span>
          <span className="hinal-tag hinal-tag--green">● Referenced (EPD / Datasheet / Ökobaudat)</span>
          <span className="hinal-tag hinal-tag--yellow">▲ Assumed (Generic / AI / Standard)</span>
          <span className="hinal-tag hinal-tag--red">✖ Missing Value / Action Required</span>
        </div>

        {/* Materials Tables Grouped By Discipline */}
        {disciplines.length === 0 ? (
          <p className="hinal-empty">No materials currently in saved assemblies.</p>
        ) : (
          disciplines.map((discipline) => {
            const discRows = groupedByDiscipline[discipline]
            return (
              <section key={discipline} className="hinal-discipline-block">
                <div className="hinal-discipline-header">
                  <h3>{discipline.toUpperCase()}</h3>
                  <span className="hinal-disc-count">{discRows.length} material(s)</span>
                </div>

                <div className="hinal-table-wrap">
                  <table className="hinal-table">
                    <thead>
                      <tr>
                        <th>Material Name & Role</th>
                        <th>Thickness</th>
                        <th>Density (kg/m³)</th>
                        <th>Lambda λ (W/mK)</th>
                        <th>GWP A1-A3</th>
                        <th>Manufacturer & EPD</th>
                        <th>Closest Provider & Distance</th>
                        <th>Provenance Status</th>
                        <th>Hinal Action Items & Image Search</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discRows.map((r) => (
                        <tr key={r.key} className="hinal-row">
                          <td className="hinal-cell-name">
                            <strong className="hinal-mat-title">{r.name}</strong>
                            <div className="hinal-mat-sub">
                              {r.category ? `${r.category} | ` : ''}
                              Used in: {r.sections.join(', ')}
                            </div>
                          </td>
                          <td className="hinal-cell-center">
                            {r.thicknessMM != null ? `${r.thicknessMM} mm` : '—'}
                          </td>
                          <td>
                            <div>{r.densityKgM3 != null ? `${r.densityKgM3}` : '—'}</div>
                            <span
                              className={`hinal-micro-badge hinal-micro-badge--${
                                r.densityProvenance === 'Referenced'
                                  ? 'green'
                                  : r.densityProvenance === 'Assumed'
                                  ? 'yellow'
                                  : 'red'
                              }`}
                            >
                              {r.densityProvenance}
                            </span>
                          </td>
                          <td>
                            <div>{r.thermalConductivityWmK != null ? `${r.thermalConductivityWmK}` : '—'}</div>
                            <span
                              className={`hinal-micro-badge hinal-micro-badge--${
                                r.lambdaProvenance === 'Referenced'
                                  ? 'green'
                                  : r.lambdaProvenance === 'Assumed'
                                  ? 'yellow'
                                  : 'red'
                              }`}
                            >
                              {r.lambdaProvenance}
                            </span>
                          </td>
                          <td>
                            <div>
                              {r.gwpA1A3PerFunctionalUnit != null
                                ? `${r.gwpA1A3PerFunctionalUnit} / ${r.functionalUnit}`
                                : '—'}
                            </div>
                            <span
                              className={`hinal-micro-badge hinal-micro-badge--${
                                r.gwpProvenance === 'Referenced'
                                  ? 'green'
                                  : r.gwpProvenance === 'Assumed'
                                  ? 'yellow'
                                  : 'red'
                              }`}
                            >
                              {r.gwpProvenance}
                            </span>
                          </td>
                          <td>
                            <div className="hinal-mfr">{r.manufacturer}</div>
                            {r.gwpSourceUrl && (
                              <a
                                href={r.gwpSourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="hinal-link"
                              >
                                View EPD / Source
                              </a>
                            )}
                          </td>
                          <td>
                            <div
                              className={
                                r.providerStatus === 'Missing' ? 'hinal-text-danger' : 'hinal-provider-name'
                              }
                            >
                              {r.providerName}
                            </div>
                            {r.providerDistanceKm != null && (
                              <div className="hinal-dist">{r.providerDistanceKm} km away</div>
                            )}
                          </td>
                          <td>
                            <span
                              className={`hinal-status-pill hinal-status-pill--${
                                r.overallStatus.startsWith('Fully')
                                  ? 'green'
                                  : r.overallStatus.startsWith('Partially')
                                  ? 'yellow'
                                  : 'red'
                              }`}
                            >
                              {r.overallStatus}
                            </span>
                          </td>
                          <td className="hinal-cell-actions">
                            <ul className="hinal-actions-list">
                              {r.actionItems.map((item, idx) => (
                                <li key={idx}>
                                  <span className="hinal-bullet">📷</span> {item}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
