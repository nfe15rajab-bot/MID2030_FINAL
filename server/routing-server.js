// Real road-routed distance/duration between two coordinates, via
// OpenRouteService's Directions API (driving-hgv profile — heavy goods
// vehicle, matching the actual diesel-truck delivery this app's A4
// transport formula models, not a passenger car). Started alongside
// `vite` via `npm run dev` (see package.json) and reached through Vite's
// dev proxy at /api/routing (vite.config.js) — same pattern as
// material-autofill-server.js and section-export-server.js.
//
// Why server-side: same two reasons as material-autofill-server.js's
// Gemini key — (1) the API key must never end up in the browser bundle,
// (2) ORS's CORS policy doesn't allow browser-origin requests to its API
// directly, so this also unblocks the request itself, not just the key.
import { readFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const PORT = 3903
const ORS_URL = 'https://api.openrouteservice.org/v2/directions/driving-hgv'

// Same hand-rolled .env reader as material-autofill-server.js (no
// `dotenv` package dependency) — reads server/.env, which is gitignored.
function loadEnvFile() {
  const envPath = path.join(import.meta.dirname, '.env')
  const env = {}
  if (!existsSync(envPath)) return env
  const raw = readFileSync(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

const ENV = loadEnvFile()
const API_KEY = process.env.ORS_API_KEY || ENV.ORS_API_KEY || null

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

function isFiniteCoord(c) {
  return c && typeof c.lat === 'number' && typeof c.lng === 'number' && Number.isFinite(c.lat) && Number.isFinite(c.lng)
}

// ORS's default (non-GeoJSON) response encodes the route line as a Google
// "encoded polyline" string (precision 5, the standard default — we don't
// request a different precision) rather than a plain coordinate array.
// Decoded here, server-side, so the client only ever deals with a plain
// [[lat,lng], ...] array — no polyline-format knowledge needed in the
// browser bundle for what's otherwise a one-off decode.
function decodePolyline(encoded) {
  const factor = 1e5
  let index = 0, lat = 0, lng = 0
  const coordinates = []
  while (index < encoded.length) {
    let shift = 0, result = 0, byte
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)

    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)

    coordinates.push([lat / factor, lng / factor])
  }
  return coordinates
}

function handleRoute(req, res) {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', async () => {
    if (!API_KEY) {
      sendJson(res, 500, {
        error: 'ORS_API_KEY is not configured. Add it to server/.env (see server/.env.example) — never commit the real key.',
      })
      return
    }

    let input
    try {
      input = JSON.parse(body)
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' })
      return
    }

    const { from, to } = input
    if (!isFiniteCoord(from) || !isFiniteCoord(to)) {
      sendJson(res, 400, { error: 'Body must include "from" and "to", each {lat, lng} numbers' })
      return
    }

    try {
      // ORS coordinates are [lng, lat] (GeoJSON order), the opposite of
      // this app's own {lat, lng} convention everywhere else — the
      // reordering happens only here, at the API boundary.
      const orsRes = await fetch(ORS_URL, {
        method: 'POST',
        headers: { 'Authorization': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
      })
      const orsBody = await orsRes.json()
      if (!orsRes.ok) {
        const detail = orsBody?.error?.message || orsBody?.error || `HTTP ${orsRes.status}`
        sendJson(res, 502, { error: `OpenRouteService error: ${detail}` })
        return
      }

      const route = orsBody?.routes?.[0]
      if (!route?.summary) {
        sendJson(res, 502, { error: 'OpenRouteService returned no route' })
        return
      }

      sendJson(res, 200, {
        distanceKm: route.summary.distance / 1000,
        durationMin: route.summary.duration / 60,
        // [[lat,lng], ...] along the real road route — for drawing the
        // actual path on the map, not just a straight line between the
        // two points. Absent (not just empty) if ORS didn't return a
        // geometry for some reason, so callers can tell "no line data"
        // apart from "a route with zero points".
        geometry: route.geometry ? decodePolyline(route.geometry) : null,
      })
    } catch (err) {
      sendJson(res, 502, { error: `Routing request failed: ${err.message}` })
    }
  })
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/route') {
    handleRoute(req, res)
    return
  }
  sendJson(res, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  console.log(`[routing-server] listening on http://localhost:${PORT}${API_KEY ? '' : ' (WARNING: no ORS_API_KEY configured — see server/.env.example)'}`)
})
