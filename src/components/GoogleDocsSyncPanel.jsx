import React, { useState, useEffect, useRef } from 'react'
import {
  initGoogleAuth,
  googleSignIn,
  googleSignOut,
  getCachedAccessToken,
  getCurrentGoogleUser
} from '../lib/googleAuth.js'
import {
  DEFAULT_DOC_URL,
  DEFAULT_DOC_ID,
  extractDocId,
  getGoogleDocMetadata,
  appendLcaReportToDoc,
  appendLcaModuleToDoc,
  overwriteLcaReportInDoc
} from '../lib/googleDocsSync.js'
import {
  DEFAULT_SLIDES_URL,
  DEFAULT_SLIDES_ID,
  extractPresentationId,
  getGooglePresentationMetadata,
  syncLcaResultsToGoogleSlides
} from '../lib/googleSlidesSync.js'
import {
  extractSheetId,
  getGoogleSheetMetadata,
  createNewSpreadsheet,
  pushGroup2DataToGoogleSheet
} from '../lib/googleSheetsSync.js'
import { getSpreadsheetRows, getSpreadsheetMeta } from '../lib/spreadsheetData.js'
import { appendChartImageToDoc } from '../lib/driveImageUpload.js'
import { captureElementToPngDataUrl } from '../lib/pngExport.js'
import BarChart from './BarChart.jsx'
import LayerSharePieChart from './LayerSharePieChart.jsx'
import './GoogleDocsSyncPanel.css'

// Modules that have a real chart/diagram to go with their text -- keyed
// so handleAppendSelectedModule knows which off-screen chart ref(s) to
// capture after the text append succeeds. Every other module stays
// text-only, same as before this feature existed.
const MODULES_WITH_GRAPHICS = new Set([
  'GLOBAL_GRAPHICS',
  'ASSEMBLY_WALL', 'ASSEMBLY_FLOOR', 'ASSEMBLY_ROOF',
  'ASSEMBLY_WINDOW', 'ASSEMBLY_DOOR', 'ASSEMBLY_SKYLIGHT',
])

