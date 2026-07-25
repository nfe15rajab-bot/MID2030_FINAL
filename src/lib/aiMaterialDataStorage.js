// Client-side overlay for AI-suggested / manually-entered λ, GWP, and
// density values, keyed by material (name, or {id, name} — see keyFor
// below) + field. Same "additive only, never touches the bundled JSON"
// relationship customMaterialStorage.js has to database/materials.json —
// this overlay sits in front of lambdaProviders.json (a static, build-time-
// imported asset a browser app can't write to) rather than duplicating its
// shape as a second, disconnected dataset.
//
// One entry = one team decision about one material's λ, GWP, or density
// value. Read by FieldSuggest.jsx (to pre-fill the next teammate's
// "Suggest" click instead of hitting "no match" again), by
// materialsCatalog.js's getAllMaterials() (to apply the correction to every
// future layer pick, catalog-wide), and by the report/export gate (which
// only pulls verified entries — see deliverablesData.js).
//
// Firestore sync: this is the actual "shared, live-across-the-team" data
// surface — when one teammate accepts a Suggest, everyone else's next
// Suggest click on that same material should already see it, not hit "no
// match" again in their own browser. localStorage stays the source of
// truth this module reads from synchronously (every existing call site —
// FieldSuggest.jsx, etc. — expects synchronous reads, and this shouldn't
// need to become async everywhere just to gain live sync). A background
// onSnapshot listener (below) keeps that localStorage cache warm from
// Firestore in real time; saveMaterialData/setMaterialDataVerified push
// their write to Firestore too, fire-and-forget, alongside the existing
// synchronous localStorage write. If Firestore is unreachable, both
// directions fail soft — the localStorage-only behavior from before this
// feature existed is exactly the fallback.
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig.js'
import { sessionKeyPrefix, sessionSyncsToFirestore } from './sessionScope.js'

const GROUP2_KEY = 'mid2030:aimaterialdata'
const SHARED_DOC_PATH = 'sharedData/materialData'

// See sectionStorage.js's storageKey() for the isolation rationale.
function activeKey() {
  return `mid2030:${sessionKeyPrefix()}aimaterialdata`
}

/** Same normalize() as lambdaProviders.js / customMaterialStorage.js's slugify — kept local, not shared, matching this codebase's existing duplication convention for small string helpers. */
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// `material` is either a plain name string (legacy — every FieldSuggest.jsx
// call site still passes this, unchanged) or a {id, name} object. Two
// different database/materials.json entries can legitimately share the same
// name (e.g. "Kronoply OSB/3 Panel" appears twice, for different layer
// roles) — passing {id, name} keys precisely on the material id instead of
// colliding on the shared name. Falls back to the name-normalize key when
// no id is available (true one-off Ökobaudat picks with no catalog id).
function keyFor(material, field) {
  if (material && typeof material === 'object') {
    return material.id ? `${field}::id:${material.id}` : `${field}::${normalize(material.name)}`
  }
  return `${field}::${normalize(material)}`
}

function nameOf(material) {
  return material && typeof material === 'object' ? material.name ?? '' : material
}

function idOf(material) {
  return material && typeof material === 'object' ? material.id ?? null : null
}

