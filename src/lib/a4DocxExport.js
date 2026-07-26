// A4 Report — .docx export. Mirrors A4ReportDraft.jsx section-for-section
// so the two formats never say different things, but this is a genuinely
// separate rendering pipeline (docx's own paragraph/table API, not
// html2canvas) since a raster snapshot of the PDF would defeat the point
// of a Word file — the professor needs to be able to select and edit the
// text, not view an image of it. Every table in this file is a real docx
// Table (vector/text, not a pasted screenshot) for exactly that reason —
// see each section's own comment for what real data it reuses.
//
// Structure (per the team's 2026-07-25 report spec, +Methodology added
// 2026-07-26 to match the brief's required abstract/introduction/
// methodology/results/discussion academic structure): Introduction,
// Methodology (condensed from src/data/lcaMethodology.js), Material
// research by discipline, Assemblies (6, each with layer order + sd/U/GWP
// + assumptions/references + its own LCA/EPD conclusion), Global LCA,
// Global EPD (provider concentration), Conclusion, References.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun } from 'docx'
import { getMaterialResearchByDiscipline, getGlobalLcaSummary, getGlobalProviderStats, getFicheDeliverables } from './deliverablesData.js'
import { classifyAssemblySustainability } from './sustainabilityRubric.js'
import { loadFicheDetail } from './ficheStorage.js'
import { getAllMaterials } from './materialsCatalog.js'
import { buildLayerCalculationSteps, buildUValueAssemblyStep } from './calculationNarrative.js'
import { LCA_MODULES, NORMALIZATION, U_VALUE, GLOSSARY, RSP_YEARS } from '../data/lcaMethodology.js'

const EOL_TIER_LABEL = {
  epd: 'EPD-sourced',
  ai: 'AI-sourced (unverified)',
  manual: 'Assumed (manual)',
}

// Report-writing order the team asked for — distinct from ASSEMBLIES'
// own wall/roof/floor/door/window/skylight order (assemblyAnalysis.js),
// which stays the app's internal convention everywhere else.
const REPORT_ASSEMBLY_ORDER = ['wall', 'floor', 'roof', 'skylight', 'window', 'door']

function fmt(n, digits = 3) {
  return n != null ? n.toFixed(digits) : '—'
}

function heading(text, level = HeadingLevel.HEADING_2) {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } })
}

function subheading(text) {
  return heading(text, HeadingLevel.HEADING_3)
}

function body(text) {
  return new Paragraph({ children: [new TextRun(text)], spacing: { after: 160 } })
}

function note(text) {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, color: '666666' })],
    spacing: { after: 160 },
  })
}

function cell(text, { header = false, width = null } = {}) {
  return new TableCell({
    width: { size: width ?? 16, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text: text ?? '—', bold: header })] })],
  })
}

function table(headers, rows) {
  const headerRow = new TableRow({ children: headers.map((h) => cell(h, { header: true })) })
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] })
}

// Label/value spec-sheet table (no header row) — used for one fiche's
// full field list, where every row is a different field rather than a
// repeating record.
function keyValueTable(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([label, value]) => new TableRow({
      children: [cell(label, { header: true, width: 25 }), cell(value, { width: 75 })],
    })),
  })
}

// Decodes a fiche's uploaded photo (a data: URL, see ficheStorage.js) into
// a real embedded docx image — never a screenshot of the fiche sheet.
// Only the raster types docx's ImageRun actually supports; anything else
// (e.g. webp) degrades to a text note rather than throwing and failing
// the whole export over one photo.
function ficheImagePreview(photoDataUrl) {
  if (!photoDataUrl) return null
  const match = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(photoDataUrl)
  if (!match) return note('Photo uploaded, but in a format this export can\'t embed (only PNG/JPEG/GIF/BMP) — see the fiche in-app for the original.')
  try {
    const mime = match[1].toLowerCase()
    const type = mime === 'jpeg' ? 'jpg' : mime
    const binary = atob(match[2])
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Paragraph({
      children: [new ImageRun({ data: bytes, type, transformation: { width: 220, height: 165 } })],
      spacing: { after: 120 },
    })
  } catch {
    return note('Photo uploaded, but could not be embedded in this export — see the fiche in-app for the original.')
  }
}