export default function GoogleDocsSyncPanel({ summaries = [], references = [] }) {
  const [activeTab, setActiveTab] = useState('docs') // 'docs' | 'slides' | 'sheets'
  const [docInput, setDocInput] = useState(DEFAULT_DOC_URL)
  const [slidesInput, setSlidesInput] = useState(DEFAULT_SLIDES_URL)
  const [sheetInput, setSheetInput] = useState('') // no team default yet — paste one or "Create New"
  const [selectedModule, setSelectedModule] = useState('ALL_THESIS')
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState(null) // { type: 'success' | 'error' | 'info', text: string }
  const [docMetadata, setDocMetadata] = useState(null)
  const [slidesMetadata, setSlidesMetadata] = useState(null)
  const [sheetMetadata, setSheetMetadata] = useState(null)
  const [imageUploadStatus, setImageUploadStatus] = useState(null) // string | null, shown while uploading chart(s)

  // Off-screen copies of the same chart components used elsewhere in the
  // app (BarChart.jsx / LayerSharePieChart.jsx) -- rendered purely so
  // there's a live DOM node to hand to html2canvas (via
  // captureElementToPngDataUrl) right before an image-bearing module is
  // synced. Same "position:fixed, opacity:0.001" off-screen convention as
  // DeliverablesTab.jsx's A4ReportSection/A3PosterSection export copies.
  const uValueChartRef = useRef(null)
  const gwpChartRef = useRef(null)
  const assemblyPieRef = useRef(null)

  const withData = summaries.filter((s) => s.hasData)
  const uValueBars = withData.map((s) => ({ label: s.label, value: s.uValue, formattedValue: s.uValue != null ? s.uValue.toFixed(3) : null }))
  const gwpBars = withData.map((s) => ({ label: s.label, value: s.a1a3KnownCount > 0 ? s.a1a3Total : null, formattedValue: s.a1a3Total != null ? s.a1a3Total.toFixed(1) : null }))

  const selectedAssemblyKey = selectedModule.startsWith('ASSEMBLY_') ? selectedModule.replace('ASSEMBLY_', '').toLowerCase() : null
  const selectedAssemblySummary = selectedAssemblyKey ? summaries.find((s) => s.key === selectedAssemblyKey) : null
  const assemblyPieSlices = (selectedAssemblySummary?.layerResults || []).map((l, i) => ({
    label: l.name || 'Unnamed layer',
    value: l.a1a3,
    formattedValue: l.a1a3 != null ? l.a1a3.toFixed(2) : null,
    key: l.instanceId ?? i,
  }))

  // Captures whichever chart(s) belong to the module just synced and
  // appends them to the doc, one at a time -- upload failures here are
  // reported but never roll back the text that already synced
  // successfully, since the text is the more important half.
  async function appendModuleGraphics(docId, moduleKey, accessToken) {
    if (!MODULES_WITH_GRAPHICS.has(moduleKey)) return { attempted: 0, failed: 0 }
    const targets = moduleKey === 'GLOBAL_GRAPHICS'
      ? [
          { ref: uValueChartRef, filename: 'uvalue-by-assembly.png', aspectRatio: 0.5 },
          { ref: gwpChartRef, filename: 'gwp-by-assembly.png', aspectRatio: 0.5 },
        ]
      : [{ ref: assemblyPieRef, filename: `${moduleKey.toLowerCase()}-layer-share.png`, aspectRatio: 0.7 }]

    let failed = 0
    for (const { ref, filename, aspectRatio } of targets) {
      if (!ref.current) continue
      try {
        setImageUploadStatus(`Uploading ${filename} to Drive and inserting into the doc...`)
        const dataUrl = await captureElementToPngDataUrl(ref.current, { scale: 2 })
        await appendChartImageToDoc(docId, dataUrl, filename, accessToken, { widthPt: 380, aspectRatio })
      } catch (err) {
        console.error(`Chart image upload failed (${filename}):`, err)
        failed += 1
      }
    }
    setImageUploadStatus(null)
    return { attempted: targets.length, failed }
  }

  useEffect(() => {
    const unsubscribe = initGoogleAuth(
      (u, t) => {
        setUser(u)
        setToken(t)
      },
      () => {
        setUser(null)
        setToken(null)
      }
    )
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  const cleanDocId = extractDocId(docInput)
  const docWebUrl = `https://docs.google.com/document/d/${cleanDocId}/edit`

  const cleanSlidesId = extractPresentationId(slidesInput)
  const slidesWebUrl = `https://docs.google.com/presentation/d/${cleanSlidesId}/edit`

  const cleanSheetId = extractSheetId(sheetInput)
  const sheetWebUrl = cleanSheetId ? `https://docs.google.com/spreadsheets/d/${cleanSheetId}/edit` : null

  async function handleLogin() {
    setLoading(true)
    setStatusMsg(null)
    try {
      const result = await googleSignIn()
      if (result) {
        setUser(result.user)
        setToken(result.accessToken)
        setStatusMsg({
          type: 'success',
          text: `Connected to Google as ${result.user.email || result.user.displayName || 'authenticated user'}.`
        })
      }
    } catch (err) {
      console.error('Google Auth Failed:', err)
      setStatusMsg({
        type: 'error',
        text: `Authentication failed: ${err.message || 'Could not complete Google sign-in.'}`
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    try {
      await googleSignOut()
      setUser(null)
      setToken(null)
      setDocMetadata(null)
      setSlidesMetadata(null)
      setStatusMsg({ type: 'info', text: 'Signed out of Google Workspace.' })
    } catch (err) {
      console.error('Logout error:', err)
    }
  }

  // Helper to ensure an access token exists (auto-prompting sign-in if needed)
  async function ensureToken() {
    let accessToken = token || getCachedAccessToken()
    if (!accessToken) {
      setStatusMsg({ type: 'info', text: 'Initiating Google sign-in...' })
      try {
        const res = await googleSignIn()
        if (res && res.accessToken) {
          setUser(res.user)
          setToken(res.accessToken)
          accessToken = res.accessToken
        }
      } catch (err) {
        console.warn('Auto sign-in bypassed or cancelled:', err)
      }
    }
    return accessToken
  }

  // --- Google Docs Actions ---
  async function handleVerifyDoc() {
    setLoading(true)
    setStatusMsg(null)
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const meta = await getGoogleDocMetadata(cleanDocId, accessToken)
      setDocMetadata(meta)
      setStatusMsg({
        type: 'success',
        text: `Document verified! Title: "${meta.title || 'Untitled Google Doc'}" (ID: ${cleanDocId})`
      })
    } catch (err) {
      console.error('Doc Verification Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Could not access document: ${err.message}. Make sure your account has edit permissions.`
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleAppendSelectedModule() {
    const docName = docMetadata?.title || cleanDocId

    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Processing selected module for Google Doc...' })
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const res = await appendLcaModuleToDoc(cleanDocId, summaries, references, selectedModule, accessToken)

      const graphics = await appendModuleGraphics(cleanDocId, selectedModule, accessToken)
      const graphicsNote = graphics.attempted === 0
        ? ''
        : graphics.failed === 0
          ? ` (+${graphics.attempted} chart image${graphics.attempted === 1 ? '' : 's'})`
          : ` (${graphics.attempted - graphics.failed}/${graphics.attempted} chart images — ${graphics.failed} failed to upload, text synced fine)`

      setStatusMsg({
        type: graphics.failed > 0 ? 'info' : 'success',
        text: `Selected module appended successfully to Google Doc "${res.docTitle || docName}"${graphicsNote} at ${new Date().toLocaleTimeString()}!`
      })
    } catch (err) {
      console.error('Append Module Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Failed to append module: ${err.message}`
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleSyncFullThesis() {
    const docName = docMetadata?.title || cleanDocId

    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Syncing full thesis with Google Docs named heading styles & dynamic outline...' })
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const res = await overwriteLcaReportInDoc(cleanDocId, summaries, references, accessToken)
      setStatusMsg({
        type: 'success',
        text: `Full Thesis LCA Report synced with automatic heading structure into Google Doc "${res.docTitle || docName}" at ${new Date().toLocaleTimeString()}!`
      })
    } catch (err) {
      console.error('Sync Thesis Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Failed to sync full thesis: ${err.message}`
      })
    } finally {
      setLoading(false)
    }
  }

  async function handlePullCleanVersion() {
    const docName = docMetadata?.title || cleanDocId

    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Deleting wrong version and pulling latest clean LCA report into Google Doc...' })
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const res = await overwriteLcaReportInDoc(cleanDocId, summaries, references, accessToken)
      setStatusMsg({
        type: 'success',
        text: `Successfully deleted wrong version! Pulled and restored latest clean LCA Report state into Google Doc "${res.docTitle || docName}" at ${new Date().toLocaleTimeString()}.`
      })
    } catch (err) {
      console.error('Pull Clean Version Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Failed to pull/reset document: ${err.message}`
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleCopyModuleToClipboard() {
    try {
      const { generateLcaModuleText } = await import('../lib/googleDocsSync.js')
      const text = generateLcaModuleText(selectedModule, summaries, references)
      await navigator.clipboard.writeText(text)
      setStatusMsg({
        type: 'success',
        text: `📋 Copied selected module text to clipboard! You can paste it directly into Google Docs or Word.`
      })
    } catch (e) {
      setStatusMsg({ type: 'error', text: `Clipboard copy failed: ${e.message}` })
    }
  }

  async function handlePullCleanSlides() {
    const presName = slidesMetadata?.title || cleanSlidesId

    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Deleting wrong presentation state and pulling latest clean LCA assembly metrics into Google Slides...' })
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const res = await syncLcaResultsToGoogleSlides(cleanSlidesId, summaries, accessToken)
      const count = res.updatedSlides?.length || 0
      setStatusMsg({
        type: 'success',
        text: `Successfully deleted wrong version! Pulled and restored clean LCA assembly metrics across ${count} slides in "${res.presentationTitle || presName}" at ${new Date().toLocaleTimeString()}.`
      })
    } catch (err) {
      console.error('Pull Clean Slides Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Failed to pull/reset presentation: ${err.message}`
      })
    } finally {
      setLoading(false)
    }
  }

  // --- Google Slides Actions ---
  async function handleVerifySlides() {
    setLoading(true)
    setStatusMsg(null)
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const meta = await getGooglePresentationMetadata(cleanSlidesId, accessToken)
      setSlidesMetadata(meta)
      const slidesCount = meta.slides ? meta.slides.length : 0
      setStatusMsg({
        type: 'success',
        text: `Presentation verified! Title: "${meta.title || 'Untitled Presentation'}" (${slidesCount} slides)`
      })
    } catch (err) {
      console.error('Slides Verification Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Could not access presentation: ${err.message}. Check edit permissions.`
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleSyncSlides() {
    const presName = slidesMetadata?.title || cleanSlidesId

    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Syncing LCA results to Google Slides...' })
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const res = await syncLcaResultsToGoogleSlides(cleanSlidesId, summaries, accessToken)
      const count = res.updatedSlides?.length || 0
      setStatusMsg({
        type: 'success',
        text: `Successfully synced LCA results across ${count} assembly slides in "${res.presentationTitle || presName}" at ${new Date().toLocaleTimeString()}!`
      })
    } catch (err) {
      console.error('Sync Slides Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Failed to sync slides: ${err.message}`
      })
    } finally {
      setLoading(false)
    }
  }

  // --- Google Sheets Actions ---
  async function handleVerifySheet() {
    if (!cleanSheetId) {
      setStatusMsg({ type: 'error', text: 'Paste a Google Sheet link/ID first, or use "Create New Spreadsheet".' })
      return
    }
    setLoading(true)
    setStatusMsg(null)
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const meta = await getGoogleSheetMetadata(cleanSheetId, accessToken)
      setSheetMetadata(meta)
      setStatusMsg({
        type: 'success',
        text: `Spreadsheet verified! Title: "${meta.properties?.title || 'Untitled Spreadsheet'}"`
      })
    } catch (err) {
      console.error('Sheet Verification Error:', err)
      setStatusMsg({ type: 'error', text: `Could not access spreadsheet: ${err.message}. Make sure your account has edit permissions.` })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateNewSheet() {
    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Creating a new Google Sheet...' })
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const res = await createNewSpreadsheet('MID 2030 — Model 1 LCA Data (group2)', accessToken)
      setSheetInput(res.url)
      setStatusMsg({ type: 'success', text: `Created a new spreadsheet — you can push data to it now.` })
    } catch (err) {
      console.error('Create Sheet Error:', err)
      setStatusMsg({ type: 'error', text: `Failed to create spreadsheet: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }

  async function handlePushToSheet() {
    if (!cleanSheetId) {
      setStatusMsg({ type: 'error', text: 'Paste a Google Sheet link/ID first, or use "Create New Spreadsheet".' })
      return
    }
    const sheetName = sheetMetadata?.properties?.title || cleanSheetId
    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Pushing LCA data (group2 layout) to Google Sheets...' })
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const rows = getSpreadsheetRows()
      const meta = getSpreadsheetMeta()
      if (rows.length === 0) {
        setStatusMsg({ type: 'error', text: 'No saved layers yet — nothing to push.' })
        return
      }
      const res = await pushGroup2DataToGoogleSheet(cleanSheetId, rows, meta, accessToken)
      setStatusMsg({
        type: 'success',
        text: `Pushed ${rows.length} rows to the "group2" tab of "${res.spreadsheetTitle || sheetName}" at ${new Date().toLocaleTimeString()}!`
      })
    } catch (err) {
      console.error('Push to Sheet Error:', err)
      setStatusMsg({ type: 'error', text: `Failed to push data: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="gdoc-sync-panel">
      {/* Tab Navigation */}
      <div className="gdoc-tab-bar">
        <button
          className={`gdoc-tab-btn ${activeTab === 'docs' ? 'active' : ''}`}
          onClick={() => setActiveTab('docs')}
        >
          <svg className="gdoc-mini-icon" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C4.89 2 4 2.89 4 4V20C4 21.1 4.89 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#2684FC" />
            <path d="M14 2V8H20L14 2Z" fill="#0066DA" />
          </svg>
          Google Docs Report Sync
        </button>
        <button
          className={`gdoc-tab-btn ${activeTab === 'slides' ? 'active' : ''}`}
          onClick={() => setActiveTab('slides')}
        >
          <svg className="gdoc-mini-icon" viewBox="0 0 24 24" fill="none">
            <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3Z" fill="#FFBA00" />
            <path d="M7 7H17V17H7V7Z" fill="#FFFFFF" opacity="0.8" />
          </svg>
          Google Slides Deck Sync
        </button>
        <button
          className={`gdoc-tab-btn ${activeTab === 'sheets' ? 'active' : ''}`}
          onClick={() => setActiveTab('sheets')}
        >
          <svg className="gdoc-mini-icon" viewBox="0 0 24 24" fill="none">
            <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3Z" fill="#0F9D58" />
            <path d="M7 8H17V10H7V8ZM7 12H17V14H7V12ZM7 16H13V18H7V16Z" fill="#FFFFFF" opacity="0.9" />
          </svg>
          Google Sheets Data Push
        </button>
      </div>

      <div className="gdoc-sync-header">
        <div className="gdoc-sync-title-group">
          <div>
            <h3 className="gdoc-sync-title">
              {activeTab === 'docs' ? 'Google Docs Report & Modular Sync' : activeTab === 'slides' ? 'Google Slides Assembly Sync' : 'Google Sheets LCA Data Push'}
            </h3>
            <p className="gdoc-sync-subtitle">
              {activeTab === 'docs'
                ? 'Modularly sync specific paragraphs, graphic section diagrams, or full thesis reports with auto-generated Google Docs headings and document outline'
                : activeTab === 'slides'
                  ? 'Auto-assign assembly LCA metrics (U-value, GWP, freight, layers) directly to matching presentation slides'
                  : 'Pushes the exact group2 template layout (same columns/formulas as the Excel export) into a live Google Sheet — every saved layer, real quantities, consolidated A4, B4, B6'}
            </p>
          </div>
        </div>
      </div>

      {/* Target Document / Presentation Input */}
      {activeTab === 'docs' ? (
        <div className="gdoc-doc-input-group">
          <label className="gdoc-input-label">Target Google Document Link or ID</label>
          <div className="gdoc-input-row">
            <input
              type="text"
              className="gdoc-input"
              value={docInput}
              onChange={(e) => setDocInput(e.target.value)}
              placeholder="Paste Google Doc URL or Document ID"
            />
            <a
              href={docWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="gdoc-open-btn"
              title="Open document in Google Docs"
            >
              Open Doc ↗
            </a>
          </div>

          {/* Modular Section / Graphic Selector */}
          <div style={{ marginTop: '14px', background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <label className="gdoc-input-label" style={{ color: '#1e293b', fontWeight: 700 }}>
              🎯 Select Specific Paragraph, Graphic, or Section to Sync:
            </label>
            <select
              className="gdoc-input"
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              style={{ marginTop: '6px', background: '#ffffff', cursor: 'pointer', fontWeight: 600 }}
            >
              <option value="ALL_THESIS">📜 Full Thesis LCA Report (All Chapters & Annexes)</option>
              <option value="PROPOSAL_COMPARISON">📋 Proposal MID 2030 Requirement Comparison & Matrix</option>
              <option value="ABSTRACT">📌 Chapter 1: Abstract & Executive Summary</option>
              <option value="METHODOLOGY">🔬 Chapter 2: Methodological Framework & DIN EN Standards</option>
              <option value="DELPHIN_MOISTURE">💧 Chapter 2.1: Delphin 1D Hygrothermal & Moisture Analysis</option>
              <option value="LADYBUG_ENERGY">☀️ Chapter 2.2: Ladybug 50-Year Dynamic Energy & Comfort Simulation</option>
              <option value="MATERIALS_DISCIPLINE">🧪 Chapter 3: Material Research & Discipline Analysis</option>
              <option value="ASSEMBLY_WALL">🧱 Assembly: Exterior Wall (Section Diagram & LCA Breakdown)</option>
              <option value="ASSEMBLY_FLOOR">🪵 Assembly: Ground Floor (Section Diagram & LCA Breakdown)</option>
              <option value="ASSEMBLY_ROOF">🏠 Assembly: Roof (Section Diagram & LCA Breakdown)</option>
              <option value="ASSEMBLY_WINDOW">🪟 Assembly: Window (Section Diagram & LCA Breakdown)</option>
              <option value="ASSEMBLY_DOOR">🚪 Assembly: Door (Section Diagram & LCA Breakdown)</option>
              <option value="ASSEMBLY_SKYLIGHT">☀️ Assembly: Skylight (Section Diagram & LCA Breakdown)</option>
              <option value="GLOBAL_GRAPHICS">📊 Chapter 5: Whole-Building Totals & Lifecycle Stage Graphics</option>
              <option value="ANNEX_A_FICHES">📑 Annex A: Material Fiche Technical Sheets</option>
              <option value="ANNEX_B_MATRIX">⚖️ Annex B: Level of Assumption & Confidence Matrix</option>
            </select>
            <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: '#64748b' }}>
              💡 Modular sync appends only your chosen element (e.g. wall graphic diagram) right where you want it without touching or overwriting the rest of your document.
            </p>
          </div>
        </div>
      ) : activeTab === 'slides' ? (
        <div className="gdoc-doc-input-group">
          <label className="gdoc-input-label">Target Google Slides Deck Link or ID</label>
          <div className="gdoc-input-row">
            <input
              type="text"
              className="gdoc-input"
              value={slidesInput}
              onChange={(e) => setSlidesInput(e.target.value)}
              placeholder="Paste Google Slides Presentation URL or ID"
            />
            <a
              href={slidesWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="gdoc-open-btn"
              title="Open presentation in Google Slides"
            >
              Open Deck ↗
            </a>
          </div>
        </div>
      ) : (
        <div className="gdoc-doc-input-group">
          <label className="gdoc-input-label">Target Google Sheet Link or ID</label>
          <div className="gdoc-input-row">
            <input
              type="text"
              className="gdoc-input"
              value={sheetInput}
              onChange={(e) => setSheetInput(e.target.value)}
              placeholder="Paste an existing Google Sheet URL/ID, or click Create New →"
            />
            {sheetWebUrl && (
              <a
                href={sheetWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="gdoc-open-btn"
                title="Open spreadsheet in Google Sheets"
              >
                Open Sheet ↗
              </a>
            )}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: '#64748b' }}>
            💡 No team sheet yet? "Create New Spreadsheet" below makes one and fills this in — no existing link needed.
            Pushing writes the exact same group2 column layout as "Export Excel (class template group2)" into a
            "group2" tab, overwriting only that tab (nothing else in the spreadsheet is touched).
          </p>
        </div>
      )}

      {/* Authentication Banner */}
      <div className="gdoc-auth-section">
        {user ? (
          <>
            <div className="gdoc-user-badge">
              <div className="gdoc-user-avatar">
                {(user.email || user.displayName || 'G')[0].toUpperCase()}
              </div>
              <div className="gdoc-user-info">
                <span className="gdoc-user-name">
                  {user.displayName || 'Authenticated Google User'}
                </span>
                <span className="gdoc-user-email">{user.email || 'Google Account Connected'}</span>
              </div>
            </div>
            <button className="gdoc-btn gdoc-btn--outline" onClick={handleLogout} disabled={loading}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <div>
              <span className="gdoc-user-name">Sign in with Google Workspace</span>
              <span className="gdoc-user-email" style={{ display: 'block' }}>
                Required to access and edit Docs & Slides
              </span>
            </div>
            <button className="gsi-material-button" onClick={handleLogin} disabled={loading}>
              <div className="gsi-material-button-state"></div>
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{ display: 'block' }}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    ></path>
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    ></path>
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    ></path>
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    ></path>
                    <path fill="none" d="M0 0h48v48H0z"></path>
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  {loading ? 'Connecting...' : 'Sign in with Google'}
                </span>
              </div>
            </button>
          </>
        )}
      </div>

      {/* Action Buttons */}
      <div className="gdoc-action-bar">
        {activeTab === 'docs' ? (
          <>
            <button
              className="gdoc-btn gdoc-btn--outline"
              onClick={handleVerifyDoc}
              disabled={loading}
            >
              🔍 Verify Access
            </button>
            <button
              className="gdoc-btn gdoc-btn--primary"
              onClick={handleAppendSelectedModule}
              disabled={loading}
              title="Appends ONLY your selected module/graphic without modifying existing document text"
            >
              ➕ Append Selected Module to Doc
            </button>
            <button
              className="gdoc-btn gdoc-btn--secondary"
              onClick={handleSyncFullThesis}
              disabled={loading}
              title="Overwrites Google Doc cleanly with full thesis report using Google Docs official Heading styles"
            >
              🔄 Sync Full Thesis (With Headings & Outline)
            </button>
            <button
              className="gdoc-btn gdoc-btn--outline"
              onClick={handleCopyModuleToClipboard}
              disabled={loading}
              title="Copy formatted module text directly to clipboard without needing Google sign-in"
            >
              📋 Copy Module Text
            </button>
            <button
              className="gdoc-btn gdoc-btn--outline"
              onClick={handlePullCleanVersion}
              disabled={loading}
              style={{ color: '#dc2626', borderColor: '#fca5a5' }}
              title="Delete wrong version and pull/restore latest clean report state"
            >
              📥 Pull Clean State
            </button>
          </>
        ) : activeTab === 'slides' ? (
          <>
            <button
              className="gdoc-btn gdoc-btn--outline"
              onClick={handleVerifySlides}
              disabled={loading}
            >
              🔍 Verify Slides Access
            </button>
            <button
              className="gdoc-btn gdoc-btn--primary"
              onClick={handleSyncSlides}
              disabled={loading}
            >
              📊 Auto-Assign LCA Results to Assembly Slides
            </button>
            <button
              className="gdoc-btn gdoc-btn--secondary"
              onClick={handlePullCleanSlides}
              disabled={loading}
              title="Delete wrong version and pull/restore latest clean slides state"
            >
              📥 Pull Clean Deck (Delete Wrong Version)
            </button>
          </>
        ) : (
          <>
            <button
              className="gdoc-btn gdoc-btn--outline"
              onClick={handleVerifySheet}
              disabled={loading}
            >
              🔍 Verify Access
            </button>
            <button
              className="gdoc-btn gdoc-btn--secondary"
              onClick={handleCreateNewSheet}
              disabled={loading}
              title="Creates a brand-new Google Sheet with a group2 tab, ready to push into"
            >
              ✨ Create New Spreadsheet
            </button>
            <button
              className="gdoc-btn gdoc-btn--primary"
              onClick={handlePushToSheet}
              disabled={loading}
              title="Writes every saved layer (real quantities, consolidated A4, B4, B6) into the group2 tab"
            >
              📤 Push LCA Data to Sheet
            </button>
          </>
        )}
      </div>

      {/* Feedback Status */}
      {statusMsg && (
        <div className={`gdoc-status-msg gdoc-status-msg--${statusMsg.type}`}>
          {statusMsg.text}
        </div>
      )}
      {imageUploadStatus && (
        <div className="gdoc-status-msg gdoc-status-msg--info">{imageUploadStatus}</div>
      )}

      {/* Off-screen chart copies, captured to PNG and uploaded to Drive
          when an image-bearing module (GLOBAL_GRAPHICS / ASSEMBLY_*) is
          synced — see appendModuleGraphics above. Never shown to the
          user; exists purely so html2canvas has a real, laid-out DOM
          node to capture, same convention as DeliverablesTab.jsx's
          export-only report/poster copies. */}
      <div style={{ position: 'fixed', left: 0, top: 0, width: '600px', zIndex: -9999, opacity: 0.001, pointerEvents: 'none', background: '#ffffff' }}>
        <div ref={uValueChartRef}>
          <BarChart title="U-value by assembly" unit="W/m²K" bars={uValueBars} />
        </div>
        <div ref={gwpChartRef}>
          <BarChart title="GWP A1-A3 by assembly" unit="kg CO₂e" bars={gwpBars} />
        </div>
        {selectedAssemblySummary && (
          <div ref={assemblyPieRef}>
            <LayerSharePieChart
              title={`${selectedAssemblySummary.label} — share of GWP A1-A3 by layer`}
              unit="kg CO₂e"
              slices={assemblyPieSlices}
            />
          </div>
        )}
      </div>
    </div>
  )
}

