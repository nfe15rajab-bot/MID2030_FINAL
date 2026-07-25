// Manual geometry input per assembly (surface area, volume) for the LCA
// and EPD tab's Part A — these come from the 3D model and there's no
// automated geometry bridge yet (stays manual for now, not a Rhino
// pipeline, per earlier decision). Same localStorage pattern as
// ficheStorage.js/assemblyGeometryStorage.js, keyed by assembly instead
// of material.
import { sessionKeyPrefix } from './sessionScope.js'

// Session-aware key — see sectionStorage.js's storageKey() for the
// isolation rationale (this module has no Firestore sync at all, so only
// the localStorage key needs to change per session).
function storageKey(assemblyKey) {
  return `mid2030:${sessionKeyPrefix()}geometry:${assemblyKey}`
}

/** @typedef {{ surfaceAreaM2: string, volumeM3: string }} AssemblyGeometry */

export const DEFAULT_GEOMETRIES = {
  roof: { surfaceAreaM2: '18.0', volumeM3: '6.30' },
  floor: { surfaceAreaM2: '17.0', volumeM3: '6.24' },
  wall: { surfaceAreaM2: '53.0', volumeM3: '16.96' },
  door: { surfaceAreaM2: '6.0', volumeM3: '0.90' },
  window: { surfaceAreaM2: '3.6', volumeM3: '0.36' },
  skylight: { surfaceAreaM2: '2.0', volumeM3: '0.24' },
}

const EMPTY_GEOMETRY = { surfaceAreaM2: '', volumeM3: '' }

/** @returns {AssemblyGeometry} */
export function loadAssemblyGeometry(assemblyKey) {
  const defaultGeo = DEFAULT_GEOMETRIES[assemblyKey] ?? EMPTY_GEOMETRY
  const raw = localStorage.getItem(storageKey(assemblyKey))
  if (!raw) return { ...defaultGeo }
  try {
    const parsed = JSON.parse(raw)
    return {
      surfaceAreaM2: parsed.surfaceAreaM2 || defaultGeo.surfaceAreaM2,
      volumeM3: parsed.volumeM3 || defaultGeo.volumeM3,
    }
  } catch {
    return { ...defaultGeo }
  }
}

export function saveAssemblyGeometry(assemblyKey, geometry) {
  localStorage.setItem(storageKey(assemblyKey), JSON.stringify(geometry))
}
