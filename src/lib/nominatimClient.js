// Free-text address search via Nominatim (OpenStreetMap's geocoder,
// /search endpoint) — no API key, same OSM data source ProviderMap.jsx
// and FicheMap.jsx already render tiles from.
//
// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// asks for: a distinguishing User-Agent or Referer identifying the app,
// and a max of ~1 request/second. Two real constraints on a browser app:
// - `fetch` cannot set a custom User-Agent header — browsers silently
//   strip/ignore it (a "forbidden header name"). The browser sends its
//   own User-Agent, plus the page's Referer automatically, which is what
//   Nominatim's policy actually treats as the distinguishing signal for
//   client-side apps (the User-Agent ask is aimed at server-side
//   scripts/bots making the request, which can set arbitrary headers).
//   Nothing to configure here — it's sent automatically by the browser.
// - Rate limiting has to live entirely on our side (this module tracks
//   the last request time and refuses to fire early) since there's no
//   way to inspect Nominatim's own throttling from a 429 in advance.
const SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
const MIN_INTERVAL_MS = 1000

// Old-style country-letter-prefixed postcodes (e.g. "D-12345" Germany,
// "A-1010" Austria, "H-2536" Hungary, "CH-8000" Switzerland) — still
// common in addresses AI web search returns, but Nominatim's free-text
// parser reliably returns zero results when this prefix is present
// (verified directly: stripping it turns a 0-result query into a match).
// Retried once, prefix-stripped, before giving up.
const COUNTRY_POSTCODE_PREFIX = /\b[A-Z]{1,2}-(?=\d)/g

let lastRequestAt = 0

async function rawSearch(query, { countryCodes, limit }) {
  const sinceLast = Date.now() - lastRequestAt
  if (sinceLast < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - sinceLast))
  }
  lastRequestAt = Date.now()

  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: String(limit),
    addressdetails: '0',
  })
  if (countryCodes?.length) {
    params.set('countrycodes', countryCodes.join(','))
  }

  const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Nominatim search failed: HTTP ${res.status}`)
  }
  const body = await res.json()
  return body.map((r) => ({
    displayName: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }))
}

/**
 * @param {string} query
 * @param {{ countryCodes?: string[], limit?: number }} [opts]
 * @returns {Promise<{ displayName: string, lat: number, lng: number }[]>}
 */
export async function searchAddress(query, { countryCodes, limit = 5 } = {}) {
  const trimmed = query.trim()
  if (trimmed.length < 3) return []

  const results = await rawSearch(trimmed, { countryCodes, limit })
  if (results.length > 0) return results

  const stripped = trimmed.replace(COUNTRY_POSTCODE_PREFIX, '')
  if (stripped === trimmed) return []
  return rawSearch(stripped, { countryCodes, limit })
}
