// Transport (A4) CO2 estimate — DIN EN ISO 14083.
//
// Two internally consistent conventions exist for the same delivery, both
// built from the same truck/fuel parameters (group2_v2!B2:B7, below) — see
// TransportMethodologyA3.jsx for the full step-by-step comparison:
//   - ROUND TRIP (estimateTransportCO2RoundTrip): a dedicated truck drives
//     out loaded and back empty — the class template's own column-T
//     formula. Conservative (an honest worst case), but a shipment is
//     billed the fuel of an entire empty return leg to itself.
//   - CONSOLIDATED (estimateTransportCO2Consolidated): DIN EN ISO 14083 /
//     GLEC Framework attribution — emissions = transport activity (t·km)
//     x a fleet-average intensity for the same truck, full both ways. This
//     is the standard convention for real (shared) freight and is what
//     estimateTransportCO2 (the one every A1-A3/A4/C2 caller in this app
//     uses) computes by default, per the team's own decision to adopt it
//     app-wide (2026-07-27) — round trip stays available as a named export
//     for audit/comparison, not as the computed A4.
// If the team updates the underlying vehicle/fuel cells, update
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

// Consolidated intensity — kg CO2e per t·km — for the same truck, full
// both ways, shared across its whole payload: 2 x (empty + loaded diff) /
// payload / 100 x diesel density x diesel GHG factor. A fixed constant
// (doesn't depend on this shipment's own mass), so callers that need it
// directly (spreadsheet export's column O) don't need to reimplement it.
export function getConsolidatedIntensityKgCo2ePerTonneKm() {
  const { emptyConsumptionLPer100Km, loadedVsEmptyDiffLPer100Km, payloadCapacityTonnes, dieselDensityKgPerL, dieselGhgFactorKgCo2ePerKg } =
    TRANSPORT_ASSUMPTIONS
  return (2 * (emptyConsumptionLPer100Km + loadedVsEmptyDiffLPer100Km) / payloadCapacityTonnes) / 100
    * dieselDensityKgPerL * dieselGhgFactorKgCo2ePerKg
}

/**
 * CONSOLIDATED convention (DIN EN ISO 14083 / GLEC Framework): transport
 * activity (t·km) x fleet-average intensity. This is the app's default —
 * every A4/C2 caller (lcaAnalysis.js) uses this, not the round-trip one.
 * @param {{ distanceKm: number|null, massKg: number|null }} params
 *   distanceKm is the total ONE-WAY routed distance (manufacturer -> Detmold
 *   -> Haarlem, i.e. distanceToDetmoldKm + the fixed 370km leg — see
 *   lcaAnalysis.js's deriveDistanceKm), not a direct-to-Haarlem distance.
 * @returns {{ co2Kg: number|null, pending: boolean }}
 */
export function estimateTransportCO2Consolidated({ distanceKm, massKg }) {
  if (distanceKm == null || massKg == null) {
    return { co2Kg: null, pending: true }
  }
  const tonnes = massKg / 1000
  const co2Kg = tonnes * distanceKm * getConsolidatedIntensityKgCo2ePerTonneKm()
  return { co2Kg, pending: false }
}

/**
 * ROUND TRIP convention (the class template's own column-T formula): a
 * dedicated truck drives out loaded and back empty. Kept as a named,
 * separately-callable function for audit/comparison (see
 * TransportMethodologyA3.jsx) — not the app's computed A4 anymore.
 * @param {{ distanceKm: number|null, massKg: number|null }} params
 * @returns {{ co2Kg: number|null, pending: boolean }}
 */
export function estimateTransportCO2RoundTrip({ distanceKm, massKg }) {
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

/**
 * The app's canonical A4/C2 transport estimate — CONSOLIDATED convention
 * (see header comment). transportMode is accepted for signature
 * compatibility but not yet used — group2_v2's assumptions are all for a
 * single road/diesel vehicle profile, no per-mode branching exists in the
 * source sheet.
 * @param {{ distanceKm: number|null, transportMode: string|null, massKg: number|null }} params
 * @returns {{ co2Kg: number|null, pending: boolean }}
 */
export function estimateTransportCO2({ distanceKm, massKg }) {
  return estimateTransportCO2Consolidated({ distanceKm, massKg })
}
