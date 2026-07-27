import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import leafletImage from 'leaflet-image'
import { downloadElementAsPng, copyElementPngToClipboard } from '../lib/pngExport.js'
import FicheTechnique from './FicheTechnique.jsx'
import FieldSuggest from './FieldSuggest.jsx'
import EndOfLifeSuggest, { END_OF_LIFE_SCENARIOS } from './EndOfLifeSuggest.jsx'
import CircularitySuggest from './CircularitySuggest.jsx'
import ProviderInfoSuggest from './ProviderInfoSuggest.jsx'
import AddressAutocomplete from './AddressAutocomplete.jsx'
import { MARKER_COLORS, providerMarkerColor } from './FicheMap.jsx'
import referenceLocations from '../../database/reference-locations.json'
import { loadFicheDetail, saveFicheDetail } from '../lib/ficheStorage.js'
import { searchAddress } from '../lib/nominatimClient.js'
import { roadEstimateKm } from '../lib/geo.js'
import { fetchRoutedDistanceKm } from '../lib/routingClient.js'
import { saveRouteDistance } from '../lib/routeDistanceStorage.js'
import { useSharedData } from '../hooks/useSharedData.js'
import './FicheTechnique.css'

const EMPTY_DETAIL = {
  germanName: '',
  specs: '',
  norm: '',
  photoDataUrl: null,
  // Manual fallback only — FicheTechnique.jsx prefers the geo-matched
  // closestToSite (providers.json + geo.js) over these, so they only show
  // up when there's genuinely no provider record for this material yet.
  providerName: '',
  providerLocation: '',
  // Set only via AddressAutocomplete's onSelect (see updateProviderLocation
  // below) — never guessed from the free-text providerLocation string.
  // FicheTechnique.jsx falls back to these for the map pin when there's
  // no auto-matched closestToSite.
  providerLat: null,
  providerLng: null,
  providerWebsite: '',
  providerDistanceKm: '',
  // Auto-computed (haversine, geo.js) the moment providerLat/providerLng
  // is set — manufacturer -> Detmold leg, so lcaAnalysis.js's A4 calc can
  // route through Detmold (+ the fixed Detmold->Haarlem leg) the same way
  // it already does for providers.json/materials.json entries, instead of
  // falling back to the direct-to-Haarlem estimate it flags as "likely
  // understates A4". Still overwritten (not just filled) on every new
  // geocode, same as providerDistanceKm below — see computeProviderDistances.
  providerDistanceToDetmoldKm: '',
  // 'routed' once fetchAndUpgradeRoute below resolves a real
  // OpenRouteService route for this pin, else 'haversine' (the instant
  // estimate computeProviderDistances always fills in first) or null
  // (nothing pinned yet). Shown next to the distance so it's never
  // ambiguous which kind of number is feeding the A4 calc.
  providerDistanceSource: null,
  // Same "keep confidence/source permanently" reasoning as end-of-life
  // below — the LCA tab's A4 calc needs to know whether this distance is
  // AI-researched or hand-typed, not just what the number is.
  providerConfidence: null,
  providerConfidenceLabel: null,
  providerSource: null,
  // End-of-life (C&D phase) — unlike the fields above, this one keeps its
  // confidence/source permanently (not just during the suggest-review
  // step) since it feeds the LCA tab's C&D summary, which needs to know
  // how trustworthy each layer's scenario is, not just what it says.
  endOfLifeScenario: '',
  endOfLifeNotes: '',
  endOfLifeConfidence: null,
  endOfLifeConfidenceLabel: null,
  endOfLifeSource: null,
  // Circularity — recyclability % and deconstruction method, shown
  // alongside endOfLifeScenario/endOfLifeNotes in the fiche's left-column
  // circularity bullet block. Same "keep confidence/source permanently"
  // reasoning as end-of-life above.
  circularityRecyclabilityPercent: '',
  circularityDeconstructionMethod: '',
  circularityConfidence: null,
  circularityConfidenceLabel: null,
  circularitySource: null,
}

