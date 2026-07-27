// Aggregates data already computed elsewhere in the app for the
// Deliverables tab — no new calculation logic, this is assembly and
// formatting only. Pulls from lcaAnalysis.js (A1-A3/A4/B4/normalized),
// assemblyAnalysis.js (U-value), aiFeedbackStorage.js (accepted AI
// Feedback drafts), and epdReferenceList.js (citable sources) — the
// same functions the LCA and EPD / Assembly Analysis Preview tabs
// already use to render their own numbers, so nothing here can drift
// from what's shown elsewhere in the app.
import { ASSEMBLIES, analyzeAssembly } from './assemblyAnalysis.js'
import { analyzeLcaAssembly } from './lcaAnalysis.js'
import { loadAiFeedback } from './aiFeedbackStorage.js'
import { getEpdReferenceList } from './epdReferenceList.js'
import { loadFicheDetail } from './ficheStorage.js'
import { getAllMaterials } from './materialsCatalog.js'
import { loadSection } from './sectionStorage.js'
import { classifyAssemblySustainability } from './sustainabilityRubric.js'
import { roadEstimateKm } from './geo.js'
import providers from '../../database/providers.json'
import referenceLocations from '../../database/reference-locations.json'
import defaultLayersBySection from '../../database/defaultLayers.json'

const SECTIONS = ['wall', 'roof', 'floor', 'door', 'window', 'skylight']

/** One combined summary per in-scope assembly — U-value + full lifecycle numbers + AI feedback, if any. */
export function getAssemblySummaries() {
  return ASSEMBLIES.filter((a) => a.inScope).map((a) => {
    const uValueResult = analyzeAssembly(a.key)
    const lcaResult = analyzeLcaAssembly(a.key)
    const feedback = loadAiFeedback(a.key)
    return {
      key: a.key,
      label: a.label,
      hasData: uValueResult.hasData,
      uValue: uValueResult.uValue ?? null,
      uValueMissing: uValueResult.missingFields ?? [],
      layerCount: uValueResult.layerCount ?? 0,
      layers: uValueResult.layers ?? [],
      a1a3Total: lcaResult.a1a3Total ?? null,
      a1a3KnownCount: lcaResult.a1a3KnownCount ?? 0,
      a4Total: lcaResult.a4Total ?? null,
      a4KnownCount: lcaResult.a4KnownCount ?? 0,
      normalized: lcaResult.normalized ?? null,
      geometry: lcaResult.geometry ?? null,
      // End-of-life methodology per layer (eolSource/eolAssumptionBasis +
      // C1/C3/C4/D) — used by A4ReportDraft.jsx's new methodology note so
      // graders can see EPD-sourced vs. AI-sourced vs. assumed at a
      // glance, not just the resulting numbers.
      layerResults: lcaResult.layerResults ?? [],
      completeCount: uValueResult.completeCount ?? 0,
      totalCount: uValueResult.totalCount ?? 0,
      aiFeedback: feedback?.text ?? null,
      owner: uValueResult.owner ?? null,
      savedAt: uValueResult.savedAt ?? null,
    }
  })
}

/**
 * Every real, checkable source URL currently attached to accepted data —
 * Ökobaudat processes, AI-verified GWP suggestions (both via
 * epdReferenceList.js, already deduplicated there), plus each material's
 * fiche-level AI-researched end-of-life and provider citations. Never a
 * fabricated citation — anything without a real sourceUrl is excluded,
 * not padded with a placeholder.
 */
