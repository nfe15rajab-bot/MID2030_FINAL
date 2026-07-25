// Client-side catalog of user-created materials, same record shape as
// database/materials.json (see database/schema.md) — additive only, never
// touches the bundled JSON. Exists for materials that aren't in the shared
// catalog and aren't on Ökobaudat either (or the team just hasn't looked
// yet): the user types in whatever they know (λ, thickness, GWP, norm...)
// instead of being blocked. Merge with the static catalog wherever
// materials are listed — see materialsCatalog.js.
import { sessionKeyPrefix } from './sessionScope.js'

// Session-aware key — see sectionStorage.js's storageKey() for the
// isolation rationale (this module has no Firestore sync at all, so only
// the localStorage key needs to change per session).
function activeKey() {
  return `mid2030:${sessionKeyPrefix()}customMaterials`
}

export function loadCustomMaterials() {
  const raw = localStorage.getItem(activeKey())
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function addCustomMaterial(material) {
  const next = [...loadCustomMaterials(), material]
  localStorage.setItem(activeKey(), JSON.stringify(next))
  return next
}

/** Restores materials from an export — merges by id (each already carries a unique custom-<slug>-<timestamp> id from buildCustomMaterial) rather than duplicating on repeat imports. */
export function importCustomMaterials(materials) {
  const byId = Object.fromEntries(loadCustomMaterials().map((m) => [m.id, m]))
  for (const m of materials) byId[m.id] = m
  localStorage.setItem(activeKey(), JSON.stringify(Object.values(byId)))
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents (ö -> o etc.), same approach as lambdaProviders.js
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Builds a materials.json-shaped record from the custom-material form's fields. */
export function buildCustomMaterial({
  name,
  category,
  discipline,
  manufacturer,
  enNorm,
  thicknessMM,
  densityKgM3,
  thermalConductivityWmK,
  gwpA1A3PerFunctionalUnit,
  functionalUnit,
}) {
  return {
    id: `custom-${slugify(name)}-${Date.now()}`,
    name,
    category,
    discipline,
    manufacturer: manufacturer || 'User-entered (custom)',
    providerLocation: null,
    distanceToDetmoldKm: null,
    distanceDetmoldToSiteKm: 370,
    transportMode: 'road',
    enNorm: enNorm || null,
    thicknessMM: thicknessMM ?? null,
    densityKgM3: densityKgM3 ?? null,
    thermalConductivityWmK: thermalConductivityWmK ?? null,
    gwpA1A3PerFunctionalUnit: gwpA1A3PerFunctionalUnit ?? null,
    functionalUnit: functionalUnit || 'm3',
    okobaudatUUID: null,
    epdSource: null,
    notes: 'Added manually via the app UI — not in the shared database/materials.json catalog yet.',
  }
}
