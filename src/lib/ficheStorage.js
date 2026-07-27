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
  try {
    localStorage.setItem(storageKey(materialId), JSON.stringify(detail))
  } catch (err) {
    // Defensive backstop — FicheTechniquePanel.jsx's photo compression
    // should prevent this in practice, but if storage is genuinely full
    // (many large fiches, or a browser with a smaller quota), fail
    // gracefully instead of throwing uncaught out of a setState updater,
    // which previously crashed the whole app to a blank page with no
    // error boundary to catch it. This material's PREVIOUS saved detail
    // (in localStorage) is untouched — setItem never partially writes —
    // only this one new edit doesn't persist.
    console.error(`[ficheStorage] Failed to save "${materialId}" locally (storage may be full):`, err.message)
    if (typeof window !== 'undefined' && err?.name === 'QuotaExceededError') {
      window.alert('Could not save — local storage is full. If this was a photo, try a smaller image; nothing else was lost.')
    }
    return
  }
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

// One-time, non-destructive cleanup for browsers that hit the storage
// quota because photos uploaded BEFORE the 2026-07-27 compression fix
// (FicheTechniquePanel.jsx's handlePhotoChange) are still sitting at
// their original, uncompressed size. Re-encodes every already-stored
// photo down to the same standard (max 1280px, JPEG q=0.82) and writes
// it back to the SAME key — never removes a photo, never touches any
// other field on the record, and skips anything already small enough
// that recompressing would just lose quality for no space gained. Runs
// across every 'fiche:' key regardless of session prefix, since a
// browser can carry more than one session's cache.
const RECOMPRESS_SKIP_UNDER_BYTES = 150 * 1024 // already small — don't re-encode (lossy) for no real gain
const RECOMPRESS_MAX_DIMENSION_PX = 1280
const RECOMPRESS_JPEG_QUALITY = 0.82

function recompressDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > RECOMPRESS_MAX_DIMENSION_PX || height > RECOMPRESS_MAX_DIMENSION_PX) {
        const scale = RECOMPRESS_MAX_DIMENSION_PX / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', RECOMPRESS_JPEG_QUALITY))
    }
    img.onerror = () => reject(new Error('could not decode existing photo'))
    img.src = dataUrl
  })
}

/**
 * @returns {Promise<{ scanned: number, recompressed: number, skippedAlreadySmall: number, failed: number, bytesBefore: number, bytesAfter: number }>}
 */
export async function compressAllStoredPhotos() {
  const result = { scanned: 0, recompressed: 0, skippedAlreadySmall: 0, failed: 0, bytesBefore: 0, bytesAfter: 0 }
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.includes('fiche:')) keys.push(k)
  }

  for (const key of keys) {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    let detail
    try {
      detail = JSON.parse(raw)
    } catch {
      continue // corrupt entry — leave it exactly as ficheStorage's own reads already do
    }
    if (!detail?.photoDataUrl) continue
    result.scanned += 1
    const beforeLen = detail.photoDataUrl.length

    if (beforeLen < RECOMPRESS_SKIP_UNDER_BYTES) {
      result.skippedAlreadySmall += 1
      continue
    }

    try {
      const smaller = await recompressDataUrl(detail.photoDataUrl)
      // Only keep the recompressed version if it's genuinely smaller —
      // a photo that's already a small, already-JPEG-compressed image
      // can occasionally come back slightly larger after a second
      // lossy pass; never make things worse.
      if (smaller.length < beforeLen) {
        detail.photoDataUrl = smaller
        localStorage.setItem(key, JSON.stringify(detail))
        result.recompressed += 1
        result.bytesBefore += beforeLen
        result.bytesAfter += smaller.length
      } else {
        result.skippedAlreadySmall += 1
      }
    } catch (err) {
      console.warn(`[ficheStorage] Could not recompress photo for "${key}":`, err.message)
      result.failed += 1
    }
  }

  return result
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
