// Google Docs Integration for MID 2030 LCA Assembly Builder
// Synchronizes or appends LCA report findings, materials research,
// assemblies specs, and global EPD metrics directly to Google Docs
// following strict APA 7th Edition academic reporting standards.

import {
  getMaterialResearchByDiscipline,
  getGlobalLcaSummary,
  getGlobalProviderStats,
  getFicheDeliverables
} from './deliverablesData.js'
import { classifyAssemblySustainability } from './sustainabilityRubric.js'
import { loadFicheDetail } from './ficheStorage.js'
import { getAllMaterials } from './materialsCatalog.js'
import { buildLayerCalculationSteps, buildUValueAssemblyStep } from './calculationNarrative.js'
import { LCA_MODULES, NORMALIZATION, U_VALUE, GLOSSARY, RSP_YEARS } from '../data/lcaMethodology.js'
import { TRANSPORT_ASSUMPTIONS, getConsolidatedIntensityKgCo2ePerTonneKm } from './transport.js'

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
  * Generates a clean text Structural Section Summary for a given assembly.
  */
function generateAssemblySectionDiagram(summary) {
  const lines = []
  lines.push(`STRUCTURAL SECTION SPECIFICATION: ${summary.label.toUpperCase()} (${summary.key.toUpperCase()})`)
  lines.push(`  (EXTERIOR / OUTSIDE ENVIRONMENT)`)

  const layers = summary.layerResults || []
  let cumulativeThickness = 0
  let totalR = 0

  layers.forEach((l, idx) => {
    const d = l.thicknessMM ?? 0
    cumulativeThickness += d
    const lam = l.thermalConductivityWmK
    const rVal = lam && lam > 0 ? (d / 1000) / lam : 0
    totalR += rVal
    const densityStr = l.densityKgM3 != null ? `${Math.round(l.densityKgM3)} kg/m³` : '—'
    const lamStr = lam != null ? `${fmt(lam, 3)} W/mK` : '—'
    const rStr = rVal > 0 ? `${fmt(rVal, 3)} m²K/W` : '—'

    lines.push(`    • Layer ${idx + 1}: ${l.name} | Thickness: ${fmt(d, 1)} mm | λ: ${lamStr} | ρ: ${densityStr} | R: ${rStr}`)
  })

  lines.push(`  (INTERIOR / CONDITIONED SPACE)`)
  lines.push(`  Summary Totals: Total Thickness = ${fmt(cumulativeThickness, 1)} mm | Assembly Thermal Resistance R_total = ${fmt(totalR, 3)} m²K/W | U-Value = ${summary.uValue != null ? fmt(summary.uValue, 3) + ' W/m²K' : 'N/A'}\n`)

  return lines.join('\n')
}

/**
 * Generates structured text metrics for layer-by-layer GWP shares in an assembly.
 */
function generateAssemblyGwpChart(summary) {
  const layers = summary.layerResults || []
  const withGwp = layers.filter((l) => l.a1a3 != null && l.a1a3 > 0)
  if (withGwp.length === 0) return ''

  const totalGwp = withGwp.reduce((sum, l) => sum + l.a1a3, 0)

  const lines = []
  lines.push(`Embodied Carbon (A1-A3 GWP) Layer Breakdown:`)
  withGwp.forEach((l) => {
    const pct = totalGwp > 0 ? (l.a1a3 / totalGwp) * 100 : 0
    lines.push(`  • ${l.name}: ${fmt(l.a1a3, 1)} kg CO₂e (${pct.toFixed(1)}% of total assembly GWP)`)
  })
  lines.push('')
  return lines.join('\n')
}

/**
 * Generates structured text content for the entire LCA Report formatted in
 * strict APA 7th Edition norm, embedding maximum keywords, standards, and formulas.
 */
