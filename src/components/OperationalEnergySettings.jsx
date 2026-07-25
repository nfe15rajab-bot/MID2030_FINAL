import React, { useEffect, useState } from 'react'
import { suggestField } from '../lib/materialAutofillClient.js'
import { loadOperationalEnergySettings, saveOperationalEnergySettings } from '../lib/operationalEnergyStorage.js'
import { getDetmoldToHaarlemKm } from '../lib/transport.js'
import { fetchRoutedDistanceKm } from '../lib/routingClient.js'
import { saveRouteDistance } from '../lib/routeDistanceStorage.js'
import { useSharedData } from '../hooks/useSharedData.js'
import { useCurrentUser } from '../context/CurrentUserContext.jsx'
import referenceLocations from '../../database/reference-locations.json'

// Not a "material" search — the AI backend's suggestField() is generic
// enough to ground a web search on any well-described query, not just a
// product name, so this reuses the exact same endpoint/pattern (see
// server's FIELD_SPECS.electricityGwpFactor) with a descriptive stand-in
// "material name" instead of forking a second AI-search code path.
const ELECTRICITY_QUERY_NAME = 'Germany national grid electricity mix, average'

function badge(source, populated) {
  if (!populated) return null
  return (
    <span className={`service-life-badge service-life-badge--${source === 'manual' ? 'verified' : 'unverified'}`}>
      {source === 'manual' ? 'Verified — manual' : 'Unverified — AI sourced'}
    </span>
  )
}