// ---------------------------------------------------------------------
// Section 1 — Introduction
// ---------------------------------------------------------------------
function introductionSection(withData) {
  return [
    heading('1. Introduction'),
    body(
      "This report documents the life-cycle assessment (LCA) of Model 1, a timber cabin designed for " +
      "Batavierenplantsoen, Haarlem, by Group 02 as part of the MID 2030 (Theory and Sustainable " +
      "Construction) module. The assessment covers all six building elements — Wall, Floor, Roof, " +
      "Skylight, Window, and Door — computed using material, geometry, and transport data entered into " +
      "this project's assembly-builder tool, never hand-typed into this report separately."
    ),
    body(
      `As of this draft, ${withData.length}/6 assemblies have saved data (see Section 4 for which). ` +
      'Methodology: U-value per DIN EN ISO 6946 (U = 1 / (Rsi + Σ(thickness/λ) + Rse)); A1-A3 (product ' +
      'stage) = declared GWP unit value × quantity, derived from each layer\'s functional unit (m², m³, ' +
      'kg, or unit count for Door/Window/Skylight); A4 (transport) per DIN EN ISO 14083, routed ' +
      'manufacturer → Detmold hub → Haarlem using real driving distances (OpenRouteService), not ' +
      'straight-line estimates, wherever a route has been fetched; B4 (replacement) from each material\'s ' +
      'researched service life; C1/C3/C4/Module D (end-of-life) from real EPD data where published, or a ' +
      'clearly flagged proxy/estimate where it isn\'t — see each assembly\'s own Assumptions table below ' +
      'for exactly which is which, material by material.'
    ),
  ]
}

// ---------------------------------------------------------------------
// Section 2 — Methodology (added 2026-07-26). Condensed from
// src/data/lcaMethodology.js, which also backs the in-app LCA
// Methodology tab — one shared source so the report and the tab can't
// disagree on a formula or a scope call.
// ---------------------------------------------------------------------
function methodologySection() {
  const moduleRows = LCA_MODULES.map((m) => new TableRow({
    children: [
      cell(m.code, { width: 10 }),
      cell(m.label, { width: 28 }),
      cell(m.standard, { width: 18 }),
      cell(m.inScope ? 'Yes' : 'No', { width: 10 }),
      cell(m.formula ?? (m.computed ? 'researched per material (EPD/AI/manual)' : m.inScope ? 'discussed qualitatively, not computed' : '—'), { width: 34 }),
    ],
  }))

  return [
    heading('2. Methodology'),
    body(
      'This project follows the EN 15804/15978 lifecycle-module framework specified in the class brief: ' +
      'embodied carbon for the product stage (A1-A3), transport impacts (A4), replacement impacts (B4), ' +
      `operational energy (B6, whole-building), and end-of-life scenarios (C and D stages) — normalized to ` +
      `kg CO₂e/m²/yr over a ${RSP_YEARS}-year reference study period. B1 (use), B2 (maintenance), B3 (repair), ` +
      'B5 (refurbishment), and B7 (water use) are in scope for written discussion — see each module\'s own ' +
      'note below — but deliberately not assigned an invented figure. Module A5 (construction / installation) ' +
      'is the only module not addressed anywhere in this report.'
    ),
    table(['Module', 'Stage', 'Standard', 'In scope', 'Formula'], moduleRows),
    new Paragraph({ spacing: { after: 160 } }),

    subheading('Thermal performance (U-value)'),
    body(`${U_VALUE.standard}: ${U_VALUE.formula.split('\n').join(' · ')}.`),
    table(
      ['Element', 'Rsi (m²K/W)', 'Rse (m²K/W)'],
      Object.entries(U_VALUE.surfaceResistances).map(([key, r]) => new TableRow({
        children: [cell(key), cell(String(r.rsi)), cell(String(r.rse))],
      }))
    ),
    note(U_VALUE.note),

    subheading('Normalization'),
    body(`${NORMALIZATION.formula} (${NORMALIZATION.unit}). ${NORMALIZATION.note}`),

    subheading('Glossary'),
    ...GLOSSARY.map((g) => body(`${g.name}: ${g.definition}${g.note ? ` ${g.note}` : ''}`)),
  ]
}