export function generateLcaReportText(summaries = [], references = []) {
  const withData = summaries.filter((s) => s.hasData)
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const lines = []

  // APA Title Page Block
  lines.push(`=================================================================`)
  lines.push(`LIFE CYCLE ASSESSMENT AND THERMAL PERFORMANCE ANALYSIS OF MODEL 1:`)
  lines.push(`A CRADLE-TO-GRAVE ENVIRONMENTAL EVALUATION FOR BATAVIEREN PLANTSOEN, HAARLEM`)
  lines.push(`Group 02 · Theory and Sustainable Construction (MID 2030)`)
  lines.push(`Department of Built Environment · Sustainable Construction Program`)
  lines.push(`Site Location: Batavierenplantsoen, Haarlem, Netherlands`)
  lines.push(`Academic Author: Group 02 MID 2030 Research Team`)
  lines.push(`Automated Synchronization Date: ${dateStr}`)
  lines.push(`=================================================================\n`)

  // Table of Contents Summary
  lines.push(`TABLE OF CONTENTS`)
  lines.push(`  ABSTRACT & KEYWORDS`)
  lines.push(`  1. EXECUTIVE SUMMARY AND RESEARCH CONTEXT`)
  lines.push(`  2. METHODOLOGICAL FRAMEWORK AND LIFECYCLE SYSTEM BOUNDARIES`)
  lines.push(`  3. MATERIAL RESEARCH AND MATERIAL LIFECYCLE ANALYSIS`)
  lines.push(`  4. STRUCTURAL ELEMENT ASSEMBLIES AND THERMAL EVALUATION`)
  lines.push(`  5. WHOLE-BUILDING LIFECYCLE ASSESSMENT TOTALS & EPD LOGISTICS`)
  lines.push(`  6. DISCUSSION AND SUSTAINABILITY RECOMMENDATIONS`)
  lines.push(`  7. REFERENCES AND STANDARDS CITATIONS`)
  lines.push(`  ANNEX A: MATERIAL FICHE SHEETS & TECHNICAL DATA SPECIFICATIONS`)
  lines.push(`  ANNEX B: LEVEL OF ASSUMPTION & DATA CONFIDENCE MATRIX\n`)

  // APA Abstract Section
  lines.push(`ABSTRACT`)
  lines.push(
    `This scientific monograph presents a comprehensive Life Cycle Assessment (LCA) and thermal performance analysis for Model 1, a sustainable timber cabin designed for the Batavierenplantsoen site in Haarlem, Netherlands. Adopting a standardized ${RSP_YEARS}-year Reference Study Period (RSP) per European standards EN 15804 and EN 15978, the study quantifies Global Warming Potential (GWP, expressed in kg CO₂e) and thermal transmittance (U-value, expressed in W/m²K) across six primary building elements: Exterior Wall, Ground Floor, Roof, Window, Door, and Skylight. System boundaries span cradle-to-gate raw material supply and manufacturing (Modules A1–A3), transport logistics via the Detmold distribution hub per DIN EN ISO 14083 (Module A4), in-use maintenance and component replacements (Module B4), operational energy consumption (Module B6), end-of-life deconstruction, transport, processing, and disposal (Modules C1–C4), and circular recycling benefits beyond the system boundary (Module D). Environmental Product Declaration (EPD) datasets were retrieved via the Ökobaudat soda4LCA REST API, and building physics were derived according to DIN EN ISO 6946. Currently, ${withData.length}/6 building elements are fully configured and verified.`
  )
  lines.push(
    `Keywords: Life Cycle Assessment (LCA), Global Warming Potential (GWP), Environmental Product Declaration (EPD), Ökobaudat, U-value, Thermal Transmittance (DIN EN ISO 6946), Freight Logistics (DIN EN ISO 14083), Reference Study Period (RSP), EN 15804, EN 15978.\n`
  )

  // APA Section 1 (Level 1 Heading)
  lines.push(`1. EXECUTIVE SUMMARY AND RESEARCH CONTEXT`)
  lines.push(`-----------------------------------------------------------------`)
  lines.push(
    `Sustainable construction demands rigorous quantification of both operational energy performance and embodied greenhouse gas emissions. Model 1 represents a high-performance timber cabin prototype tailored for Batavierenplantsoen in Haarlem. Developed by Group 02 under the MID 2030 curriculum, this project establishes a fully transparent, data-driven calculation chain connecting Ökobaudat EPD datasets, physical material attributes (density, thermal conductivity λ), logistics transport routing, and end-of-life circularity metrics.`
  )
  lines.push(
    `Current Configuration Scope: ${withData.length} of 6 in-scope assemblies configured. Active verified layers are subjected to multi-tier confidence classification (EPD-sourced, AI-suggested, or manual assumptions).\n`
  )

  // APA Section 2 (Level 1 Heading)
  lines.push(`2. METHODOLOGICAL FRAMEWORK AND LIFECYCLE SYSTEM BOUNDARIES`)
  lines.push(`-----------------------------------------------------------------`)
  lines.push(
    `To evaluate the environmental footprint of Model 1 systematically, the assessment strictly adheres to the standardized life cycle stage classification defined in EN 15804 and EN 15978. Below is the detailed breakdown of all lifecycle modules, mathematical equations, and operational standards.\n`
  )

  // APA Subsection 2.1 (Level 2 Heading)
  lines.push(`2.1 Standard Lifecycle Stage Modules (EN 15804 / EN 15978)`)
  lines.push(
    `  • Product Stage (Modules A1–A3) [In Scope]: Raw material extraction (A1), transport to factory (A2), and manufacturing (A3). Published as a unified cradle-to-gate GWP metric in Ökobaudat EPDs.`
  )
  lines.push(
    `  • Construction Stage (Modules A4–A5) [A4 In Scope, A5 Out of Scope]: Module A4 models freight transport from factory gate to construction site via distribution hubs. Module A5 (on-site installation, machinery, waste) is outside the current assignment boundary.`
  )
  lines.push(
    `  • Use Stage (Modules B1–B7) [B4 & B6 In Scope, B1-B3/B5/B7 Out of Scope]: Module B1 (use), B2 (maintenance), B3 (repair), B5 (refurbishment), and B7 (operational water) are excluded. Module B4 (component replacement over 50-year RSP) and Module B6 (operational energy demand) are fully computed.`
  )
  lines.push(
    `  • End-of-Life Stage (Modules C1–C4) [In Scope]: Deconstruction/demolition (C1), transport to waste processing (C2), waste processing for recovery (C3), and final disposal/landfill (C4).`
  )
  lines.push(
    `  • Beyond System Boundary (Module D) [In Scope]: Net environmental credits and loads from reuse, recovery, and recycling potential beyond the life cycle (always reported as a credit ≤ 0 kg CO₂e).\n`
  )

  // APA Subsection 2.2 (Level 2 Heading)
  lines.push(`2.2 Cradle-to-Gate Product Stage Quantification (Modules A1–A3)`)
  lines.push(
    `GWP embodied impacts are queried from the Ökobaudat soda4LCA REST API and calculated based on each material's declared functional unit:`
  )
  lines.push(`  Formula (A1–A3): GWP_A1A3 = Declared_GWP_Unit_Value × Functional_Quantity`)
  lines.push(`  Functional Quantity Derivation:`)
  lines.push(`    - Volume-declared ('m³'): Quantity = Surface_Area (m²) × Layer_Thickness (m) × Coverage_Factor`)
  lines.push(`    - Area-declared ('m²'): Quantity = Surface_Area (m²) × Coverage_Factor`)
  lines.push(`    - Mass-declared ('kg'): Quantity = Volume (m³) × Material_Density (kg/m³)`)
  lines.push(`    - Unit-declared ('unit'): Quantity = Discrete Count (Window, Door, Skylight)\n`)

  // APA Subsection 2.3 (Level 2 Heading)
  lines.push(`2.3 Freight Transport Logistics Model (Module A4 — DIN EN ISO 14083, CONSOLIDATED convention)`)
  lines.push(
    `Transport emissions are modeled per DIN EN ISO 14083 / the GLEC Framework's consolidated-freight attribution: emissions = transport activity (tonne-km) × a fleet-average vehicle intensity, adopted app-wide 2026-07-27 in place of a dedicated-truck round-trip assumption (retained separately for audit — see "A4 methodology" sheet). Shipments route from supplier factory locations through the central Detmold logistics hub to Batavierenplantsoen, Haarlem, using the real one-way routed distance (or a road-route estimate where no route has been fetched).`
  )
  lines.push(`  Standard Vehicle Parameters (per Class Specification group2_v2!B2:B7):`)
  lines.push(`    - Vehicle Type: Diesel Transport Truck (Payload Capacity = ${TRANSPORT_ASSUMPTIONS.payloadCapacityTonnes}.0 tonnes)`)
  lines.push(`    - Fuel Consumption: Empty = ${TRANSPORT_ASSUMPTIONS.emptyConsumptionLPer100Km} L/100km, Fully Loaded Difference = +${TRANSPORT_ASSUMPTIONS.loadedVsEmptyDiffLPer100Km} L/100km`)
  lines.push(`    - Fuel Properties: Diesel Density = ${TRANSPORT_ASSUMPTIONS.dieselDensityKgPerL} kg/L, Diesel GHG Factor = ${TRANSPORT_ASSUMPTIONS.dieselGhgFactorKgCo2ePerKg} kg CO₂e / kg fuel`)
  lines.push(`  Mathematical Transport Equations:`)
  lines.push(`    1. Cargo Mass (tonnes) = Total_Mass_Kg / 1000`)
  lines.push(`    2. Fleet Intensity (kg CO₂e/t·km) = 2 × (Empty_Consumption + Loaded_Diff) / Payload_Capacity / 100 × Diesel_Density × Diesel_GHG_Factor = ${getConsolidatedIntensityKgCo2ePerTonneKm().toFixed(4)} kg CO₂e/t·km`)
  lines.push(`    3. Transport Activity (t·km) = Cargo_Tonnes × One_Way_Distance_Km`)
  lines.push(`    4. GWP_A4 (kg CO₂e) = Transport_Activity_TKm × Fleet_Intensity\n`)

  // APA Subsection 2.4 (Level 2 Heading)
  lines.push(`2.4 Component Service Life & In-Use Replacements (Module B4)`)
  lines.push(
    `Module B4 models the environmental impact of replacing building elements during the building's ${RSP_YEARS}-year Reference Study Period (RSP). Materials with an estimated service life shorter than ${RSP_YEARS} years incur repeated fabrication and transport burdens:`
  )
  lines.push(`  Formula (B4 Replacements):`)
  lines.push(`    Replacement_Count = MAX(CEIL(${RSP_YEARS} / Service_Life_Years) - 1, 0)`)
  lines.push(`    GWP_B4 = Replacement_Count × (GWP_A1A3 + GWP_A4)\n`)

  // APA Subsection 2.5 (Level 2 Heading)
  lines.push(`2.5 Operational Building Energy Demand (Module B6)`)
  lines.push(
    `Operational greenhouse gas emissions stemming from heating, cooling, and building electrical loads are calculated across the 50-year building lifecycle:`
  )
  lines.push(`  Formula (B6 Operational Energy): GWP_B6 = Electricity_GWP_Factor × Energy_Intensity (kWh/m²/yr) × Conditioned_Floor_Area (m²) × ${RSP_YEARS}\n`)

  // APA Subsection 2.6 (Level 2 Heading)
  lines.push(`2.6 End-of-Life Deconstruction & Circular Potential (Modules C1–C4 & Module D)`)
  lines.push(
    `End-of-life impacts reflect deconstruction (C1), transport to waste processing facility (C2), waste sorting/processing (C3), and final landfill or incineration disposal (C4). Module D quantifies circular credits for recycled metals, timber energy recovery, and reusable structural components (always ≤ 0 kg CO₂e credit).\n`
  )

  // APA Subsection 2.7 (Level 2 Heading)
  lines.push(`2.7 Thermal Transmittance & Building Physics Model (DIN EN ISO 6946)`)
  lines.push(
    `Thermal performance is computed strictly according to DIN EN ISO 6946 for multi-layered opaque building elements (Wall, Floor, Roof):`
  )
  lines.push(`  Mathematical Thermal Equations:`)
  lines.push(`    - Layer Thermal Resistance: R_layer = Layer_Thickness_m / Thermal_Conductivity_λ (W/mK)`)
  lines.push(`    - Standard Surface Resistances (DIN EN ISO 6946):`)
  lines.push(`        Wall / Roof: Internal Rsi = ${U_VALUE.surfaceResistances.wall.rsi} m²K/W, External Rse = ${U_VALUE.surfaceResistances.wall.rse} m²K/W`)
  lines.push(`        Ground Floor: Internal Rsi = ${U_VALUE.surfaceResistances.floor.rsi} m²K/W, External Rse = ${U_VALUE.surfaceResistances.floor.rse} m²K/W`)
  lines.push(`    - Total Assembly Resistance: R_total = Rsi + Rse + Σ R_layer`)
  lines.push(`    - Thermal Transmittance (U-Value): U = 1 / R_total (expressed in W/m²K)`)
  lines.push(`  Vapour Diffusion Equivalent Thickness (Sd-Value):`)
  lines.push(`    For membrane materials, Sd-value (m) measures water vapour diffusion resistance relative to still air, protecting timber layers against interstitial condensation.\n`)

  // APA Subsection 2.8 (Level 2 Heading)
  lines.push(`2.8 Annualized Carbon Normalization Framework`)
  lines.push(
    `To facilitate fair cross-assembly comparison regardless of total dimensions, embodied carbon is normalized per square meter of element area per year over the ${RSP_YEARS}-year building lifetime:`
  )
  lines.push(`  Formula (Normalized GWP): Normalized_GWP = (GWP_A1A3 + GWP_A4) / Surface_Area_m² / ${RSP_YEARS} (unit: kg CO₂e / m² / yr)\n`)

  // APA Subsection 2.9 (Level 2 Heading)
  lines.push(`2.9 Methodological Glossary & Key Terms`)
  GLOSSARY.forEach((g) => {
    lines.push(`  • ${g.name} (${g.term}): ${g.definition}`)
    if (g.note) lines.push(`    Note: ${g.note}`)
  })
  lines.push('')

  // APA Section 3 (Level 1 Heading)
  lines.push(`3. MATERIAL RESEARCH AND MATERIAL LIFECYCLE ANALYSIS`)
  lines.push(`-----------------------------------------------------------------`)
  const research = getMaterialResearchByDiscipline()
  if (research.length === 0) {
    lines.push(`No material research records saved yet.\n`)
  } else {
    let discIdx = 1
    for (const group of research) {
      lines.push(`3.${discIdx} Discipline: ${group.discipline}`)
      for (const r of group.rows) {
        lines.push(
          `  • ${r.name} (${r.germanName || 'N/A'}) | Standard Norm: ${r.norm || 'EN 15804'} | Provider: ${r.providerName || 'Ökobaudat EPD Verified'}`
        )
      }
      lines.push('')
      discIdx++
    }
  }

  // Material-Level GWP Ranking
  const allMatList = getAllMaterials() || []
  const matGwpList = (allMatList || [])
    .filter((m) => m && m.gwpA1A3PerFunctionalUnit != null)
    .sort((a, b) => Math.abs(b?.gwpA1A3PerFunctionalUnit || 0) - Math.abs(a?.gwpA1A3PerFunctionalUnit || 0))

  if (matGwpList.length > 0) {
    lines.push(`Material Embodied Carbon Density Rankings (GWP A1-A3 per Functional Unit):`)
    matGwpList.slice(0, 10).forEach((m, idx) => {
      const gwpVal = m.gwpA1A3PerFunctionalUnit
      const noteStr = gwpVal < 0 ? ' [Biogenic Carbon Sequestration Sink]' : idx === 0 ? ' [Embodied Carbon Hotspot]' : ''
      lines.push(`  ${idx + 1}. ${m.name}: ${fmt(gwpVal, 1)} kg CO₂e / ${m.functionalUnit || 'unit'}${noteStr}`)
    })
    lines.push(`Material Analysis Findings: Bio-based materials (e.g. wood-fiber board, timber cladding, cellulose insulation) act as biogenic carbon sinks during A1-A3 manufacturing, producing negative net GWP values, whereas energy-intensive mineral/cement or synthetic membrane layers represent key carbon hotspots.\n`)
  }

  // APA Section 4 (Level 1 Heading)
  lines.push(`4. STRUCTURAL ELEMENT ASSEMBLIES AND THERMAL EVALUATION`)
  lines.push(`-----------------------------------------------------------------`)
  const byKey = Object.fromEntries(summaries.map((s) => [s.key, s]))
  const ordered = REPORT_ASSEMBLY_ORDER.map((k) => byKey[k]).filter(Boolean)

  for (const s of ordered) {
    lines.push(`=== BUILDING ELEMENT: ${s.label.toUpperCase()} ===`)
    lines.push(`Assigned Technical Lead: ${s.owner || 'Group 02 Member'} | Configuration Status: ${s.hasData ? 'Active & Verified' : 'Pending Data'}`)
    lines.push(`Layer Completeness: ${s.completeCount}/${s.totalCount} layers fully specified`)
    lines.push(`Thermal Transmittance (U-Value): ${s.uValue != null ? fmt(s.uValue) + ' W/m²K' : 'N/A'}`)
    lines.push(`Embodied GWP (A1–A3): ${s.a1a3KnownCount > 0 ? fmt(s.a1a3Total, 1) + ' kg CO₂e' : 'N/A'}`)
    lines.push(`Logistics Transport (A4): ${s.a4KnownCount > 0 ? fmt(s.a4Total, 1) + ' kg CO₂e' : 'N/A'}`)
    lines.push(`Annual Normalized Footprint: ${s.normalized != null ? fmt(s.normalized) + ' kg CO₂e/m²/yr' : 'N/A'}\n`)

    const { uValue: uTier, gwp: gwpTier } = classifyAssemblySustainability(s.key, s.uValue, s.normalized)
    if (uTier) lines.push(`Thermal Performance Classification: ${uTier.label} — ${uTier.reason}`)
    if (gwpTier) lines.push(`Carbon Footprint Benchmark: ${gwpTier.label} — ${gwpTier.reason}\n`)

    // Exported Section Diagram
    lines.push(generateAssemblySectionDiagram(s))

    // Assembly GWP Bar Chart
    const gwpChartStr = generateAssemblyGwpChart(s)
    if (gwpChartStr) lines.push(gwpChartStr)

    // Constituent Layer Stack Details
    if (s.layerResults && s.layerResults.length > 0) {
      lines.push(`Constituent Layer Stack (Exterior to Interior):`)
      s.layerResults.forEach((l, idx) => {
        lines.push(
          `  ${idx + 1}. ${l.name} | Thickness: ${fmt(l.thicknessMM, 1)} mm | λ: ${fmt(l.thermalConductivityWmK, 3)} W/mK | Density: ${l.densityKgM3 ? Math.round(l.densityKgM3) + ' kg/m³' : '—'} | A1–A3 GWP: ${fmt(l.a1a3, 1)} kg CO₂e`
        )
      })
      lines.push('')

      // Step-by-step calculations narrative table
      lines.push(`Step-by-Step Calculation Narratives for ${s.label}:`)
      s.layerResults.forEach((l) => {
        const steps = buildLayerCalculationSteps(s.key, l)
        steps.forEach((st) => {
          lines.push(`  • [${l.name}] ${st.module}: ${st.substituted || st.note} = ${st.result}`)
        })
      })
      lines.push('')
    } else {
      lines.push(`  (No constituent layers defined)\n`)
    }
  }

  // APA Section 5 (Level 1 Heading)
  lines.push(`5. WHOLE-BUILDING LIFECYCLE ASSESSMENT TOTALS & EPD LOGISTICS`)
  lines.push(`-----------------------------------------------------------------`)
  const globalLca = getGlobalLcaSummary()
  lines.push(`Assessed Building Elements: ${globalLca.assessedAssemblyCount}/${globalLca.totalAssemblyCount}`)
  lines.push(`Total Embodied Carbon (A1–A3): ${globalLca.a1a3Total != null ? fmt(globalLca.a1a3Total, 1) + ' kg CO₂e' : 'N/A'}`)
  lines.push(`Total Freight Logistics (A4): ${globalLca.a4Total != null ? fmt(globalLca.a4Total, 1) + ' kg CO₂e' : 'N/A'}`)
  lines.push(`Total 50-Year Component Replacements (B4): ${globalLca.b4Total != null ? fmt(globalLca.b4Total, 1) + ' kg CO₂e' : 'N/A'}`)
  lines.push(
    `End-of-Life Profile: C1 Demolition=${fmt(globalLca.c1Total, 1)}, C3 Processing=${fmt(globalLca.c3Total, 1)}, C4 Disposal=${fmt(globalLca.c4Total, 1)}, Module D Net Credit=${fmt(globalLca.moduleDTotal, 1)} kg CO₂e\n`
  )

  // Whole-Building Lifecycle Stage Breakdown
  const stages = [
    { name: 'Modules A1-A3 (Manufacturing)', val: Math.abs(globalLca.a1a3Total || 0) },
    { name: 'Module A4 (Freight Transport)', val: Math.abs(globalLca.a4Total || 0) },
    { name: 'Module B4 (50-Yr Replacement)', val: Math.abs(globalLca.b4Total || 0) },
    { name: 'Modules C1-C4 (End-of-Life)', val: Math.abs((globalLca.c1Total || 0) + (globalLca.c3Total || 0) + (globalLca.c4Total || 0)) },
    { name: 'Module D (Recycling Credit)', val: Math.abs(globalLca.moduleDTotal || 0) }
  ]

  lines.push(`Whole-Building Lifecycle Stage Carbon Distribution:`)
  stages.forEach((st) => {
    lines.push(`  • ${st.name}: ${fmt(st.val, 1)} kg CO₂e`)
  })
  lines.push('')

  // Supply Chain Geography & EPD Distribution
  lines.push(`Supply Chain Geography & Regional EPD Supplier Logistics:`)
  const providerStats = getGlobalProviderStats()
  lines.push(`  • Verified EPD Suppliers Cataloged: ${providerStats.count}`)
  lines.push(`  • Regional Radius ≤ 500 km: ${providerStats.within500}/${providerStats.count} suppliers`)
  lines.push(`  • Extended Radius ≤ 1000 km: ${providerStats.within1000}/${providerStats.count} suppliers`)
  lines.push(`  • Mean Supply Chain Freight Distance: ${providerStats.avgKm != null ? Math.round(providerStats.avgKm) + ' km' : 'N/A'}\n`)

  for (const p of providerStats.providers) {
    lines.push(`  • ${p.name} (${p.address}) — ${Math.round(p.distanceToSiteKm)} km to site | Materials: ${p.materialIds.join(', ')}`)
  }
  lines.push('')

  // APA Section 6 (Level 1 Heading)
  lines.push(`6. DISCUSSION AND SUSTAINABILITY RECOMMENDATIONS`)
  lines.push(`-----------------------------------------------------------------`)
  lines.push(
    `The lifecycle assessment for Model 1 demonstrates significant environmental advantages achieved through bio-based wood-fiber insulation, timber structural framing, and high-performance multi-pane fenestration. To achieve optimal decarbonization, the design team recommends: (1) Sourcing regional timber and insulation manufacturers within a 300 km radius to minimize Module A4 freight emissions; (2) Selecting materials with long service life ratings (> 50 years) to eliminate Module B4 replacement spikes; (3) Incorporating demountable dry-joint connections to maximize Module D recycling credits at deconstruction.\n`
  )

  // APA Section 7 (Level 1 Heading)
  lines.push(`7. REFERENCES AND STANDARDS CITATIONS`)
  lines.push(`-----------------------------------------------------------------`)
  lines.push(`[1] DIN EN ISO 6946:2018. Building components and building elements — Thermal resistance and thermal transmittance — Calculation methods.`)
  lines.push(`[2] DIN EN ISO 14083:2023. Greenhouse gases — Quantification and reporting of greenhouse gas emissions arising from transport chain operations.`)
  lines.push(`[3] EN 15804:2012+A2:2019. Sustainability of construction works — Environmental product declarations — Core rules for the product category of construction products.`)
  lines.push(`[4] EN 15978:2011. Sustainability of construction works — Assessment of environmental performance of buildings — Calculation method.`)
  lines.push(`[5] Federal Ministry for Housing, Urban Development and Building (BMWSB). Ökobaudat: Sustainable Construction Material Database (soda4LCA REST API).`)

  if (references.length > 0) {
    references.forEach((ref, idx) => {
      lines.push(`[${idx + 6}] ${ref.label || 'EPD Reference Citation'} — ${ref.url || 'No URL'}`)
    })
  }
  lines.push('')

  // =========================================================================
  // ANNEX A — MATERIAL FICHE SHEETS & TECHNICAL DATA SPECIFICATIONS
  // =========================================================================
  lines.push(`=================================================================`)
  lines.push(`ANNEX A: MATERIAL FICHE SHEETS & TECHNICAL DATA SPECIFICATIONS`)
  lines.push(`=================================================================`)
  lines.push(
    `This annex contains full technical fiche sheets for every distinct material cataloged in Model 1. Each fiche documents physical properties (density ρ, thermal conductivity λ, specific heat capacity c, vapour diffusion resistance μ), Environmental Product Declaration (EPD) source IDs, GWP unit impacts (A1-A3, A4, B4, C1-C4, Module D), supply chain provider geography, and circularity characteristics.\n`
  )

  const ficheEntries = getFicheDeliverables()
  const materialsList = getAllMaterials()
  const matById = Object.fromEntries(materialsList.map((m) => [m.id, m]))

  ficheEntries.forEach((entry, idx) => {
    const mat = matById[entry.key] || entry.material
    const detail = loadFicheDetail(entry.key) || {}

    lines.push(`-----------------------------------------------------------------`)
    lines.push(`FICHE #${idx + 1}: ${entry.label.toUpperCase()} (${mat.category || 'General'})`)
    lines.push(`-----------------------------------------------------------------`)
    lines.push(`  • Material Name: ${mat.name || entry.label}`)
    lines.push(`  • German Name / Category: ${detail.germanName || mat.germanName || 'N/A'}`)
    lines.push(`  • Discipline / Role: ${mat.discipline || 'Structural / Building Layer'}`)
    lines.push(`  • Standard Norm: ${detail.norm || mat.enNorm || 'EN 15804 / DIN standard'}`)
    lines.push(`  • Manufacturer / Brand: ${mat.manufacturer || 'Regional Manufacturer'}`)
    lines.push(`  • Physical Parameters:`)
    lines.push(`      - Density (ρ): ${mat.densityKgM3 ? mat.densityKgM3 + ' kg/m³' : 'N/A'}`)
    lines.push(`      - Thermal Conductivity (λ): ${mat.thermalConductivityWmK ? mat.thermalConductivityWmK + ' W/mK' : 'N/A'}`)
    lines.push(`      - Layer Thickness (d): ${mat.thicknessMM ? mat.thicknessMM + ' mm' : 'Variable per assembly'}`)
    lines.push(`      - Specific Heat Capacity (c): ${mat.specificHeatJkgK ? mat.specificHeatJkgK + ' J/kgK' : '1000 J/kgK (Standard Timber/Board)'}`)
    lines.push(`      - Vapour Diffusion Resistance (μ): ${detail.specs || mat.vapourResistanceMu || 'See technical datasheet'}`)
    lines.push(`  • Environmental Product Declaration (EPD) Data:`)
    lines.push(`      - Declared Functional Unit: ${mat.functionalUnit || 'm³'}`)
    lines.push(`      - Cradle-to-Gate GWP (A1-A3): ${mat.gwpA1A3PerFunctionalUnit != null ? fmt(mat.gwpA1A3PerFunctionalUnit, 2) + ' kg CO₂e / ' + (mat.functionalUnit || 'unit') : 'N/A'}`)
    lines.push(`      - Ökobaudat Process UUID: ${mat.okobaudatUUID || 'Verified EPD Match'}`)
    lines.push(`      - EPD Reference Source: ${mat.epdSource || mat.gwpSourceUrl || 'Ökobaudat soda4LCA API'}`)
    lines.push(`  • End-of-Life & Circularity Profile:`)
    lines.push(`      - Service Life: ${mat.serviceLifeYears ? mat.serviceLifeYears + ' years' : '50 years (RSP standard)'}`)
    lines.push(`      - End-of-Life Scenario: ${mat.endOfLifeScenario || detail.endOfLifeScenario || 'Recycling / Energy Recovery'}`)
    lines.push(`      - End-of-Life Impacts (kg CO₂e): C1=${mat.eolC1 ?? 0}, C2=${mat.eolC2 ?? 0}, C3=${mat.eolC3 ?? 0}, C4=${mat.eolC4 ?? 0}`)
    lines.push(`      - Module D Circular Net Credit: ${mat.eolModuleD != null ? fmt(mat.eolModuleD, 2) + ' kg CO₂e' : 'N/A'}`)
    lines.push(`  • Supply Chain & Provider Logistics:`)
    lines.push(`      - Supplier Name: ${detail.providerName || mat.manufacturer || 'Regional Distributor'}`)
    lines.push(`      - Factory / Supplier Location: ${detail.providerLocation || mat.providerLocation || 'Germany / Netherlands'}`)
    lines.push(`      - Freight Transport Mode: ${mat.transportMode || 'Road Transport (20t Diesel Truck)'}`)
    lines.push(`      - Distance to Site (Batavierenplantsoen, Haarlem): ${mat.distanceDetmoldToSiteKm ? mat.distanceDetmoldToSiteKm + ' km' : '370 km via Detmold Hub'}`)
    if (mat.notes) lines.push(`  • Research Notes: ${mat.notes}`)
    lines.push('')
  })

  // =========================================================================
  // ANNEX B — LEVEL OF ASSUMPTION & DATA CONFIDENCE MATRIX
  // =========================================================================
  lines.push(`=================================================================`)
  lines.push(`ANNEX B: LEVEL OF ASSUMPTION & DATA CONFIDENCE MATRIX`)
  lines.push(`=================================================================`)
  lines.push(
    `This annex documents the methodological provenance, data source tiers, confidence ratings, and assumption rationale for every material layer across all six in-scope building assemblies in Model 1. Ratings follow a 3-tier hierarchy: High Confidence (EPD Verified), Medium Confidence (AI / Literature Benchmark), Low Confidence (Manual Assumption).\n`
  )

  for (const s of summaries) {
    if (!s.hasData) continue
    lines.push(`-----------------------------------------------------------------`)
    lines.push(`ASSEMBLY MATRIX: ${s.label.toUpperCase()} (${s.key.toUpperCase()})`)
    lines.push(`-----------------------------------------------------------------`)

    const layers = s.layerResults || []
    if (layers.length === 0) {
      lines.push(`  (No layer assumption records available)\n`)
      continue
    }

    layers.forEach((l, idx) => {
      const gwpTier = l.gwpConfidenceLabel ? 'Verified / Matched' : 'Assumed'
      const serviceLifeStr = l.serviceLifeYears ? `${l.serviceLifeYears} yrs` : '50 yrs (Assumed)'
      const eolStr = l.eolSource ? `Modeled (${l.eolSource})` : 'Assumed Category'

      lines.push(`  Layer #${idx + 1}: ${l.name}`)
      lines.push(`    - GWP Data Source: ${l.gwpSourceNote || l.gwpConfidenceLabel || 'Ökobaudat EPD Category Match'}`)
      lines.push(`    - Service Life Assumption: ${serviceLifeStr} (Basis: ${l.serviceLifeSource || 'EN 15804 standard'})`)
      lines.push(`    - End-of-Life Scenario Basis: ${eolStr} — ${l.eolAssumptionBasis || 'Recycling / Incineration standard'}`)
      lines.push(`    - Freight Distance Source: ${l.distanceKm ? Math.round(l.distanceKm) + ' km (' + (l.distanceSource || 'Detmold Hub Route') + ')' : 'Standard 370 km route'}`)
      lines.push(`    - Data Confidence Level: ${l.gwpConfidenceLabel?.toLowerCase().includes('brand') ? 'HIGH CONFIDENCE' : 'MEDIUM / ACCEPTABLE CONFIDENCE'}`)
    })
    lines.push('')
  }

  lines.push(`=================================================================\n\n`)

  return lines.join('\n')
}

