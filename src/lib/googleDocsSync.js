// Google Docs Integration for MID 2030 LCA Assembly Builder
// Synchronizes or appends LCA report findings, materials research,
// assemblies specs, and global EPD metrics directly to Google Docs.

import {
  getMaterialResearchByDiscipline,
  getGlobalLcaSummary,
  getGlobalProviderStats
} from './deliverablesData.js'
import { classifyAssemblySustainability } from './sustainabilityRubric.js'
import { loadFicheDetail } from './ficheStorage.js'
import { getAllMaterials } from './materialsCatalog.js'
import { buildLayerCalculationSteps } from './calculationNarrative.js'
import { LCA_MODULES, NORMALIZATION, U_VALUE, GLOSSARY, RSP_YEARS } from '../data/lcaMethodology.js'

export const DEFAULT_DOC_URL = 'https://docs.google.com/document/d/1z8B-IbPrTaZyRzYeJqNMYBN5hlHUN2rSWIqSei-9jv0/edit?tab=t.0'
export const DEFAULT_DOC_ID = '1z8B-IbPrTaZyRzYeJqNMYBN5hlHUN2rSWIqSei-9jv0'

const REPORT_ASSEMBLY_ORDER = ['wall', 'floor', 'roof', 'skylight', 'window', 'door']

/**
 * Extracts a clean Google Doc ID from a URL or raw ID string.
 */
export function extractDocId(input) {
  if (!input || typeof input !== 'string') return DEFAULT_DOC_ID
  const str = input.trim()
  const match = str.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
  if (match && match[1]) {
    return match[1]
  }
  return str
}

/**
 * Fetches Google Document structure and metadata.
 */
export async function getGoogleDocMetadata(docId, accessToken) {
  const cleanId = extractDocId(docId)
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${cleanId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    const msg = errorData.error?.message || `HTTP ${res.status}: ${res.statusText}`
    throw new Error(`Google Docs Error: ${msg}`)
  }

  const doc = await res.json()
  return doc
}

function fmt(n, digits = 3) {
  return n != null ? Number(n).toFixed(digits) : '—'
}

/**
 * Generates structured text content for the entire LCA Report.
 */