// One-time, whole-building constants for the B6 (operational energy)
// calc — shared team-wide via operationalEnergyStorage.js (Firestore +
// localStorage, same pattern as every other shared field in this app).
// Only the electricity GWP factor is AI-searchable; intensity load and
// floor area are manual-only per the brief (no reliable generic web
// answer for "this specific building's" values).
export default function OperationalEnergySettings() {
  const { currentUser } = useCurrentUser()
  const { data: shared } = useSharedData('sharedData/operationalEnergy')
  const [settings, setSettings] = useState(() => loadOperationalEnergySettings())
  const [aiState, setAiState] = useState({ status: 'idle' })
  // Recomputed on every render (cheap — a single localStorage read, see
  // transport.js) rather than derived from `settings`, since the cached
  // route lives in its own storage module (routeDistanceStorage.js),
  // shared with the Providers tab's per-material routes, not folded into
  // this settings object.
  const detmoldToHaarlem = getDetmoldToHaarlemKm()
  const [fetchingDetmoldRoute, setFetchingDetmoldRoute] = useState(false)

  async function handleGetDetmoldRoute() {
    setFetchingDetmoldRoute(true)
    try {
      const { site, detmoldFactory } = referenceLocations
      const route = await fetchRoutedDistanceKm(detmoldFactory, site)
      saveRouteDistance(detmoldFactory, site, route)
      // Nothing to setState for the distance itself — getDetmoldToHaarlemKm()
      // reads the cache fresh on the next render, forced below.
      setSettings((s) => ({ ...s }))
    } catch (err) {
      window.alert(`Real route lookup failed: ${err.message}`)
    } finally {
      setFetchingDetmoldRoute(false)
    }
  }

  // Live-merge a teammate's update — same reasoning as SharedDataBanner's
  // subscription, just applied directly to this panel's own displayed
  // values instead of a separate read-only banner.
  useEffect(() => {
    if (!shared) return
    setSettings((prev) => {
      const merged = { ...loadOperationalEnergySettings(), ...shared }
      return JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged
    })
  }, [shared])

  function update(patch) {
    setSettings(saveOperationalEnergySettings(patch, currentUser || null))
  }

  async function handleSuggestElectricity() {
    setAiState({ status: 'loading' })
    try {
      const suggestion = await suggestField({
        materialName: ELECTRICITY_QUERY_NAME,
        category: null,
        providerName: null,
        field: 'electricityGwpFactor',
      })
      if (suggestion.value == null) {
        setAiState({ status: 'empty', note: suggestion.note })
      } else {
        update({
          electricityGwpFactor: Number(suggestion.value),
          electricityGwpFactorSource: 'ai',
          electricityGwpFactorSourceUrl: suggestion.sourceUrl ?? null,
        })
        setAiState({ status: 'idle' })
      }
    } catch (err) {
      setAiState({ status: 'error', error: err.message })
    }
  }

  return (
    <div className="operational-energy-settings">
      <h3>Operational energy (B6) settings</h3>
      <p className="deliverable-note">
        One-time, whole-building constants — shared across the team, feed the B6 figure below.
      </p>

      <label className="fiche-editor-field">
        Electricity GWP factor (kg CO₂e/kWh)
        <input
          type="number"
          step="any"
          min={0}
          value={settings.electricityGwpFactor ?? ''}
          onChange={(e) =>
            update({
              electricityGwpFactor: e.target.value === '' ? null : Number(e.target.value),
              electricityGwpFactorSource: 'manual',
              electricityGwpFactorSourceUrl: null,
            })
          }
          placeholder="e.g. 0.38 (Germany average)"
        />
      </label>
      <div className="field-suggest-trigger-row">
        <button type="button" className="field-suggest-trigger" onClick={handleSuggestElectricity} disabled={aiState.status === 'loading'}>
          {aiState.status === 'loading' ? 'Searching…' : 'Search with AI (Germany average)'}
        </button>
        {badge(settings.electricityGwpFactorSource, settings.electricityGwpFactor != null)}
        {settings.electricityGwpFactorSourceUrl && (
          <a href={settings.electricityGwpFactorSourceUrl} target="_blank" rel="noreferrer">source</a>
        )}
      </div>
      {aiState.status === 'empty' && (
        <p className="field-suggest-note">
          No reliable source found{aiState.note && aiState.note !== 'no reliable source found' ? ` — ${aiState.note}` : ''} — enter manually.
        </p>
      )}
      {aiState.status === 'error' && <p className="field-suggest-note field-suggest-note--error">Search failed: {aiState.error}</p>}

      <label className="fiche-editor-field">
        Intensity load (kWh/m²/year)
        <input
          type="number"
          step="any"
          min={0}
          value={settings.intensityLoad ?? ''}
          onChange={(e) =>
            update({
              intensityLoad: e.target.value === '' ? null : Number(e.target.value),
              intensityLoadSource: 'manual',
            })
          }
          placeholder="manual — e.g. from Bouwbesluit/PHPP"
        />
      </label>
      {badge('manual', settings.intensityLoad != null)}

      <label className="fiche-editor-field">
        Conditioned floor area (m²)
        <input
          type="number"
          step="any"
          min={0}
          value={settings.conditionedFloorAreaM2 ?? ''}
          onChange={(e) =>
            update({
              conditionedFloorAreaM2: e.target.value === '' ? null : Number(e.target.value),
              conditionedFloorAreaSource: 'manual',
            })
          }
          placeholder="manual"
        />
      </label>
      {badge('manual', settings.conditionedFloorAreaM2 != null)}

      <h4>Detmold → Haarlem route (A4, shared leg)</h4>
      <p className="providers-distance-line">
        <strong>{detmoldToHaarlem.distanceKm.toFixed(1)} km</strong>
        {detmoldToHaarlem.source === 'routed' ? (
          <span className="service-life-badge service-life-badge--verified"> Real road route (OpenRouteService)</span>
        ) : (
          <span className="service-life-badge service-life-badge--unverified"> Class spreadsheet assumption (370km)</span>
        )}
        <button type="button" onClick={handleGetDetmoldRoute} disabled={fetchingDetmoldRoute}>
          {fetchingDetmoldRoute ? 'Fetching route…' : 'Get real route'}
        </button>
      </p>
      <p className="deliverable-note">
        Every A4 calc routes manufacturer→Detmold→Haarlem — this is that fixed final leg, shared by
        every material (see transport.js). Fetched once here, not per-material.
      </p>

      <h4>End-of-life transport (C2)</h4>
      <label className="fiche-editor-field">
        Waste facility distance, one-way (km)
        <input
          type="number"
          step="any"
          min={0}
          value={settings.wasteFacilityDistanceKm ?? ''}
          onChange={(e) =>
            update({
              wasteFacilityDistanceKm: e.target.value === '' ? null : Number(e.target.value),
              wasteFacilityDistanceSource: 'manual',
            })
          }
          placeholder="manual — nearest relevant C&D waste processing facility"
        />
      </label>
      {badge('manual', settings.wasteFacilityDistanceKm != null)}
      <p className="deliverable-note">
        Feeds C2 (transport to waste processing) — computed with the same DIN EN ISO 14083 formula as
        A4, using each layer's own mass and this one shared distance.
      </p>

      {settings.updatedBy && (
        <p className="fiche-editor-hint">
          Last updated by {settings.updatedBy}{settings.updatedAt && ` at ${new Date(settings.updatedAt).toLocaleString()}`}
        </p>
      )}
    </div>
  )
}