export function getAllReferences() {
  const refs = []
  const seen = new Set()

  function add(label, url) {
    if (!url || seen.has(url)) return
    seen.add(url)
    refs.push({ label, url })
  }

  for (const entry of getEpdReferenceList()) {
    add(`${entry.material} — GWP A1-A3 (${entry.sourceType})`, entry.sourceUrl)
  }

  const materialById = Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))
  for (const section of SECTIONS) {
    const record = loadSection(section)
    const layers = record?.layers && record.layers.length > 0 ? record.layers : (defaultLayersBySection[section] ?? [])
    for (const layer of layers) {
      if (!layer.materialId) continue
      const fiche = loadFicheDetail(layer.materialId)
      if (!fiche) continue
      add(`${materialById[layer.materialId]?.name ?? layer.name} — end-of-life scenario`, fiche.endOfLifeSource)
      add(`${materialById[layer.materialId]?.name ?? layer.name} — provider`, fiche.providerSource)
    }
  }

  return refs
}

/**
 * One entry per distinct material across all saved layers (deduplicated
 * the same way ProvidersTab.jsx pools them: by material.id for catalog
 * materials, by the layer's own instanceId for one-off Ökobaudat picks
 * with no shared material record) — everything the Deliverables tab's
 * "Fiche technique" section needs to list what exists and whether it's
 * actually been researched yet, without re-deriving that pooling logic
 * a third time.
 */
export function getFicheDeliverables() {
  const materialById = Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))
  const seen = new Set()
  const entries = []

  for (const section of SECTIONS) {
    const record = loadSection(section)
    const layers = record?.layers && record.layers.length > 0 ? record.layers : (defaultLayersBySection[section] ?? [])
    for (const layer of layers) {
      const material = layer.materialId ? materialById[layer.materialId] : null
      const ficheKey = material ? material.id : layer.instanceId
      if (seen.has(ficheKey)) continue
      seen.add(ficheKey)

      const ficheMaterial = material ?? {
        id: layer.instanceId,
        name: layer.name,
        discipline: null,
        category: undefined,
        enNorm: null,
      }
      const detail = loadFicheDetail(ficheMaterial.id)
      const hasData = !!detail && !!(
        detail.germanName || detail.specs || detail.norm || detail.photoDataUrl ||
        detail.endOfLifeScenario || detail.providerName || detail.providerLocation
      )

      entries.push({
        key: ficheKey,
        material: ficheMaterial,
        label: layer.name,
        section,
        hasData,
      })
    }
  }

  return entries
}

/**
 * getFicheDeliverables() grouped by discipline (Cladding/Sheathing/
 * Insulation/Membrane/Finishing/Framing/...) with the actual fiche detail
 * merged in — the "Material research by discipline" section of the A4
 * report needs the real researched content (German name, specs, norm,
 * end-of-life scenario + source, provider), not just "has it been
 * researched yet" the Deliverables tab's own checklist needs. Same
 * pooling (one row per distinct material, not per layer instance) — a
 * material used 3x in one assembly or shared across assemblies (e.g.
 * Kronoply OSB) still gets exactly one row here.
 */
export function getMaterialResearchByDiscipline() {
  const entries = getFicheDeliverables()
  const groups = new Map()

  for (const entry of entries) {
    const discipline = entry.material.discipline || 'Other'
    const detail = loadFicheDetail(entry.key) ?? {}
    const row = {
      key: entry.key,
      name: entry.label,
      section: entry.section,
      germanName: detail.germanName || null,
      specs: detail.specs || null,
      norm: detail.norm || entry.material.enNorm || null,
      endOfLifeScenario: detail.endOfLifeScenario || null,
      endOfLifeSource: detail.endOfLifeSource || null,
      providerName: detail.providerName || null,
      hasPhoto: !!detail.photoDataUrl,
    }
    if (!groups.has(discipline)) groups.set(discipline, [])
    groups.get(discipline).push(row)
  }

  return Array.from(groups.entries())
    .map(([discipline, rows]) => ({ discipline, rows }))
    .sort((a, b) => a.discipline.localeCompare(b.discipline))
}

/**
 * Whole-building rollup for the "Global LCA" report section — sums each
 * in-scope assembly's own already-computed A1-A3/A4/B4 totals (never
 * re-derives a single number) and applies the same sustainability rubric
 * used per-assembly (sustainabilityRubric.js) to the aggregate, so the
 * building-level verdict is reached the identical way each assembly's own
 * verdict is, not a separately invented scale.
 */