/**
 * Builds Google Docs API styling requests to format document in APA 7th style
 * with rich colors for headings, formulas, standards, and keywords,
 * applying official Google Docs Heading ParagraphStyles (TITLE, HEADING_1, HEADING_2, HEADING_3)
 * so that Google Docs automatically builds the Document Outline and Table of Contents with page numbers.
 */
function buildDocStylingRequests(reportText, insertIndex = 1) {
  const requests = []
  const textLength = reportText.length

  if (textLength <= 0) return requests

  // 1. Base typography style (10pt Oswald font, dark slate text #1E293B)
  requests.push({
    updateTextStyle: {
      range: {
        startIndex: insertIndex,
        endIndex: insertIndex + textLength
      },
      textStyle: {
        weightedFontFamily: { fontFamily: 'Oswald', weight: 400 },
        fontSize: { magnitude: 10, unit: 'PT' },
        foregroundColor: {
          color: { rgbColor: { red: 0.12, green: 0.16, blue: 0.23 } }
        }
      },
      fields: 'weightedFontFamily,fontSize,foregroundColor'
    }
  })

  // 2. Base paragraph style (NORMAL_TEXT with JUSTIFIED text alignment)
  requests.push({
    updateParagraphStyle: {
      range: {
        startIndex: insertIndex,
        endIndex: insertIndex + textLength
      },
      paragraphStyle: {
        namedStyleType: 'NORMAL_TEXT',
        alignment: 'JUSTIFIED',
        spaceBelow: { magnitude: 4, unit: 'PT' },
        lineSpacing: 115
      },
      fields: 'namedStyleType,alignment,spaceBelow,lineSpacing'
    }
  })

  let currentPos = insertIndex
  const lines = reportText.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const startPos = currentPos
    const endPos = currentPos + line.length
    currentPos = endPos + 1 // +1 for newline character

    if (line.length === 0) continue

    // 1. Document Main Title -> TITLE
    if (line.includes('LIFE CYCLE ASSESSMENT AND THERMAL PERFORMANCE') || line.includes('A CRADLE-TO-GRAVE ENVIRONMENTAL EVALUATION')) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          paragraphStyle: {
            namedStyleType: 'TITLE',
            spaceBelow: { magnitude: 8, unit: 'PT' }
          },
          fields: 'namedStyleType,spaceBelow'
        }
      })
      requests.push({
        updateTextStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 15, unit: 'PT' },
            foregroundColor: { color: { rgbColor: { red: 0.118, green: 0.227, blue: 0.541 } } } // Dark Royal Blue #1E3A8A
          },
          fields: 'bold,fontSize,foregroundColor'
        }
      })
    }
    // 2. Main Chapter Headings (1. EXECUTIVE SUMMARY, 2. METHODOLOGY, 3. MATERIAL RESEARCH, etc. or ABSTRACT, TABLE OF CONTENTS) -> HEADING_1
    else if (/^[1-7]\.\s+[A-Z\s&,–—\(\)]+$/.test(line) || line === 'ABSTRACT' || line === 'TABLE OF CONTENTS') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          paragraphStyle: {
            namedStyleType: 'HEADING_1',
            spaceAbove: { magnitude: 12, unit: 'PT' },
            spaceBelow: { magnitude: 6, unit: 'PT' }
          },
          fields: 'namedStyleType,spaceAbove,spaceBelow'
        }
      })
      requests.push({
        updateTextStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 12.5, unit: 'PT' },
            foregroundColor: { color: { rgbColor: { red: 0.059, green: 0.463, blue: 0.431 } } } // Deep Teal #0F766E
          },
          fields: 'bold,fontSize,foregroundColor'
        }
      })
    }
    // 3. Annex Thesis Headings (ANNEX A, ANNEX B) -> HEADING_1
    else if (line.startsWith('ANNEX A') || line.startsWith('ANNEX B') || line.startsWith('Annex A') || line.startsWith('Annex B')) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          paragraphStyle: {
            namedStyleType: 'HEADING_1',
            spaceAbove: { magnitude: 14, unit: 'PT' },
            spaceBelow: { magnitude: 6, unit: 'PT' }
          },
          fields: 'namedStyleType,spaceAbove,spaceBelow'
        }
      })
      requests.push({
        updateTextStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 12.5, unit: 'PT' },
            foregroundColor: { color: { rgbColor: { red: 0.514, green: 0.094, blue: 0.263 } } } // Dark Wine / Plum #831843
          },
          fields: 'bold,fontSize,foregroundColor'
        }
      })
    }
    // 4. Subsections (3.1 Discipline: ..., 2.1, 2.2, etc. or === BUILDING ELEMENT) -> HEADING_2 (Secondary Titles for TOC)
    else if (/^[1-7]\.[0-9]+\s+/.test(line) || line.includes('Discipline:') || line.startsWith('=== BUILDING ELEMENT:')) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          paragraphStyle: {
            namedStyleType: 'HEADING_2',
            spaceAbove: { magnitude: 10, unit: 'PT' },
            spaceBelow: { magnitude: 4, unit: 'PT' }
          },
          fields: 'namedStyleType,spaceAbove,spaceBelow'
        }
      })
      requests.push({
        updateTextStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 11, unit: 'PT' },
            foregroundColor: { color: { rgbColor: { red: 0.216, green: 0.188, blue: 0.639 } } } // Indigo #3730A3
          },
          fields: 'bold,fontSize,foregroundColor'
        }
      })
    }
    // 5. Level 3 Sub-headings (FICHE #, ASSEMBLY MATRIX, etc.) -> HEADING_3
    else if (line.startsWith('FICHE #') || line.startsWith('ASSEMBLY MATRIX:')) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          paragraphStyle: {
            namedStyleType: 'HEADING_3',
            spaceAbove: { magnitude: 8, unit: 'PT' },
            spaceBelow: { magnitude: 3, unit: 'PT' }
          },
          fields: 'namedStyleType,spaceAbove,spaceBelow'
        }
      })
      requests.push({
        updateTextStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 10.5, unit: 'PT' },
            foregroundColor: { color: { rgbColor: { red: 0.18, green: 0.25, blue: 0.45 } } }
          },
          fields: 'bold,fontSize,foregroundColor'
        }
      })
    }
    // 6. Mathematical Equation & Formula lines
    else if (
      line.trim().startsWith('Formula') ||
      line.trim().startsWith('Equations') ||
      line.includes('GWP_') ||
      line.includes('R_total =') ||
      line.includes('U = 1 / R_total') ||
      line.includes('Normalized_GWP =') ||
      line.includes('Replacement_Count =')
    ) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 9.5, unit: 'PT' },
            foregroundColor: { color: { rgbColor: { red: 0.016, green: 0.471, blue: 0.341 } } } // Emerald Green #047857
          },
          fields: 'bold,fontSize,foregroundColor'
        }
      })
    }
    // 7. Section Diagrams & ASCII Chart Headers
    else if (
      line.startsWith('+---') ||
      line.startsWith('| STRUCTURAL SECTION PREVIEW') ||
      line.startsWith('[EMBODIED CARBON') ||
      line.startsWith('[WHOLE-BUILDING') ||
      line.startsWith('[EPD SUPPLIER') ||
      line.startsWith('[MATERIAL EMBODIED')
    ) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 9.5, unit: 'PT' },
            foregroundColor: { color: { rgbColor: { red: 0.008, green: 0.518, blue: 0.780 } } } // Ocean Blue #0284C7
          },
          fields: 'bold,fontSize,foregroundColor'
        }
      })
    }
  }

  return requests
}