function loadAll() {
  const raw = localStorage.getItem(activeKey())
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function saveAll(map) {
  localStorage.setItem(activeKey(), JSON.stringify(map))
}

// Background live sync FROM Firestore — merges remote entries into the
// local cache as they arrive from any teammate, so the synchronous reads
// above (findMaterialDataMatch, getAllMaterialDataEntries) get fresher
// over time without their callers needing to change at all. lastEditedBy/
// lastEditedAt are top-level doc metadata (see pushEntryToFirestore
// below), not a material entry, so they're split out before merging.
// Registered once at module load — this module is a singleton for the
// lifetime of the page, same as the localStorage it wraps.
// Always reads/writes the canonical Group 2 key directly (not
// loadAll()/saveAll()'s session-aware activeKey()) — remote Firestore
// data is always Group 2's data by definition, regardless of which
// session happens to be active in this browser tab when the snapshot
// fires (see sessionScope.js).
try {
  const sharedDocRef = doc(db, SHARED_DOC_PATH)
  onSnapshot(
    sharedDocRef,
    (snap) => {
      if (!snap.exists()) return
      const { lastEditedBy, lastEditedAt, ...remoteEntries } = snap.data()
      const raw = localStorage.getItem(GROUP2_KEY)
      let local = {}
      try {
        local = raw ? JSON.parse(raw) : {}
      } catch {
        local = {}
      }
      localStorage.setItem(GROUP2_KEY, JSON.stringify({ ...local, ...remoteEntries }))
    },
    (err) => {
      console.warn('[aiMaterialDataStorage] Firestore sync unavailable, using local-only cache:', err.message)
    }
  )
} catch (err) {
  console.warn('[aiMaterialDataStorage] Firestore init failed, using local-only cache:', err.message)
}

// Fire-and-forget push TO Firestore — never awaited or thrown from the
// public API below, so a slow/offline/misconfigured Firestore degrades
// to "this save only landed locally," not a broken Suggest/Accept flow.
function pushEntryToFirestore(key, entry, editedBy) {
  if (!sessionSyncsToFirestore()) return
  const ref = doc(db, SHARED_DOC_PATH)
  setDoc(
    ref,
    {
      [key]: entry,
      lastEditedBy: editedBy ?? entry.enteredBy ?? null,
      lastEditedAt: new Date().toISOString(),
    },
    { merge: true }
  ).catch((err) => {
    console.warn('[aiMaterialDataStorage] Failed to sync to Firestore (saved locally):', err.message)
  })
}

/**
 * One-time push of everything currently in this browser's local cache up
 * to Firestore, merged with whatever's already there. Meant for the
 * "sync to Firestore" button (see TeamSummaryTab.jsx) — this dataset
 * predates Firestore support, so whoever clicks it first makes sure their
 * own already-accepted λ/GWP values aren't left stranded in their own
 * browser once the team starts relying on the shared copy.
 * @returns {Promise<number>} number of entries pushed
 */
export async function syncLocalDataToFirestore(syncedBy) {
  if (!sessionSyncsToFirestore()) return 0
  const map = loadAll()
  const ref = doc(db, SHARED_DOC_PATH)
  await setDoc(
    ref,
    {
      ...map,
      lastEditedBy: syncedBy ?? null,
      lastEditedAt: new Date().toISOString(),
    },
    { merge: true }
  )
  return Object.keys(map).length
}

/**
 * Restores entries exactly as exported (see getAllMaterialDataEntries /
 * sessionExport.js) — writes them as-is, unlike saveMaterialData, which
 * treats every call as a fresh edit (resets verified, stamps a new
 * updatedAt). Each entry's own `id` (set by saveMaterialData originally)
 * is its map key.
 */
export function importMaterialDataEntries(entries) {
  const map = loadAll()
  for (const entry of entries) {
    map[entry.id] = entry
  }
  saveAll(map)
  for (const entry of entries) {
    pushEntryToFirestore(entry.id, entry, entry.enteredBy)
  }
}

/**
 * @param {string|{id: string, name: string}} material - a plain name (legacy)
 *   or a {id, name} object for a precise, collision-free key.
 * @returns {object|null} the stored entry for this exact material+field, or null.
 */
export function findMaterialDataMatch(material, field) {
  const map = loadAll()
  return map[keyFor(material, field)] ?? null
}

/** Every stored entry, flat — for the report/export completeness gate. */
export function getAllMaterialDataEntries() {
  return Object.values(loadAll())
}

/**
 * Upsert one entry. If a prior entry exists for this exact material+field
 * AND the value is unchanged, its verified/verifiedBy/verifiedAt are
 * preserved (re-accepting the same already-verified number shouldn't
 * silently un-verify it). Any new value — a fresh AI suggestion, a
 * changed manual entry — resets verified to false, since a verification
 * is a claim about one specific number, not the material in general.
 *
 * @param {string|{id: string, name: string}} material - a plain name (legacy)
 *   or a {id, name} object for a precise, collision-free key.
 * @param {'lambda'|'gwp'|'density'} field
 * @param {{ value: number, tier: 'ai-suggested'|'manual-entry', aiConfidence?: string|null, aiConfidenceLabel?: string|null, sourceUrl?: string|null, justification?: string|null, enteredBy?: string|null }} patch
 * @returns {object} the saved entry
 */
export function saveMaterialData(material, field, patch) {
  const map = loadAll()
  const k = keyFor(material, field)
  const existing = map[k] ?? null
  const valueUnchanged = existing != null && existing.value === patch.value

  const entry = {
    id: k,
    material: nameOf(material),
    materialId: idOf(material),
    field,
    value: patch.value,
    tier: patch.tier,
    aiConfidence: patch.aiConfidence ?? null,
    aiConfidenceLabel: patch.aiConfidenceLabel ?? null,
    sourceUrl: patch.sourceUrl ?? null,
    justification: patch.justification ?? null,
    verified: valueUnchanged ? existing.verified : false,
    verifiedBy: valueUnchanged ? existing.verifiedBy : null,
    verifiedAt: valueUnchanged ? existing.verifiedAt : null,
    enteredBy: patch.enteredBy ?? existing?.enteredBy ?? null,
    updatedAt: new Date().toISOString(),
  }

  map[k] = entry
  saveAll(map)
  pushEntryToFirestore(k, entry, patch.enteredBy)
  return entry
}

/** Flip (or set) the verified flag on an existing entry. No-op if nothing's stored yet for this material+field. */
export function setMaterialDataVerified(material, field, verified, verifiedBy) {
  const map = loadAll()
  const k = keyFor(material, field)
  const existing = map[k]
  if (!existing) return null

  const entry = {
    ...existing,
    verified,
    verifiedBy: verified ? (verifiedBy || null) : null,
    verifiedAt: verified ? new Date().toISOString() : null,
  }
  map[k] = entry
  saveAll(map)
  pushEntryToFirestore(k, entry, verifiedBy)
  return entry
}
