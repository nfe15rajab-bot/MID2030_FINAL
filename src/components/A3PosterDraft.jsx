import React from 'react'
import SectionPreview from './SectionPreview.jsx'
import { calculateUValue } from '../lib/uvalue.js'
import './A3PosterDraft.css'

function fmt(n, digits = 1) {
  return n != null ? n.toFixed(digits) : '—'
}

// One assembly's "column" — the real section drawing (same SectionPreview
// used by the standalone Section PDFs) plus its key figures and its
// per-layer inputs, so the poster reads as one coherent sheet rather than
// a diagram with numbers looked up elsewhere.
function AssemblyColumn({ summary, record }) {
  if (!summary.hasData) {
    return (
      <div className="a3-poster-column a3-poster-column--empty">
        <h3>{summary.label}</h3>
        <p className="a3-poster-empty">No layers saved yet.</p>
      </div>
    )
  }

  const layers = record?.layers ?? []
  // SectionPreview needs a real rTotal (calls .toFixed on it whenever
  // missingData is false) — getAssemblySummaries() only surfaces uValue,
  // not rTotal, so recompute both together here the same way
  // SectionPdfButton does, rather than passing a null rTotal that would
  // crash SectionPreview the moment uValue happens to be known.
  const { uValue, rTotal, missingData } = calculateUValue(layers, summary.key)

  return (
    <div className="a3-poster-column">
      <div className="a3-poster-drawing">
        <SectionPreview
          section={summary.label}
          owner={summary.owner}
          savedAt={summary.savedAt}
          layers={layers}
          uValue={uValue}
          rTotal={rTotal}
          missingData={missingData}
          gwpTotal={summary.a1a3Total}
          gwpKnownCount={summary.a1a3KnownCount}
          pitchDeg={record?.pitchDeg}
        />
      </div>

      <table className="a3-poster-results-table">
        <tbody>
          <tr><th>U-value</th><td>{fmt(summary.uValue, 3)} W/m²K</td></tr>
          <tr><th>A1-A3</th><td>{summary.a1a3KnownCount > 0 ? `${fmt(summary.a1a3Total)} kg CO₂e` : 'not yet assessed'}</td></tr>
          <tr><th>A4</th><td>{summary.a4KnownCount > 0 ? `${fmt(summary.a4Total)} kg CO₂e` : 'not yet assessed'}</td></tr>
          <tr>
            <th>B4</th>
            <td>
              {layers.every((l, i) => summary.layerResults[i]?.b4 != null) && layers.length > 0
                ? `${fmt(summary.layerResults.reduce((s, l) => s + (l.b4 ?? 0), 0))} kg CO₂e`
                : 'not yet assessed'}
            </td>
          </tr>
          <tr><th>Normalized</th><td>{fmt(summary.normalized, 3)} kg CO₂e/m²/yr</td></tr>
        </tbody>
      </table>

      <table className="a3-poster-inputs-table">
        <thead>
          <tr>
            <th>Layer</th>
            <th>Thickness</th>
            <th>Density</th>
            <th>λ</th>
            <th>GWP unit</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((l) => (
            <tr key={l.instanceId}>
              <td>{l.name}</td>
              <td>{l.thicknessMM != null ? `${l.thicknessMM}mm` : '—'}</td>
              <td>{l.densityKgM3 ?? '—'}</td>
              <td>{l.thermalConductivityWmK ?? '—'}</td>
              <td>{l.gwpA1A3PerFunctionalUnit ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PosterHeader({ subtitle }) {
  return (
    <div className="a3-poster-header">
      <div>
        <h1>MID 2030 — Model 1 Assembly Builder</h1>
        <p>Group 02 · Batavierenplantsoen, Haarlem · Model 1, timber cabin{subtitle ? ` — ${subtitle}` : ''}</p>
      </div>
      <p className="a3-poster-date">Generated {new Date().toLocaleDateString()}</p>
    </div>
  )
}

/**
 * A3 Poster Draft — automates the previously-manual "A3 presentation
 * slides" checklist in DeliverablesTab.jsx (compile key figures / add
 * section diagrams / add inputs) into an exportable landscape sheet set.
 * Deliberately does NOT attempt to capture a 3D model render or provider
 * map screenshot — grabbing a live WebGL/Leaflet frame reliably from
 * outside those components isn't something this app can do without a
 * second, fragile capture pipeline; those two images stay a manual
 * paste-in from the 3D Model / Providers tabs, same as this app is
 * upfront about the true-to-scale DXF export needing a running local
 * server. Everything else here is pulled from real saved data, same as
 * every other export in this app.
 *
 * Two physical pages, not one long sheet: Page 1 is the per-assembly
 * technical content (diagrams/figures/inputs), Page 2 is the building-wide
 * summary (totals/resources) — a real content boundary, each captured as
 * its own html2canvas snapshot and its own PDF page (see
 * multiPagePdfExport.js's exportMultiSectionPdf), rather than one giant
 * canvas sliced at a fixed pixel height that could as easily cut a table
 * row or a layer band in half as land between them. `page1Ref`/`page2Ref`
 * are where the export function reads from (plain refs, not React's
 * forwardRef — this component owns two independent DOM roots, not one).
 */
export default function A3PosterDraft({ summaries, records, references, page1Ref, page2Ref }) {
  const withData = summaries.filter((s) => s.hasData)
  const totalA1A3 = withData.reduce((sum, s) => sum + (s.a1a3KnownCount > 0 ? s.a1a3Total : 0), 0)
  const totalA4 = withData.reduce((sum, s) => sum + (s.a4KnownCount > 0 ? s.a4Total : 0), 0)

  return (
    <div className="a3-poster-pages">
      <div className="a3-poster" ref={page1Ref}>
        <PosterHeader />
        <div className="a3-poster-columns">
          {summaries.map((s) => (
            <AssemblyColumn key={s.key} summary={s} record={records[s.key]} />
          ))}
        </div>
        <p className="a3-poster-page-number">Sheet 1 of 2 — per-assembly sections</p>
      </div>

      <div className="a3-poster" ref={page2Ref}>
        <PosterHeader subtitle="continued" />
        <div className="a3-poster-footer">
          <div className="a3-poster-totals">
            <h3>Building totals (in-scope assemblies)</h3>
            <p>A1-A3: <strong>{fmt(totalA1A3)} kg CO₂e</strong> · A4: <strong>{fmt(totalA4)} kg CO₂e</strong></p>
            <p className="a3-poster-note">
              3D model renders and provider-map screenshots are not captured automatically — paste them
              in by hand from the 3D Model / Providers tabs before printing.
            </p>
          </div>

          <div className="a3-poster-resources">
            <h3>Resources &amp; sources</h3>
            {references.length === 0 ? (
              <p className="a3-poster-empty">No accepted citations yet.</p>
            ) : (
              <ul>
                {references.map((r, i) => <li key={i}>{r.label}</li>)}
              </ul>
            )}
          </div>
        </div>
        <p className="a3-poster-page-number">Sheet 2 of 2 — summary &amp; sources</p>
      </div>
    </div>
  )
}