// Road-route estimate (haversine × 1.2 circuity factor — see geo.js's
// ROAD_ROUTE_FACTOR rationale) from a resolved provider location to both
// reference points, the moment real coordinates exist — same methodology
// geo.js's findProvidersForMaterial already uses for providers.json
// entries. Rounded to the nearest km since sub-km precision is false
// confidence for an estimate feeding a fixed-factor transport calc.
function computeProviderDistances(lat, lng) {
  const { site, detmoldFactory } = referenceLocations
  const toSiteKm = roadEstimateKm({ lat, lng }, site)
  const toDetmoldKm = roadEstimateKm({ lat, lng }, detmoldFactory)
  return {
    providerDistanceKm: toSiteKm != null ? String(Math.round(toSiteKm)) : '',
    providerDistanceToDetmoldKm: toDetmoldKm != null ? String(Math.round(toDetmoldKm)) : '',
    providerDistanceSource: toDetmoldKm != null ? 'road-estimate' : null,
  }
}

// leaflet-image (verified directly) hangs indefinitely if the map has any
// L.divIcon-based marker on it — it's built for classic image-based
// markers and never resolves its callback otherwise. Our triangle markers
// are divIcons (see FicheMap.jsx), so: strip them from the map before
// rasterizing tiles, then draw the same triangles ourselves straight onto
// the returned canvas using the map's own pixel projection. leaflet-image
// still does the hard part (compositing tile images with correct
// offsets); we only draw 3 flat-color triangles, which needs nothing from
// the marker/icon system at all.
function drawTriangle(ctx, point, color) {
  const halfWidth = 6
  const height = 11
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(point.x, point.y)
  ctx.lineTo(point.x - halfWidth, point.y - height)
  ctx.lineTo(point.x + halfWidth, point.y - height)
  ctx.closePath()
  ctx.fill()
}

async function rasterizeMap(map, points) {
  const markerLayers = []
  map.eachLayer((layer) => {
    if (layer instanceof L.Marker) markerLayers.push(layer)
  })
  markerLayers.forEach((m) => map.removeLayer(m))

  try {
    const canvas = await new Promise((resolve, reject) => {
      leafletImage(map, (err, canvas) => (err ? reject(err) : resolve(canvas)))
    })
    const ctx = canvas.getContext('2d')
    for (const { latlng, color } of points) {
      drawTriangle(ctx, map.latLngToContainerPoint(latlng), color)
    }
    return canvas
  } finally {
    markerLayers.forEach((m) => map.addLayer(m))
  }
}

