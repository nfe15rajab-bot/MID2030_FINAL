// Per-material "fiche technique" manual fields (German name, freeform specs,
// technical norm override, uploaded photo, provider fallback, end-of-life)
// — same localStorage pattern as sectionStorage.js, keyed by material id
// instead of section. These fields aren't reliably in Ökobaudat/
// materials.json, so they're researched/typed in by hand (optionally via
// the AI-assisted Suggest flow — see FieldSuggest.jsx/EndOfLifeSuggest.jsx)
// once per material.
//
// Firestore sync: this is exactly the kind of research a teammate doesn't
// want to redo — a provider location one person just pinned should show
// up on another teammate's map without them re-searching it. Same
// background-listener + push-on-save pattern as aiMaterialDataStorage.js,
// one shared doc keyed by material id instead of field::material. Local
// synchronous reads (loadFicheDetail) stay the source of truth every
// existing call site expects; components that need to re-render on a
// remote change (FicheTechniquePanel, for the map) additionally subscribe
// via useSharedData — see its own comment there.
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig.js'
import { sessionKeyPrefix, sessionSyncsToFirestore } from './sessionScope.js'

const GROUP2_PREFIX = 'mid2030:fiche:'
const SHARED_DOC_PATH = 'sharedData/ficheDetails'

// See sectionStorage.js's storageKey() for the isolation rationale.
function keyPrefix() {
  return `mid2030:${sessionKeyPrefix()}fiche:`
}
function storageKey(materialId) {
  return `${keyPrefix()}${materialId}`
}

/**
 * @typedef {{
 *   germanName: string, specs: string, norm: string, photoDataUrl: string|null,
 *   providerName: string, providerLocation: string, providerLat: number|null, providerLng: number|null,
 *   providerWebsite: string, providerDistanceKm: string,
 *   endOfLifeScenario: '' | 'Reuse' | 'Recycle' | 'Downcycle' | 'Energy recovery (incineration)' | 'Landfill/disposal',
 *   endOfLifeNotes: string,
 *   endOfLifeConfidence: 'high' | 'medium' | 'low' | null,
 *   endOfLifeConfidenceLabel: string | null,
 *   endOfLifeSource: string | null,
 * }} FicheDetail
 */

export function saveFicheDetail(materialId, detail) {
  localStorage.setItem(storageKey(materialId), JSON.stringify(detail))
  pushToFirestore(materialId, detail)
}

/** Every fiche detail currently stored for the active session, keyed by material id — for the full session export/import (see sessionExport.js). */
export function loadAllFicheDetails() {
  const prefix = keyPrefix()
  const result = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(prefix)) continue
    try {
      result[key.slice(prefix.length)] = JSON.parse(localStorage.getItem(key))
    } catch {
      // skip a corrupt entry rather than fail the whole read
    }
  }
  return result
}

/** Restores every fiche detail from an export — goes through saveFicheDetail so both localStorage and (for Group 2) Firestore get updated the normal way. */
export function saveAllFicheDetails(map) {
  for (const [materialId, detail] of Object.entries(map)) {
    saveFicheDetail(materialId, detail)
  }
}

/** @returns {FicheDetail | null} */
export function loadFicheDetail(materialId) {
  const raw = localStorage.getItem(storageKey(materialId))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// photoDataUrl (an uploaded photo, base64-encoded) is excluded from
// Firestore entirely — a single decent-resolution photo can approach
// Firestore's 1 MiB PER-DOCUMENT limit on its own, and this app shares
// ONE doc across every material's fiche (see SHARED_DOC_PATH), so syncing
// photos risks blowing that limit as more materials get one uploaded.
// Photos stay local-only, per browser — everything else (provider
// research, specs, end-of-life, circularity, distances) syncs.
function stripPhotoForSync(detail) {
  const { photoDataUrl, ...rest } = detail
  return rest
}

function pushToFirestore(materialId, detail) {
  if (!sessionSyncsToFirestore()) return
  const ref = doc(db, SHARED_DOC_PATH)
  setDoc(ref, { [materialId]: stripPhotoForSync(detail) }, { merge: true }).catch((err) => {
    console.warn('[ficheStorage] Failed to sync to Firestore (saved locally):', err.message)
  })
}

// Applies one material's remote entry to the local cache, preserving
// whatever photo is already stored locally (the remote entry never has
// one — see stripPhotoForSync) rather than wiping it out on every sync.
// Always targets the canonical Group 2 key directly (not the session-aware
// storageKey()) — remote Firestore data is always Group 2's data by
// definition, regardless of which session happens to be active in this
// browser tab when the snapshot fires (see sessionScope.js).
function mergeRemoteIntoLocal(materialId, remoteDetail) {
  const raw = localStorage.getItem(`${GROUP2_PREFIX}${materialId}`)
  let existing = null
  try {
    existing = raw ? JSON.parse(raw) : null
  } catch {
    existing = null
  }
  const merged = { ...remoteDetail, photoDataUrl: existing?.photoDataUrl ?? null }
  localStorage.setItem(`${GROUP2_PREFIX}${materialId}`, JSON.stringify(merged))
}

// Background live sync FROM Firestore — same pattern as
// aiMaterialDataStorage.js, registered once at module load.
try {
  const sharedDocRef = doc(db, SHARED_DOC_PATH)
  onSnapshot(
    sharedDocRef,
    (snap) => {
      if (!snap.exists()) return
      const remote = snap.data()
      for (const [materialId, detail] of Object.entries(remote)) {
        mergeRemoteIntoLocal(materialId, detail)
      }
    },
    (err) => {
      console.warn('[ficheStorage] Firestore sync unavailable, using local-only cache:', err.message)
    }
  )
} catch (err) {
  console.warn('[ficheStorage] Firestore init failed, using local-only cache:', err.message)
}