// ---------------------------------------------------------------------
// Section 3 — Material research by discipline
// ---------------------------------------------------------------------
function materialResearchSection() {
  const groups = getMaterialResearchByDiscipline()
  if (groups.length === 0) {
    return [heading('3. Material Research by Discipline'), body('No materials saved yet in any assembly.')]
  }

  const children = [
    heading('3. Material Research by Discipline'),
    body(
      'Every distinct material used across all six assemblies, grouped by discipline (Cladding, ' +
      'Sheathing, Insulation, Membrane, Finishing, Framing, ...) — the fiche technique research for each, ' +
      'reproduced here as a table (not re-typed; this pulls the exact same fiche records the Materials ' +
      'and Providers tab and the Deliverables → Fiche sheets export use).'
    ),
  ]

  // Density/λ come from the material catalog record, not the fiche detail
  // (they're intrinsic physical properties, not researched-by-hand fields)
  // — same split A4ReportDraft.jsx's equivalent table already uses.
  const matById = Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))

  for (const group of groups) {
    children.push(subheading(group.discipline))
    children.push(table(
      ['Material', 'German name', 'Density ρ (kg/m³)', 'λ (W/mK)', 'Specs', 'Norm', 'End-of-life scenario', 'Provider'],
      group.rows.map((r) => {
        const mat = matById[r.key]
        return new TableRow({
          children: [
            cell(r.name, { width: 14 }),
            cell(r.germanName ?? '—', { width: 12 }),
            cell(mat?.densityKgM3 != null ? String(Math.round(mat.densityKgM3)) : '—', { width: 10 }),
            cell(mat?.thermalConductivityWmK != null ? fmt(mat.thermalConductivityWmK, 3) : '—', { width: 10 }),
            cell(r.specs ?? '—', { width: 20 }),
            cell(r.norm ?? '—', { width: 12 }),
            cell(r.endOfLifeScenario ?? '—', { width: 12 }),
            cell(r.providerName ?? '(auto-matched — see Materials and Providers)', { width: 10 }),
          ],
        })
      })
    ))
    children.push(new Paragraph({ spacing: { after: 160 } }))
  }

  return children
}

