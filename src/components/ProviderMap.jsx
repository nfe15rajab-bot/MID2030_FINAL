import React, { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import referenceLocations from '../../database/reference-locations.json'
import providers from '../../database/providers.json'
import { findProvidersForMaterial } from '../lib/geo.js'
import { estimateTransportCO2 } from '../lib/transport.js'
import { findRouteDistance } from '../lib/routeDistanceStorage.js'

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// Default Leaflet marker icons don't bundle correctly with Vite — fix paths.
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const siteIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  className: 'marker-site',
})

export default function ProviderMap({ materialId }) {
  const { candidates, closestToSite, closestToDetmold } = useMemo(
    () => findProvidersForMaterial(materialId, providers, referenceLocations),
    [materialId]
  )

  const { site, detmoldFactory } = referenceLocations
  const center = [site.lat, site.lng]

  return (
    <div className="provider-map-wrapper">
      <MapContainer center={center} zoom={5} style={{ height: '420px', width: '100%', borderRadius: '8px' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker position={[site.lat, site.lng]} icon={siteIcon}>
          <Popup>{site.name}</Popup>
        </Marker>
        <Marker position={[detmoldFactory.lat, detmoldFactory.lng]}>
          <Popup>{detmoldFactory.name}</Popup>
        </Marker>

        {candidates
          .filter((p) => p.lat != null && p.lng != null)
          .map((p) => {
            // Real route geometry only exists in THIS browser's cache if
            // someone here fetched it (see routeDistanceStorage.js — the
            // line itself doesn't sync via Firestore, only the distance
            // number does) — so this can be null even when
            // distanceToDetmoldKmSource is 'routed' from a teammate's
            // fetch. Falls back to the straight dashed line either way,
            // same as before.
            const route = findRouteDistance(p, detmoldFactory)
            const isClosest = p.id === closestToDetmold?.id
            const weight = isClosest ? 4 : 1.5

            return (
              <React.Fragment key={p.id}>
                <Marker position={[p.lat, p.lng]}>
                  <Popup>
                    <strong>{p.name}</strong>
                    <br />
                    {p.address}
                    <br />
                    → site: {p.distanceToSiteKm?.toFixed(0)} km
                    <br />
                    → Detmold: {p.distanceToDetmoldKm?.toFixed(0)} km
                  </Popup>
                </Marker>
                {route?.geometry?.length > 0 ? (
                  <Polyline positions={route.geometry} pathOptions={{ color: '#3f6b4f', weight }}>
                    <Tooltip sticky>
                      <strong>{p.name} → Detmold</strong>
                      <br />
                      {route.distanceKm.toFixed(1)} km · {formatDuration(route.durationMin)} (real road route, driving-hgv)
                    </Tooltip>
                  </Polyline>
                ) : (
                  <Polyline
                    positions={[[p.lat, p.lng], [detmoldFactory.lat, detmoldFactory.lng]]}
                    pathOptions={{ color: '#3f6b4f', weight, dashArray: '4 4' }}
                  >
                    <Tooltip sticky>
                      <strong>{p.name} → Detmold</strong>
                      <br />
                      {p.distanceToDetmoldKm?.toFixed(1)} km road-route estimate — click "Get real route" to trace the actual road.
                    </Tooltip>
                  </Polyline>
                )}
              </React.Fragment>
            )
          })}
      </MapContainer>

      <div className="provider-summary">
        {candidates.length === 0 && (
          <p className="empty-state">No providers registered for this material yet — add them to database/providers.json.</p>
        )}
        {closestToSite && (
          <p>Closest to site: <strong>{closestToSite.name}</strong> ({closestToSite.distanceToSiteKm.toFixed(0)} km, {closestToSite.distanceToSiteKmSource === 'routed' ? 'real road route' : 'road-route estimate'})</p>
        )}
        {closestToDetmold && (
          <p>Closest to Detmold: <strong>{closestToDetmold.name}</strong> ({closestToDetmold.distanceToDetmoldKm.toFixed(0)} km, {closestToDetmold.distanceToDetmoldKmSource === 'routed' ? 'real road route' : 'road-route estimate'})</p>
        )}
        {closestToSite && estimateTransportCO2({
          distanceKm: closestToSite.distanceToSiteKm,
          transportMode: null,
          massKg: null,
        }).pending && (
          <p className="note">Transport (A4) CO2: pending — awaiting the A4 emission-factor formula.</p>
        )}
        {closestToDetmold?.distanceToDetmoldKmSource !== 'routed' && (
          <p className="note">Distance to Detmold is a road-route estimate (straight-line × 1.2 circuity factor) — use "Get real route" in the Materials and Providers tab for the exact figure.</p>
        )}
      </div>
    </div>
  )
}
