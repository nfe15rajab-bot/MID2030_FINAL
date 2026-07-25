import React, { useEffect, useMemo, useState } from 'react'
import providers from '../../database/providers.json'
import referenceLocations from '../../database/reference-locations.json'
import { findProvidersForMaterial } from '../lib/geo.js'
import { fetchRoutedDistanceKm } from '../lib/routingClient.js'
import { saveRouteDistance } from '../lib/routeDistanceStorage.js'
import { getAllMaterials } from '../lib/materialsCatalog.js'
import { loadAssemblyGeometry } from '../lib/assemblyGeometryStorage.js'
import { gwpTotalForLayers } from '../lib/gwpPerM2.js'
import { SECTIONS, poolAllLayers, dedupeMaterials, groupByDiscipline } from '../lib/materialsSummary.js'
import MaterialProviderMap from './MaterialProviderMap.jsx'
import SectionPreview from './SectionPreview.jsx'
import FicheTechniquePanel from './FicheTechniquePanel.jsx'
import FicheMap from './FicheMap.jsx'
import MaterialCoreValuesEditor from './MaterialCoreValuesEditor.jsx'
import MaterialsSummaryTable from './MaterialsSummaryTable.jsx'
import { calculateUValue } from '../lib/uvalue.js'
import { loadFicheDetail } from '../lib/ficheStorage.js'
import { useSharedData } from '../hooks/useSharedData.js'
import { useCurrentUser } from '../context/CurrentUserContext.jsx'
import './SectionPreview.css'

// Door/Window/Skylight are single manufactured units with no Part A floor
// area of their own (see assemblyGeometryStorage.js/assemblyAnalysis.js) —
// the section-preview GWP total below must skip the area lookup for them.
const UNIT_SECTIONS = new Set(['door', 'window', 'skylight'])