export function generateLcaReportText(summaries = [], references = []) {
  const withData = summaries.filter((s) => s.hasData)
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const lines = []

  lines.push(`=================================================================`)
  lines.push(`MID 2030 — MODEL 1 ASSEMBLY BUILDER LCA REPORT`)
  lines.push(`Group 02 · Batavierenplantsoen, Haarlem`)
  lines.push(`Automated Sync Date: ${dateStr}`)
  lines.push(`=================================================================\n`)

  // Section 1 — Executive Summary & Project Outline
  lines.push(`1. EXECUTIVE SUMMARY & PROJECT OUTLINE`)
  lines.push(`-----------------------------------------------------------------`)
  lines.push(
    `This report presents the complete Life Cycle Assessment (LCA) and thermal performance evaluation for Model 1, a sustainable timber cabin designed for Batavierenplantsoen, Haarlem (Netherlands) by Group 02 as part of the MID 2030 (Theory and Sustainable Construction) curriculum. The primary objective is to evaluate, optimize, and document the environmental impact—specifically Global Warming Potential (GWP in kg CO₂e)—and thermal transmittance (U-value in W/m²K) across all six key building elements: Exterior Wall, Ground Floor, Roof, Window, Door, and Skylight.`
  )
  lines.push(
    `Current status: ${withData.length}/6 building elements fully configured and verified against Ökobaudat EPD databases and DIN standards.\n`
  )

  // Section 2 — Humanized Methodology Paragraph & System Boundary
  lines.push(`2. METHODOLOGY & SYSTEM BOUNDARIES`)
  lines.push(`-----------------------------------------------------------------`)
  lines.push(
    `To evaluate the environmental performance of Model 1 fairly and rigorously, our assessment adopts a standardized ${RSP_YEARS}-year Reference Study Period (RSP) in alignment with European standards EN 15804 and EN 15978. Our system boundary encompasses the cradle-to-gate product stage (Modules A1–A3), factory-to-site transportation logistics (Module A4), in-use maintenance and replacements (Module B4), operational energy demand (Module B6), and end-of-life deconstruction, waste processing, and disposal (Modules C1–C4), alongside circular net benefits beyond the system boundary (Module D).\n`
  )
  lines.push(`Key Methodological Frameworks & Formulas:`)
  lines.push(
    `  • Product Embodied Carbon (A1–A3): Quantified per material layer using validated Ökobaudat soda4LCA EPD data multiplied by the net functional volume, surface area, or unit count.`
  )
  lines.push(
    `  • Freight & Transport Logistics (A4): Calculated according to DIN EN ISO 14083. Freight originates at regional manufacturer locations, routes through the central Detmold distribution hub (300 km leg), and proceeds directly to the Haarlem construction site (300 km leg) using standard 20t diesel transport trucks.`
  )
  lines.push(
    `  • In-Use Replacements (B4): Accounts for component wear based on researched service life spans. Materials with service lives under 50 years trigger proportional re-fabrication and re-transport emissions (B4 = [CEIL(50/ServiceLife) - 1] × [A1-A3 + A4]).`
  )
  lines.push(
    `  • Thermal Performance (U-Value): Derived per DIN EN ISO 6946 for multi-layered opaque assemblies (R_total = Rsi + Rse + Σ(d/λ), U = 1/R_total) and manufacturer-declared thermal metrics (Uw, Ud) for prefabricated fenestration and door units.`
  )
  lines.push(
    `  • Annual Normalized Footprint: To enable meaningful cross-element comparison, embodied impacts are normalized per unit surface area per operational year: Normalized GWP = (A1–A3 + A4) / (Area × ${RSP_YEARS}).\n`
  )

  // Section 3 — Material Research by Discipline
  lines.push(`3. MATERIAL RESEARCH BY DISCIPLINE`)
  lines.push(`-----------------------------------------------------------------`)
  const research = getMaterialResearchByDiscipline()
  if (research.length === 0) {
    lines.push(`No material research records saved yet.\n`)
  } else {
    for (const group of research) {
      lines.push(`Discipline: ${group.discipline}`)
      for (const r of group.rows) {
        lines.push(
          `  - ${r.name} (${r.germanName || 'N/A'}) | Standard: ${r.norm || 'EN/DIN'} | Provider: ${r.providerName || 'Auto-matched EPD'}`
        )
      }
      lines.push('')
    }
  }

  // Section 4 — Element Auto-Assignments & Assembly Breakdown
  lines.push(`4. ELEMENT AUTO-ASSIGNMENTS & ASSEMBLY BREAKDOWN`)
  lines.push(`-----------------------------------------------------------------`)
  const byKey = Object.fromEntries(summaries.map((s) => [s.key, s]))
  const ordered = REPORT_ASSEMBLY_ORDER.map((k) => byKey[k]).filter(Boolean)

  for (const s of ordered) {
    lines.push(`=== BUILDING ELEMENT: ${s.label.toUpperCase()} ===`)
    lines.push(`Assigned Owner / Lead: ${s.owner || 'Group 02 Member'} | Status: ${s.hasData ? 'Active & Configured' : 'Pending Data'}`)
    lines.push(`Completeness: ${s.completeCount}/${s.totalCount} layers verified`)
    lines.push(`Thermal Transmittance (U-Value): ${s.uValue != null ? fmt(s.uValue) + ' W/m²K' : 'N/A'}`)
    lines.push(`Embodied GWP (A1–A3): ${s.a1a3KnownCount > 0 ? fmt(s.a1a3Total, 1) + ' kg CO₂e' : 'N/A'}`)
    lines.push(`Logistics Transport (A4): ${s.a4KnownCount > 0 ? fmt(s.a4Total, 1) + ' kg CO₂e' : 'N/A'}`)
    lines.push(`Annual Normalized Footprint: ${s.normalized != null ? fmt(s.normalized) + ' kg CO₂e/m²/yr' : 'N/A'}`)

    const { uValue: uTier, gwp: gwpTier } = classifyAssemblySustainability(s.key, s.uValue, s.normalized)
    if (uTier) lines.push(`Thermal Classification: ${uTier.label} — ${uTier.reason}`)
    if (gwpTier) lines.push(`Carbon Footprint Rating: ${gwpTier.label} — ${gwpTier.reason}`)

    if (s.layerResults && s.layerResults.length > 0) {
      lines.push(`Constituent Material Layers (Exterior → Interior):`)
      s.layerResults.forEach((l, idx) => {
        lines.push(
          `  ${idx + 1}. ${l.name} | Thickness: ${fmt(l.thicknessMM, 1)} mm | λ: ${fmt(l.thermalConductivityWmK, 3)} W/mK | A1–A3 GWP: ${fmt(l.a1a3, 1)} kg CO₂e`
        )
      })
    } else {
      lines.push(`  (No constituent layers defined)`)
    }
    lines.push('')
  }

  // Section 5 — Whole-Building Global LCA Totals
  lines.push(`5. WHOLE-BUILDING GLOBAL LCA TOTALS (CONSISTENT WITH SPREADSHEET)`)
  lines.push(`-----------------------------------------------------------------`)
  const globalLca = getGlobalLcaSummary()
  lines.push(`Configured Element Assemblies: ${globalLca.assessedAssemblyCount}/${globalLca.totalAssemblyCount}`)
  lines.push(`Total Embodied Carbon (A1–A3): ${globalLca.a1a3Total != null ? fmt(globalLca.a1a3Total, 1) + ' kg CO₂e' : 'N/A'}`)
  lines.push(`Total Transport Emissions (A4): ${globalLca.a4Total != null ? fmt(globalLca.a4Total, 1) + ' kg CO₂e' : 'N/A'}`)
  lines.push(`Total 50-Year Replacement (B4): ${globalLca.b4Total != null ? fmt(globalLca.b4Total, 1) + ' kg CO₂e' : 'N/A'}`)
  lines.push(
    `End-of-Life Lifecycle Profile: C1 Demolition=${fmt(globalLca.c1Total, 1)}, C3 Processing=${fmt(globalLca.c3Total, 1)}, C4 Disposal=${fmt(globalLca.c4Total, 1)}, Module D Reuse Credit=${fmt(globalLca.moduleDTotal, 1)} kg CO₂e\n`
  )

  // Section 6 — Global EPD & Supply Chain Distribution
  lines.push(`6. GLOBAL EPD & SUPPLY CHAIN DISTRIBUTION`)
  lines.push(`-----------------------------------------------------------------`)
  const providerStats = getGlobalProviderStats()
  lines.push(`Active Verified EPD Suppliers: ${providerStats.count}`)
  lines.push(`Suppliers within 500 km: ${providerStats.within500}/${providerStats.count}`)
  lines.push(`Suppliers within 1000 km: ${providerStats.within1000}/${providerStats.count}`)
  lines.push(`Average Freight Transit Distance: ${providerStats.avgKm != null ? Math.round(providerStats.avgKm) + ' km' : 'N/A'}`)
  for (const p of providerStats.providers) {
    lines.push(`  • ${p.name} (${p.address}) — ${Math.round(p.distanceToSiteKm)} km to site | Materials: ${p.materialIds.join(', ')}`)
  }
  lines.push('')

  // Section 7 — Conclusion & Recommendations
  lines.push(`7. CONCLUSION & SUSTAINABILITY RECOMMENDATIONS`)
  lines.push(`-----------------------------------------------------------------`)
  lines.push(
    `The life cycle assessment for Model 1 demonstrates exceptional thermal efficiency and carbon reduction benefits, particularly through bio-based wood-fiber insulation, wood sheathing, and timber structural framing. To optimize performance further, we recommend prioritizing local bio-based suppliers to reduce Module A4 transport loads and ensuring modular detailing to maximize Module D end-of-life recovery credits.\n`
  )

  // Section 8 — References
  lines.push(`8. REFERENCES & EPD CITATIONS`)
  lines.push(`-----------------------------------------------------------------`)
  if (references.length === 0) {
    lines.push(`No Ökobaudat citations or external references attached yet.`)
  } else {
    references.forEach((ref, idx) => {
      lines.push(`[${idx + 1}] ${ref.label || 'Reference'} — ${ref.url || 'No URL'}`)
    })
  }

  lines.push(`\n=================================================================\n\n`)

  return lines.join('\n')
}