// Owns the fiche's editable fields (load/save via ficheStorage, keyed by
// material id) and renders the editor form + the read-only FicheTechnique
// sheet it feeds. material/closestToSite come straight from whatever the
// caller already resolved via materials.json + geo.js's
// findProvidersForMaterial — this component doesn't re-derive them.
export default function FicheTechniquePanel({ material, closestToSite }) {
  const [detail, setDetail] = useState(
    () => loadFicheDetail(material.id) ?? { ...EMPTY_DETAIL, norm: material.enNorm ?? '' }
  )
  const [exporting, setExporting] = useState(false)
  const [mapSnapshotUrl, setMapSnapshotUrl] = useState(null)
  const sheetRef = useRef(null)
  const mapInstanceRef = useRef(null)

  // Switching to a different material — reload that material's own saved
  // detail (or the empty/norm-prefilled default) rather than carrying over
  // the previous material's fields.
  useEffect(() => {
    setDetail(loadFicheDetail(material.id) ?? { ...EMPTY_DETAIL, norm: material.enNorm ?? '' })
  }, [material.id])

  // Live map re-render: a teammate researching this same material's
  // provider elsewhere should update the map here too, without a reload —
  // ficheStorage.js's background listener already keeps localStorage
  // warm, but only this subscription actually triggers a React re-render.
  // Merges rather than replaces so a field the local user is mid-editing
  // isn't clobbered by an unrelated remote change to the same material;
  // still last-write-wins if the SAME field changes on both sides within
  // the same window — acceptable for a 6-person team, same tradeoff
  // already accepted by every other Firestore-synced field in this app.
  const { data: sharedFicheDetails } = useSharedData('sharedData/ficheDetails')
  useEffect(() => {
    const remote = sharedFicheDetails?.[material.id]
    if (!remote) return
    setDetail((prev) => {
      const merged = { ...prev, ...remote, photoDataUrl: prev.photoDataUrl }
      return JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged
    })
  }, [sharedFicheDetails, material.id])

  function updateField(field, value) {
    setDetail((prev) => {
      const next = { ...prev, [field]: value }
      saveFicheDetail(material.id, next)
      return next
    })
  }

  // Unlike updateField, this persists confidence/source alongside the
  // value, since end-of-life needs to keep showing its provenance (not
  // just during the suggest-review step) for the LCA tab's C&D summary
  // to know how trustworthy each layer's scenario is.
  function acceptEndOfLife({ scenario, notes, sourceUrl, confidence, confidenceLabel }) {
    setDetail((prev) => {
      const next = {
        ...prev,
        endOfLifeScenario: scenario,
        endOfLifeNotes: notes ?? '',
        endOfLifeSource: sourceUrl,
        endOfLifeConfidence: confidence,
        endOfLifeConfidenceLabel: confidenceLabel,
      }
      saveFicheDetail(material.id, next)
      return next
    })
  }

  // A manual edit after accepting a suggestion invalidates that
  // provenance — keeping a "High confidence, sourced" badge on a value
  // the user just hand-edited would misrepresent where it came from, so
  // clear confidence/source rather than leave them stale.
  function updateEndOfLifeManually(field, value) {
    setDetail((prev) => {
      const next = {
        ...prev,
        [field]: value,
        endOfLifeConfidence: null,
        endOfLifeConfidenceLabel: null,
        endOfLifeSource: null,
      }
      saveFicheDetail(material.id, next)
      return next
    })
  }

  // Same "persist confidence/source, manual edit clears it" reasoning as
  // Fire-and-forget upgrade from the instant haversine estimate
  // (computeProviderDistances, already applied synchronously by both
  // callers below) to a real OpenRouteService route, the moment a
  // provider location is pinned. Only fetches the Detmold leg — that's
  // the only one lcaAnalysis.js's deriveDistanceKm actually reads
  // (fiche.providerDistanceToDetmoldKm) for A4. Deliberately not awaited
  // by its callers — the haversine estimate is already good enough to
  // show immediately; this just quietly replaces it with the real number
  // a few hundred ms later, same "instant estimate, upgrade in the
  // background" pattern the rest of this app uses for AI-researched
  // fields. Guards against a stale response landing after the location
  // was pinned again (or cleared) in the meantime, same as the geocode
  // race guard in acceptProviderInfo below.
  async function fetchAndUpgradeRoute(lat, lng) {
    try {
      const { site, detmoldFactory } = referenceLocations
      const toDetmold = await fetchRoutedDistanceKm({ lat, lng }, detmoldFactory)
      saveRouteDistance({ lat, lng }, detmoldFactory, toDetmold)
      // Also cache the site leg opportunistically (cheap, same call
      // shape) so a later findProvidersForMaterial/geo.js lookup for this
      // exact pin benefits too, not just the Detmold leg this fiche reads.
      fetchRoutedDistanceKm({ lat, lng }, site)
        .then((toSite) => saveRouteDistance({ lat, lng }, site, toSite))
        .catch(() => {})

      setDetail((prev) => {
        if (prev.providerLat !== lat || prev.providerLng !== lng) return prev
        const next = {
          ...prev,
          providerDistanceToDetmoldKm: String(Math.round(toDetmold.distanceKm)),
          providerDistanceSource: 'routed',
        }
        saveFicheDetail(material.id, next)
        return next
      })
    } catch (err) {
      // Routing is a bonus on top of the instant haversine estimate, not
      // a requirement — a failed/misconfigured ORS request shouldn't
      // block or roll back the estimate already shown.
      console.warn('[FicheTechniquePanel] Real route fetch failed, keeping haversine estimate:', err.message)
    }
  }

  // end-of-life above — see acceptEndOfLife/updateEndOfLifeManually. Also
  // geocodes the AI-returned location via Nominatim so accepting a
  // suggestion drops a real pin immediately, same as picking an
  // AddressAutocomplete suggestion by hand — the user shouldn't have to
  // separately retype the address just to get it on the map.
  async function acceptProviderInfo({ name, location, website, distanceToHaarlemKm, sourceUrl, confidence, confidenceLabel }) {
    setDetail((prev) => {
      const next = {
        ...prev,
        providerName: name,
        providerLocation: location ?? '',
        providerWebsite: website ?? '',
        providerDistanceKm: distanceToHaarlemKm === '' || distanceToHaarlemKm == null ? '' : String(distanceToHaarlemKm),
        providerSource: sourceUrl,
        providerConfidence: confidence,
        providerConfidenceLabel: confidenceLabel,
        // Cleared until the geocode below resolves — better to show no
        // pin briefly than a stale one from whatever provider was
        // accepted before this.
        providerLat: null,
        providerLng: null,
      }
      saveFicheDetail(material.id, next)
      return next
    })

    if (!location) return
    try {
      // No countryCodes restriction — unlike the manual AddressAutocomplete
      // below, this is geocoding an address the AI already grounded in a
      // real source (ProviderInfoSuggest), which can legitimately be
      // anywhere the actual manufacturer is (e.g. Hungary, Poland) rather
      // than just Germany/Netherlands. Restricting here silently dropped
      // the geocode for any accepted provider outside those two countries
      // — no pin, no error, just a location with no lat/lng.
      const results = await searchAddress(location)
      if (results.length === 0) return
      const { lat, lng } = results[0]
      setDetail((prev) => {
        // The address text might have been hand-edited or replaced by a
        // newer accept while this geocode was in flight — only apply if
        // it's still the same location we looked up.
        if (prev.providerLocation !== location) return prev
        // Real coordinates now exist — overwrite whatever distance was
        // there (the AI's own ballpark distanceToHaarlemKm guess, or a
        // stale value from a prior provider) with the precise haversine
        // figure computed straight from this geocode. Still editable by
        // hand afterward via updateProviderManually, same as before.
        const next = { ...prev, providerLat: lat, providerLng: lng, ...computeProviderDistances(lat, lng) }
        saveFicheDetail(material.id, next)
        return next
      })
      fetchAndUpgradeRoute(lat, lng)
    } catch {
      // Geocoding is a bonus on top of the AI suggestion, not a
      // requirement — a failed/no-match Nominatim lookup shouldn't
      // block or roll back the provider info that already saved above.
    }
  }

  // Same "persist confidence/source, manual edit clears it" reasoning as
  // acceptEndOfLife/updateEndOfLifeManually above.
  function acceptCircularity({ recyclabilityPercent, deconstructionMethod, sourceUrl, confidence, confidenceLabel }) {
    setDetail((prev) => {
      const next = {
        ...prev,
        circularityRecyclabilityPercent: recyclabilityPercent === '' || recyclabilityPercent == null ? '' : String(recyclabilityPercent),
        circularityDeconstructionMethod: deconstructionMethod ?? '',
        circularitySource: sourceUrl,
        circularityConfidence: confidence,
        circularityConfidenceLabel: confidenceLabel,
      }
      saveFicheDetail(material.id, next)
      return next
    })
  }

  function updateCircularityManually(field, value) {
    setDetail((prev) => {
      const next = {
        ...prev,
        [field]: value,
        circularityConfidence: null,
        circularityConfidenceLabel: null,
        circularitySource: null,
      }
      saveFicheDetail(material.id, next)
      return next
    })
  }

  function updateProviderManually(field, value) {
    setDetail((prev) => {
      const next = {
        ...prev,
        [field]: value,
        providerConfidence: null,
        providerConfidenceLabel: null,
        providerSource: null,
        // Free-typing providerLocation invalidates any previously
        // geocoded pin — the coordinates no longer necessarily match
        // what's now typed. Only picking a real AddressAutocomplete
        // suggestion (updateProviderLocation below) sets lat/lng again.
        ...(field === 'providerLocation' ? { providerLat: null, providerLng: null } : {}),
      }
      saveFicheDetail(material.id, next)
      return next
    })
  }

  // AddressAutocomplete's onSelect — text and coordinates always land
  // together, atomically, so the map pin can never point somewhere the
  // displayed address text doesn't.
  function updateProviderLocation({ displayName, lat, lng }) {
    setDetail((prev) => {
      const next = {
        ...prev,
        providerLocation: displayName,
        providerLat: lat,
        providerLng: lng,
        providerConfidence: null,
        providerConfidenceLabel: null,
        providerSource: null,
        ...computeProviderDistances(lat, lng),
      }
      saveFicheDetail(material.id, next)
      return next
    })
    fetchAndUpgradeRoute(lat, lng)
  }

  // A raw phone-camera photo (often 3-12MB) stored as a base64 data URL
  // can single-handedly blow past localStorage's ~5-10MB per-origin quota
  // once combined with every other fiche's own photo + all the app's
  // other saved data. saveFicheDetail's localStorage.setItem then threw
  // uncaught, and with no error boundary anywhere in the tree that
  // crashed the ENTIRE app to a blank page — this is the reported bug.
  // Fixed two ways: (1) downscale/recompress here so a normal product
  // photo lands in the tens-to-low-hundreds of KB, not several MB, so the
  // quota is essentially never hit in practice; (2) saveFicheDetail also
  // now catches a quota failure defensively (belt and suspenders) instead
  // of throwing. Neither of these touches any other material's already-
  // saved research or photos — this only changes how a NEW upload is
  // encoded before it's ever written to storage.
  const MAX_PHOTO_DIMENSION_PX = 1280
  const PHOTO_JPEG_QUALITY = 0.82

  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > MAX_PHOTO_DIMENSION_PX || height > MAX_PHOTO_DIMENSION_PX) {
          const scale = MAX_PHOTO_DIMENSION_PX / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        updateField('photoDataUrl', canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY))
      }
      img.onerror = () => {
        console.warn('[FicheTechniquePanel] Could not decode the selected image — not saved, nothing else touched.')
        window.alert('That file could not be read as an image. Try a different photo.')
      }
      img.src = reader.result
    }
    reader.onerror = () => {
      console.warn('[FicheTechniquePanel] Could not read the selected file.')
    }
    reader.readAsDataURL(file)
  }

  async function handleExportPng() {
    if (!sheetRef.current) return
    setExporting(true)
    try {
      if (mapInstanceRef.current) {
        const { site, detmoldFactory } = referenceLocations
        const providerPoint = closestToSite?.lat != null
          ? { lat: closestToSite.lat, lng: closestToSite.lng }
          : detail.providerLat != null && detail.providerLng != null
            ? { lat: detail.providerLat, lng: detail.providerLng }
            : null
        const points = [
          { latlng: [site.lat, site.lng], color: MARKER_COLORS.haarlem },
          { latlng: [detmoldFactory.lat, detmoldFactory.lng], color: MARKER_COLORS.detmold },
          ...(providerPoint
            ? [{ latlng: [providerPoint.lat, providerPoint.lng], color: providerMarkerColor(!!closestToSite) }]
            : []),
        ]
        const mapCanvas = await rasterizeMap(mapInstanceRef.current, points)
        setMapSnapshotUrl(mapCanvas.toDataURL('image/png'))
        await new Promise((r) => setTimeout(r, 50))
      }
      await downloadElementAsPng(sheetRef.current, `fiche-technique-${material.id}.png`, { scale: 3 })
    } finally {
      setMapSnapshotUrl(null)
      setExporting(false)
    }
  }

  async function handleCopyPng() {
    if (!sheetRef.current) return
    setExporting(true)
    try {
      if (mapInstanceRef.current) {
        const { site, detmoldFactory } = referenceLocations
        const providerPoint = closestToSite?.lat != null
          ? { lat: closestToSite.lat, lng: closestToSite.lng }
          : detail.providerLat != null && detail.providerLng != null
            ? { lat: detail.providerLat, lng: detail.providerLng }
            : null
        const points = [
          { latlng: [site.lat, site.lng], color: MARKER_COLORS.haarlem },
          { latlng: [detmoldFactory.lat, detmoldFactory.lng], color: MARKER_COLORS.detmold },
          ...(providerPoint
            ? [{ latlng: [providerPoint.lat, providerPoint.lng], color: providerMarkerColor(!!closestToSite) }]
            : []),
        ]
        const mapCanvas = await rasterizeMap(mapInstanceRef.current, points)
        setMapSnapshotUrl(mapCanvas.toDataURL('image/png'))
        await new Promise((r) => setTimeout(r, 50))
      }
      await copyElementPngToClipboard(sheetRef.current, { scale: 3 })
    } catch (err) {
      console.warn('Clipboard copy failed:', err)
    } finally {
      setMapSnapshotUrl(null)
      setExporting(false)
    }
  }

  async function handleExportFiche() {
    if (!sheetRef.current) return
    setExporting(true)
    try {
      // html2canvas can't read Leaflet's CSS3-transform-positioned tile
      // panes correctly (verified directly — tiles come back blank even
      // though they're not CORS-tainted). leaflet-image rasterizes the
      // live map by drawing tiles straight onto a canvas, sidestepping
      // that DOM/transform issue entirely; swap the result in as a plain
      // <img> — which html2canvas handles fine — before capturing the
      // rest of the sheet. See FicheMap.jsx's header comment for the
      // full story, and rasterizeMap()'s comment above for why markers
      // are handled separately from the tile rasterization.
      if (mapInstanceRef.current) {
        const { site, detmoldFactory } = referenceLocations
        // Same closestToSite -> manual/geocoded fallback chain
        // FicheTechnique.jsx's live map already uses — the exported PDF
        // snapshot should show the same pin the on-screen map does, not
        // silently drop it just because there's no catalog match.
        const providerPoint = closestToSite?.lat != null
          ? { lat: closestToSite.lat, lng: closestToSite.lng }
          : detail.providerLat != null && detail.providerLng != null
            ? { lat: detail.providerLat, lng: detail.providerLng }
            : null
        const points = [
          { latlng: [site.lat, site.lng], color: MARKER_COLORS.haarlem },
          { latlng: [detmoldFactory.lat, detmoldFactory.lng], color: MARKER_COLORS.detmold },
          ...(providerPoint
            ? [{ latlng: [providerPoint.lat, providerPoint.lng], color: providerMarkerColor(!!closestToSite) }]
            : []),
        ]
        const mapCanvas = await rasterizeMap(mapInstanceRef.current, points)
        setMapSnapshotUrl(mapCanvas.toDataURL('image/png'))
        // Let React commit the live-map -> <img> swap before html2canvas
        // reads the DOM. Deliberately setTimeout, not requestAnimationFrame
        // — rAF callbacks get throttled/paused entirely on backgrounded or
        // unfocused tabs (verified: this is exactly what caused an
        // indefinite hang here), which setTimeout doesn't suffer from.
        await new Promise((r) => setTimeout(r, 50))
      }

      const canvas = await html2canvas(sheetRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height)
      pdf.save(`fiche-technique-${material.id}.pdf`)
    } finally {
      setMapSnapshotUrl(null)
      setExporting(false)
    }
  }

  return (
    <div className="fiche-panel">
      <div className="fiche-editor">
        <h4>Fiche technique details for {material.name}</h4>
        <label className="fiche-editor-field">
          Technical german name
          <input
            type="text"
            value={detail.germanName}
            onChange={(e) => updateField('germanName', e.target.value)}
            placeholder="e.g. Pulverbeschichtetes Aluminium-Tropfprofil"
          />
        </label>
        <FieldSuggest
          field="germanName"
          materialName={material.name}
          category={material.discipline || material.category || null}
          providerName={closestToSite?.name ?? detail.providerName ?? null}
          onAccept={(value) => updateField('germanName', value)}
        />
        <label className="fiche-editor-field">
          Technical infos / material specifications
          <textarea
            rows={4}
            value={detail.specs}
            onChange={(e) => updateField('specs', e.target.value)}
            placeholder="Freeform — alloy/composition, coating, standards met, etc."
          />
        </label>
        <FieldSuggest
          field="specs"
          materialName={material.name}
          category={material.discipline || material.category || null}
          providerName={closestToSite?.name ?? detail.providerName ?? null}
          onAccept={(value) => updateField('specs', value)}
        />
        <label className="fiche-editor-field">
          Technical norm
          <input
            type="text"
            value={detail.norm}
            onChange={(e) => updateField('norm', e.target.value)}
            placeholder="e.g. EN 755 / EN 12020"
          />
        </label>
        <FieldSuggest
          field="norm"
          materialName={material.name}
          category={material.discipline || material.category || null}
          providerName={closestToSite?.name ?? detail.providerName ?? null}
          onAccept={(value) => updateField('norm', value)}
        />
        <label className="fiche-editor-field">
          Product photo
          <input type="file" accept="image/*" onChange={handlePhotoChange} />
        </label>

        <label className="fiche-editor-field">
          End-of-life scenario
          <select
            value={detail.endOfLifeScenario}
            onChange={(e) => updateEndOfLifeManually('endOfLifeScenario', e.target.value)}
          >
            <option value="">— unresearched —</option>
            {END_OF_LIFE_SCENARIOS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="fiche-editor-field">
          End-of-life notes
          <textarea
            rows={2}
            value={detail.endOfLifeNotes}
            onChange={(e) => updateEndOfLifeManually('endOfLifeNotes', e.target.value)}
            placeholder="e.g. mechanically fixed, easily separable"
          />
        </label>
        {detail.endOfLifeConfidenceLabel && (
          <p className="fiche-editor-hint">
            <span className={`field-suggest-badge field-suggest-badge--${detail.endOfLifeConfidence}`}>
              {detail.endOfLifeConfidenceLabel}
            </span>
            {detail.endOfLifeSource && (
              <> · <a href={detail.endOfLifeSource} target="_blank" rel="noreferrer">source</a></>
            )}
          </p>
        )}
        <EndOfLifeSuggest
          materialName={material.name}
          category={material.discipline || material.category || null}
          providerName={closestToSite?.name ?? detail.providerName ?? null}
          onAccept={acceptEndOfLife}
        />
        <label className="fiche-editor-field">
          Recyclability (%)
          <input
            type="number"
            min={0}
            max={100}
            value={detail.circularityRecyclabilityPercent}
            onChange={(e) => updateCircularityManually('circularityRecyclabilityPercent', e.target.value)}
            placeholder="if known"
          />
        </label>
        <label className="fiche-editor-field">
          Deconstruction method
          <input
            type="text"
            value={detail.circularityDeconstructionMethod}
            onChange={(e) => updateCircularityManually('circularityDeconstructionMethod', e.target.value)}
            placeholder="e.g. mechanically fixed, easily separable"
          />
        </label>
        {detail.circularityConfidenceLabel && (
          <p className="fiche-editor-hint">
            <span className={`field-suggest-badge field-suggest-badge--${detail.circularityConfidence}`}>
              {detail.circularityConfidenceLabel}
            </span>
            {detail.circularitySource && (
              <> · <a href={detail.circularitySource} target="_blank" rel="noreferrer">source</a></>
            )}
          </p>
        )}
        <CircularitySuggest
          materialName={material.name}
          category={material.discipline || material.category || null}
          providerName={closestToSite?.name ?? detail.providerName ?? null}
          onAccept={acceptCircularity}
        />

        <p className="fiche-editor-hint">
          {closestToSite
            ? `Provider auto-matched from providers.json (${closestToSite.name}) — the fields below are ignored while that match exists.`
            : "No provider auto-matched for this material — fill these in manually, or research them below. This also unblocks the LCA and EPD tab's A4 (transport) calc for this material."}
        </p>
        {detail.providerConfidenceLabel && (
          <p className="fiche-editor-hint">
            <span className={`field-suggest-badge field-suggest-badge--${detail.providerConfidence}`}>
              {detail.providerConfidenceLabel}
            </span>
            {detail.providerSource && (
              <> · <a href={detail.providerSource} target="_blank" rel="noreferrer">source</a></>
            )}
          </p>
        )}
        <ProviderInfoSuggest
          materialName={material.name}
          category={material.discipline || material.category || null}
          onAccept={acceptProviderInfo}
        />
        <label className="fiche-editor-field">
          Provider name
          <input
            type="text"
            value={detail.providerName}
            onChange={(e) => updateProviderManually('providerName', e.target.value)}
            placeholder="e.g. Acme Building Supplies"
          />
        </label>
        <label className="fiche-editor-field">
          Provider's location
          <AddressAutocomplete
            value={detail.providerLocation}
            onChange={(value) => updateProviderManually('providerLocation', value)}
            onSelect={updateProviderLocation}
            placeholder="start typing an address…"
          />
        </label>
        <p className="fiche-editor-hint fiche-editor-hint--nominatim">
          Search via Nominatim (OpenStreetMap), unrestricted by country — providers can be anywhere
          the manufacturer actually is. Pick a suggestion to drop a real pin on the map to the right.
          Typing without picking one keeps the text but won't plot a pin.
          {detail.providerLat != null && ' Pin set.'}
        </p>
        <label className="fiche-editor-field">
          Provider's website
          <input
            type="text"
            value={detail.providerWebsite}
            onChange={(e) => updateField('providerWebsite', e.target.value)}
            placeholder="optional"
          />
        </label>
        <FieldSuggest
          field="providerWebsite"
          materialName={material.name}
          category={material.discipline || material.category || null}
          providerName={closestToSite?.name ?? detail.providerName ?? null}
          onAccept={(value) => updateField('providerWebsite', value)}
        />
        <label className="fiche-editor-field">
          Distance to Haarlem (km)
          <input
            type="number"
            min={0}
            value={detail.providerDistanceKm}
            onChange={(e) => updateProviderManually('providerDistanceKm', e.target.value)}
            placeholder="if known"
          />
        </label>
        <p className="fiche-editor-hint">
          {detail.providerDistanceKm !== '' && detail.providerLat != null
            ? 'Auto-computed from the pinned location above — edit to override.'
            : 'Auto-fills once a location is pinned above (AddressAutocomplete pick or AI-accepted + geocoded address).'}
          {detail.providerDistanceToDetmoldKm !== '' && (
            <>
              {' '}Distance to Detmold: <strong>{detail.providerDistanceToDetmoldKm} km</strong>
              {detail.providerDistanceSource === 'routed' ? (
                <span className="service-life-badge service-life-badge--verified"> Real road route (OpenRouteService)</span>
              ) : detail.providerDistanceSource === 'road-estimate' || detail.providerDistanceSource === 'haversine' ? (
                <span className="service-life-badge service-life-badge--unverified"> Fetching real route… (showing road-route estimate)</span>
              ) : null}
              {' '}— this is what the LCA and EPD tab's A4 calc actually routes through, not the Haarlem figure above.
            </>
          )}
        </p>
      </div>

      <FicheTechnique
        ref={sheetRef}
        material={material}
        closestToSite={closestToSite}
        detail={detail}
        mapSnapshotUrl={mapSnapshotUrl}
        onMapReady={(map) => { mapInstanceRef.current = map }}
      />

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>
        <button type="button" className="export-scale-button" onClick={handleExportPng} disabled={exporting}>
          {exporting ? 'Processing PNG…' : '📸 Save Fiche PNG'}
        </button>
        <button type="button" className="export-scale-button" onClick={handleCopyPng} disabled={exporting}>
          {exporting ? 'Processing PNG…' : '📋 Copy Fiche PNG'}
        </button>
        <button type="button" className="export-scale-button" onClick={handleExportFiche} disabled={exporting} style={{ background: '#475569' }}>
          {exporting ? 'Generating fiche PDF…' : 'Export fiche technique PDF'}
        </button>
      </div>
    </div>
  )
}