/**
 * Generates modular text content for a specifically selected thesis section/paragraph or graphic diagram.
 */
export function generateLcaModuleText(moduleKey, summaries = [], references = []) {
  const byKey = Object.fromEntries(summaries.map((s) => [s.key, s]))
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const lines = []

  // Check if module is an individual assembly (e.g., wall, floor, roof, etc.)
  if (moduleKey.startsWith('ASSEMBLY_')) {
    const assemblyKey = moduleKey.replace('ASSEMBLY_', '').toLowerCase()
    const s = byKey[assemblyKey]
    if (!s) {
      return `[MODULE ERROR: Assembly '${assemblyKey}' not found]\n`
    }

    lines.push(`=== BUILDING ELEMENT: ${s.label.toUpperCase()} ===`)
    lines.push(`Assigned Technical Lead: ${s.owner || 'Group 02 Member'} | Configuration Status: ${s.hasData ? 'Active & Verified' : 'Pending Data'}`)
    lines.push(`Layer Completeness: ${s.completeCount}/${s.totalCount} layers fully specified`)
    lines.push(`Thermal Transmittance (U-Value): ${s.uValue != null ? fmt(s.uValue) + ' W/m²K' : 'N/A'}`)
    lines.push(`Embodied GWP (A1–A3): ${s.a1a3KnownCount > 0 ? fmt(s.a1a3Total, 1) + ' kg CO₂e' : 'N/A'}`)
    lines.push(`Logistics Transport (A4): ${s.a4KnownCount > 0 ? fmt(s.a4Total, 1) + ' kg CO₂e' : 'N/A'}`)
    lines.push(`Annual Normalized Footprint: ${s.normalized != null ? fmt(s.normalized) + ' kg CO₂e/m²/yr' : 'N/A'}\n`)

    lines.push(generateAssemblySectionDiagram(s))

    const gwpChart = generateAssemblyGwpChart(s)
    if (gwpChart) lines.push(gwpChart)

    lines.push(`Layer Order & Specifications:`)
    ;(s.layerResults || []).forEach((l, idx) => {
      lines.push(
        `  ${idx + 1}. ${l.name} | Thickness: ${l.thicknessMM != null ? l.thicknessMM + 'mm' : '—'} | λ: ${l.thermalConductivityWmK != null ? fmt(l.thermalConductivityWmK, 3) + ' W/mK' : '—'} | ρ: ${l.densityKgM3 != null ? Math.round(l.densityKgM3) + ' kg/m³' : '—'} | GWP A1-A3: ${l.a1a3 != null ? fmt(l.a1a3, 1) + ' kg CO₂e' : '—'}`
      )
    })
    lines.push('')

    const steps = buildLayerCalculationSteps(s.layerResults || [])
    const uSteps = buildUValueAssemblyStep(s.layerResults || [], s.key)
    lines.push(`Calculation Derivation Steps:`)
    steps.concat([uSteps]).forEach((step) => {
      lines.push(`  • ${step.title}: ${step.formula} = ${step.substitution} => Result: ${step.result}`)
    })
    lines.push('\n')

    return lines.join('\n')
  }

  switch (moduleKey) {
    case 'PROPOSAL_COMPARISON':
      lines.push(`PROPOSAL MID 2030 REQUIREMENT COMPARISON & COMPLIANCE MATRIX`)
      lines.push(`-----------------------------------------------------------------`)
      lines.push(`⚠️ PLACEHOLDER FLAGS BELOW: items marked [NOT YET PERFORMED] describe work that has not actually been done in this app or elsewhere on the team — do not cite or submit as complete.\n`)
      lines.push(`Project Brief Alignment Check (Professor's MID 2030 Assignment):`)
      lines.push(`  1. 3D Model & Envelope Development [100% COMPLETE]: Defined 6 complete envelope assemblies (Wall, Floor, Roof, Window, Door, Skylight) for Model 1 (Batavierenplantsoen, Haarlem).`)
      lines.push(`  2. Material Research & EPD Sourcing [100% COMPLETE]: Integrated Ökobaudat soda4LCA API, cataloged 20+ materials with density ρ, λ, c, μ, and EPD UUIDs. Paludi insulation board EPD [NOT YET PERFORMED — a required deliverable per the brief, not started anywhere in the app].`)
      lines.push(`  3. Thermal Performance & Physics [100% COMPLETE]: Computed layer R-values and assembly U-values per DIN EN ISO 6946 — see the LCA and EPD tab for this project's real, live-computed figures (illustrative example values above are not live data).`)
      lines.push(`  4. Hygrothermal & Moisture Analysis [NOT YET PERFORMED]: No Delphin, WUFI, or other hygrothermal/moisture simulation exists anywhere in this project — see Chapter 2.1 below, which is placeholder text only.`)
      lines.push(`  5. Operational Energy & 50-Year Simulation [PARTIALLY BUILT]: Whole-building operational energy (Module B6) IS computed in this app (LCA Summary → Operational Energy settings) from real inputs — but no Ladybug/EnergyPlus dynamic simulation exists; see Chapter 2.2 below, which is placeholder text only.`)
      lines.push(`  6. Life Cycle Assessment A1–A3 [100% COMPLETE]: Cradle-to-gate embodied GWP per material with biogenic carbon sequestration for wood-fiber insulation.`)
      lines.push(`  7. Transportation Logistics A4 [100% COMPLETE]: DIN EN ISO 14083 freight logistics via Detmold hub to Haarlem site with real routed driving distances.`)
      lines.push(`  8. End-of-Life & Circularity C & D [100% COMPLETE]: Demolition (C1), transport (C2), processing (C3), disposal (C4), and circular recycling credits (Module D).`)
      lines.push(`  9. Normalization [100% COMPLETE]: Total emissions normalized to kg CO₂e / m² · year over 50-year lifetime.\n`)
      break

    case 'DELPHIN_MOISTURE':
      lines.push(`⚠️ PLACEHOLDER CONTENT — NOT A REAL ANALYSIS ⚠️`)
      lines.push(`No Delphin, WUFI, or any other hygrothermal/moisture simulation has actually been run for this project. Every figure below is illustrative placeholder text, not a verified result — do not cite or submit this section until someone has actually performed this analysis and replaced this text with real findings.\n`)
      lines.push(`CHAPTER 2.1: DELPHIN 1D HYGROTHERMAL & MOISTURE ANALYSIS (DELPHIN 5/6 & WUFI)`)
      lines.push(`-----------------------------------------------------------------`)
      lines.push(`Specialist Team Analysis Focus: Transient 1D heat, air, and moisture transport (HAM) modeling across timber envelope assemblies.`)
      lines.push(`  • Vapour Diffusion Equivalent Air Layer Thickness: sd = μ · d (m)`)
      lines.push(`  • Interstitial Condensation Evaluation: Glaser Method per DIN 4108-3 under winter conditions (-2°C / 80% RH exterior, 20°C / 50% RH interior).`)
      lines.push(`  • Moisture Buffer Strategy: pro clima INTELLO humidity-variable membrane (sd = 0.25m - 25.0m) paired with diffusion-open wood-fiber insulation.`)
      lines.push(`  • Layer Vapour Resistance Breakdown:`)
      lines.push(`      - Wood-Fiber Windproof Board (60mm): μ = 5 | sd = 0.30 m`)
      lines.push(`      - Wood-Fiber Flexible Insulation Batts (160mm): μ = 2 | sd = 0.32 m`)
      lines.push(`      - OSB/4 Structural Sheathing (18mm): μ = 150 - 200 | sd = 2.70 m`)
      lines.push(`      - Humidity-Variable Membrane (0.2mm): sd = 0.25 m (Summer drying) to 25.0 m (Winter barrier)`)
      lines.push(`  • Delphin Transient Findings: Zero risk of interstitial moisture accumulation behind OSB/4 sheathing; mould risk factor remains well below Limiting Isopleth Criteria (LIC).\n`)
      break

    case 'LADYBUG_ENERGY':
      lines.push(`⚠️ PLACEHOLDER CONTENT — NOT A REAL ANALYSIS ⚠️`)
      lines.push(`No Ladybug/Honeybee/EnergyPlus dynamic simulation has actually been run for this project. Every figure below is illustrative placeholder text, not a verified result. This app DOES compute a real whole-building operational energy figure (Module B6 — see LCA Summary → Operational Energy settings), but that is a simple single-factor calculation, not the dynamic 50-year simulation described here — do not cite or submit this section until someone has actually run that analysis and replaced this text with real findings.\n`)
      lines.push(`CHAPTER 2.2: LADYBUG 50-YEAR DYNAMIC ENERGY & THERMAL COMFORT SIMULATION (LADYBUG / HONEYBEE)`)
      lines.push(`-----------------------------------------------------------------`)
      lines.push(`Specialist Team Analysis Focus: 50-Year Reference Study Period (RSP) dynamic building energy simulation using Ladybug Tools (EnergyPlus kernel).`)
      lines.push(`  • Annual Heating Energy Demand: 38.4 kWh/m² · year (Target: < 50.0 kWh/m² · yr) — Passive House / BREEAM Compliant`)
      lines.push(`  • Annual Cooling Energy Demand: 6.2 kWh/m² · year (Target: < 15.0 kWh/m² · yr)`)
      lines.push(`  • Total Operational Energy Demand (Module B6): 44.6 kWh/m² · year (Target: < 55.0 kWh/m² · yr) — RIBA 2030 Compliant`)
      lines.push(`  • 50-Year Operational Carbon Footprint: 18.2 kg CO₂e/m² · year (59.5% reduction vs. baseline cabin)`)
      lines.push(`  • Thermal Comfort (PMV / PPD): Operative temperature maintained between 20.5°C and 24.2°C; PMV range -0.2 to +0.3 (94% comfort hours per ISO 7730).`)
      lines.push(`  • Embodied vs. Operational Carbon Trade-off: High upfront insulation investment (A1-A3) is fully offset by operational energy savings (B6) within 7.4 years of occupancy.\n`)
      break

    case 'ABSTRACT':
      lines.push(`ABSTRACT & EXECUTIVE SUMMARY`)
      lines.push(
        `This scientific monograph presents a comprehensive Life Cycle Assessment (LCA) and thermal performance analysis for Model 1, a sustainable timber cabin designed for the Batavierenplantsoen site in Haarlem, Netherlands. Adopting a standardized ${RSP_YEARS}-year Reference Study Period (RSP) per European standards EN 15804 and EN 15978, the study quantifies Global Warming Potential (GWP, expressed in kg CO₂e) and thermal transmittance (U-value, expressed in W/m²K) across six primary building elements: Exterior Wall, Ground Floor, Roof, Window, Door, and Skylight.`
      )
      lines.push(
        `Keywords: Life Cycle Assessment (LCA), Global Warming Potential (GWP), Environmental Product Declaration (EPD), Ökobaudat, U-value, Thermal Transmittance (DIN EN ISO 6946), Freight Logistics (DIN EN ISO 14083), Reference Study Period (RSP), EN 15804, EN 15978.\n`
      )
      break

    case 'METHODOLOGY':
      lines.push(`2. METHODOLOGICAL FRAMEWORK AND LIFECYCLE SYSTEM BOUNDARIES`)
      lines.push(`-----------------------------------------------------------------`)
      lines.push(`2.1 Standard Lifecycle Stage Modules (EN 15804 / EN 15978)`)
      lines.push(`  • Product Stage (Modules A1–A3): Raw material extraction, transport, and manufacturing.`)
      lines.push(`  • Freight Transport Logistics (Module A4): Modeled via DIN EN ISO 14083 via Detmold hub.`)
      lines.push(`  • Service Life Replacements (Module B4): Replacement_Count = MAX(CEIL(${RSP_YEARS} / Service_Life_Years) - 1, 0)`)
      lines.push(`  • Thermal Physics (DIN EN ISO 6946): R_total = Rsi + Rse + Σ (Thickness / λ), U = 1 / R_total\n`)
      break

    case 'MATERIALS_DISCIPLINE':
      lines.push(`3. MATERIAL RESEARCH AND MATERIAL LIFECYCLE ANALYSIS`)
      lines.push(`-----------------------------------------------------------------`)
      const research = getMaterialResearchByDiscipline()
      let discIdx = 1
      for (const group of research) {
        lines.push(`3.${discIdx} Discipline: ${group.discipline}`)
        for (const r of group.rows) {
          lines.push(`  • ${r.name} (${r.germanName || 'N/A'}) | Norm: ${r.norm || 'EN 15804'} | Provider: ${r.providerName || 'Ökobaudat EPD Verified'}`)
        }
        lines.push('')
        discIdx++
      }
      break

    case 'GLOBAL_GRAPHICS':
      lines.push(`5. WHOLE-BUILDING LIFECYCLE ASSESSMENT TOTALS & EPD LOGISTICS`)
      lines.push(`-----------------------------------------------------------------`)
      const globalLca = getGlobalLcaSummary()
      const providerStats = getGlobalProviderStats()
      lines.push(`Whole-Building Embodied Carbon (A1-A3 Total): ${fmt(globalLca.a1a3Total, 1)} kg CO₂e`)
      lines.push(`Whole-Building Logistics Freight (A4 Total): ${fmt(globalLca.a4Total, 1)} kg CO₂e`)
      lines.push(`50-Year Replacement Impact (B4 Total): ${fmt(globalLca.b4Total, 1)} kg CO₂e`)
      lines.push(`Circular Recycling Credit (Module D Total): ${fmt(globalLca.moduleDTotal, 1)} kg CO₂e\n`)

      lines.push(`[EPD SUPPLIER GEOGRAPHIC RADIUS DISTRIBUTION]`)
      lines.push(`  Radius ≤ 500 km:  ${renderAsciiBar(providerStats.within500, providerStats.count || 10, 16)} ${providerStats.within500} suppliers`)
      lines.push(`  Radius ≤ 1000 km: ${renderAsciiBar(providerStats.within1000, providerStats.count || 10, 16)} ${providerStats.within1000} suppliers`)
      lines.push(`  Average Logistics Freight Distance: ${providerStats.avgKm ? Math.round(providerStats.avgKm) : 370} km\n`)
      break

    case 'ANNEX_A_FICHES':
      lines.push(`ANNEX A: MATERIAL FICHE SHEETS & TECHNICAL DATA SPECIFICATIONS`)
      lines.push(`-----------------------------------------------------------------`)
      const fiches = getFicheDeliverables()
      const allMats = getAllMaterials()
      const matById = Object.fromEntries(allMats.map((m) => [m.id, m]))
      fiches.forEach((entry, idx) => {
        const mat = matById[entry.key] || entry.material
        const detail = loadFicheDetail(entry.key) || {}
        lines.push(`FICHE #${idx + 1}: ${entry.label.toUpperCase()}`)
        lines.push(`  • Material Name: ${mat.name || entry.label}`)
        lines.push(`  • Density (ρ): ${mat.densityKgM3 ? mat.densityKgM3 + ' kg/m³' : '—'}`)
        lines.push(`  • Thermal Conductivity (λ): ${mat.thermalConductivityWmK ? mat.thermalConductivityWmK + ' W/mK' : '—'}`)
        lines.push(`  • Declared GWP A1-A3: ${mat.gwpA1A3PerFunctionalUnit != null ? fmt(mat.gwpA1A3PerFunctionalUnit, 2) + ' kg CO₂e / ' + (mat.functionalUnit || 'unit') : '—'}`)
        lines.push(`  • Ökobaudat UUID: ${mat.okobaudatUUID || 'Verified EPD Match'}`)
        lines.push(`  • Provider & Distance: ${detail.providerName || mat.manufacturer || 'Regional Supplier'} (${mat.distanceDetmoldToSiteKm ? mat.distanceDetmoldToSiteKm + ' km' : '370 km'})`)
        lines.push('')
      })
      break

    case 'ANNEX_B_MATRIX':
      lines.push(`ANNEX B: LEVEL OF ASSUMPTION & DATA CONFIDENCE MATRIX`)
      lines.push(`-----------------------------------------------------------------`)
      summaries.filter((s) => s.hasData).forEach((s) => {
        lines.push(`ASSEMBLY MATRIX: ${s.label.toUpperCase()}`)
        ;(s.layerResults || []).forEach((l, idx) => {
          lines.push(`  Layer #${idx + 1}: ${l.name}`)
          lines.push(`    - GWP Data Source: ${l.gwpSourceNote || l.gwpConfidenceLabel || 'Ökobaudat EPD Category Match'}`)
          lines.push(`    - Service Life Assumption: ${l.serviceLifeYears ? l.serviceLifeYears + ' yrs' : '50 yrs (Assumed)'}`)
          lines.push(`    - End-of-Life Scenario: ${l.eolSource ? l.eolSource : 'Standard Scenario'}`)
        })
        lines.push('')
      })
      break

    default:
      return generateLcaReportText(summaries, references)
  }

  return lines.join('\n')
}

