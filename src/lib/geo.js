// Distance primitives. Real road distance comes first (OpenRouteService
// driving-hgv — see routingClient.js/routeDistanceStorage.js):
// findProvidersForMaterial below checks the route cache and only falls
// back to an estimate when no real route has been fetched yet for that
// pair (via the "Get real route" button in ProvidersTab.jsx).
//
// The fallback is a ROAD-ROUTE ESTIMATE, not the raw straight-line
// (haversine) figure: haversine × ROAD_ROUTE_FACTOR. Raw great-circle
// distance systematically understates real road transport (roads detour),
// so feeding it into A4 as-is biases every un-routed material low. The
// 1.2 circuity factor is the typical Western/Central Europe road value,
// and matches this project's one fully-routed calibration pair: Detmold→
// Haarlem is 344 km routed vs 293 km straight-line = 1.17 measured.
// haversineKm itself stays exported as the raw geometric primitive.
import { findRouteDistance } from './routeDistanceStorage.js'

export const ROAD_ROUTE_FACTOR = 1.2

const EARTH_RADIUS_KM = 6371

function toRad(deg) {
  return (deg * Math.PI) / 180
}

export function haversineKm(a, b) {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

// Road-route estimate for pairs with no fetched real route yet — see the
// ROAD_ROUTE_FACTOR rationale in the header comment.
export function roadEstimateKm(a, b) {
  const straight = haversineKm(a, b)
  return straight == null ? null : straight * ROAD_ROUTE_FACTOR
}

// Prefers a cached real route over the road estimate for one leg —
// synchronous (reads localStorage only, never fetches), so callers of
// findProvidersForMaterial (several of them synchronous analysis
// functions in lcaAnalysis.js) don't need to become async just to benefit
// once a route has actually been fetched for that pair.
function bestDistanceKm(a, b) {
  const routed = findRouteDistance(a, b)
  if (routed) return { distanceKm: routed.distanceKm, source: 'routed' }
  return { distanceKm: roadEstimateKm(a, b), source: 'road-estimate' }
}

/**
 * Given a material id, return all matching providers annotated with
 * distance to the site and to Detmold, plus which one is closest to each.
 */
export function findProvidersForMaterial(materialId, providers, referenceLocations) {
  const { site, detmoldFactory } = referenceLocations

  const candidates = providers
    .filter((p) => p.materialIds.includes(materialId))
    .map((p) => {
      const toSite = bestDistanceKm(p, site)
      const toDetmold = bestDistanceKm(p, detmoldFactory)
      return {
        ...p,
        distanceToSiteKm: toSite.distanceKm,
        distanceToSiteKmSource: toSite.source,
        distanceToDetmoldKm: toDetmold.distanceKm,
        distanceToDetmoldKmSource: toDetmold.source,
      }
    })

  const withCoords = candidates.filter((p) => p.lat != null && p.lng != null)

  const closestToSite = withCoords.length
    ? withCoords.reduce((a, b) => (a.distanceToSiteKm < b.distanceToSiteKm ? a : b))
    : null
  const closestToDetmold = withCoords.length
    ? withCoords.reduce((a, b) => (a.distanceToDetmoldKm < b.distanceToDetmoldKm ? a : b))
    : null

  return { candidates, closestToSite, closestToDetmold }
}
