// Single source of truth for "which session is this browser tab in" —
// Group 2 (the real, shared team data, synced to Firestore exactly as
// before this module existed) vs an "Other" group's own independent,
// local-only session (never touches Group 2's shared Firestore docs).
//
// Every Firestore-backed storage module (sectionStorage.js,
// ficheStorage.js, aiMaterialDataStorage.js, routeDistanceStorage.js,
// operationalEnergyStorage.js) and the two localStorage-only ones
// (customMaterialStorage.js, assemblyGeometryStorage.js) call
// sessionKeyPrefix()/sessionSyncsToFirestore() to decide their storage
// key and whether to push to Firestore at all — see each module's own
// storageKey()/pushToFirestore() for the actual isolation. The
// module-load onSnapshot listeners in those files are deliberately left
// targeting the canonical (unprefixed) Group 2 keys regardless of the
// active session, since remote Firestore data is always Group 2's data
// by definition (an Other session never pushes anything for a listener
// to receive back).
const SESSION_KEY = 'mid2030:activeSession'

const EMPTY_SESSION = { group: null, name: null, groupName: null, sessionId: null }

function readRaw() {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return { ...EMPTY_SESSION }
  try {
    return { ...EMPTY_SESSION, ...JSON.parse(raw) }
  } catch {
    return { ...EMPTY_SESSION }
  }
}

function writeRaw(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

/** @returns {{ group: 'group2'|'other'|null, name: string|null, groupName: string|null, sessionId: string|null }} */
export function getActiveSession() {
  return readRaw()
}

/** @param {string} name - must be one of TEAM_MEMBERS; validated by the UI (IdentityPanel), not here. */
export function startGroup2Session(name) {
  const session = { group: 'group2', name, groupName: null, sessionId: 'group2' }
  writeRaw(session)
  return session
}

/** Creates a fresh, independent local session for a non-Group-2 team. */
export function startOtherSession(groupName) {
  const slug = groupName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const sessionId = `${slug || 'group'}-${Date.now().toString(36)}`
  const session = { group: 'other', name: null, groupName: groupName.trim(), sessionId }
  writeRaw(session)
  return session
}

/** "Switch" / log out — back to no session selected. */
export function clearActiveSession() {
  writeRaw({ ...EMPTY_SESSION })
}

export function isGroup2Session() {
  return readRaw().group === 'group2'
}

/** Admin's only special power in this app: force-taking a section lock (see sectionLocks.js). */
export function isAdmin() {
  const s = readRaw()
  return s.group === 'group2' && s.name === 'Nada'
}

/**
 * localStorage key infix for the active session — '' for Group 2 (or no
 * session picked yet), keeping every existing key unchanged, or
 * `other:<sessionId>:` for an Other session, fully separate from Group
 * 2's keys and from any other Other session.
 */
export function sessionKeyPrefix() {
  const s = readRaw()
  return s.group === 'other' && s.sessionId ? `other:${s.sessionId}:` : ''
}

/** Whether the active session should read/write the shared Firestore docs at all. */
export function sessionSyncsToFirestore() {
  return readRaw().group === 'group2'
}

/** The name to attribute saves to, regardless of which kind of session is active — Group 2's picked name, or the Other group's own name. */
export function sessionOwnerName() {
  const s = readRaw()
  if (s.group === 'group2') return s.name || ''
  if (s.group === 'other') return s.groupName || ''
  return ''
}