export function getGlobalLcaSummary() {
  const summaries = getAssemblySummaries()
  const withData = summaries.filter((s) => s.hasData)

  const a1a3Known = withData.filter((s) => s.a1a3KnownCount > 0)
  const a1a3Total = a1a3Known.length > 0 ? a1a3Known.reduce((sum, s) => sum + s.a1a3Total, 0) : null

  const a4Known = withData.filter((s) => s.a4KnownCount > 0)
  const a4Total = a4Known.length > 0 ? a4Known.reduce((sum, s) => sum + s.a4Total, 0) : null

  // B4 (replacement) — same "only if every layer has one" rule
  // A4ReportDraft.jsx's own b4Total() already uses per assembly.
  function assemblyB4(summary) {
    const results = summary.layerResults ?? []
    if (results.length === 0 || !results.every((l) => l.b4 != null)) return null
    return results.reduce((sum, l) => sum + l.b4, 0)
  }
  const b4PerAssembly = withData.map((s) => ({ key: s.key, b4: assemblyB4(s) })).filter((r) => r.b4 != null)
  const b4Total = b4PerAssembly.length > 0 ? b4PerAssembly.reduce((sum, r) => sum + r.b4, 0) : null

  // C&D — per-layer C1/C3/C4/D across every assembly, only where present
  // (never fabricated for a layer that hasn't been researched).
  const cdRows = withData.flatMap((s) => s.layerResults ?? [])
  const c1Total = cdRows.some((l) => l.c1 != null) ? cdRows.reduce((sum, l) => sum + (l.c1 ?? 0), 0) : null
  const c3Total = cdRows.some((l) => l.c3 != null) ? cdRows.reduce((sum, l) => sum + (l.c3 ?? 0), 0) : null
  const c4Total = cdRows.some((l) => l.c4 != null) ? cdRows.reduce((sum, l) => sum + (l.c4 ?? 0), 0) : null
  const moduleDTotal = cdRows.some((l) => l.moduleD != null) ? cdRows.reduce((sum, l) => sum + (l.moduleD ?? 0), 0) : null

  const perAssembly = withData.map((s) => ({
    key: s.key,
    label: s.label,
    uValue: s.uValue,
    a1a3Total: s.a1a3KnownCount > 0 ? s.a1a3Total : null,
    a4Total: s.a4KnownCount > 0 ? s.a4Total : null,
    normalized: s.normalized,
    sustainability: classifyAssemblySustainability(s.key, s.uValue, s.normalized),
    owner: s.owner,
  }))

  return {
    assessedAssemblyCount: withData.length,
    totalAssemblyCount: summaries.length,
    a1a3Total, a4Total, b4Total, c1Total, c3Total, c4Total, moduleDTotal,
    perAssembly,
  }
}

/**
 * Road-route-estimate-to-site concentration stats for the "Global EPD"
 * report section (haversine × 1.2 circuity factor, see geo.js) — same
 * computation GlobalProviderMap.jsx renders as a map, exposed here as
 * plain data so the DOCX/PDF report can present it as a real table
 * instead of a screenshot of the map.
 */
export function getGlobalProviderStats() {
  const { site } = referenceLocations
  const active = providers
    .filter((p) => p.materialIds?.length > 0 && p.lat != null && p.lng != null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      materialIds: p.materialIds,
      distanceToSiteKm: roadEstimateKm({ lat: p.lat, lng: p.lng }, site),
    }))
    .sort((a, b) => a.distanceToSiteKm - b.distanceToSiteKm)

  const within500 = active.filter((p) => p.distanceToSiteKm <= 500).length
  const within1000 = active.filter((p) => p.distanceToSiteKm <= 1000).length
  const avgKm = active.length > 0 ? active.reduce((sum, p) => sum + p.distanceToSiteKm, 0) / active.length : null

  return { providers: active, count: active.length, within500, within1000, avgKm }
}
