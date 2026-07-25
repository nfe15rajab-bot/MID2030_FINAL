// One-time, whole-project constants shared by two calcs: B6 (operational
// energy use stage — electricity GWP factor, intensity load, conditioned
// floor area) and C2 (transport to waste processing — the waste facility
// distance, reusing transport.js's own DIN EN ISO 14083 formula the same
// way A4 does, just with this distance instead of the manufacturer's).
// Bundled into one settings object/doc rather than two, since both are
// "fill in once, applies to the whole project" constants of the same
// kind. Unlike aiMaterialDataStorage.js (one entry per material+field),
// this is a SINGLE settings object — same Firestore-backed-with-
// localStorage-fallback shape as everywhere else in this app, just one
// doc instead of a per-material map.
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig.js'
import { sessionKeyPrefix, sessionSyncsToFirestore } from './sessionScope.js'

const GROUP2_KEY = 'mid2030:operationalEnergy'
const SHARED_DOC_PATH = 'sharedData/operationalEnergy'

// See sectionStorage.js's storageKey() for the isolation rationale.
function activeKey() {
  return `mid2030:${sessionKeyPrefix()}operationalEnergy`
}

const EMPTY_SETTINGS = {
  electricityGwpFactor: null, // kg CO2e/kWh
  electricityGwpFactorSource: null, // 'ai' | 'manual' | null
  electricityGwpFactorSourceUrl: null,
  intensityLoad: null, // kWh/m²/year — manual only, no AI search for this one
  intensityLoadSource: null, // 'manual' | null
  conditionedFloorAreaM2: null, // manual only
  conditionedFloorAreaSource: null, // 'manual' | null
  wasteFacilityDistanceKm: null, // one-way, feeds C2 (see lcaAnalysis.js) — manual only, no reliable generic AI answer for "this project's" facility
  wasteFacilityDistanceSource: null, // 'manual' | null
  updatedBy: null,
  updatedAt: null,
}

export function loadOperationalEnergySettings() {
  const raw = localStorage.getItem(activeKey())
  if (!raw) return { ...EMPTY_SETTINGS }
  try {
    return { ...EMPTY_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...EMPTY_SETTINGS }
  }
}

function pushToFirestore(settings) {
  if (!sessionSyncsToFirestore()) return
  setDoc(doc(db, SHARED_DOC_PATH), settings, { merge: true }).catch((err) => {
    console.warn('[operationalEnergyStorage] Failed to sync to Firestore (saved locally):', err.message)
  })
}

export function saveOperationalEnergySettings(patch, updatedBy) {
  const current = loadOperationalEnergySettings()
  const next = { ...current, ...patch, updatedBy: updatedBy ?? current.updatedBy, updatedAt: new Date().toISOString() }
  localStorage.setItem(activeKey(), JSON.stringify(next))
  pushToFirestore(next)
  return next
}

// Background live sync FROM Firestore — same "keep localStorage warm"
// pattern as aiMaterialDataStorage.js/ficheStorage.js, registered once at
// module load. Components that need to re-render on a remote change (the
// settings panel itself) additionally subscribe via useSharedData — this
// listener alone only guarantees the next synchronous read is fresh, not
// a live re-render.
// Always writes the canonical Group 2 key directly — see
// aiMaterialDataStorage.js's onSnapshot listener for the rationale.
try {
  const sharedDocRef = doc(db, SHARED_DOC_PATH)
  onSnapshot(
    sharedDocRef,
    (snap) => {
      if (!snap.exists()) return
      localStorage.setItem(GROUP2_KEY, JSON.stringify({ ...EMPTY_SETTINGS, ...snap.data() }))
    },
    (err) => {
      console.warn('[operationalEnergyStorage] Firestore sync unavailable, using local-only cache:', err.message)
    }
  )
} catch (err) {
  console.warn('[operationalEnergyStorage] Firestore init failed, using local-only cache:', err.message)
}
