import React, { useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { getEpdReferenceList } from '../lib/epdReferenceList.js'
import './LcaEpdTab.css'

// The "Environmental Product Declarations" deliverable — materials with
// a real, checkable source (Ökobaudat or an accepted AI suggestion that
// kept its citation), not raw research notes. Exported as its own PDF
// via the same html2canvas+jsPDF pipeline used throughout this app.
// Extracted out of LcaEpdTab.jsx so the Deliverables tab's "EPD
// Collection" button can reuse the exact same component/export logic
// instead of a second copy of it.
export default function EpdReferenceListPanel() {
  const entries = getEpdReferenceList()
  const sheetRef = useRef(null)
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    if (!sheetRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(sheetRef.current, { scale: 2, backgroundColor: '#ffffff' })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height)
      pdf.save('epd-reference-list.pdf')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="lca-epd-list">
      <h3>EPD reference list</h3>
      <p className="lca-note">
        Materials with a real Ökobaudat source or an AI-verified citation kept on accept — {entries.length} found.
        Materials whose GWP was hand-typed from a datasheet (no clickable source) aren't included here.
      </p>
      <div ref={sheetRef} className="lca-epd-sheet">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Source</th>
              <th>GWP value</th>
              <th>Declared unit</th>
              <th>Applied in this project (A1-A3 = declared value × quantity)</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td>{e.material}</td>
                <td>
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer">{e.sourceType}</a>
                </td>
                <td>{e.gwpValue != null ? e.gwpValue : '—'}</td>
                <td>{e.declaredUnit || '—'}</td>
                <td>
                  {e.usages.length === 0 ? '—' : (
                    <ul className="epd-usage-list">
                      {e.usages.map((u, j) => (
                        <li key={j}>
                          <strong>{u.section}</strong>{u.calc?.substituted ? `: ${u.calc.substituted} = ${u.calc.result}` : ' — not yet computable'}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={5} className="lca-note">None yet — accept an Ökobaudat pick or an AI GWP suggestion first.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <button type="button" className="export-scale-button" onClick={handleExport} disabled={exporting || entries.length === 0}>
        {exporting ? 'Generating PDF…' : 'Export EPD reference list PDF'}
      </button>
    </div>
  )
}
