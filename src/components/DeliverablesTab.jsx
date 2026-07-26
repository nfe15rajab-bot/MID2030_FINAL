import React, { useMemo, useRef, useState } from 'react'
import { getAssemblySummaries, getAllReferences, getFicheDeliverables } from '../lib/deliverablesData.js'
import { loadSection } from '../lib/sectionStorage.js'
import { calculateUValue } from '../lib/uvalue.js'
import { getAllMaterials } from '../lib/materialsCatalog.js'
import { loadAssemblyGeometry } from '../lib/assemblyGeometryStorage.js'
import { gwpTotalForLayers } from '../lib/gwpPerM2.js'
import { getEpdReferenceList } from '../lib/epdReferenceList.js'
import { getFullCompletenessReport } from '../lib/lcaAnalysis.js'
import { findProvidersForMaterial } from '../lib/geo.js'
import { exportMultiPagePdf, exportMultiSectionPdf, isolateClonedElement } from '../lib/multiPagePdfExport.js'
import { exportA4Docx } from '../lib/a4DocxExport.js'
import { getSpreadsheetRows, getSpreadsheetMeta } from '../lib/spreadsheetData.js'
import { exportSpreadsheetExcel, exportReferenceMatchingExcel } from '../lib/spreadsheetExcelExport.js'
import { embedSectionDataInPdf } from '../lib/pdfSessionAttachment.js'
import { exportAllAnnexVisualsAsZip } from '../lib/pngExport.js'
import providers from '../../database/providers.json'
import referenceLocations from '../../database/reference-locations.json'
import A4ReportDraft from './A4ReportDraft.jsx'
import A3PosterDraft from './A3PosterDraft.jsx'
import EpdReferenceListPanel from './EpdReferenceListPanel.jsx'
import GlobalProviderMap from './GlobalProviderMap.jsx'
import SectionPreview from './SectionPreview.jsx'
import FicheTechniquePanel from './FicheTechniquePanel.jsx'
import RevitExportPanel from './RevitExportPanel.jsx'
import HinalMaterialAuditReport from './HinalMaterialAuditReport.jsx'
import GoogleDocsSyncPanel from './GoogleDocsSyncPanel.jsx'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import './DeliverablesTab.css'
import './SectionPreview.css'
import './FicheTechnique.css'

const STATUS_META = {
  ready: { label: 'Ready to generate', className: 'deliverable-status--ready' },
  blocked: { label: 'Blocked', className: 'deliverable-status--blocked' },
  'not-yet-automated': { label: 'Not yet automated', className: 'deliverable-status--pending' },
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status]
  return <span className={`deliverable-status ${meta.className}`}>{meta.label}</span>
}