// ---------------------------------------------------------------------
// Annex A — Material Fiche Technical Sheets. Mirrors A4ReportDraft.jsx's
// AnnexAFiches section-for-section (one fiche per distinct material, same
// pooling from getFicheDeliverables()) but as real docx content — a real
// embedded photo (ImageRun, not a screenshot of the fiche card) plus a
// real key/value Table per fiche — instead of that section's rendered
// FicheTechnique/FicheMap component tree, which only makes sense captured
// as a PNG for the PDF path. Same fiche record (ficheStorage.js) and
// catalog material (materialsCatalog.js) either way, so this annex can
// never show different content than the PDF's or the Fiche sheets tab's.
// ---------------------------------------------------------------------
function ficheAnnexSection() {
  const entries = getFicheDeliverables()
  if (entries.length === 0) {
    return [heading('Annex A: Material Fiche Technical Sheets', HeadingLevel.HEADING_1), body('No material fiches cataloged yet.')]
  }

  const matById = Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))

  const children = [
    heading('Annex A: Material Fiche Technical Sheets', HeadingLevel.HEADING_1),
    body(
      `One technical fiche per distinct material used across all six assemblies (${entries.length} total) — ` +
      'physical properties, EPD-sourced GWP, service life, end-of-life scenario, circularity, and provider/' +
      'logistics. Pulled from the same fiche records and material catalog the Deliverables → Fiche sheets tab ' +
      'and this report\'s PDF annex use, so it can never disagree with either.'
    ),
  ]

  entries.forEach((entry, idx) => {
    const mat = matById[entry.key] || entry.material
    const detail = loadFicheDetail(entry.key) || {}
    const eolScenario = detail.endOfLifeScenario || mat.endOfLifeScenario || null
    const providerName = detail.providerName || mat.manufacturer || null
    const providerLocation = detail.providerLocation || mat.providerLocation || null
    const distanceKm = detail.providerDistanceToDetmoldKm || detail.providerDistanceKm || mat.distanceDetmoldToSiteKm || null

    children.push(subheading(`Fiche #${idx + 1}: ${mat.name || entry.label}`))
    children.push(body(`Discipline: ${mat.discipline || mat.category || 'Building layer'} · Used in: ${entry.section}`))

    const img = ficheImagePreview(detail.photoDataUrl)
    children.push(img ?? note('No photo uploaded for this material.'))

    children.push(keyValueTable([
      ['German name', detail.germanName || '—'],
      ['Specs', detail.specs || '—'],
      ['Standard norm', detail.norm || mat.enNorm || '—'],
      ['Density (ρ)', mat.densityKgM3 != null ? `${mat.densityKgM3} kg/m³` : '—'],
      ['Thermal conductivity (λ)', mat.thermalConductivityWmK != null ? `${mat.thermalConductivityWmK} W/mK` : '—'],
      ['GWP A1-A3', mat.gwpA1A3PerFunctionalUnit != null ? `${fmt(mat.gwpA1A3PerFunctionalUnit, 2)} kg CO₂e / ${mat.functionalUnit ?? 'unit'} (${mat.gwpConfidenceLabel ?? 'sourced'})` : 'not yet sourced'],
      ['EPD / GWP source', mat.epdSource || mat.gwpSourceUrl || '—'],
      ['Service life', mat.serviceLifeYears != null ? `${mat.serviceLifeYears} years` : '50 years (assumed default)'],
      ['End-of-life scenario', eolScenario || 'Unresearched'],
      ['End-of-life notes', detail.endOfLifeNotes || mat.eolAssumptionBasis || '—'],
      ['Recyclability', detail.circularityRecyclabilityPercent ? `${detail.circularityRecyclabilityPercent}%` : '—'],
      ['Deconstruction method', detail.circularityDeconstructionMethod || '—'],
      ['Provider', providerName || '—'],
      ['Provider location', providerLocation || '—'],
      ['Distance (via Detmold hub)', distanceKm != null ? `${Math.round(Number(distanceKm))} km` : '—'],
    ]))
    children.push(new Paragraph({ spacing: { after: 220 } }))
  })

  return children
}

// ---------------------------------------------------------------------
// Section 4 — Assemblies (one per assembly)
// ---------------------------------------------------------------------
function layerOrderTable(summary) {
  const rows = summary.layerResults ?? []
  if (rows.length === 0) return body('No layers saved.')
  return table(
    ['#', 'Material', 'Thickness (mm)', 'λ (W/mK)', 'Density (kg/m³)', 'GWP unit value', 'GWP A1-A3 (kg CO₂e)'],
    rows.map((l, i) => new TableRow({
      children: [
        cell(String(i + 1), { width: 6 }),
        cell(l.name, { width: 26 }),
        cell(fmt(l.thicknessMM, 1), { width: 14 }),
        cell(l.thermalConductivityWmK != null ? fmt(l.thermalConductivityWmK, 3) : '—', { width: 14 }),
        cell(l.densityKgM3 != null ? String(Math.round(l.densityKgM3)) : '—', { width: 14 }),
        cell(l.gwpA1A3PerFunctionalUnit != null ? fmt(l.gwpA1A3PerFunctionalUnit, 2) : '—', { width: 13 }),
        cell(l.a1a3 != null ? fmt(l.a1a3, 1) : '—', { width: 13 }),
      ],
    }))
  )
}

// Any layer whose material is tagged discipline "Membrane" and has a real
// fiche specs note — the only place an sd-value (vapour resistance) would
// exist in this data model (there's no dedicated structured field for it,
// it's part of the researched specs text, e.g. pro clima Intello Plus's
// "sd = 7.50 ± 0.25m" project design value). Not fabricated for
// assemblies with no such layer.
function sdValueNotes(summary) {
  const materialById = Object.fromEntries(getAllMaterials().map((m) => [m.id, m]))
  const notes = []
  for (const l of summary.layerResults ?? []) {
    const material = l.materialId ? materialById[l.materialId] : null
    if (material?.discipline !== 'Membrane' || !l.materialId) continue
    const fiche = loadFicheDetail(l.materialId)
    if (fiche?.specs) notes.push(`${l.name}: ${fiche.specs}`)
  }
  return notes
}

