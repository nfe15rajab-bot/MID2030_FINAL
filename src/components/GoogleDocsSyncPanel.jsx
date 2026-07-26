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
  overwriteLcaReportInDoc
} from '../lib/googleDocsSync.js'
import {
  DEFAULT_SLIDES_URL,
  DEFAULT_SLIDES_ID,
  extractPresentationId,
  getGooglePresentationMetadata,
  syncLcaResultsToGoogleSlides
} from '../lib/googleSlidesSync.js'
import './GoogleDocsSyncPanel.css'

export default function GoogleDocsSyncPanel({ summaries = [], references = [] }) {
  const [activeTab, setActiveTab] = useState('docs') // 'docs' | 'slides'
  const [docInput, setDocInput] = useState(DEFAULT_DOC_URL)
  const [slidesInput, setSlidesInput] = useState(DEFAULT_SLIDES_URL)
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

  // --- Google Docs Actions ---
  async function handleVerifyDoc() {
    const accessToken = token || getCachedAccessToken()
    if (!accessToken) {
      setStatusMsg({ type: 'error', text: 'Please sign in with Google first to verify document access.' })
      return
    }

    setLoading(true)
    setStatusMsg(null)
    try {
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

  async function handleAppendReport() {
    const accessToken = token || getCachedAccessToken()
    if (!accessToken) {
      setStatusMsg({ type: 'error', text: 'Please sign in with Google first.' })
      return
    }

    const docName = docMetadata?.title || cleanDocId
    const confirmed = window.confirm(
      `Append latest LCA report data directly to Google Doc "${docName}"?\n\nThis adds formatted executive summary, methodology, material research, assembly details, and whole-building LCA totals.`
    )
    if (!confirmed) return

    setLoading(true)
    setStatusMsg(null)
    try {
      const res = await appendLcaReportToDoc(cleanDocId, summaries, references, accessToken)
      setStatusMsg({
        type: 'success',
        text: `LCA Report appended successfully to Google Doc "${res.docTitle || docName}" at ${new Date().toLocaleTimeString()}!`
      })
    } catch (err) {
      console.error('Append Report Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Failed to append report: ${err.message}`
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleOverwriteReport() {
    const accessToken = token || getCachedAccessToken()
    if (!accessToken) {
      setStatusMsg({ type: 'error', text: 'Please sign in with Google first.' })
      return
    }

    const docName = docMetadata?.title || cleanDocId
    const confirmed = window.confirm(
      `⚠️ OVERWRITE WARNING:\n\nAre you sure you want to REPLACE all existing content in Google Doc "${docName}" with the latest LCA Report?`
    )
    if (!confirmed) return

    setLoading(true)
    setStatusMsg(null)
    try {
      const res = await overwriteLcaReportInDoc(cleanDocId, summaries, references, accessToken)
      setStatusMsg({
        type: 'success',
        text: `Google Doc "${res.docTitle || docName}" cleared and updated with latest LCA Report at ${new Date().toLocaleTimeString()}!`
      })
    } catch (err) {
      console.error('Overwrite Report Error:', err)
      setStatusMsg({
        type: 'error',
        text: `Failed to overwrite document: ${err.message}`
      })
    } finally {
      setLoading(false)
    }
  }

  // --- Google Slides Actions ---
  async function handleVerifySlides() {
    const accessToken = token || getCachedAccessToken()
    if (!accessToken) {
      setStatusMsg({ type: 'error', text: 'Please sign in with Google first to verify presentation access.' })
      return
    }

    setLoading(true)
    setStatusMsg(null)
    try {
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
    const accessToken = token || getCachedAccessToken()
    if (!accessToken) {
      setStatusMsg({ type: 'error', text: 'Please sign in with Google first.' })
      return
    }

    const presName = slidesMetadata?.title || cleanSlidesId
    const confirmed = window.confirm(
      `Auto-assign LCA results to matching Assembly slides in Google Presentation "${presName}"?\n\nThis will update body text on each slide (e.g. "Assembly 1 - LCA", "Assembly 2 - LCA", etc.) with current U-values, embodied carbon, logistics freight, and layer compositions.`
    )
    if (!confirmed) return

    setLoading(true)
    setStatusMsg(null)
    try {
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
              {activeTab === 'docs' ? 'Google Docs Report Synchronization' : 'Google Slides Assembly Sync'}
            </h3>
            <p className="gdoc-sync-subtitle">
              {activeTab === 'docs'
                ? 'Automatically sync and append MID 2030 LCA Report data directly to your target Google Document'
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
              disabled={loading || !user}
            >
              🔍 Verify Document Access
            </button>
            <button
              className="gdoc-btn gdoc-btn--primary"
              onClick={handleAppendReport}
              disabled={loading || !user}
            >
              ➕ Append LCA Report to Google Doc
            </button>
            <button
              className="gdoc-btn gdoc-btn--secondary"
              onClick={handleOverwriteReport}
              disabled={loading || !user}
            >
              🔄 Overwrite Google Doc with Latest LCA
            </button>
          </>
        ) : (
          <>
            <button
              className="gdoc-btn gdoc-btn--outline"
              onClick={handleVerifySlides}
              disabled={loading || !user}
            >
              🔍 Verify Slides Access
            </button>
            <button
              className="gdoc-btn gdoc-btn--primary"
              onClick={handleSyncSlides}
              disabled={loading || !user}
            >
              📊 Auto-Assign LCA Results to Assembly Slides
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