// One button per assembly's section PDF — reuses SectionPreview.jsx (the
// exact same read-only component LayerBuilder's own "Export PDF" already
// captures) rendered off-screen with that assembly's real saved data, so
// there's no second export pipeline, just the same one triggered for an
// assembly that isn't the one currently open in Section Configurator.
function SectionPdfButton({ assemblyKey, label }) {
  const record = loadSection(assemblyKey)
  const ref = useRef(null)
  const [exporting, setExporting] = useState(false)
  const hasData = !!record && record.layers.length > 0

  if (!hasData) {
    return (
      <div className="deliverable-row">
        <span className="deliverable-name">{label} section PDF</span>
        <StatusBadge status="blocked" />
        <span className="deliverable-reason">no layers saved for {label}</span>
      </div>
    )
  }

  const { uValue, rTotal, missingData } = calculateUValue(record.layers, assemblyKey)
  // Real area-scaled total (see gwpPerM2.js) — this feeds the exported
  // Section PDF, one of the actual graded deliverables, so it can't be
  // left as a naive raw sum.
  const allMaterials = getAllMaterials()
  const geometry = loadAssemblyGeometry(assemblyKey)
  const { total: gwpTotal, known: gwpKnown } = gwpTotalForLayers(record.layers, allMaterials, geometry?.surfaceAreaM2)

  async function handleExport() {
    if (!ref.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(ref.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: true,
        onclone: (clonedDoc, clonedEl) => {
          isolateClonedElement(clonedDoc, clonedEl, 800)
        }
      })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height)

      // Embed this section's exact saved record as a real PDF attachment
      // (see pdfSessionAttachment.js) so "Generate layers from PDF"
      // (LayerBuilder.jsx) can reconstruct it losslessly later — one extra
      // post-processing step over the plain jsPDF bytes, not a second
      // export pipeline.
      const pdfBytes = pdf.output('arraybuffer')
      const finalBytes = await embedSectionDataInPdf(pdfBytes, { section: assemblyKey, record })
      const blob = new Blob([finalBytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${assemblyKey}-section.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="deliverable-row">
      <span className="deliverable-name">{label} section PDF</span>
      <StatusBadge status="ready" />
      <button type="button" onClick={handleExport} disabled={exporting}>
        {exporting ? 'Generating…' : 'Export'}
      </button>
      {/* Off-screen, always rendered so the ref is capturable on click —
          same "hidden via positioning, not unmounted" reasoning as
          ModelViewer in App.jsx. */}
      <div style={{ position: 'fixed', left: 0, top: 0, width: '800px', zIndex: -9999, opacity: 0.001, pointerEvents: 'none', background: '#ffffff' }}>
        <SectionPreview
          ref={ref}
          section={label}
          owner={record.owner}
          savedAt={record.savedAt}
          layers={record.layers}
          uValue={uValue}
          rTotal={rTotal}
          missingData={missingData}
          gwpTotal={gwpTotal}
          gwpKnownCount={gwpKnown.length}
          pitchDeg={record.pitchDeg}
          areaM2={geometry?.surfaceAreaM2}
        />
      </div>
    </div>
  )
}

// One row per distinct material, each expandable in place to reveal the
// exact same FicheTechniquePanel the Providers tab uses — including its
// own "Export fiche technique PDF" button — so there's no second fiche
// export pipeline here, just the existing one surfaced for every
// material in one place instead of clicking through Providers one at a
// time.
function FicheDeliverablesSection() {
  const entries = useMemo(() => getFicheDeliverables(), [])
  const [openKey, setOpenKey] = useState(null)
  const [downloadingZip, setDownloadingZip] = useState(false)
  const containerRef = useRef(null)
  const researchedCount = entries.filter((e) => e.hasData).length

  async function handleDownloadAllZip() {
    if (!containerRef.current) return
    setDownloadingZip(true)
    try {
      await exportAllAnnexVisualsAsZip(containerRef, [], 'MID2030_Material_Fiches_PNG.zip')
    } finally {
      setDownloadingZip(false)
    }
  }

  return (
    <div className="deliverable-block">
      <div className="deliverable-row">
        <span className="deliverable-name">Fiche technique sheets</span>
        <StatusBadge status={entries.length > 0 ? 'ready' : 'blocked'} />
        {entries.length === 0 && <span className="deliverable-reason">no saved layers yet</span>}
        {entries.length > 0 && (
          <button
            type="button"
            onClick={handleDownloadAllZip}
            disabled={downloadingZip}
            style={{ marginLeft: 'auto', background: 'var(--accent, #2563eb)', color: '#ffffff', fontWeight: 600, padding: '6px 14px', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            {downloadingZip ? 'Packing ZIP…' : '📦 Export All Fiches as PNG ZIP'}
          </button>
        )}
      </div>
      {entries.length > 0 && (
        <p className="deliverable-note">
          One fiche per material — {researchedCount}/{entries.length} have research cataloged.
          Open any fiche to review, edit, or save / copy as high-resolution PNG image.
        </p>
      )}
      <div ref={containerRef}>
        {entries.map((e) => {
          const { closestToSite } = findProvidersForMaterial(e.material.id, providers, referenceLocations)
          const isOpen = openKey === e.key
          return (
            <div key={e.key} className="fiche-deliverable-row">
              <button type="button" onClick={() => setOpenKey(isOpen ? null : e.key)}>
                {isOpen ? 'Hide' : 'Open'} {e.label} <span className="section-badge">{e.section}</span>
              </button>
              <span className={`fiche-deliverable-status fiche-deliverable-status--${e.hasData ? 'ready' : 'pending'}`}>
                {e.hasData ? 'researched' : 'not yet researched'}
              </span>
              {isOpen && <FicheTechniquePanel material={e.material} closestToSite={closestToSite} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function A4ReportSection() {
  const summaries = getAssemblySummaries()
  const references = getAllReferences()
  const hasAnyData = summaries.some((s) => s.hasData)
  // Two copies on purpose: the visible one sits inside a scrollable,
  // height-capped preview box (good UX for a long document in a tab),
  // but html2canvas capturing an element nested inside an overflow:auto
  // ancestor clips to that ancestor's viewport — verified directly (the
  // first export came back with the Abstract cut off mid-sentence and a
  // page and a half of blank space). The export ref points at a second,
  // unconstrained off-screen copy instead — same "hidden via position,
  // not a different pipeline" approach as SectionPdfButton below.
  const exportRef = useRef(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(null) // { current, total } | null
  const [exportingDocx, setExportingDocx] = useState(false)

  async function handleExport() {
    if (!exportRef.current) return
    setExporting(true)
    setExportProgress(null)
    try {
      await exportMultiPagePdf(exportRef.current, 'a4-report-draft.pdf', {
        onProgress: (current, total) => setExportProgress({ current, total }),
      })
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }

  async function handleExportDocx() {
    setExportingDocx(true)
    try {
      await exportA4Docx(summaries, references)
    } finally {
      setExportingDocx(false)
    }
  }

  return (
    <div className="deliverable-block">
      <div className="deliverable-row">
        <span className="deliverable-name">A4 Report Draft</span>
        <StatusBadge status={hasAnyData ? 'ready' : 'blocked'} />
        {!hasAnyData && <span className="deliverable-reason">no assemblies have saved layers yet</span>}
        <button type="button" onClick={handleExport} disabled={exporting || !hasAnyData}>
          {exporting
            ? `Generating PDF… ${exportProgress ? `(page batch ${exportProgress.current}/${exportProgress.total})` : ''}`
            : 'Export A4 Report Draft PDF'}
        </button>
        <button type="button" onClick={handleExportDocx} disabled={exportingDocx || !hasAnyData}>
          {exportingDocx ? 'Generating DOCX…' : 'Export A4 Report Draft DOCX'}
        </button>
      </div>
      <p className="deliverable-note">
        Same content, two formats: the PDF is a snapshot of the styled preview below (html2canvas+jsPDF);
        the DOCX is built directly as real editable text/tables (the <code>docx</code> package) so it can
        be opened and rewritten in Word before submission. You can also sync or append the full LCA Report directly to your Google Document below.
      </p>

      <GoogleDocsSyncPanel summaries={summaries} references={references} />

      <div className="deliverable-preview">
        <A4ReportDraft summaries={summaries} references={references} />
      </div>
      <div style={{ position: 'fixed', left: 0, top: 0, width: '800px', zIndex: -9999, opacity: 0.001, pointerEvents: 'none', background: '#ffffff' }}>
        <A4ReportDraft ref={exportRef} summaries={summaries} references={references} />
      </div>
    </div>
  )
}

// Automates most of the "A3 presentation slides" checklist that used to
// be pure manual instructions below — key figures, section diagrams, and
// per-layer inputs are all pulled from real saved data into one exportable
// landscape sheet. Still leaves 3D renders/photos as a manual paste-in
// (see A3PosterDraft.jsx's own comment on why that isn't auto-captured).
function A3PosterSection() {
  const summaries = getAssemblySummaries()
  const references = getAllReferences()
  const hasAnyData = summaries.some((s) => s.hasData)
  const records = Object.fromEntries(summaries.map((s) => [s.key, loadSection(s.key)]))
  // Same "two copies" reasoning as A4ReportSection above — the visible
  // preview sits in a scrollable box, the export refs point at an
  // unconstrained off-screen copy so html2canvas doesn't clip it. Two
  // refs (not one) — see A3PosterDraft.jsx: the poster is now two
  // physical sheets, each captured and paginated independently via
  // exportMultiSectionPdf so the page break lands at a real content
  // boundary (end of the assembly columns) instead of wherever a single
  // tall canvas happened to hit the page-height mark.
  const exportPage1Ref = useRef(null)
  const exportPage2Ref = useRef(null)
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    if (!exportPage1Ref.current || !exportPage2Ref.current) return
    setExporting(true)
    try {
      await exportMultiSectionPdf(
        [exportPage1Ref.current, exportPage2Ref.current],
        'a3-poster-draft.pdf',
        { format: 'a3', orientation: 'landscape' }
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="deliverable-block">
      <div className="deliverable-row">
        <span className="deliverable-name">A3 Poster Draft</span>
        <StatusBadge status={hasAnyData ? 'ready' : 'blocked'} />
        {!hasAnyData && <span className="deliverable-reason">no assemblies have saved layers yet</span>}
        <button type="button" onClick={handleExport} disabled={exporting || !hasAnyData}>
          {exporting ? 'Generating PDF…' : 'Export A3 Poster PDF'}
        </button>
      </div>
      <p className="deliverable-note">
        Section diagrams, key figures (U-value/A1-A3/A4/B4), per-layer inputs, and sources — all pulled
        live. 3D model renders and provider-map screenshots still need to be pasted in by hand (see the
        note on the sheet itself); this is layout scaffolding, not a finished poster.
      </p>
      <div className="deliverable-preview a3-poster-preview">
        <A3PosterDraft summaries={summaries} records={records} references={references} />
      </div>
      <div style={{ position: 'fixed', left: 0, top: 0, width: '1200px', zIndex: -9999, opacity: 0.001, pointerEvents: 'none', background: '#ffffff' }}>
        <A3PosterDraft
          summaries={summaries}
          records={records}
          references={references}
          page1Ref={exportPage1Ref}
          page2Ref={exportPage2Ref}
        />
      </div>
    </div>
  )
}

// Right-pane companion to whichever deliverable list is showing on the
// left — same underlying data LCA and EPD tab's own "Completeness check"
// uses (getFullCompletenessReport), surfaced here too since "what's
// blocking a deliverable" is exactly what this tab's status badges are
// already pointing at; this just pools every assembly's gaps into one
// persistent list instead of requiring a tab switch to see them.
function MissingDataChecklist() {
  const report = useMemo(() => getFullCompletenessReport(), [])
  const totalMissing = report.reduce((sum, r) => sum + r.items.length, 0)

  return (
    <div className="deliverables-checklist">
      <h3>Missing data checklist</h3>
      {totalMissing === 0 && (
        <p className="deliverable-note">
          Nothing missing across A1-A3/A4/B4/C&D for any in-scope assembly right now.
        </p>
      )}
      {report.map((r) => (
        <div key={r.assembly} className="deliverables-checklist-group">
          <div className="deliverables-checklist-header">
            <strong>{r.assembly}</strong>
            {r.status === 'out-of-scope' && <span className="deliverable-status deliverable-status--pending">Out of scope</span>}
            {r.status === 'no-data' && <span className="deliverable-status deliverable-status--blocked">No layers saved</span>}
            {r.status === 'complete' && <span className="deliverable-status deliverable-status--ready">Complete</span>}
            {r.status === 'incomplete' && (
              <span className="deliverable-status deliverable-status--blocked">
                {r.items.length} item{r.items.length === 1 ? '' : 's'} missing
              </span>
            )}
          </div>
          {r.items.length > 0 && (
            <ul>
              {r.items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

const GWP_EOL_TIER_LABEL = {
  epd: 'EPD-sourced',
  ai: 'AI-sourced (unverified)',
  manual: 'Assumed / proxy dataset',
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

// Reuses the same "verified vs unverified" pill LayerBuilder already shows
// per-layer (service-life-badge) — one shared visual language for "is this
// number real or assumed" across the whole app, not a new badge style just
// for this tab.
function ConfidenceBadge({ tier, label }) {
  if (!tier && !label) return null
  const isVerified = tier === 'high' || tier === 'epd'
  return (
    <span className={`service-life-badge service-life-badge--${isVerified ? 'verified' : 'unverified'}`}>
      {label ?? GWP_EOL_TIER_LABEL[tier] ?? tier}
    </span>
  )
}

// One row per saved layer across every in-scope assembly, documenting
// exactly where its GWP A1-A3, service life, end-of-life (C1-C4/D), and
// transport distance figures came from — generalizes A4ReportDraft.jsx's
// EndOfLifeMethodologyNote (EOL only) to cover every researched field, off
// the exact same layerResults lcaAnalysis.js's analyzeLcaAssembly already
// computes (see lcaAnalysis.js's gwpSource/gwpConfidence additions and
// distanceSource, which was already a full descriptive string). Nothing
// here is re-derived, re-typed, or re-fetched — it's a read-only view of
// data that already exists, for graders/teammates to audit the sourcing.
function AssumptionsSection() {
  const summaries = getAssemblySummaries()
  const rows = summaries.flatMap((s) =>
    (s.layerResults ?? []).map((l) => ({ assembly: s.label, ...l }))
  )

  return (
    <div className="deliverable-block">
      <div className="deliverable-row">
        <span className="deliverable-name">Assumptions</span>
        <StatusBadge status={rows.length > 0 ? 'ready' : 'blocked'} />
        {rows.length === 0 && <span className="deliverable-reason">no assemblies have saved layers yet</span>}
      </div>
      {rows.length > 0 && (
        <>
          <p className="deliverable-note">
            Every researched value behind the numbers elsewhere in this tab, with its source and
            confidence — GWP A1-A3, service life, end-of-life (C1/C3/C4/Module D), and transport
            distance. "EPD-sourced"/high confidence means a real published source (an EPD, Ökobaudat, or
            a routed OpenRouteService distance); "Assumed"/medium or low confidence means a proxy dataset
            or reasoned estimate — flagged here rather than presented as equivalent to a verified figure.
          </p>
          <div className="assumptions-table-wrap">
            <table className="team-summary-table">
              <thead>
                <tr>
                  <th>Assembly</th>
                  <th>Material</th>
                  <th>GWP A1-A3 source</th>
                  <th>Service life</th>
                  <th>End-of-life (C1/C3/C4/D)</th>
                  <th>Transport distance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={`${l.assembly}-${l.instanceId}`}>
                    <td>{l.assembly}</td>
                    <td>{l.name}</td>
                    <td>
                      {l.gwpConfidenceLabel || l.gwpSourceNote || l.gwpSource ? (
                        <>
                          <ConfidenceBadge tier={l.gwpConfidence ?? 'epd'} label={l.gwpConfidenceLabel} />
                          {l.gwpSourceNote && <div className="deliverable-reason">{l.gwpSourceNote}</div>}
                          {l.gwpSource && (
                            <div className="deliverable-reason">
                              <a href={l.gwpSource} target="_blank" rel="noreferrer">source ↗</a>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="deliverable-reason">not yet sourced</span>
                      )}
                    </td>
                    <td>
                      {l.serviceLifeYears != null ? (
                        <>
                          {l.serviceLifeYears}yr <ConfidenceBadge tier={l.serviceLifeSource} />
                        </>
                      ) : (
                        <span className="deliverable-reason">not yet researched</span>
                      )}
                    </td>
                    <td>
                      {l.eolSource ? (
                        <>
                          {[['C1', l.c1], ['C3', l.c3], ['C4', l.c4], ['D', l.moduleD]]
                            .filter(([, v]) => v != null)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(' · ') || '—'}{' '}
                          <ConfidenceBadge tier={l.eolSource} />
                          {l.eolSource === 'manual' && l.eolAssumptionBasis && (
                            <div className="deliverable-reason">"{l.eolAssumptionBasis}"</div>
                          )}
                        </>
                      ) : (
                        <span className="deliverable-reason">not yet modeled</span>
                      )}
                    </td>
                    <td>
                      {l.distanceKm != null ? (
                        <>
                          {Math.round(l.distanceKm)}km
                          <div className="deliverable-reason">{l.distanceSource}</div>
                        </>
                      ) : (
                        <span className="deliverable-reason">{l.distanceMissing ?? 'not yet set'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const SUB_TABS = ['Report', 'Material Audit', 'Assumptions', 'Excel & EPD', 'Sections', 'Fiche sheets']

// Deliverables — the final tab. One place to generate every output the
// assignment requires, each reusing an existing pipeline rather than a
// new one per button. Status is computed live from real data, never
// hardcoded — nothing here claims "ready" if the underlying data is
// still incomplete upstream.
//
// Sub-tabbed (not one long scroll) so the page loads short and you only
// pay the render/layout cost of whatever you're actually looking at —
// same .section-tabs pill pattern Section Configurator already uses for
// wall/roof/floor, not a new tab style.
export default function DeliverablesTab() {
  const [subTab, setSubTab] = useState(SUB_TABS[0])
  const summaries = getAssemblySummaries()
  const hasAnyData = summaries.some((s) => s.hasData)
  const epdEntries = getEpdReferenceList()

  async function handleExcelExport() {
    const rows = getSpreadsheetRows()
    const meta = getSpreadsheetMeta()
    await exportSpreadsheetExcel(rows, meta)
  }

  async function handleReferenceExcelExport() {
    const rows = getSpreadsheetRows()
    const meta = getSpreadsheetMeta()
    await exportReferenceMatchingExcel(rows, meta)
  }

  return (
    <div className="deliverables-tab">
      <p className="deliverables-intro">
        Every output the assignment requires, generated from what's already saved in this app — no
        values re-entered here. A button that's "blocked" names exactly what's missing upstream.
      </p>

      <div className="section-tabs">
        {SUB_TABS.map((tab) => (
          <button
            key={tab}
            className={tab === subTab ? 'active' : ''}
            onClick={() => setSubTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="split-pane deliverables-split">
      <div className="split-pane-left split-pane-scroll">

      {subTab === 'Report' && <A4ReportSection />}

      {subTab === 'Material Audit' && <HinalMaterialAuditReport />}

      {subTab === 'Assumptions' && <AssumptionsSection />}

      {subTab === 'Excel & EPD' && (
        <>
          <div className="deliverable-block">
            <div className="deliverable-row">
              <span className="deliverable-name">LCA Calculation Excel</span>
              <StatusBadge status={hasAnyData ? 'ready' : 'blocked'} />
              {!hasAnyData && <span className="deliverable-reason">no assemblies have saved layers yet</span>}
              <button type="button" onClick={handleExcelExport} disabled={!hasAnyData}>
                Export Excel
              </button>
              <button type="button" onClick={handleReferenceExcelExport} disabled={!hasAnyData} style={{ backgroundColor: '#2d6a4f' }}>
                Export Excel Matching Reference
              </button>
            </div>
            <p className="deliverable-note">
              "Export Excel Matching Reference" matches Professor Thomaz's reference workbook layout with individual assembly worksheets (Assembly_1 Wall, Assembly_2 Floor, Assembly_3 Roof, Assembly_4 Door, Assembly_5 Window, Assembly_6 Skylight) linked to a master ANALYSIS summary tab via live Excel formulas.
            </p>
          </div>

          <div className="deliverable-block">
            <div className="deliverable-row">
              <span className="deliverable-name">EPD Collection</span>
              <StatusBadge status={epdEntries.length > 0 ? 'ready' : 'blocked'} />
              {epdEntries.length === 0 && <span className="deliverable-reason">no Ökobaudat/AI-verified GWP sources accepted yet</span>}
            </div>
            <EpdReferenceListPanel />
          </div>

          <div className="deliverable-block">
            <div className="deliverable-row">
              <span className="deliverable-name">Global provider map</span>
              <StatusBadge status="ready" />
            </div>
            <p className="deliverable-note">
              Every registered provider actually linked to a used material, plotted at once — the
              concentration argument for the Global EPD section: is the supply chain really close to the
              site, or scattered? (Per-material routed distances still live in Materials and Providers /
              Deliverables → Assumptions — this map is the birds-eye view across all of them together.)
            </p>
            <GlobalProviderMap />
          </div>

          <RevitExportPanel />
        </>
      )}

      {subTab === 'Sections' && (
        <>
          <div className="deliverable-block">
            <div className="deliverable-row">
              <span className="deliverable-name">Section PDFs</span>
            </div>
            <SectionPdfButton assemblyKey="wall" label="Wall" />
            <SectionPdfButton assemblyKey="roof" label="Roof" />
            <SectionPdfButton assemblyKey="floor" label="Floor" />
          </div>

          <div className="deliverable-block">
            <div className="deliverable-row">
              <span className="deliverable-name">3D Model</span>
              <StatusBadge status="ready" />
            </div>
            <p className="deliverable-note">
              Lives outside this app — no export needed. Source: <code>public/models/model_1.glb</code>
              {' '}(viewable in the 3D Model tab), original Rhino/CAD source held separately by the team.
            </p>
          </div>

          <A3PosterSection />
        </>
      )}

      {subTab === 'Fiche sheets' && <FicheDeliverablesSection />}

      </div>
      <div className="split-pane-right split-pane-scroll">
        <MissingDataChecklist />
      </div>
      </div>
    </div>
  )
}
