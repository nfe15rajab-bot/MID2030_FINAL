import React, { useState, useEffect } from 'react'
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
  overwriteLcaReportInDoc,
  insertAppPngsToGoogleDoc
} from '../lib/googleDocsSync.js'
import { captureElementToPngDataUrl } from '../lib/pngExport.js'
import {
  DEFAULT_SLIDES_URL,
  DEFAULT_SLIDES_ID,
  extractPresentationId,
  getGooglePresentationMetadata,
  syncLcaResultsToGoogleSlides
} from '../lib/googleSlidesSync.js'
import './GoogleDocsSyncPanel.css'

export default function GoogleDocsSyncPanel({ summaries = [], references = [], exportRef = null }) {
  const [activeTab, setActiveTab] = useState('docs') // 'docs' | 'slides'
  const [docInput, setDocInput] = useState(DEFAULT_DOC_URL)
  const [slidesInput, setSlidesInput] = useState(DEFAULT_SLIDES_URL)
  const [selectedModule, setSelectedModule] = useState('ALL_THESIS')
  const [pngSource, setPngSource] = useState('A4_REPORT')
  const [customImageFile, setCustomImageFile] = useState(null)
  const [customCaption, setCustomCaption] = useState('')
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState(null) // { type: 'success' | 'error' | 'info', text: string }
  const [docMetadata, setDocMetadata] = useState(null)
  const [slidesMetadata, setSlidesMetadata] = useState(null)

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
      setStatusMsg({
        type: 'success',
        text: `Selected module appended successfully to Google Doc "${res.docTitle || docName}" at ${new Date().toLocaleTimeString()}!`
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

  async function collectAllVisualItems(updateStatus = () => {}) {
    const itemsToInsert = []

    // 1. Thermal Performance Bar Charts
    const chartEl = document.querySelector('.a4-report-charts')
    if (chartEl) {
      updateStatus('Capturing Thermal Performance & GWP Assembly Bar Charts...')
      try {
        const chartDataUrl = await captureElementToPngDataUrl(chartEl, { scale: 2 })
        itemsToInsert.push({
          dataUrl: chartDataUrl,
          anchorKey: '01_THERMAL_BAR_CHARTS',
          name: '01_Thermal_Performance_Bar_Charts.png',
          caption: 'Thermal Transmittance (U-Value) & Embodied Carbon GWP (A1-A3) Assembly Comparison Bar Charts',
          widthPt: 425,
          heightPt: 230
        })
      } catch (err) {
        console.warn('Failed capturing bar charts:', err)
      }
    }

    // 2. Delphin 1D Hygrothermal Box & U-value Table
    const delphinEl = document.querySelector('.a4-report-preview-box')
    if (delphinEl) {
      updateStatus('Capturing Delphin 1D Hygrothermal Analysis & U-value Table...')
      try {
        const delphinDataUrl = await captureElementToPngDataUrl(delphinEl, { scale: 2 })
        itemsToInsert.push({
          dataUrl: delphinDataUrl,
          anchorKey: '02_DELPHIN_1D',
          name: '02_Delphin_1D_Hygrothermal_Analysis.png',
          caption: 'DIN EN ISO 6946 Thermal Performance Table & Delphin 1D Transient Moisture Modeling (WUFI / Delphin 5/6)',
          widthPt: 425,
          heightPt: 260
        })
      } catch (err) {
        console.warn('Failed capturing Delphin 1D box:', err)
      }
    }

    // 3. Whole-Building Lifecycle Stage & Supplier Radius Breakdown Chart
    const singleChartEl = document.querySelector('.a4-report-chart-single')
    if (singleChartEl) {
      updateStatus('Capturing Lifecycle Stage & Supplier Radius Distribution Charts...')
      try {
        const singleChartDataUrl = await captureElementToPngDataUrl(singleChartEl, { scale: 2 })
        itemsToInsert.push({
          dataUrl: singleChartDataUrl,
          anchorKey: '03_LIFECYCLE_STAGE_CHARTS',
          name: '03_Lifecycle_Stage_And_Supplier_Radius_Charts.png',
          caption: 'Whole-Building Lifecycle Carbon Stage Distribution (Modules A1-D) & EPD Supplier Geography Radius',
          widthPt: 425,
          heightPt: 230
        })
      } catch (err) {
        console.warn('Failed capturing lifecycle chart:', err)
      }
    }

    // 4. Assembly Section Diagrams (Wall, Floor, Roof, Window, Door, Skylight typical section diagrams)
    const sectionSheets = document.querySelectorAll('.section-sheet')
    if (sectionSheets && sectionSheets.length > 0) {
      let sIdx = 1
      const ASSEMBLY_KEYS = ['WALL', 'FLOOR', 'ROOF', 'SKYLIGHT', 'WINDOW', 'DOOR']
      for (const sheet of sectionSheets) {
        try {
          const titleEl = sheet.querySelector('.section-sheet-heading, h2, h3, header')
          const sheetTitle = titleEl ? titleEl.innerText.trim() : `Assembly Section #${sIdx}`
          const cleanName = sheetTitle.replace(/[^a-zA-Z0-9_-]+/g, '_')
          const matchedKey = ASSEMBLY_KEYS.find(k => sheetTitle.toUpperCase().includes(k)) || ASSEMBLY_KEYS[sIdx - 1] || 'WALL'
          updateStatus(`Capturing Assembly Section Diagram ${sIdx}/${sectionSheets.length}: ${sheetTitle}...`)
          const dataUrl = await captureElementToPngDataUrl(sheet, { scale: 2 })
          itemsToInsert.push({
            dataUrl,
            anchorKey: `SECTION_${matchedKey}`,
            name: `04_Assembly_Section_${sIdx}_${cleanName}.png`,
            caption: `Assembly Specification Diagram: ${sheetTitle}`,
            widthPt: 425,
            heightPt: 280
          })
          sIdx++
        } catch (sErr) {
          console.warn('Failed capturing section sheet:', sErr)
        }
      }
    }

    // 5. Individual Material Fiches Techniques (Each cataloged material in Model 1 as a standalone PNG)
    const rawFicheNodes = document.querySelectorAll('.a4-fiche-visual-card, .fiche-sheet')
    if (rawFicheNodes && rawFicheNodes.length > 0) {
      let fIdx = 1
      for (const rawNode of rawFicheNodes) {
        try {
          // If outer card, target inner .fiche-sheet for clean capture without UI headers/buttons
          const targetNode = rawNode.querySelector('.fiche-sheet') || rawNode
          const cardTitleEl = targetNode.querySelector('h3, .fiche-product-name, header') || rawNode.querySelector('h3, .fiche-product-name')
          const cardTitle = cardTitleEl ? cardTitleEl.innerText.trim() : `Fiche #${fIdx}`
          const cleanName = cardTitle.replace(/[^a-zA-Z0-9_-]+/g, '_')
          updateStatus(`Capturing Fiche Technique ${fIdx}/${rawFicheNodes.length}: ${cardTitle}...`)
          const dataUrl = await captureElementToPngDataUrl(targetNode, { scale: 2 })
          itemsToInsert.push({
            dataUrl,
            anchorKey: `FICHE_#${fIdx}`,
            name: `Fiche_${fIdx}_${cleanName}.png`,
            caption: `Annex A — Technical Fiche Sheet #${fIdx}: ${cardTitle}`,
            widthPt: 425,
            heightPt: 310
          })
          fIdx++
        } catch (fErr) {
          console.warn(`Failed capturing fiche card ${fIdx}:`, fErr)
        }
      }
    } else {
      // Fallback: If individual cards are not mounted, capture the main annex sheet container
      const fichesEl = document.querySelector('.a4-report-annex')
      if (fichesEl) {
        updateStatus('Capturing Annex A Material Fiche Technical Sheets...')
        try {
          const fichesDataUrl = await captureElementToPngDataUrl(fichesEl, { scale: 2 })
          itemsToInsert.push({
            dataUrl: fichesDataUrl,
            name: 'Annex_A_Material_Fiches_Catalog.png',
            caption: 'Annex A: Material Fiches Technical Sheets & Specification Catalog',
            widthPt: 480,
            heightPt: 450
          })
        } catch (err) {
          console.warn('Failed capturing fiches container:', err)
        }
      }
    }

    if (itemsToInsert.length === 0) {
      // Absolute fallback: full monograph report snapshot
      const targetEl = document.querySelector('.a4-report-sheet') || document.querySelector('.deliverable-preview')
      if (targetEl) {
        updateStatus('Capturing Full A4 Report Monograph Snapshot...')
        const reportDataUrl = await captureElementToPngDataUrl(targetEl, { scale: 2, width: '800px' })
        itemsToInsert.push({
          dataUrl: reportDataUrl,
          name: 'A4_Report_Monograph.png',
          caption: 'Full Monograph LCA Report with Graphs & Tables',
          widthPt: 480,
          heightPt: 600
        })
      }
    }

    return itemsToInsert
  }

  async function autoCaptureAndEmbedVisuals(docId, accessToken) {
    const itemsToInsert = await collectAllVisualItems((msg) => setStatusMsg({ type: 'info', text: msg }))

    if (itemsToInsert.length > 0) {
      setStatusMsg({ type: 'info', text: `Uploading ${itemsToInsert.length} high-resolution graphics to Google Drive and embedding into Google Doc...` })
      await insertAppPngsToGoogleDoc(docId, itemsToInsert, accessToken)
    }
  }

  async function handleSyncFullThesis() {
    const docName = docMetadata?.title || cleanDocId

    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Syncing full thesis text + auto-importing all visual graphs, charts & tables behind the scenes into Google Docs...' })
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const res = await overwriteLcaReportInDoc(cleanDocId, summaries, references, accessToken)

      setStatusMsg({ type: 'info', text: 'Text synced! Auto-capturing and uploading high-res PNG graphs, tables, and fiches to Google Drive...' })
      await autoCaptureAndEmbedVisuals(cleanDocId, accessToken)

      setStatusMsg({
        type: 'success',
        text: `🎉 Full Thesis LCA Report + ALL visual graphs, bar charts, tables & material fiches successfully imported behind the scenes into Google Doc "${res.docTitle || docName}" at ${new Date().toLocaleTimeString()}!`
      })
    } catch (err) {
      console.error('Sync Thesis Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Failed to sync full thesis & graphs: ${err.message}`
      })
    } finally {
      setLoading(false)
    }
  }

  async function handlePullCleanVersion() {
    const docName = docMetadata?.title || cleanDocId

    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Resetting document state and re-importing latest text + visual graphs & charts behind the scenes into Google Doc...' })
    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }
      const res = await overwriteLcaReportInDoc(cleanDocId, summaries, references, accessToken)

      setStatusMsg({ type: 'info', text: 'Document reset! Auto-capturing and uploading high-res PNG graphs, tables, and fiches...' })
      await autoCaptureAndEmbedVisuals(cleanDocId, accessToken)

      setStatusMsg({
        type: 'success',
        text: `🎉 Successfully reset document! Imported clean text + ALL visual graphs, bar charts, tables & fiches into Google Doc "${res.docTitle || docName}" at ${new Date().toLocaleTimeString()}.`
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

  async function handleInsertPngToDoc() {
    const docName = docMetadata?.title || cleanDocId
    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Capturing PNG image and uploading to Google Drive...' })

    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }

      let pngDataUrl = null
      let imageName = 'lca-app-export.png'
      let defaultCaption = ''
      let widthPt = 450
      let heightPt = 320

      if (pngSource === 'BAR_CHARTS') {
        const targetEl = document.querySelector('.a4-report-charts') || document.querySelector('.a4-report-chart-single') || document.querySelector('.a4-report-sheet')
        if (!targetEl) throw new Error('Bar Charts element is not currently mounted for capture.')
        pngDataUrl = await captureElementToPngDataUrl(targetEl, { scale: 2 })
        imageName = 'Thermal_Performance_And_GWP_Bar_Charts.png'
        defaultCaption = 'Thermal Performance (U-value) & GWP A1-A3 Assembly Comparison Bar Charts'
        widthPt = 480
        heightPt = 260
      } else if (pngSource === 'U_VALUE_TABLE') {
        const targetEl = document.querySelector('.a4-report-preview-box') || document.querySelector('.a4-report-table-wrapper') || document.querySelector('.a4-report-sheet')
        if (!targetEl) throw new Error('Thermal Performance U-value Table element is not currently mounted.')
        pngDataUrl = await captureElementToPngDataUrl(targetEl, { scale: 2 })
        imageName = 'Thermal_Performance_UValue_Table_And_Delphin_Analysis.png'
        defaultCaption = 'Thermal Performance (U-value) DIN EN ISO 6946 Table & Delphin 1D Hygrothermal Analysis'
        widthPt = 480
        heightPt = 300
      } else if (pngSource === 'FICHES_SHEET') {
        const targetEl = document.querySelector('.a4-report-annex') || document.querySelector('.fiche-sheet') || document.querySelector('.a4-report-sheet')
        if (!targetEl) throw new Error('Material Fiches element is not currently mounted for capture.')
        pngDataUrl = await captureElementToPngDataUrl(targetEl, { scale: 2 })
        imageName = 'Annex_A_Material_Fiche_Specifications.png'
        defaultCaption = 'Annex A: Material Fiche Technical Data Sheets & EPD Specifications'
        widthPt = 480
        heightPt = 400
      } else if (pngSource === 'A4_REPORT') {
        const targetEl = exportRef?.current || document.querySelector('.a4-report-sheet') || document.querySelector('.deliverable-preview')
        if (!targetEl) throw new Error('A4 Report Draft element is not currently mounted for capture.')
        pngDataUrl = await captureElementToPngDataUrl(targetEl, { scale: 2, width: '800px' })
        imageName = 'A4_Report_Draft_Snapshot.png'
        defaultCaption = 'A4 Full Monograph Report Snapshot with Graphs & Tables'
        widthPt = 480
        heightPt = 600
      } else if (pngSource === 'SECTION_DIAGRAM') {
        const targetEl = document.querySelector('.section-sheet') || document.querySelector('.deliverable-preview')
        if (!targetEl) throw new Error('Section Diagram element is not currently mounted for capture.')
        pngDataUrl = await captureElementToPngDataUrl(targetEl, { scale: 2 })
        imageName = 'Assembly_Section_Diagram.png'
        defaultCaption = 'LCA Assembly Section Specification Diagram'
        widthPt = 480
        heightPt = 320
      } else if (pngSource === 'CUSTOM_FILE') {
        if (!customImageFile) throw new Error('Please select a PNG image file from your computer.')
        pngDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(new Error('Failed reading selected image file.'))
          reader.readAsDataURL(customImageFile)
        })
        imageName = customImageFile.name
        defaultCaption = customImageFile.name
      }

      if (!pngDataUrl) throw new Error('Could not generate or read PNG image data.')

      const item = {
        dataUrl: pngDataUrl,
        name: imageName,
        caption: customCaption || defaultCaption,
        widthPt,
        heightPt
      }

      const res = await insertAppPngsToGoogleDoc(cleanDocId, [item], accessToken)
      setStatusMsg({
        type: 'success',
        text: `🖼️ PNG Image inserted into Google Doc "${res.docTitle || docName}"! Uploaded to Google Drive and inserted inline into your document.`
      })
    } catch (err) {
      console.error('Insert PNG Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Failed to insert PNG image: ${err.message}`
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleAutoSyncAllVisuals() {
    const docName = docMetadata?.title || cleanDocId
    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Auto-capturing all individual graphs, tables, assembly sections, and fiches techniques as high-resolution PNGs...' })

    try {
      const accessToken = await ensureToken()
      if (!accessToken) {
        setStatusMsg({ type: 'error', text: 'Sign in to Google was cancelled or not completed.' })
        return
      }

      const itemsToInsert = await collectAllVisualItems((msg) => setStatusMsg({ type: 'info', text: msg }))

      if (itemsToInsert.length === 0) {
        throw new Error('No visual report elements or fiches were found to capture. Please ensure the Deliverables tab is open.')
      }

      setStatusMsg({ type: 'info', text: `Uploading ${itemsToInsert.length} high-resolution graphics & fiches techniques to Google Drive and embedding into Google Doc...` })
      const res = await insertAppPngsToGoogleDoc(cleanDocId, itemsToInsert, accessToken)

      setStatusMsg({
        type: 'success',
        text: `🎉 Successfully inserted ${res.count} visual graphics, charts, assembly section diagrams, and individual fiches techniques into Google Doc "${res.docTitle || docName}"!`
      })
    } catch (err) {
      console.error('Auto Sync Visuals Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Failed to insert visual graphics & fiches: ${err.message}`
      })
    } finally {
      setLoading(false)
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
      </div>

      <div className="gdoc-sync-header">
        <div className="gdoc-sync-title-group">
          <div>
            <h3 className="gdoc-sync-title">
              {activeTab === 'docs' ? 'Google Docs Report & Modular Sync' : 'Google Slides Assembly Sync'}
            </h3>
            <p className="gdoc-sync-subtitle">
              {activeTab === 'docs'
                ? 'Modularly sync specific paragraphs, graphic section diagrams, or full thesis reports with auto-generated Google Docs headings and document outline'
                : 'Auto-assign assembly LCA metrics (U-value, GWP, freight, layers) directly to matching presentation slides'}
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

          {/* PNG Image Export & Insertion Block */}
          <div style={{ marginTop: '14px', background: '#f0f9ff', padding: '12px 14px', borderRadius: '8px', border: '1px solid #bae6fd' }}>
            <label className="gdoc-input-label" style={{ color: '#0369a1', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              🖼️ Insert App PNGs / Diagrams into Google Doc:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '8px' }}>
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#334155', display: 'block' }}>Select PNG Source:</span>
                <select
                  className="gdoc-input"
                  value={pngSource}
                  onChange={(e) => setPngSource(e.target.value)}
                  style={{ marginTop: '4px', background: '#ffffff', cursor: 'pointer', fontWeight: 600 }}
                >
                  <option value="BAR_CHARTS">📊 Thermal Performance & GWP Comparison Bar Charts</option>
                  <option value="U_VALUE_TABLE">📐 Thermal Performance (U-value) Table & Delphin 1D Analysis</option>
                  <option value="FICHES_SHEET">📑 Annex A Material Fiche Technical Data Sheets</option>
                  <option value="A4_REPORT">📸 Full Monograph A4 Report Snapshot (with Graphs & Tables)</option>
                  <option value="SECTION_DIAGRAM">🧱 Assembly Section Specification Diagram</option>
                  <option value="CUSTOM_FILE">📁 Custom PNG Image File from Computer</option>
                </select>
              </div>
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#334155', display: 'block' }}>Figure Caption (Optional):</span>
                <input
                  type="text"
                  className="gdoc-input"
                  placeholder="e.g. Figure 1: Exterior Wall Layer Section"
                  value={customCaption}
                  onChange={(e) => setCustomCaption(e.target.value)}
                  style={{ marginTop: '4px', background: '#ffffff' }}
                />
              </div>
            </div>

            {pngSource === 'CUSTOM_FILE' && (
              <div style={{ marginTop: '10px', background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px dashed #0284c7' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0284c7', display: 'block', marginBottom: '4px' }}>Choose PNG File:</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setCustomImageFile(e.target.files[0] || null)}
                  style={{ fontSize: '0.82rem', color: '#334155' }}
                />
              </div>
            )}

            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                className="gdoc-btn gdoc-btn--primary"
                onClick={handleInsertPngToDoc}
                disabled={loading}
                style={{ background: '#0284c7', borderColor: '#0284c7', width: '100%', justifyContent: 'center', padding: '10px 14px' }}
              >
                🖼️ Upload & Insert Selected Graphic / Graph into Google Doc
              </button>

              <button
                type="button"
                className="gdoc-btn gdoc-btn--primary"
                onClick={handleAutoSyncAllVisuals}
                disabled={loading}
                style={{ background: '#15803d', borderColor: '#15803d', width: '100%', justifyContent: 'center', padding: '12px 14px', fontWeight: 700 }}
              >
                📊 Auto-Capture & Insert ALL Visual Graphs, Tables & Fiche Cards into Google Doc
              </button>
            </div>
          </div>
        </div>
      ) : (
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
        ) : (
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
        )}
      </div>

      {/* Feedback Status */}
      {statusMsg && (
        <div className={`gdoc-status-msg gdoc-status-msg--${statusMsg.type}`}>
          {statusMsg.text}
        </div>
      )}
    </div>
  )
}