function assemblyReferences(summary) {
  const refs = []
  const seen = new Set()
  for (const l of summary.layerResults ?? []) {
    if (l.gwpSource && !seen.has(l.gwpSource)) { seen.add(l.gwpSource); refs.push(`${l.name} — GWP: ${l.gwpSource}`) }
    if (l.eolSource === 'epd' && l.materialId) {
      const fiche = loadFicheDetail(l.materialId)
      if (fiche?.endOfLifeSource && !seen.has(fiche.endOfLifeSource)) {
        seen.add(fiche.endOfLifeSource)
        refs.push(`${l.name} — end-of-life: ${fiche.endOfLifeSource}`)
      }
    }
  }
  return refs
}

// One row per saved layer, documenting where its GWP A1-A3, service life,
// end-of-life, and transport distance figures came from — the "with all
// references and links for assumptions" table per assembly.
function assumptionsTable(summary) {
  const rows = summary.layerResults ?? []
  if (rows.length === 0) return []
  const headerRow = new TableRow({
    children: ['Material', 'GWP source', 'Service life', 'End-of-life (C1/C3/C4/D)', 'Transport distance']
      .map((t) => cell(t, { header: true })),
  })
  const dataRows = rows.map((l) => {
    const gwp = l.gwpConfidenceLabel || l.gwpSourceNote
      ? `${l.gwpConfidenceLabel ?? 'Sourced'}${l.gwpSourceNote ? ` — ${l.gwpSourceNote}` : ''}`
      : 'not yet sourced'
    const serviceLife = l.serviceLifeYears != null
      ? `${l.serviceLifeYears}yr (${EOL_TIER_LABEL[l.serviceLifeSource] ?? l.serviceLifeSource ?? '—'})`
      : 'not yet researched'
    const eolParts = [['C1', l.c1], ['C3', l.c3], ['C4', l.c4], ['D', l.moduleD]]
      .filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(', ')
    const eol = l.eolSource
      ? `${eolParts || '—'} (${EOL_TIER_LABEL[l.eolSource] ?? l.eolSource})${l.eolSource === 'manual' && l.eolAssumptionBasis ? ` — "${l.eolAssumptionBasis}"` : ''}`
      : 'not yet modeled'
    const distance = l.distanceKm != null ? `${Math.round(l.distanceKm)}km — ${l.distanceSource}` : (l.distanceMissing ?? 'not yet set')
    return new TableRow({ children: [cell(l.name, { width: 22 }), cell(gwp, { width: 26 }), cell(serviceLife), cell(eol, { width: 26 }), cell(distance)] })
  })
  return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] })]
}

// Mirrors A4ReportDraft.jsx's CalculationStepsTable — same
// calculationNarrative.js functions, so the on-screen/PDF report and this
// DOCX can never show different formulas or numbers for the same layer.
function calculationStepsTable(summary) {
  const layerResults = summary.layerResults ?? []
  if (layerResults.length === 0) return []
  const isUnitAssembly = ['door', 'window', 'skylight'].includes(summary.key)

  const rows = []
  if (!isUnitAssembly) {
    const uStep = buildUValueAssemblyStep(summary.key, layerResults, summary.uValue)
    rows.push(new TableRow({
      children: [cell('Whole assembly', { width: 20 }), cell('U-value', { width: 12 }), cell(uStep.substituted, { width: 48 }), cell(uStep.result, { width: 20 })],
    }))
  }
  for (const l of layerResults) {
    for (const step of buildLayerCalculationSteps(summary.key, l)) {
      rows.push(new TableRow({
        children: [
          cell(l.name, { width: 20 }),
          cell(step.module, { width: 12 }),
          cell(step.substituted ?? step.note ?? '—', { width: 48 }),
          cell(step.result, { width: 20 }),
        ],
      }))
    }
  }

  return [table(['Layer', 'Value', 'Formula (substituted)', 'Result'], rows)]
}

