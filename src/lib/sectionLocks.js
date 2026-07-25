// Section-level editing locks (Wall/Roof/Floor) for Group 2 only — "Other"
// sessions never touch this (nothing to collide with, see sessionScope.js).
// Built on the existing generic useSharedData()/saveData() helpers
// (src/hooks/useSharedData.js) rather than a new bespoke Firestore
// listener — one doc, sharedData/sectionLocks, keyed by section name,
// same shape as every other shared doc in this app.
//
// Priority: whoever acquires a section's lock first keeps it until they
// leave (see LayerBuilder.jsx's mount/unmount effect) or their heartbeat
// goes stale (tab closed/crashed without a clean unmount); admins always
// force-acquire regardless of who currently holds it.
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig.js'
import { useSharedData, saveData } from '../hooks/useSharedData.js'
import { isGroup2Session } from './sessionScope.js'

const LOCKS_PATH = 'sharedData/sectionLocks'
const STALE_MS = 60_000 // no heartbeat in this long => treat the lock as abandoned

function isRecordStale(record) {
  if (!record?.heartbeatAt) return true
  return Date.now() - new Date(record.heartbeatAt).getTime() > STALE_MS
}

async function readLock(section) {
  try {
    const snap = await getDoc(doc(db, LOCKS_PATH))
    return snap.exists() ? snap.data()[section] ?? null : null
  } catch (err) {
    console.warn('[sectionLocks] Failed to read current lock, proceeding optimistically:', err.message)
    return null
  }
}

/** @returns {Promise<{ok: true} | {ok: false, heldBy: string}>} */
export async function acquireLock(section, { name, isAdmin }) {
  if (!isGroup2Session() || !name) return { ok: true }
  const current = await readLock(section)
  const heldByOther = current?.name && current.name !== name && !isRecordStale(current)
  if (heldByOther && !isAdmin) return { ok: false, heldBy: current.name }

  const now = new Date().toISOString()
  await saveData(LOCKS_PATH, { [section]: { name, lockedAt: now, heartbeatAt: now } })
  return { ok: true }
}

/**
 * Always writes the full nested record (not a partial field) — sidesteps
 * any ambiguity about whether Firestore's merge:true deep-merges nested
 * map fields. Re-checks current ownership first and no-ops if someone
 * else now holds the lock (e.g. an admin force-took it while this tab
 * stayed mounted) — without this check, a still-running heartbeat
 * interval would silently reclaim the lock out from under whoever just
 * took it over, defeating "admin always has priority."
 */
export async function heartbeat(section, { name, lockedAt }) {
  if (!isGroup2Session()) return
  const current = await readLock(section)
  if (current?.name !== name) return
  await saveData(LOCKS_PATH, { [section]: { name, lockedAt, heartbeatAt: new Date().toISOString() } })
}

/** No-op if the section is no longer held by `name` — e.g. an admin already force-took-over before this tab's cleanup ran. Never clobbers someone else's active lock. */
export async function releaseLock(section, name) {
  if (!isGroup2Session()) return
  const current = await readLock(section)
  if (current?.name !== name) return
  await saveData(LOCKS_PATH, { [section]: { name: null, lockedAt: null, heartbeatAt: null } })
}

/** Live view of who (if anyone) currently holds a section's lock — null if free, stale, or the doc doesn't exist yet. */
export function useSectionLock(section) {
  const { data } = useSharedData(LOCKS_PATH, {})
  const record = data?.[section] ?? null
  const heldBy = record?.name && !isRecordStale(record) ? record.name : null
  return { heldBy }
}