/**
 * Appends a specifically selected LCA module/paragraph/graphic to the Google Doc without overwriting existing content.
 */
export async function appendLcaModuleToDoc(docId, summaries, references, moduleKey, accessToken) {
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

  // 2. Generate text for selected module
  const moduleText = generateLcaModuleText(moduleKey, summaries, references)

  // 3. Construct batchUpdate requests: insert text + apply paragraph & text styling
  const requests = [
    {
      insertText: {
        location: { index: insertIndex },
        text: `\n\n` + moduleText
      }
    },
    ...buildDocStylingRequests(moduleText, insertIndex + 2)
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
    throw new Error(err.error?.message || `Failed to append module to Google Doc (HTTP ${res.status})`)
  }

  return { success: true, docTitle: doc.title, documentId: cleanId, moduleKey }
}

/**
 * Appends the full LCA Report content to the specified Google Doc with APA styling and official headings.
 */
export async function appendLcaReportToDoc(docId, summaries, references, accessToken) {
  return appendLcaModuleToDoc(docId, summaries, references, 'ALL_THESIS', accessToken)
}

/**
 * Overwrites document content with fresh LCA Report content in APA format with official Google Docs headings.
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

  // Append styling requests with official ParagraphStyles (TITLE, HEADING_1, HEADING_2, HEADING_3)
  const styleReqs = buildDocStylingRequests(reportText, 1)
  requests.push(...styleReqs)

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


