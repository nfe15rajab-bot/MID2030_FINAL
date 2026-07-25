// Transport (A4) CO2 estimate — DIN EN ISO 14083, real formula.
//
// The formula and its vehicle/fuel assumptions come straight from
// LCA-Table-Project-Analysis_v2_2_3.xlsx, sheet group2_v2 (cells B2:B7
// for the assumptions, column T for the formula itself) — this WAS a
// stub ("the actual A4 formula... hasn't been shared yet") until that
// file was provided; this now mirrors it exactly rather than inventing
// a different one. If the team updates those cells, update
// TRANSPORT_ASSUMPTIONS to match — don't let this drift from the
// spreadsheet's own numbers.
import { findRouteDistance } from './routeDistanceStorage.js'
import referenceLocations from '../../database/reference-locations.json'

const { site, detmoldFactory } = referenceLocations

// Sourced from group2_v2!B2:B7. Exported (not just used internally) so
// the group2_v2-matching spreadsheet tab/export can display these same
// numbers in their own AB-AI columns without a second hardcoded copy.
export const TRANSPORT_ASSUMPTIONS = {
  emptyConsumptionLPer100Km: 16.6, // B2 — vehicle empty consumption
  loadedVsEmptyDiffLPer100Km: 2.4, // B3 — extra consumption fully loaded vs empty
  payloadCapacityTonnes: 6, // B4 — vehicle payload capacity
  dieselDensityKgPerL: 0.832, // B5
  dieselGhgFactorKgCo2ePerKg: 3.74, // B6
}

// B7 — the fixed Detmold -> Haarlem leg. group2_v2's own R (total one-way
// distance) column is manufacturer->Detmold (P) + this fixed leg (Q=$B$7),
// i.e. routed THROUGH Detmold, not a direct manufacturer->Haarlem distance.
// 370 is the class spreadsheet's own assumed figure — kept as the fallback
// below, never silently overwritten, since it's a specified assumption
// from the professor's template, not something this app should second-
// guess on its own initiative.
export const DETMOLD_TO_HAARLEM_KM = 370

// Real routed distance for that same fixed leg, once fetched (see
// OperationalEnergySettings.jsx's "Get real route" button) — a plain
// synchronous cache read, same "instant read, network call is a separate
// explicit action" shape as geo.js's bestDistanceKm. Falls back to the
// class spreadsheet's own DETMOLD_TO_HAARLEM_KM assumption until someone
// actually fetches the real route once (it never needs fetching twice —
// this is a single fixed pair of coordinates, not per-material).
export function getDetmoldToHaarlemKm() {
  const routed = findRouteDistance(detmoldFactory, site)
  return { distanceKm: routed ? routed.distanceKm : DETMOLD_TO_HAARLEM_KM, source: routed ? 'routed' : 'assumption' }
}

/**
 * @param {{ distanceKm: number|null, transportMode: string|null, massKg: number|null }} params
 *   distanceKm is the total ONE-WAY routed distance (manufacturer -> Detmold
 *   -> Haarlem, i.e. distanceToDetmoldKm + the fixed 370km leg — see
 *   lcaAnalysis.js's deriveDistanceKm), not a direct-to-Haarlem distance.
 *   transportMode is accepted for signature compatibility but not yet used
 *   in the calc — group2_v2's assumptions are all for a single road/diesel
 *   vehicle profile, no per-mode branching exists in the source sheet.
 * @returns {{ co2Kg: number|null, pending: boolean }}
 */
export function estimateTransportCO2({ distanceKm, massKg }) {
  if (distanceKm == null || massKg == null) {
    return { co2Kg: null, pending: true }
  }

  const { emptyConsumptionLPer100Km, loadedVsEmptyDiffLPer100Km, payloadCapacityTonnes, dieselDensityKgPerL, dieselGhgFactorKgCo2ePerKg } =
    TRANSPORT_ASSUMPTIONS
  const tonnes = massKg / 1000
  const litresPer100Km = emptyConsumptionLPer100Km + (loadedVsEmptyDiffLPer100Km * (tonnes / 2)) / payloadCapacityTonnes
  const roundTripKm = 2 * distanceKm
  const litres = (roundTripKm / 100) * litresPer100Km
  const co2Kg = litres * dieselDensityKgPerL * dieselGhgFactorKgCo2ePerKg

  return { co2Kg, pending: false }
}
