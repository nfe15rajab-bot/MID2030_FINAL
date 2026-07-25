import React, { useRef, useState } from 'react'
import { TEAM_MEMBERS } from '../data/teamMembers.js'
import { useCurrentUser } from '../context/CurrentUserContext.jsx'
import { exportSessionJson, readSessionExportFile, summarizeSessionExport, applySessionImport } from '../lib/sessionExport.js'

// Replaces the old header-only TeamMemberSelector — sits beside the 3D
// viewer (see App.jsx's .model-split) as the app's landing identity
// picker: Group first (Group 2 / Other), then — only for Group 2 — the
// team's own name dropdown; Other groups instead name their own
// independent, local-only session (see sessionScope.js/
// CurrentUserContext.jsx for what "independent" means: no Firestore
// writes, a separate localStorage namespace, never touches Group 2's
// shared data).
export default function IdentityPanel() {
  const { group, groupName, currentUser, isAdmin, selectGroup2, selectOther, switchSession } = useCurrentUser()
  const [groupChoice, setGroupChoice] = useState(group ?? '')
  const [otherGroupName, setOtherGroupName] = useState('')
  const [importStatus, setImportStatus] = useState(null)
  const fileInputRef = useRef(null)

  const loggedIn = group === 'group2' ? currentUser : group === 'other' ? groupName : ''

  function handleGroupChange(e) {
    const value = e.target.value
    setGroupChoice(value)
    if (value === '') switchSession()
  }

  function handleNameChange(e) {
    const name = e.target.value
    if (name) selectGroup2(name)
    else switchSession()
  }

  function handleStartOtherSession() {
    if (otherGroupName.trim()) selectOther(otherGroupName.trim())
  }

  function handleSwitch() {
    switchSession()
    setGroupChoice('')
    setOtherGroupName('')
  }

  function handleExport() {
    exportSessionJson()
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleImportFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file next time
    if (!file) return

    setImportStatus(null)
    let data
    try {
      data = await readSessionExportFile(file)
    } catch (err) {
      setImportStatus(`Couldn't read that file: ${err.message}`)
      return
    }

    const summary = summarizeSessionExport(data)
    const fromLabel = summary.fromSession?.group === 'group2' ? 'Group 2' : (summary.fromSession?.groupName ?? 'an unknown session')
    let message =
      `This file has ${summary.layerCounts} layers, ${summary.ficheCount} fiche(s), and ${summary.materialDataCount} material data entries, ` +
      `exported ${new Date(summary.exportedAt).toLocaleString()} from ${fromLabel}.\n\n` +
      `It will be imported into your CURRENT session (${loggedIn}).`
    if (group === 'group2') {
      message += "\n\nYou're on Group 2 — this will overwrite the whole team's shared, synced data, not just your own browser."
    }
    message += '\n\nContinue?'

    if (!window.confirm(message)) return

    applySessionImport(data)
    setImportStatus('Import complete — reload to see everything reflected everywhere (some tabs cache what they had open).')
  }

  return (
    <div className="identity-panel">
      <h3>Session</h3>

      {loggedIn ? (
        <>
          <p className="identity-current">
            Logged in as <strong>{loggedIn}</strong>
            {group === 'group2' && ' · Group 2'}
            {group === 'other' && ' · Other group'}
            {isAdmin && ' · Admin'}
            {' — '}
            <button type="button" className="identity-switch-link" onClick={handleSwitch}>Switch</button>
          </p>

          <div className="identity-session-actions">
            <button type="button" onClick={handleExport}>Export session</button>
            <button type="button" onClick={handleImportClick}>Add session</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleImportFileChange}
              style={{ display: 'none' }}
            />
          </div>
          {importStatus && <p className="identity-hint">{importStatus}</p>}
        </>
      ) : (
        <>
          <label className="identity-field">
            Group
            <select value={groupChoice} onChange={handleGroupChange}>
              <option value="">— select —</option>
              <option value="group2">Group 2</option>
              <option value="other">Other</option>
            </select>
          </label>

          {groupChoice === 'group2' && (
            <label className="identity-field">
              Name
              <select value={currentUser} onChange={handleNameChange}>
                <option value="">— select —</option>
                {TEAM_MEMBERS.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          )}

          {groupChoice === 'other' && (
            <div className="identity-field identity-other">
              <label>
                Your group's name
                <input
                  type="text"
                  value={otherGroupName}
                  onChange={(e) => setOtherGroupName(e.target.value)}
                  placeholder="e.g. Group 5"
                />
              </label>
              <button type="button" onClick={handleStartOtherSession} disabled={!otherGroupName.trim()}>
                Start session
              </button>
              <p className="identity-hint">
                Independent from Group 2 — your own local data, no live sync with the team.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