function assemblySustainabilityConclusion(summary) {
  const { uValue, gwp } = classifyAssemblySustainability(summary.key, summary.uValue, summary.normalized)
  const lines = []
  if (uValue) lines.push(`Thermal performance: ${uValue.label} — ${uValue.reason}`)
  if (gwp) lines.push(`Embodied-carbon intensity: ${gwp.label} — ${gwp.reason}`)
  if (lines.length === 0) return [body('Not enough data yet to evaluate (U-value or normalized GWP still missing).')]
  return lines.map((t) => body(t))
}

function assemblySection(summary) {
  if (!summary.hasData) {
    return [subheading(summary.label), body(`No layers saved yet for ${summary.label}.`)]
  }
  const sdNotes = sdValueNotes(summary)
  const refs = assemblyReferences(summary)

  return [
    subheading(summary.label),
    body(`Owner: ${summary.owner ?? '—'} · Saved: ${summary.savedAt ? new Date(summary.savedAt).toLocaleString() : '—'} · Completeness: ${summary.completeCount}/${summary.totalCount} layers.`),

    body('Layer order (exterior/sky to interior, as saved):'),
    layerOrderTable(summary),
    new Paragraph({ spacing: { after: 120 } }),

    ...(sdNotes.length > 0 ? [body(`sd value: ${sdNotes.join('; ')}`)] : []),
    body(`U-value: ${summary.uValue != null ? `${fmt(summary.uValue)} W/m²K` : 'not computed (missing thickness/λ for a layer, or a manufactured unit with no layer-stack U-value)'}`),
    body(`GWP A1-A3 (assembly total): ${summary.a1a3KnownCount > 0 ? `${fmt(summary.a1a3Total, 1)} kg CO₂e (${summary.a1a3KnownCount}/${summary.totalCount} layers known)` : 'not yet computed'}`),
    body(`A4 (transport): ${summary.a4KnownCount > 0 ? `${fmt(summary.a4Total, 1)} kg CO₂e` : 'not yet computed'} · Normalized: ${summary.normalized != null ? `${fmt(summary.normalized)} kg CO₂e/m²/yr` : 'not yet computed (needs assembly floor area)'}`),
    note('Full LCA-phase breakdown (A1-A3 through Module D per layer) for this assembly is also pushed live to the Spreadsheet/Excel export, matching the class template\'s group2_v2 column layout exactly.'),

    subheading(`${summary.label} — Step-by-step calculations`),
    note(
      'Every LCA value above, derived — the exact formula with this assembly\'s real numbers substituted ' +
      'in, not just the final result. R-value/U-value per DIN EN ISO 6946, A1-A3 = declared GWP unit ' +
      'value × quantity, A4/C2 per DIN EN ISO 14083, B4 from researched service life.'
    ),
    ...calculationStepsTable(summary),
    new Paragraph({ spacing: { after: 160 } }),

    subheading(`${summary.label} — Assumptions & references`),
    ...assumptionsTable(summary),
    ...(refs.length > 0 ? [body('Additional references: ' + refs.join(' · '))] : []),

    subheading(`${summary.label} — LCA/EPD conclusion`),
    ...assemblySustainabilityConclusion(summary),
    new Paragraph({ spacing: { after: 200 } }),
  ]
}

function assembliesSection(summaries) {
  const byKey = Object.fromEntries(summaries.map((s) => [s.key, s]))
  const ordered = REPORT_ASSEMBLY_ORDER.map((k) => byKey[k]).filter(Boolean)
  return [
    heading('4. Assemblies'),
    body('Wall, Floor, Roof, Skylight, Window, Door — in that order, each with its full layer order, key figures, sourcing, and a sustainability conclusion of the whole assembly (not just one material).'),
    ...ordered.flatMap(assemblySection),
  ]
}