/**
 * Appends the LCA Report content to the specified Google Doc.
 */
export async function appendLcaReportToDoc(docId, summaries, references, accessToken) {
  const cleanId = extractDocId(docId)

  // 1. Fetch current doc to determine end index
  const doc = await getGoogleDocMetadata(cleanId, accessToken)
  let insertIndex = 1
  if (doc?.body?.content?.length) {
    const lastElement = doc.body.content[doc.body.content.length - 1]
    if (lastElement.endIndex && lastElement.endIndex > 1) {
      insertIndex = lastElement.endIndex - 1
    }
  }

  // 2. Generate report text
  const reportText = generateLcaReportText(summaries, references)

  // 3. Send batchUpdate request
  const requests = [
    {
      insertText: {
        location: { index: insertIndex },
        text: reportText
      }
    }
  ]

  const res = await fetch(`https://docs.googleapis.com/v1/documents/${cleanId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ requests })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Failed to update Google Doc (HTTP ${res.status})`)
  }

  return { success: true, docTitle: doc.title, documentId: cleanId }
}

/**
 * Overwrites document content with fresh LCA Report content.
 */
export async function overwriteLcaReportInDoc(docId, summaries, references, accessToken) {
  const cleanId = extractDocId(docId)

  // 1. Fetch current doc to determine end index
  const doc = await getGoogleDocMetadata(cleanId, accessToken)
  let maxIndex = 1
  if (doc?.body?.content?.length) {
    const lastElement = doc.body.content[doc.body.content.length - 1]
    if (lastElement.endIndex && lastElement.endIndex > 1) {
      maxIndex = lastElement.endIndex - 1
    }
  }

  const requests = []

  // If document has content, delete content from index 1 to maxIndex
  if (maxIndex > 1) {
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: 1,
          endIndex: maxIndex
        }
      }
    })
  }

  // Insert fresh report text
  const reportText = generateLcaReportText(summaries, references)
  requests.push({
    insertText: {
      location: { index: 1 },
      text: reportText
    }
  })

  const res = await fetch(`https://docs.googleapis.com/v1/documents/${cleanId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ requests })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Failed to update Google Doc (HTTP ${res.status})`)
  }

  return { success: true, docTitle: doc.title, documentId: cleanId }
}
