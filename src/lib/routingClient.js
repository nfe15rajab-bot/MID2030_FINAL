// Talks to server/routing-server.js (reached via the /api/routing Vite
// proxy — see vite.config.js), which calls OpenRouteService's Directions
// API (driving-hgv profile) server-side, keeping the API key out of the
// browser bundle. See routeDistanceStorage.js for the cache this feeds —
// this module never caches anything itself, it's a plain network call.

/**
 * @param {{lat: number, lng: number}} from
 * @param {{lat: number, lng: number}} to
 * @returns {Promise<{distanceKm: number, durationMin: number, geometry: [number,number][]|null}>}
 *   geometry is the real route line, already decoded to plain
 *   [lat,lng] pairs server-side — ready to hand straight to a Leaflet
 *   <Polyline positions={...}>.
 */
export async function fetchRoutedDistanceKm(from, to) {
  const res = await fetch('/api/routing/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })

  const body = await res.json()
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return body
}
