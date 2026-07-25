import React, { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import referenceLocations from '../../database/reference-locations.json'

// Small, non-interactive inset for the fiche technique — reuses the same
// Leaflet setup + reference-locations.json as the full ProviderMap
// (src/components/ProviderMap.jsx), just fixed-size and static rather than
// the full interactive map. ProviderMap.jsx itself is never screenshotted,
// so it's untouched and stays on OSM tiles.
//
// Getting this into the PDF turned out to need two layers of fixing:
//
// 1. Tile source: verified directly that tile.openstreetmap.org doesn't
//    send CORS headers for anonymous-mode image requests, so any
//    canvas-based capture silently gets blank tiles (no exception, just
//    missing pixels — this is true regardless of capture method, not an
//    html2canvas-specific thing). CartoDB's basemap tiles are free, need
//    no API key, and do send permissive CORS headers.
// 2. Capture method: even with CORS-clean tiles, html2canvas STILL
//    rendered them blank — verified the tile <img> pixels were genuinely
//    readable (drew one to a plain canvas successfully) while the exact
//    same element came back blank through html2canvas. This is a known
//    html2canvas/Leaflet incompatibility: Leaflet positions tile panes
//    with CSS `transform: translate3d(...)`, which html2canvas doesn't
//    resolve correctly. Fix: rasterize the live map with `leaflet-image`
//    (which draws tiles onto a canvas directly, sidestepping the DOM/
//    transform capture entirely) and swap in the result as a plain
//    <img src="data:..."> — see snapshotUrl below — *before* html2canvas
//    captures the rest of the sheet. A plain <img> is something
//    html2canvas handles fine; the live Leaflet DOM is what it can't.
//
// onMapReady hands the underlying Leaflet Map instance up to
// FicheTechniquePanel, which is what actually calls leaflet-image (it
// owns the export flow); snapshotUrl, when set, swaps this component to
// render that captured image instead of the live map.
function MapReadyNotifier({ onMapReady }) {
  const map = useMap()
  useEffect(() => {
    onMapReady?.(map)
  }, [map, onMapReady])
  return null
}

// MapContainer's `bounds` prop (below) only ever applies once, at the map's
// initial construction — react-leaflet does not re-run it on prop changes.
// The fiche panel mounts before a provider location exists, so without this,
// the view fits to just Haarlem+Detmold and never re-fits once the user
// picks/accepts a provider address — the marker is genuinely added to the
// map (verified directly), just positioned outside whatever viewport was
// fit at mount time, so it silently never becomes visible. This component
// re-runs map.fitBounds() whenever the actual coordinates change.
function FitBounds({ bounds, boundsOptions }) {
  const map = useMap()
  // Depend on the flattened primitive lat/lngs, not the `bounds` array
  // itself — a new array identity is created every render regardless of
  // whether the coordinates actually changed, which would re-fit (and
  // fight any zoom/pan the user did) on every unrelated re-render.
  const key = bounds.flat().join(',')
  useEffect(() => {
    map.fitBounds(bounds, boundsOptions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}
// Haarlem/Detmold are fixed reference landmarks, not a status signal —
// always exactly what they are, never "complete" or "needs attention" —
// so they deliberately stay off the app's status palette (would be
// actively misleading, e.g. Haarlem-the-site rendered in "error" red).
// Kept as two distinguishable neutral slate tones instead. The provider
// pin DOES carry a real status (verified/catalog-matched vs manually
// researched) — see providerMarkerColor() below, which mirrors the
// shared status tokens.
export const MARKER_COLORS = {
  haarlem: '#5a6a78',
  detmold: '#8a95a1',
}

// Hardcoded hex, not var(--status-complete)/var(--status-attention) —
// this color also feeds a plain <canvas> 2D context (see
// FicheTechniquePanel.jsx's rasterizeMap/drawTriangle, used for the PDF
// export), and canvas fillStyle can't resolve CSS custom properties.
// Mirrors styles.css's tokens exactly; if those change, update here too.
/** @param {boolean} verified — true when this provider came from a real providers.json match (closestToSite), false for a manually-researched/geocoded fallback. */
export function providerMarkerColor(verified) {
  return verified ? '#2f6b3a' : '#8a6d1d'
}

function triangleIcon(color) {
  return L.divIcon({
    className: 'fiche-marker-icon',
    html: `<div class="fiche-marker-triangle" style="border-bottom-color:${color}"></div>`,
    iconSize: [14, 12],
    iconAnchor: [7, 12],
  })
}

export default function FicheMap({ providerLatLng, providerVerified, snapshotUrl, onMapReady }) {
  const { site, detmoldFactory } = referenceLocations
  const bounds = [
    [site.lat, site.lng],
    [detmoldFactory.lat, detmoldFactory.lng],
    ...(providerLatLng ? [[providerLatLng.lat, providerLatLng.lng]] : []),
  ]

  if (snapshotUrl) {
    return (
      <div className="fiche-map">
        <img src={snapshotUrl} alt="Provider, Haarlem and Detmold locations" width={220} height={160} />
      </div>
    )
  }

  return (
    <div className="fiche-map">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [18, 18] }}
        zoomControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        keyboard={false}
        style={{ height: '160px', width: '220px' }}
      >
        <MapReadyNotifier onMapReady={onMapReady} />
        <FitBounds bounds={bounds} boundsOptions={{ padding: [18, 18] }} />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          crossOrigin="anonymous"
        />
        <Marker position={[site.lat, site.lng]} icon={triangleIcon(MARKER_COLORS.haarlem)} />
        <Marker position={[detmoldFactory.lat, detmoldFactory.lng]} icon={triangleIcon(MARKER_COLORS.detmold)} />
        {providerLatLng && (
          <Marker
            position={[providerLatLng.lat, providerLatLng.lng]}
            icon={triangleIcon(providerMarkerColor(providerVerified))}
          />
        )}
      </MapContainer>
    </div>
  )
}
