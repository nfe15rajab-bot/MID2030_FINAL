import React, { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet'
import L from 'leaflet'
import referenceLocations from '../../database/reference-locations.json'
import providers from '../../database/providers.json'
import { haversineKm } from '../lib/geo.js'

// Default Leaflet marker icons don't bundle correctly with Vite — same fix
// as ProviderMap.jsx (harmless to repeat; L.Icon.Default is a shared
// prototype, so whichever map mounts first wins either way).
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const siteIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [30, 49],
  iconAnchor: [15, 49],
  className: 'marker-site',
})

// Distance bands purely for the concentration visual (circle color) — not
// tied to the app's A4 transport calc anywhere, just a quick visual read
// of "how close is this provider to the site." Real per-material A4
// distances (routed via Detmold) live in lcaAnalysis.js/geo.js and are
// unaffected by this file.
function bandColor(km) {
  if (km <= 500) return '#2f6b3a' // var(--status-complete)
  if (km <= 1000) return '#8a6d1d' // var(--status-attention)
  return '#a13d3d' // var(--status-error)
}

/**
 * Every provider actually linked to a used material (materialIds.length >
 * 0), deduplicated by provider id, plotted at once around the site —
 * "does our supply chain actually cluster near Haarlem" is a question
 * about the whole provider list, not one material at a time (that's what
 * ProviderMap.jsx already answers, per-material, with routed lines to
 * Detmold). Distance here is straight-line to the SITE (not the routed
 * via-Detmold A4 figure) — a deliberately simpler "how far away is this
 * pin" read for the overview map, clearly labeled as such so it's never
 * confused with the A4 transport numbers computed elsewhere.
 */
export default function GlobalProviderMap({ mapRef }) {
  const { site } = referenceLocations

  const activeProviders = useMemo(() => {
    return providers
      .filter((p) => p.materialIds?.length > 0 && p.lat != null && p.lng != null)
      .map((p) => ({ ...p, distanceToSiteKm: haversineKm({ lat: p.lat, lng: p.lng }, site) }))
      .sort((a, b) => a.distanceToSiteKm - b.distanceToSiteKm)
  }, [site])

  const within500 = activeProviders.filter((p) => p.distanceToSiteKm <= 500).length
  const within1000 = activeProviders.filter((p) => p.distanceToSiteKm <= 1000).length
  const avgKm = activeProviders.length > 0
    ? activeProviders.reduce((sum, p) => sum + p.distanceToSiteKm, 0) / activeProviders.length
    : null
  const farthest = activeProviders[activeProviders.length - 1]

  return (
    <div className="global-provider-map-wrapper">
      <MapContainer
        ref={mapRef}
        center={[site.lat, site.lng]}
        zoom={4}
        style={{ height: '480px', width: '100%', borderRadius: '8px' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker position={[site.lat, site.lng]} icon={siteIcon}>
          <Popup>{site.name} — project site</Popup>
        </Marker>

        {activeProviders.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={7}
            pathOptions={{ color: bandColor(p.distanceToSiteKm), fillColor: bandColor(p.distanceToSiteKm), fillOpacity: 0.7, weight: 2 }}
          >
            <Popup>
              <strong>{p.name}</strong>
              <br />
              {p.address}
              <br />
              {Math.round(p.distanceToSiteKm)} km straight-line to site
              <br />
              Materials: {p.materialIds.join(', ')}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      <div className="global-provider-summary">
        <p>
          <strong>{activeProviders.length}</strong> active providers plotted · <strong>{within500}</strong>/
          {activeProviders.length} within 500&nbsp;km of the site (green) · <strong>{within1000}</strong>/
          {activeProviders.length} within 1000&nbsp;km (green+amber) · average{' '}
          <strong>{avgKm != null ? Math.round(avgKm) : '—'}&nbsp;km</strong> straight-line.
        </p>
        {farthest && (
          <p className="global-provider-note">
            Farthest: {farthest.name} ({Math.round(farthest.distanceToSiteKm)}&nbsp;km) — the rest of the supply
            chain is concentrated in Germany/Benelux/Central Europe, well within reach of the fixed Detmold-hub
            trucking route this project's A4 transport calc already assumes.
          </p>
        )}
        <p className="global-provider-note">
          Distance shown here is straight-line to the site (for a quick visual read of concentration) — the
          project's actual A4 transport figures use real routed driving distances via the Detmold hub; see
          Materials and Providers / Deliverables → Assumptions for those.
        </p>
      </div>
    </div>
  )
}
