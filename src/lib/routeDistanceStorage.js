// Cache for real, road-routed distances (OpenRouteService driving-hgv
// profile — see routingClient.js/server/routing-server.js), keyed by the
// coordinate pair itself rather than by material/provider name, so any
// caller with the same two points (a provider's own lat/lng, a fiche's
// pinned location, a materials.json entry) shares one fetched route
// instead of re-querying ORS for coordinates someone else already routed.
// Same "localStorage is the synchronous source of truth, Firestore keeps
// it warm across the team in the background" shape as
// aiMaterialDataStorage.js — findRouteDistance() below is a SYNCHRONOUS
// read on purpose: geo.js's findProvidersForMaterial (called from
// lcaAnalysis.js's synchronous analysis functions) needs to check "is a
// real route already cached?" without becoming async itself. Only the
// actual network fetch (routingClient.js, triggered by an explicit "Get
// real route" button) is async — this module never calls the network.
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig.js'
import { sessionKeyPrefix, sessionSyncsToFirestore } from './sessionScope.js'

const GROUP2_KEY = 'mid2030:routedistance'
const SHARED_DOC_PATH = 'sharedData/routeDistances'

// See sectionStorage.js's storageKey() for the isolation rationale.
function activeKey() {
  return `mid2030:${sessionKeyPrefix()}routedistance`
}

// Rounded to 4 decimal degrees (~11m) — enough precision to distinguish
// real distinct locations while treating floating-point noise or a
// re-geocode of the "same" address as the same cache key.
function round(n) {
  return Math.round(n * 10000) / 10000
}

function keyFor(a, b) {
  return `${round(a.lat)},${round(a.lng)}->${round(b.lat)},${round(b.lng)}`
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

// Background live sync FROM Firestore, same pattern as
// aiMaterialDataStorage.js — a route one teammate already fetched shows up
// for everyone else's next synchronous read without them needing to
// re-fetch (and re-spend ORS quota on) the same coordinates.
// Always reads/writes the canonical Group 2 key directly (not
// loadAll()/saveAll()'s session-aware activeKey()) — see
// aiMaterialDataStorage.js's onSnapshot listener for the same rationale.
try {
  const sharedDocRef = doc(db, SHARED_DOC_PATH)
  onSnapshot(
    sharedDocRef,
    (snap) => {
      if (!snap.exists()) return
      const raw = localStorage.getItem(GROUP2_KEY)
      let local = {}
      try {
        local = raw ? JSON.parse(raw) : {}
      } catch {
        local = {}
      }
      localStorage.setItem(GROUP2_KEY, JSON.stringify({ ...local, ...snap.data() }))
    },
    (err) => {
      console.warn('[routeDistanceStorage] Firestore sync unavailable, using local-only cache:', err.message)
    }
  )
} catch (err) {
  console.warn('[routeDistanceStorage] Firestore init failed, using local-only cache:', err.message)
}

// Only distanceKm/durationMin/fetchedAt sync to Firestore — never the
// route geometry. A real route's line can be a few thousand [lat,lng]
// points (the Detmold<->Haarlem route alone decodes to ~2,900); syncing
// that for every fetched route risks the shared doc creeping toward
// Firestore's 1MB-per-document limit, for something that's only ever a
// map-drawing nicety, not calculation input (the DISTANCE is what A4
// actually needs, and that's tiny). So: the distance number is
// team-shared like everywhere else in this app, but the traced line on
// the map is local-only — a teammate who wants to see it drawn clicks
// "Get real route" in their own browser too (cheap, same free ORS quota).
function pushToFirestore(key, entry) {
  if (!sessionSyncsToFirestore()) return
  const { distanceKm, durationMin, fetchedAt } = entry
  setDoc(doc(db, SHARED_DOC_PATH), { [key]: { distanceKm, durationMin, fetchedAt } }, { merge: true }).catch((err) => {
    console.warn('[routeDistanceStorage] Failed to sync to Firestore (saved locally):', err.message)
  })
}

/** Every cached route for the active session, keyed the same way findRouteDistance looks them up — for the full session export/import (see sessionExport.js). */
export function loadAllRouteDistances() {
  return loadAll()
}

/** Restores routes from an export — merges into the local cache and re-pushes each to Firestore (for Group 2) the normal way, same field-stripping as pushToFirestore. */
export function saveAllRouteDistances(map) {
  const current = loadAll()
  saveAll({ ...current, ...map })
  for (const [key, entry] of Object.entries(map)) {
    pushToFirestore(key, entry)
  }
}

/**
 * @returns {{distanceKm: number, durationMin: number, fetchedAt: string, geometry: [number,number][]|undefined}|null}
 *   Synchronous — reads whatever's already cached (locally, or synced in
 *   from Firestore for distance/duration only — see pushToFirestore),
 *   never triggers a network fetch itself. `geometry` is only present if
 *   THIS browser fetched the route itself (see saveRouteDistance) — a
 *   value synced in from a teammate via Firestore won't have it.
 */
export function findRouteDistance(a, b) {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null
  const map = loadAll()
  return map[keyFor(a, b)] ?? null
}

/** Stores a freshly-fetched route (see routingClient.js) so every future caller for this same pair reads it instantly instead of re-fetching. */
export function saveRouteDistance(a, b, { distanceKm, durationMin, geometry }) {
  const key = keyFor(a, b)
  const entry = { distanceKm, durationMin, geometry: geometry ?? null, fetchedAt: new Date().toISOString() }
  const map = loadAll()
  map[key] = entry
  saveAll(map)
  pushToFirestore(key, entry)
  return entry
}
