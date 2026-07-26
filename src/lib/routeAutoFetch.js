// Eagerly fetches+caches every real road-routed distance this project
// needs (the shared Detmold->Haarlem leg, plus every provider actually
// linked to a used material) once, on app load — so A4 is routed by
// default from the moment the app opens, instead of requiring someone to
// find and click "Get real route" per provider (OperationalEnergySettings.jsx
// for the shared leg, ProvidersTab.jsx per provider). Those buttons still
// work (e.g. to re-fetch after a provider's address changes) — this just
// means nobody has to remember to click them first.
//
// Sequential with a short pause between calls, not Promise.all — this
// hits the local /api/routing proxy -> OpenRouteService for every real
// provider (20+), and firing them all at once risks tripping ORS's own
// rate limit (verified against nominatimClient.js's identical concern for
// the geocoder) for no real benefit, since this runs once in the
// background regardless of whether it takes 2 seconds or 20. Silent
// per-route failure (network hiccup, one bad coordinate pair) never stops
// the sweep — same "routing is a bonus on top of the instant estimate,
// never a requirement" reasoning as FicheTechniquePanel.jsx's own
// fetchAndUpgradeRoute.
import { fetchRoutedDistanceKm } from './routingClient.js'
import { findRouteDistance, saveRouteDistance } from './routeDistanceStorage.js'
import referenceLocations from '../../database/reference-locations.json'
import providers from '../../database/providers.json'

const PAUSE_MS = 350

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchAndCache(from, to, onProgress) {
  if (from?.lat == null || from?.lng == null || to?.lat == null || to?.lng == null) return
  if (findRouteDistance(from, to)) return // already routed — nothing to do
  try {
    const route = await fetchRoutedDistanceKm(from, to)
    saveRouteDistance(from, to, route)
    onProgress?.()
  } catch (err) {
    // Best-effort: a proxy/network hiccup on one pair shouldn't stop the
    // rest of the sweep, and this already has a haversine estimate to
    // fall back on in the meantime.
    console.warn('[routeAutoFetch] Could not fetch a real route (keeping the estimate):', err.message)
  }
}

/**
 * Runs once per app load. `onProgress` fires after each newly-fetched
 * route actually lands in the cache (not for ones already cached) — a
 * caller can use it to force a re-render so an already-open tab picks up
 * the real distance without needing a reload.
 */
export async function warmRouteCache(onProgress) {
  const { site, detmoldFactory } = referenceLocations

  await fetchAndCache(detmoldFactory, site, onProgress)

  const activeProviders = providers.filter((p) => p.materialIds?.length > 0 && p.lat != null && p.lng != null)
  for (const provider of activeProviders) {
    await wait(PAUSE_MS)
    await fetchAndCache(provider, detmoldFactory, onProgress)
  }
}