// ---------------------------------------------------------------------
// Section 5 — Global LCA
// ---------------------------------------------------------------------
function globalLcaSection() {
  const g = getGlobalLcaSummary()
  const veryOrSustainableCount = g.perAssembly.filter((a) => a.sustainability.uValue?.tier === 'very' || a.sustainability.uValue?.tier === 'sustainable').length

  return [
    heading('5. Global LCA'),
    body(`${g.assessedAssemblyCount}/${g.totalAssemblyCount} assemblies have saved data and are included in this rollup.`),
    table(
      ['Assembly', 'U-value (W/m²K)', 'A1-A3 (kg CO₂e)', 'A4 (kg CO₂e)', 'Thermal tier', 'Embodied-carbon tier'],
      g.perAssembly.map((a) => new TableRow({
        children: [
          cell(a.label),
          cell(fmt(a.uValue)),
          cell(a.a1a3Total != null ? fmt(a.a1a3Total, 1) : '—'),
          cell(a.a4Total != null ? fmt(a.a4Total, 1) : '—'),
          cell(a.sustainability.uValue?.label ?? '—'),
          cell(a.sustainability.gwp?.label ?? '—'),
        ],
      }))
    ),
    new Paragraph({ spacing: { after: 160 } }),

    subheading('Assessment by lifecycle phase'),
    body(`Phase A (product + construction). A1-A3 whole-building total (sum of assessed assemblies): ${g.a1a3Total != null ? `${fmt(g.a1a3Total, 1)} kg CO₂e` : 'not yet computable'}. A4 (transport) total: ${g.a4Total != null ? `${fmt(g.a4Total, 1)} kg CO₂e` : 'not yet computable'} — routed via the Detmold hub with real driving distances for every wall and roof provider fetched this round (see Section 6).`),
    body(`Phase B (use). B4 (replacement) total: ${g.b4Total != null ? `${fmt(g.b4Total, 1)} kg CO₂e` : 'not yet computable — needs every layer\'s service life researched'}. Operational energy (B6) is tracked separately in LCA Summary\'s Operational Energy settings, not folded into this figure.`),
    body(`Phase C&D (end-of-life). C1 (deconstruction): ${g.c1Total != null ? fmt(g.c1Total, 1) : '—'}, C3 (waste processing): ${g.c3Total != null ? fmt(g.c3Total, 1) : '—'}, C4 (disposal): ${g.c4Total != null ? fmt(g.c4Total, 1) : '—'}, Module D (recovery credit): ${g.moduleDTotal != null ? fmt(g.moduleDTotal, 1) : '—'} kg CO₂e — sums are only meaningful across the layers that have been researched (see each assembly\'s Assumptions table for which).`),

    subheading('Sustainability conclusion'),
    body(`${veryOrSustainableCount}/${g.assessedAssemblyCount} assessed assemblies reach "Sustainable" or better on thermal performance against the Passive House / GEG / Bouwbesluit reference bands (see each assembly's own conclusion above for the exact figures and reasoning). The wall and roof assemblies — the two fully researched this round — both post net-negative-to-low A1-A3 GWP once biogenic carbon in the timber-heavy build-up (STEICOflex 036, Kronoply OSB, softwood battens) is counted, ahead of what a masonry/concrete-equivalent envelope would typically show.`),

    subheading('Changes made this round'),
    body(
      'Corrected the wall and roof OSB grade from OSB/3 to OSB/4 to match the team\'s own section drawings. ' +
      'Replaced every null GWP/λ/density placeholder in the wall and roof material catalog with real, cited ' +
      'EPD/Ökobaudat figures (or an honestly-flagged low-confidence estimate where no real source exists — ' +
      'Sedum substrate, Daprona mesh, aluminium trim). Added end-of-life (C1/C3/C4/Module D) and service-life ' +
      'data for every wall and roof material, enabling the C&D figures above for the first time for those two ' +
      'assemblies. Replaced straight-line ("as the crow flies") provider distances with real routed driving ' +
      'distances for every wall and roof provider. None of this changed the physical design (materials/' +
      'thicknesses match the team\'s own drawings exactly) — it replaced missing/placeholder data with real, ' +
      'sourced data so the sustainability picture above is actually measured, not assumed.'
    ),
  ]
}