export default function ProvidersTab() {
  const { currentUser } = useCurrentUser()

  // Bumped after a λ/GWP/density override is saved (MaterialCoreValuesEditor)
  // or an Excel import applies changes (MaterialsSummaryTable) — both write
  // straight to localStorage/Firestore without going through React state,
  // so nothing else would otherwise tell this component's memos to re-read
  // getAllMaterials()/loadSection() and reflect the change immediately.
  const [dataVersion, setDataVersion] = useState(0)
  function refreshData() {
    setDataVersion((v) => v + 1)
  }

  // Live cross-team refresh: a teammate saving a section elsewhere updates
  // Firestore's sharedData/sections doc, which sectionStorage.js's
  // background listener already writes into this browser's localStorage —
  // but nothing forces a re-render to actually re-read it until this
  // subscription's value changes. loadSection() itself stays a synchronous
  // localStorage read; this only decides WHEN to re-run it.
  const { data: sharedSections } = useSharedData('sharedData/sections')

  // Read once per mount (plus whenever dataVersion bumps) — this tab fully
  // unmounts on tab switch, so a custom material added in Section
  // Configurator is picked up next time this tab opens anyway; dataVersion
  // covers the in-tab edit case (MaterialCoreValuesEditor, Excel import).
  const allMaterials = useMemo(() => getAllMaterials(), [dataVersion])
  const materialById = useMemo(
    () => Object.fromEntries(allMaterials.map((m) => [m.id, m])),
    [allMaterials]
  )

  const { bySection, pooled } = useMemo(
    () => poolAllLayers(materialById),
    [materialById, dataVersion, sharedSections]
  )
  // The "no duplicates" view — one row per unique material (by materialId,
  // falling back to the Ökobaudat dataset URL, then the raw layer instance)
  // rather than one row per layer instance across sections. See
  // materialsSummary.js's dedupeKey for why name alone is never used as the
  // fallback (the catalog has genuine name collisions).
  const dedupedRows = useMemo(() => dedupeMaterials(pooled), [pooled])
  const groupedRows = useMemo(() => groupByDiscipline(dedupedRows), [dedupedRows])
  const hasAnySaved = SECTIONS.some((s) => bySection[s])

  const [selectedRowKey, setSelectedRowKey] = useState(null)
  const [selectedMaterialId, setSelectedMaterialId] = useState(null)
  const [previewSection, setPreviewSection] = useState(null)
  const [showSectionPreview, setShowSectionPreview] = useState(false)
  // Keyed by the deduped row's key (materialId, Ökobaudat URL, or instance
  // id — see materialsSummary.js) so switching materials never carries over
  // a previous material's override, and two sections sharing the same
  // material share one override state too.
  const [ficheOverride, setFicheOverride] = useState({})
  const [routeVersion, setRouteVersion] = useState(0)
  const [fetchingRoute, setFetchingRoute] = useState(false)
  // Only used to trigger a re-render when a teammate (or this same user, in
  // FicheTechniquePanel to the right) pins a provider location for an
  // unclassified layer — loadFicheDetail() below stays the actual source of
  // truth, same "subscribe to re-render, read local storage for the value"
  // split ficheStorage.js documents and FicheTechniquePanel itself uses.
  const { data: sharedFicheDetails } = useSharedData('sharedData/ficheDetails')

  const disciplines = Object.keys(groupedRows).sort()
  const selectedRow = disciplines
    .flatMap((d) => groupedRows[d])
    .find((r) => r.key === selectedRowKey) ?? null

  function selectRow(row) {
    setSelectedRowKey(row.key)
    setSelectedMaterialId(row.materialId)
    setPreviewSection(row.sections[0] ?? null)
  }

  // Auto-select the first material once data exists, so the left-pane map
  // shows something immediately on open instead of sitting empty until the
  // user clicks a row on the right — same "give a real starting point, not
  // nothing" reasoning as LayerBuilder's defaultLayers seed.
  useEffect(() => {
    if (selectedRowKey != null || disciplines.length === 0) return
    const first = groupedRows[disciplines[0]]?.[0]
    if (first) selectRow(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disciplines.join(','), selectedRowKey])

  if (!hasAnySaved) {
    return (
      <div className="providers-tab">
        <p className="empty-state">
          No sections saved yet — go to Section Configurator, build a wall/roof/floor assembly, and
          click "Save changes" first. This tab reads from those saved sections.
        </p>
      </div>
    )
  }

  const selectedSectionRecord = selectedRow && previewSection ? bySection[previewSection] : null
  // Real area-scaled total (see gwpPerM2.js) — not a naive sum of raw
  // per-declared-unit values, same fix as everywhere else this pattern
  // showed up.
  const previewGeometry = selectedSectionRecord && !UNIT_SECTIONS.has(previewSection)
    ? loadAssemblyGeometry(previewSection)
    : null
  const previewGwp = selectedSectionRecord
    ? gwpTotalForLayers(selectedSectionRecord.layers, allMaterials, previewGeometry?.surfaceAreaM2)
    : null
  const disciplineMates = selectedRow
    ? allMaterials.filter((m) => m.discipline === selectedRow.discipline)
    : []
  const selectedMaterial = selectedMaterialId ? materialById[selectedMaterialId] : null
  const canShowProviderMap = selectedMaterial && disciplineMates.length > 0

  // Same lookup ProviderMap.jsx uses internally — reused here (not
  // reimplemented) so the fiche technique's provider/distance numbers can
  // never drift from what the map itself shows. Safe to call with a null
  // materialId (unclassified layers) — geo.js just returns no candidates.
  const { closestToSite } = useMemo(
    () => findProvidersForMaterial(selectedMaterialId, providers, referenceLocations),
    [selectedMaterialId, routeVersion]
  )

  // Real road route for the currently-matched closest provider, fetched
  // on demand (not automatically — unlike the fiche pin flow, which
  // fetches immediately since a human just took the specific action of
  // pinning a location, this list can auto-match many providers the user
  // never asked to look up a route for, so it stays a deliberate click).
  async function handleGetRealRoute() {
    if (!closestToSite) return
    setFetchingRoute(true)
    try {
      const { site, detmoldFactory } = referenceLocations
      const [toDetmold, toSite] = await Promise.all([
        fetchRoutedDistanceKm(closestToSite, detmoldFactory),
        fetchRoutedDistanceKm(closestToSite, site),
      ])
      saveRouteDistance(closestToSite, detmoldFactory, toDetmold)
      saveRouteDistance(closestToSite, site, toSite)
      setRouteVersion((v) => v + 1)
    } catch (err) {
      window.alert(`Real route lookup failed: ${err.message}`)
    } finally {
      setFetchingRoute(false)
    }
  }

  // A fiche technique needs *something* material-shaped to key its saved
  // fields on and to show as "Category"/product name — for a real material
  // (catalog or custom) that's the material record itself, keyed by
  // material.id (shared by every layer that uses the same material, across
  // every section). For a one-off Ökobaudat pick with no materialId, key on
  // the deduped row's own key instead (its Ökobaudat dataset URL when
  // available) so two sections that picked the exact same Ökobaudat entry
  // share one fiche too, rather than each getting an independent one.
  const ficheMaterial = selectedMaterial ?? (selectedRow
    ? {
        id: selectedRow.key,
        name: selectedRow.name,
        discipline: null,
        category: undefined,
        enNorm: null,
      }
    : null)

  // The fiche technique form exists to research/fill in data for
  // materials that don't already have one — a real provider match
  // (closestToSite) means providers.json already has that data, so the
  // form stays hidden by default. The override lets the team pull it up
  // anyway (e.g. to double-check an auto-match, or add end-of-life notes
  // on an otherwise-complete material).
  const showFiche = ficheMaterial != null && (!closestToSite || !!ficheOverride[selectedRow?.key])

  // For an unclassified (live Ökobaudat search) material, there's no
  // providers.json/MaterialProviderMap to show — but the fiche technique to
  // the right may still have a manually-pinned provider location (see
  // FicheTechniquePanel's updateProviderLocation/acceptProviderInfo). If so,
  // show that same pin here too instead of just explaining why the usual
  // map is empty. loadFicheDetail is a plain synchronous localStorage read
  // (cheap, no memoization needed) — sharedFicheDetails isn't read here
  // directly, but subscribing to it above is what makes this component
  // re-render (and thus re-read localStorage) when a teammate's pin syncs
  // in via Firestore.
  const unclassifiedProviderPin = !selectedMaterial && ficheMaterial
    ? loadFicheDetail(ficheMaterial.id)
    : null

  return (
    <div className="providers-tab-root">
      <MaterialsSummaryTable
        groupedRows={groupedRows}
        rows={dedupedRows}
        materialById={materialById}
        enteredBy={currentUser}
        onImported={refreshData}
      />

      <div className="split-pane providers-split">
        <div className="split-pane-left split-pane-scroll">
          {canShowProviderMap ? (
            <MaterialProviderMap
              materials={disciplineMates}
              selectedMaterialId={selectedMaterialId}
              onSelect={setSelectedMaterialId}
            />
          ) : selectedMaterial ? (
            <p className="empty-state">
              No providers registered for this material's discipline yet — add one to
              database/providers.json, or fill in the provider fields manually on the fiche to the right.
            </p>
          ) : selectedRow && unclassifiedProviderPin?.providerLat != null ? (
            <div className="providers-unclassified-map">
              <FicheMap
                providerLatLng={{ lat: unclassifiedProviderPin.providerLat, lng: unclassifiedProviderPin.providerLng }}
                providerVerified={false}
              />
              <p className="empty-state">
                Provider location pinned via the fiche technique to the right
                {unclassifiedProviderPin.providerName ? ` (${unclassifiedProviderPin.providerName})` : ''} — this
                material isn't in the local material database, so distances/A4 still come from that fiche's own
                fields, not a providers.json match.
              </p>
            </div>
          ) : selectedRow ? (
            <p className="empty-state">
              This material was added via live Ökobaudat search and isn't in the local material
              database, so there's no provider map for it — but the fiche technique to the right still
              works. Fill in the provider fields there manually if you know them (a pinned address will
              show a dot here too), or use "+ Create custom material" in Section Configurator next time
              to get a real catalog entry.
            </p>
          ) : (
            <p className="empty-state">Pick a material on the right to see its provider map.</p>
          )}
        </div>

        <div className="split-pane-right split-pane-scroll">
          <div className="providers-groups">
            {disciplines.map((discipline) => (
              <div key={discipline} className="providers-group">
                <h3>{discipline}</h3>
                <div className="providers-group-list">
                  {groupedRows[discipline].map((row) => (
                    <button
                      key={row.key}
                      className={`providers-layer-row${row.key === selectedRowKey ? ' active' : ''}`}
                      onClick={() => selectRow(row)}
                    >
                      <span className="providers-layer-name">{row.name}</span>
                      <span className="providers-layer-meta">
                        {row.thicknessMM != null ? `${row.thicknessMM}mm · ` : ''}
                        {row.sections.map((s) => (
                          <span key={s} className="section-badge">{s}</span>
                        ))}
                        {row.instanceCount > 1 ? ` · ${row.instanceCount}×` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {selectedRow && (
            <div className="providers-detail">
              <div className="providers-detail-header">
                <h3>{selectedRow.name}</h3>
                <button type="button" onClick={() => setShowSectionPreview((s) => !s)}>
                  {showSectionPreview ? 'Hide section preview' : 'Show section preview'}
                </button>
              </div>

              {showSectionPreview && selectedRow.sections.length > 1 && (
                <div className="providers-preview-picker">
                  Preview section:
                  {selectedRow.sections.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`section-badge${s === previewSection ? ' active' : ''}`}
                      onClick={() => setPreviewSection(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {showSectionPreview && selectedSectionRecord && (
                <SectionPreview
                  section={previewSection.charAt(0).toUpperCase() + previewSection.slice(1)}
                  owner={selectedSectionRecord.owner}
                  savedAt={selectedSectionRecord.savedAt}
                  layers={selectedSectionRecord.layers}
                  {...calculateUValue(selectedSectionRecord.layers, previewSection)}
                  gwpTotal={previewGwp?.total ?? 0}
                  gwpKnownCount={previewGwp?.known.length ?? 0}
                />
              )}

              {closestToSite && (
                <>
                  <label className="fiche-override-toggle">
                    <input
                      type="checkbox"
                      checked={!!ficheOverride[selectedRow.key]}
                      onChange={(e) =>
                        setFicheOverride((prev) => ({ ...prev, [selectedRow.key]: e.target.checked }))
                      }
                    />
                    Research fiche technique anyway (provider already auto-matched to {closestToSite.name})
                  </label>

                  <p className="providers-distance-line">
                    Distance to Detmold: <strong>{closestToSite.distanceToDetmoldKm?.toFixed(1)} km</strong>
                    {closestToSite.distanceToDetmoldKmSource === 'routed' ? (
                      <span className="service-life-badge service-life-badge--verified"> Real road route (OpenRouteService)</span>
                    ) : (
                      <span className="service-life-badge service-life-badge--unverified"> Straight-line estimate</span>
                    )}
                    {' '}— feeds the LCA and EPD tab's A4 transport calc.
                    <button type="button" onClick={handleGetRealRoute} disabled={fetchingRoute}>
                      {fetchingRoute ? 'Fetching route…' : 'Get real route'}
                    </button>
                  </p>
                </>
              )}

              {selectedMaterial && (
                <MaterialCoreValuesEditor
                  material={selectedMaterial}
                  usage={{ instanceCount: selectedRow.instanceCount, sections: selectedRow.sections }}
                  enteredBy={currentUser}
                  onChanged={refreshData}
                />
              )}

              {showFiche && (
                <FicheTechniquePanel material={ficheMaterial} closestToSite={closestToSite} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
