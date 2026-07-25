// Client-side persistence for a section's layer stack, keyed by section
// (wall/roof/floor) — this is what "Save changes" writes and everything
// else (Team Summary, Providers tab, Assembly Analysis, Deliverables, LCA
// Summary, the Excel/PDF exports) reads via loadSection().
//
// Firestore sync: this used to be localStorage-only, which meant your
// saved wall/roof/floor stack didn't follow you to a different machine or
// browser — only the field-level research (fiche details, AI-sourced
// values, routes) synced, via their own storage modules. Same background-
// listener + push-on-save pattern as those (aiMaterialDataStorage.js,
// ficheStorage.js, routeDistanceStorage.js) — one shared doc keyed by
// section name instead of material id/coordinate pair. loadSection() stays
// a SYNCHRONOUS local read (every existing call site — lcaAnalysis.js,
// assemblyAnalysis.js, spreadsheetData.js, etc. — expects that), kept warm
// in the background by the Firestore listener below.
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig.js'
import { sessionKeyPrefix, sessionSyncsToFirestore } from './sessionScope.js'

const GROUP2_PREFIX = 'mid2030:section:'
const SHARED_DOC_PATH = 'sharedData/sections'

// Session-aware storage key — Group 2 (or no session picked yet) resolves
// to the exact same key as before this module supported sessions at all;
// an Other session gets its own fully separate key. See sessionScope.js.
function storageKey(section) {
  return `mid2030:${sessionKeyPrefix()}section:${section}`
}

/** @typedef {{ layers: Array, owner: string, savedAt: string, pitchDeg: number|undefined, unitSpec: object|undefined }} SectionRecord */

/**
 * Spreads whatever's passed rather than destructuring a fixed
 * {layers, owner, pitchDeg} shape — Door/Window/Skylight's own records
 * (see UnitAssemblyBuilder.jsx) also carry a `unitSpec` (dimensions, key
 * characteristics, performance) alongside `layers`, and previously any
 * field outside that fixed shape was silently dropped on save. Existing
 * wall/roof/floor callers are unaffected — they only ever pass
 * {layers, owner, pitchDeg} anyway.
 */
export function saveSection(section, payload) {
  const record = { ...payload, savedAt: new Date().toISOString() }
  localStorage.setItem(storageKey(section), JSON.stringify(record))
  pushToFirestore(section, record)
  return record
}

/** @returns {SectionRecord | null} */
export function loadSection(section) {
  const raw = localStorage.getItem(storageKey(section))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function pushToFirestore(section, record) {
  if (!sessionSyncsToFirestore()) return
  setDoc(doc(db, SHARED_DOC_PATH), { [section]: record }, { merge: true }).catch((err) => {
    console.warn('[sectionStorage] Failed to sync to Firestore (saved locally):', err.message)
  })
}

// Background live sync FROM Firestore, same pattern as ficheStorage.js —
// registered once at module load so a section saved on one machine shows
// up here the next time loadSection() is read, without the user having to
// manually re-save or export/import anything.
try {
  const sharedDocRef = doc(db, SHARED_DOC_PATH)
  onSnapshot(
    sharedDocRef,
    (snap) => {
      if (!snap.exists()) return
      const remote = snap.data()
      for (const [section, record] of Object.entries(remote)) {
        localStorage.setItem(`${GROUP2_PREFIX}${section}`, JSON.stringify(record))
      }
    },
    (err) => {
      console.warn('[sectionStorage] Firestore sync unavailable, using local-only cache:', err.message)
    }
  )
} catch (err) {
  console.warn('[sectionStorage] Firestore init failed, using local-only cache:', err.message)
}