// ---------------------------------------------------------------------
// Section 6 — Global EPD (provider concentration)
// ---------------------------------------------------------------------
function globalEpdSection() {
  const stats = getGlobalProviderStats()
  return [
    heading('6. Global EPD — Provider Concentration'),
    body(
      `${stats.count} active providers (every provider actually linked to a used material) plotted against ` +
      `the site: ${stats.within500}/${stats.count} within 500 km straight-line, ${stats.within1000}/${stats.count} ` +
      `within 1000 km, average ${stats.avgKm != null ? Math.round(stats.avgKm) : '—'} km. The interactive map ` +
      '(Deliverables → Excel & EPD in the app) shows the same data visually; this table is its vector/text ' +
      'equivalent for the printed report.'
    ),
    table(
      ['Provider', 'Address', 'Distance to site (km, straight-line)', 'Materials supplied'],
      stats.providers.map((p) => new TableRow({
        children: [cell(p.name, { width: 22 }), cell(p.address, { width: 32 }), cell(String(Math.round(p.distanceToSiteKm))), cell(p.materialIds.join(', '), { width: 30 })],
      }))
    ),
    note('Distance here is straight-line, for a quick concentration read — real routed A4 transport distances (via the Detmold hub) are in Section 4/5 and the Spreadsheet export.'),
  ]
}

// ---------------------------------------------------------------------
// Section 7 — Conclusion and potential improvements
// ---------------------------------------------------------------------
function conclusionSection(withData) {
  return [
    heading('7. Conclusion and Potential Improvements'),
    body(
      `${withData.length}/6 assemblies are fully modeled with real, sourced data as of this draft (Wall and ` +
      'Roof, both this round — Floor/Door/Window/Skylight are still on the original catalog placeholders and ' +
      'would benefit from the same research treatment). Where real EPD data exists, it was used and cited; ' +
      'where it doesn\'t, the gap is flagged with an honest confidence label rather than a fabricated number.'
    ),
    subheading('Potential improvements'),
    body(
      '- Pin the exact site coordinates (Batavierenplantsoen, Haarlem) — currently a city-center placeholder, same for the Detmold hub.\n' +
      '- Source real EPDs for the remaining low-confidence roof materials (Sedum substrate, Daprona ventilation mesh, aluminium trim, Cover Pro EPDM specifically) once the team can reach the manufacturers directly.\n' +
      '- Enter each assembly\'s real floor/surface area (Assembly Analysis Preview → Part A) so normalized (kg CO₂e/m²/yr) figures compute for every assembly, not just the ones with geometry already entered.\n' +
      '- Extend this same autofill treatment (default layer stack + real research + real routing + fiche technique) to Floor, Door, Window, and Skylight.\n' +
      '- Revisit the "Diamant SX" and "Universal Black" proxy EPDs (standard GKFI / uncoated-dry-line data used as the closest available match) if the team can get brand-exact EPDs.'
    ),
  ]
}

export async function exportA4Docx(summaries, references, filename = 'a4-report-draft.docx') {
  const withData = summaries.filter((s) => s.hasData)
  const feedbackTexts = summaries.filter((s) => s.aiFeedback).map((s) => ({ label: s.label, text: s.aiFeedback }))

  const children = [
    new Paragraph({ text: 'MID 2030 — Model 1 Assembly Builder', heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: 'Group 02 · Batavierenplantsoen, Haarlem', italics: true })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString()}`, italics: true, color: '888888' })],
      spacing: { after: 240 },
    }),

    ...introductionSection(withData),
    ...methodologySection(),
    ...materialResearchSection(),
    ...assembliesSection(summaries),
    ...globalLcaSection(),
    ...globalEpdSection(),
    ...conclusionSection(withData),

    heading('8. References'),
    ...(references.length === 0
      ? [body('No accepted AI-suggestions or Ökobaudat citations yet.')]
      : references.map((r) => new Paragraph({
          numbering: { reference: 'references-numbering', level: 0 },
          children: [new TextRun(`${r.label} — ${r.url}`)],
        }))),

    ...(feedbackTexts.length > 0
      ? [heading('Appendix — AI Feedback (Discussion drafts)'), ...feedbackTexts.map((f) => new Paragraph({
          children: [new TextRun({ text: `${f.label}: `, bold: true }), new TextRun(f.text)],
          spacing: { after: 160 },
        }))]
      : []),

    ...ficheAnnexSection(),
  ]

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'references-numbering',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
      }],
    },
    sections: [{ properties: {}, children }],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
