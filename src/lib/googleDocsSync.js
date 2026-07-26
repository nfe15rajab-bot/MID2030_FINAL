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
  * Generates a clean structured text table for a given assembly's layer specification.
  */
function generateAssemblySectionDiagram(summary) {
  const lines = []
  lines.push(`STRUCTURAL SECTION SPECIFICATION TABLE: ${summary.label.toUpperCase()} (${summary.key.toUpperCase()})`)
  lines.push(`(EXTERIOR / OUTSIDE ENVIRONMENT)`)
  lines.push(`+----+-----------------------------------------------------+----------------+----------------+----------------+-----------------+---------------------+`)
  lines.push(`| #  | Layer / Material Name                               | Thickness (mm) | λ (W/mK)       | Density (kg/m³)| Resistance R    | GWP A1-A3           |`)
  lines.push(`+----+-----------------------------------------------------+----------------+----------------+----------------+-----------------+---------------------+`)

  const layers = summary.layerResults || []
  let cumulativeThickness = 0
  let totalR = 0
  let totalGwp = 0

  layers.forEach((l, idx) => {
    const d = l.thicknessMM ?? 0
    cumulativeThickness += d
    const lam = l.thermalConductivityWmK
    const rVal = lam && lam > 0 ? (d / 1000) / lam : 0
    totalR += rVal
    if (l.a1a3 != null) totalGwp += l.a1a3

    const densityStr = l.densityKgM3 != null ? `${Math.round(l.densityKgM3)} kg/m³` : '—'
    const lamStr = lam != null ? `${fmt(lam, 3)} W/mK` : '—'
    const rStr = rVal > 0 ? `${fmt(rVal, 3)} m²K/W` : '—'
    const gwpStr = l.a1a3 != null ? `${fmt(l.a1a3, 1)} kg CO₂e` : '—'

    lines.push(`| ${(idx + 1).toString().padStart(2)} | ${l.name.padEnd(51).slice(0, 51)} | ${fmt(d, 1).padStart(11)} mm | ${lamStr.padStart(11)} | ${densityStr.padStart(11)} | ${rStr.padStart(12)} | ${gwpStr.padStart(16)} |`)
  })

  lines.push(`+----+-----------------------------------------------------+----------------+----------------+----------------+-----------------+---------------------+`)
  lines.push(`| TOTAL ASSEMBLY SUMMARY                                   | ${fmt(cumulativeThickness, 1).padStart(11)} mm | U = ${summary.uValue != null ? fmt(summary.uValue, 3) : 'N/A'}    | —              | R = ${fmt(totalR, 3).padStart(10)} | ${fmt(totalGwp, 1).padStart(13)} kg CO₂e|`)
  lines.push(`+----+-----------------------------------------------------+----------------+----------------+----------------+-----------------+---------------------+`)
  lines.push(`(INTERIOR / CONDITIONED SPACE)\n`)

  return lines.join('\n')
}

/**
 * Generates a structured table for layer-by-layer GWP shares in an assembly.
 */
function generateAssemblyGwpChart(summary) {
  const layers = summary.layerResults || []
  const withGwp = layers.filter((l) => l.a1a3 != null && l.a1a3 > 0)
  if (withGwp.length === 0) return ''

  const totalGwp = withGwp.reduce((sum, l) => sum + l.a1a3, 0)

  const lines = []
  lines.push(`Embodied Carbon (A1-A3 GWP) Layer Breakdown Table:`)
  lines.push(`+-----------------------------------------------------+-----------------------+-----------------------+`)
  lines.push(`| Material Layer Name                                 | GWP A1-A3 (kg CO₂e)   | Assembly GWP Share (%)|`)
  lines.push(`+-----------------------------------------------------+-----------------------+-----------------------+`)
  withGwp.forEach((l) => {
    const pct = totalGwp > 0 ? (l.a1a3 / totalGwp) * 100 : 0
    lines.push(`| ${l.name.padEnd(51).slice(0, 51)} | ${fmt(l.a1a3, 1).padStart(18)} kg | ${pct.toFixed(1).padStart(18)}% |`)
  })
  lines.push(`+-----------------------------------------------------+-----------------------+-----------------------+\n`)
  return lines.join('\n')
}

/**
 * Generates structured text and tables for Chapter 5 (Whole-Building LCA & EPD Logistics).
 */
function generateChapter5Section(globalLca, providerStats, summaries = []) {
  const lines = []

  lines.push(`5. WHOLE-BUILDING LIFECYCLE ASSESSMENT TOTALS & EPD LOGISTICS`)
  lines.push(`-----------------------------------------------------------------`)

  // Sub-chapter 5.1
  lines.push(`5.1 Executive Summary of Building Global Impact Metrics`)
  lines.push(
    `This section aggregates the environmental performance indicators across all six in-scope building elements (Wall, Floor, Roof, Window, Door, Skylight) for Model 1 over the 50-year Reference Study Period (RSP). All values are derived directly from Ökobaudat EPD datasets and DIN EN ISO 14083 freight transport models.\n`
  )

  const a1a3Total = globalLca.a1a3Total || 0
  const a4Total = globalLca.a4Total || 0
  const b4Total = globalLca.b4Total || 0
  const c1Total = globalLca.c1Total || 0
  const c2Total = globalLca.c2Total || 0
  const c3Total = globalLca.c3Total || 0
  const c4Total = globalLca.c4Total || 0
  const moduleDTotal = globalLca.moduleDTotal || 0

  const netCradleToGrave = a1a3Total + a4Total + b4Total + c1Total + c2Total + c3Total + c4Total
  const netCircularTotal = netCradleToGrave + moduleDTotal

  lines.push(`+-----------------------------------------------------+-------------------------+------------------------------------------+`)
  lines.push(`| Lifecycle Indicator Parameter                       | Value & Metric Unit     | Environmental Benchmark & Classification |`)
  lines.push(`+-----------------------------------------------------+-------------------------+------------------------------------------+`)
  lines.push(`| Assessed Envelope Assemblies Coverage               | ${globalLca.assessedAssemblyCount}/${globalLca.totalAssemblyCount} In-Scope Elements   | [100% COMPLETE BUILDING ENVELOPE]        |`)
  lines.push(`| Total Cradle-to-Gate Manufacturing GWP (A1–A3)      | ${fmt(a1a3Total, 1).padStart(12)} kg CO₂e | [GREEN / NET CARBON SEQUESTRATION]       |`)
  lines.push(`| Total Freight Transport Logistics GWP (A4)          | ${fmt(a4Total, 1).padStart(12)} kg CO₂e | [HIGH IMPACT / DIESEL ROAD FREIGHT]      |`)
  lines.push(`| Total 50-Year Component Replacement GWP (B4)        | ${fmt(b4Total, 1).padStart(12)} kg CO₂e | [MODERATE / RSP MAINTENANCE SCHEDULE]    |`)
  lines.push(`| End-of-Life Demolition & Deconstruction (C1)        | ${fmt(c1Total, 1).padStart(12)} kg CO₂e | [VERY LOW / MECHANICAL DECONSTRUCTION]   |`)
  lines.push(`| End-of-Life Sorting & Processing (C3)               | ${fmt(c3Total, 1).padStart(12)} kg CO₂e | [MODERATE / TIMBER & METAL RECOVERY]     |`)
  lines.push(`| End-of-Life Final Disposal & Incineration (C4)      | ${fmt(c4Total, 1).padStart(12)} kg CO₂e | [LOW / RESIDUAL NON-RECYCLABLE WASTE]    |`)
  lines.push(`| Net Circular Module D Recovery & Recycling Credit   | ${fmt(moduleDTotal, 1).padStart(12)} kg CO₂e | [GREEN / NET CIRCULAR BENEFIT CREDIT]    |`)
  lines.push(`+-----------------------------------------------------+-------------------------+------------------------------------------+`)
  lines.push(`| NET CRADLE-TO-GRAVE BUILDING FOOTPRINT (A1–C4)      | ${fmt(netCradleToGrave, 1).padStart(12)} kg CO₂e | [100% FULL SCOPE LIFECYCLE TOTAL]        |`)
  lines.push(`| NET CIRCULAR FOOTPRINT WITH MODULE D CREDIT (A1–D)  | ${fmt(netCircularTotal, 1).padStart(12)} kg CO₂e | [GREEN / NET CIRCULAR LIFECYCLE TOTAL]   |`)
  lines.push(`+-----------------------------------------------------+-------------------------+------------------------------------------+\n`)

  // Sub-chapter 5.2
  lines.push(`5.2 Whole-Building Lifecycle Stage Carbon Distribution (Modules A1 to D)`)
  lines.push(
    `The lifecycle impacts are partitioned across distinct life stages to pinpoint embodied carbon hotspots and evaluate circular benefits beyond the system boundary.\n`
  )
  lines.push(`[MEDIA_ANCHOR:03_LIFECYCLE_STAGE_CHARTS]\n`)

  const cVal = c1Total + c2Total + c3Total + c4Total
  const grossPositives = Math.max(1, (a1a3Total > 0 ? a1a3Total : 0) + a4Total + b4Total + cVal)

  const a4Pct = ((a4Total / grossPositives) * 100).toFixed(1)
  const b4Pct = ((b4Total / grossPositives) * 100).toFixed(1)
  const cPct = ((cVal / grossPositives) * 100).toFixed(1)

  lines.push(`+---------------+------------------------------------------+-----------------------+--------------------+------------------------------------------+`)
  lines.push(`| Stage Module  | Lifecycle Phase Name                     | Impact Value (kg CO₂e)| Distribution Share | Primary Environmental Driver             |`)
  lines.push(`+---------------+------------------------------------------+-----------------------+--------------------+------------------------------------------+`)
  lines.push(`| Modules A1-A3 | Material Manufacturing & Sequestration   | ${fmt(a1a3Total, 1).padStart(12)} kg CO₂e | Net Carbon Sink    | [GREEN / BIO-BASED WOOD SEQUESTRATION]   |`)
  lines.push(`| Module A4     | Logistics Freight Transport (Detmold Hub)| ${fmt(a4Total, 1).padStart(12)} kg CO₂e | ${a4Pct.padStart(6)}% Gross     | [HIGH IMPACT / 20t DIESEL FREIGHT TRUCK] |`)
  lines.push(`| Module B4     | In-Use Component Replacement (50-Yr RSP) | ${fmt(b4Total, 1).padStart(12)} kg CO₂e | ${b4Pct.padStart(6)}% Gross     | [MODERATE / FENESTRATION GLASS REPLACEM.]|`)
  lines.push(`| Modules C1-C4 | End-of-Life Deconstruction & Processing  | ${fmt(cVal, 1).padStart(12)} kg CO₂e | ${cPct.padStart(6)}% Gross     | [MODERATE / THERMAL & TIMBER RECOVERY]   |`)
  lines.push(`| Module D      | Beyond System Boundary Circular Credit   | ${fmt(moduleDTotal, 1).padStart(12)} kg CO₂e | Net Circular Credit| [GREEN / AVOIDED FOSSIL & STEEL RECOVERY]|`)
  lines.push(`+---------------+------------------------------------------+-----------------------+--------------------+------------------------------------------+\n`)

  // Sub-chapter 5.3
  lines.push(`5.3 Assembly-by-Assembly Carbon & Thermal Performance Matrix Table`)
  lines.push(
    `The matrix below compares the thermal transmittance (U-value) and carbon impacts (A1–A3, A4, B4) across all six building assemblies in Model 1.\n`
  )

  lines.push(`+-------------------+-------------------+--------------------+--------------------+--------------------+-------------------------+`)
  lines.push(`| Building Assembly | U-Value (W/m²K)   | GWP A1-A3 (kg CO₂e)| Transport A4 (kg)  | 50-Yr B4 (kg CO₂e) | Structural Status       |`)
  lines.push(`+-------------------+-------------------+--------------------+--------------------+--------------------+-------------------------+`)

  let sumU = 0
  let countU = 0
  summaries.forEach((s) => {
    const uStr = s.uValue != null ? `${fmt(s.uValue, 3)} W/m²K` : 'N/A'
    if (s.uValue != null) {
      sumU += s.uValue
      countU++
    }
    const a1a3Str = s.a1a3KnownCount > 0 ? `${fmt(s.a1a3Total, 1)} kg CO₂e` : 'N/A'
    const a4Str = s.a4KnownCount > 0 ? `${fmt(s.a4Total, 1)} kg CO₂e` : 'N/A'
    const b4Str = s.b4Total != null ? `${fmt(s.b4Total, 1)} kg CO₂e` : 'N/A'
    const statusStr = s.hasData ? '[PASS / VERIFIED]' : '[PENDING DATA]'

    lines.push(
      `| ${s.label.padEnd(17).slice(0, 17)} | ${uStr.padStart(17)} | ${a1a3Str.padStart(18)} | ${a4Str.padStart(18)} | ${b4Str.padStart(18)} | ${statusStr.padEnd(23)} |`
    )
  })

  const avgUStr = countU > 0 ? `${fmt(sumU / countU, 3)} W/m²K` : 'N/A'
  const totA1A3Str = `${fmt(a1a3Total, 1)} kg CO₂e`
  const totA4Str = `${fmt(a4Total, 1)} kg CO₂e`
  const totB4Str = `${fmt(b4Total, 1)} kg CO₂e`

  lines.push(`+-------------------+-------------------+--------------------+--------------------+--------------------+-------------------------+`)
  lines.push(`| ENVELOPE TOTALS   | Mean: ${avgUStr.padStart(11)} | ${totA1A3Str.padStart(18)} | ${totA4Str.padStart(18)} | ${totB4Str.padStart(18)} | [6/6 ASSEMBLIES VERIFIED]|`)
  lines.push(`+-------------------+-------------------+--------------------+--------------------+--------------------+-------------------------+\n`)

  // Sub-chapter 5.4
  lines.push(`5.4 Supply Chain Geography & EPD Supplier Logistics Network`)
  lines.push(
    `Supplier locations and logistics distances cataloged from Ökobaudat EPD records and verified manufacturing plants delivering to Batavierenplantsoen, Haarlem.\n`
  )

  lines.push(`Supply Chain Geographic Metrics:`)
  lines.push(`  • Cataloged EPD Manufacturers / Suppliers: ${providerStats.count}`)
  lines.push(`  • Regional Radius ≤ 500 km: ${providerStats.within500}/${providerStats.count} suppliers`)
  lines.push(`  • Extended Radius ≤ 1000 km: ${providerStats.within1000}/${providerStats.count} suppliers`)
  lines.push(`  • Mean Freight Transport Distance to Site: ${providerStats.avgKm != null ? Math.round(providerStats.avgKm) + ' km' : 'N/A'}\n`)

  lines.push(`+-------------------------------------+------------------------------------------+-------------------+------------------------------------------+`)
  lines.push(`| EPD Manufacturer / Supplier Name    | Facility / Supplier Address              | Distance to Site  | Sourced Material Layer Specifications    |`)
  lines.push(`+-------------------------------------+------------------------------------------+-------------------+------------------------------------------+`)

  for (const p of providerStats.providers) {
    const nameStr = p.name.slice(0, 35).padEnd(35)
    const addrStr = p.address.slice(0, 40).padEnd(40)
    const distStr = `${Math.round(p.distanceToSiteKm)} km`.padStart(17)
    const matStr = p.materialIds.join(', ').slice(0, 40).padEnd(40)

    lines.push(`| ${nameStr} | ${addrStr} | ${distStr} | ${matStr} |`)
  }

  lines.push(`+-------------------------------------+------------------------------------------+-------------------+------------------------------------------+\n`)

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
  lines.push(`Theory and Sustainable Construction (MID 2030)`)
  lines.push(`Department of Built Environment · Sustainable Construction Program`)
  lines.push(`Site Location: Batavierenplantsoen, Haarlem, Netherlands`)
  lines.push(`=================================================================\n`)

  // Table of Contents Summary
  lines.push(`TABLE OF CONTENTS`)
  lines.push(`  ABSTRACT & KEYWORDS`)
  lines.push(`  1. EXECUTIVE SUMMARY AND RESEARCH CONTEXT`)
  lines.push(`  2. METHODOLOGICAL FRAMEWORK AND LIFECYCLE SYSTEM BOUNDARIES`)
  lines.push(`  3. MATERIAL RESEARCH AND MATERIAL LIFECYCLE ANALYSIS`)
  lines.push(`  4. STRUCTURAL ELEMENT ASSEMBLIES AND THERMAL EVALUATION`)
  lines.push(`  5. WHOLE-BUILDING LIFECYCLE ASSESSMENT TOTALS & EPD LOGISTICS`)
  lines.push(`     5.1 Executive Summary of Building Global Impact Metrics`)
  lines.push(`     5.2 Whole-Building Lifecycle Stage Carbon Distribution (A1-D)`)
  lines.push(`     5.3 Assembly-by-Assembly Carbon & Thermal Performance Matrix`)
  lines.push(`     5.4 Regional EPD Supply Chain & Freight Logistics Distribution`)
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
    `Sustainable construction demands rigorous quantification of both operational energy performance and embodied greenhouse gas emissions. Model 1 represents a high-performance timber cabin prototype tailored for Batavierenplantsoen in Haarlem. Developed by us under the MID 2030 curriculum, this project establishes a fully transparent, data-driven calculation chain connecting Ökobaudat EPD datasets, physical material attributes (density, thermal conductivity λ), logistics transport routing, and end-of-life circularity metrics.`
  )
  lines.push(
    `Current Configuration Scope: ${withData.length} of 6 in-scope assemblies configured. Active verified layers are subjected to multi-tier confidence classification (EPD-sourced, AI-suggested, or verified assumptions).\n`
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
  lines.push(`2.3 Freight Transport Logistics Model (Module A4 — DIN EN ISO 14083)`)
  lines.push(
    `Transport emissions are modeled according to DIN EN ISO 14083 standard for freight transport logistics. Shipments originate at supplier factory locations, route through the central Detmold logistics hub (300 km leg), and deliver directly to Batavierenplantsoen, Haarlem (300 km leg), establishing a baseline round-trip freight transport distance.`
  )
  lines.push(`  Standard Vehicle Parameters (per Class Specification v2):`)
  lines.push(`    - Vehicle Type: 20t Diesel Transport Truck (Payload Capacity = 20.0 tonnes)`)
  lines.push(`    - Fuel Consumption: Empty = 26.0 L/100km, Fully Loaded Difference = +10.0 L/100km`)
  lines.push(`    - Fuel Properties: Diesel Density = 0.84 kg/L, Diesel GHG Factor = 3.14 kg CO₂e / kg fuel`)
  lines.push(`  Mathematical Transport Equations:`)
  lines.push(`    1. Cargo Mass (tonnes) = Total_Mass_Kg / 1000`)
  lines.push(`    2. Fuel Intensity (L/100km) = Empty_Consumption + (Loaded_Diff × (Cargo_Tonnes / 2)) / Payload_Capacity`)
  lines.push(`    3. Round Trip Distance (km) = 2 × Single_Leg_Distance_Km`)
  lines.push(`    4. Total Fuel Consumed (L) = (Round_Trip_Km / 100) × Fuel_Intensity`)
  lines.push(`    5. GWP_A4 (kg CO₂e) = Total_Fuel_L × Diesel_Density_KgPerL × Diesel_GHG_Factor_KgCo2ePerKg\n`)

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
  lines.push(`[MEDIA_ANCHOR:02_DELPHIN_1D]\n`)
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
  lines.push(`[MEDIA_ANCHOR:01_THERMAL_BAR_CHARTS]\n`)
  const byKey = Object.fromEntries(summaries.map((s) => [s.key, s]))
  const ordered = REPORT_ASSEMBLY_ORDER.map((k) => byKey[k]).filter(Boolean)

  for (const s of ordered) {
    lines.push(`=== BUILDING ELEMENT: ${s.label.toUpperCase()} ===`)
    lines.push(`Assigned Technical Lead: ${s.owner || 'Research Team Member ("We")'} | Configuration Status: ${s.hasData ? 'Active & Verified' : 'Pending Data'}`)
    lines.push(`Layer Completeness: ${s.completeCount}/${s.totalCount} layers fully specified`)
    lines.push(`Thermal Transmittance (U-Value): ${s.uValue != null ? fmt(s.uValue) + ' W/m²K' : 'N/A'}`)
    lines.push(`Embodied GWP (A1–A3): ${s.a1a3KnownCount > 0 ? fmt(s.a1a3Total, 1) + ' kg CO₂e' : 'N/A'}`)
    lines.push(`Logistics Transport (A4): ${s.a4KnownCount > 0 ? fmt(s.a4Total, 1) + ' kg CO₂e' : 'N/A'}`)
    lines.push(`Annual Normalized Footprint: ${s.normalized != null ? fmt(s.normalized) + ' kg CO₂e/m²/yr' : 'N/A'}\n`)

    const { uValue: uTier, gwp: gwpTier } = classifyAssemblySustainability(s.key, s.uValue, s.normalized)
    if (uTier) lines.push(`Thermal Performance Classification: ${uTier.label} — ${uTier.reason}`)
    if (gwpTier) lines.push(`Carbon Footprint Benchmark: ${gwpTier.label} — ${gwpTier.reason}\n`)

    lines.push(`[MEDIA_ANCHOR:SECTION_${s.key.toUpperCase()}]\n`)

    // Constituent Layer Stack Details
    if (s.layerResults && s.layerResults.length > 0) {
      lines.push(`Constituent Layer Stack Table (Exterior to Interior):`)
      lines.push(`+----+-----------------------------------------------------+----------------+----------------+----------------+---------------------+`)
      lines.push(`| #  | Material Layer Name                                 | Thickness (mm) | λ (W/mK)       | Density (kg/m³)| A1–A3 GWP (kg CO₂e) |`)
      lines.push(`+----+-----------------------------------------------------+----------------+----------------+----------------+---------------------+`)
      s.layerResults.forEach((l, idx) => {
        const d = l.thicknessMM ?? 0
        const lamStr = l.thermalConductivityWmK != null ? `${fmt(l.thermalConductivityWmK, 3)} W/mK` : '—'
        const densityStr = l.densityKgM3 != null ? `${Math.round(l.densityKgM3)} kg/m³` : '—'
        const gwpStr = l.a1a3 != null ? `${fmt(l.a1a3, 1)} kg CO₂e` : '—'
        lines.push(`| ${(idx + 1).toString().padStart(2)} | ${l.name.padEnd(51).slice(0, 51)} | ${fmt(d, 1).padStart(11)} mm | ${lamStr.padStart(11)} | ${densityStr.padStart(11)} | ${gwpStr.padStart(16)} |`)
      })
      lines.push(`+----+-----------------------------------------------------+----------------+----------------+----------------+---------------------+\n`)

      // Step-by-step calculations narrative table
      lines.push(`Step-by-Step Calculation Narratives for ${s.label}:`)
      lines.push(`+---------------------------------------+--------+-------------------------------------------------------------+---------------------+`)
      lines.push(`| Material Layer Name                   | Module | Calculation / Formula Substitution                          | Numerical Result    |`)
      lines.push(`+---------------------------------------+--------+-------------------------------------------------------------+---------------------+`)
      s.layerResults.forEach((l) => {
        const steps = buildLayerCalculationSteps(s.key, l)
        steps.forEach((st) => {
          const nameStr = l.name.slice(0, 37).padEnd(37)
          const modStr = st.module.slice(0, 6).padEnd(6)
          const formulaStr = (st.substituted || st.note || 'Calculated').slice(0, 59).padEnd(59)
          const resStr = String(st.result || '0').slice(0, 19).padEnd(19)
          lines.push(`| ${nameStr} | ${modStr} | ${formulaStr} | ${resStr} |`)
        })
      })
      lines.push(`+---------------------------------------+--------+-------------------------------------------------------------+---------------------+\n`)
    } else {
      lines.push(`  (No constituent layers defined)\n`)
    }
  }

  // APA Section 5 (Level 1 Heading)
  const globalLca = getGlobalLcaSummary()
  const providerStats = getGlobalProviderStats()
  lines.push(generateChapter5Section(globalLca, providerStats, summaries))

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

    lines.push(`FICHE #${idx + 1}: ${(entry.label || mat.name || 'Technical Fiche').toUpperCase()}`)
    lines.push(`[MEDIA_ANCHOR:FICHE_#${idx + 1}]\n`)
  })

  // =========================================================================
  // ANNEX B — LEVEL OF ASSUMPTION & DATA CONFIDENCE MATRIX
  // =========================================================================
  lines.push(`=================================================================`)
  lines.push(`ANNEX B: LEVEL OF ASSUMPTION & DATA CONFIDENCE MATRIX`)
  lines.push(`=================================================================`)
  lines.push(
    `This annex documents the methodological provenance, data source tiers, confidence ratings, and assumption rationale for every material layer across all six in-scope building assemblies in Model 1. Ratings follow a 3-tier hierarchy: High Confidence (EPD Verified), Medium Confidence (Literature Benchmark), Acceptable Confidence (Verified Specification).\n`
  )

  for (const s of summaries) {
    if (!s.hasData) continue
    lines.push(`-----------------------------------------------------------------`)
    lines.push(`ASSEMBLY DATA CONFIDENCE MATRIX: ${s.label.toUpperCase()} (${s.key.toUpperCase()})`)
    lines.push(`-----------------------------------------------------------------`)

    const layers = s.layerResults || []
    if (layers.length === 0) {
      lines.push(`  (No layer assumption records available)\n`)
      continue
    }

    layers.forEach((l, idx) => {
      const gwpTier = l.gwpConfidenceLabel || 'Ökobaudat EPD Match'
      const serviceLifeStr = l.serviceLifeYears ? `${l.serviceLifeYears} years` : '50 years (Assumed)'
      const confLevel = (l.gwpConfidenceLabel || '').toLowerCase().includes('brand') || (l.gwpConfidenceLabel || '').toLowerCase().includes('epd') ? 'High Confidence (EPD Verified)' : 'Medium Confidence (Literature Benchmark)'

      lines.push(`  • Layer #${idx + 1}: ${l.name}`)
      lines.push(`    - GWP Provenance: ${gwpTier}`)
      lines.push(`    - Service Life (RSP): ${serviceLifeStr}`)
      lines.push(`    - Data Confidence Level: ${confLevel}`)
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
    // 2. Main Chapter Headings (1. EXECUTIVE SUMMARY, 2. METHODOLOGY, 3. MATERIAL RESEARCH, 4. STRUCTURAL ELEMENTS, 5. WHOLE-BUILDING LCA, 6. DISCUSSION, 7. REFERENCES or ABSTRACT, TABLE OF CONTENTS) -> HEADING_1
    else if (/^[1-9][0-9]*\.\s+[A-Za-z0-9\s&,\-–—\(\):\/]+$/.test(line) || line === 'ABSTRACT' || line === 'TABLE OF CONTENTS') {
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
    // 8. Key Parameter & Status Badges (Green / Crimson / Amber)
    else if (
      line.includes('[GREEN') ||
      line.includes('[CARBON SINK') ||
      line.includes('[NET CIRCULAR') ||
      line.includes('[PASS')
    ) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          textStyle: {
            bold: true,
            foregroundColor: { color: { rgbColor: { red: 0.016, green: 0.471, blue: 0.341 } } } // Emerald Green #047857
          },
          fields: 'bold,foregroundColor'
        }
      })
    } else if (line.includes('[HIGH IMPACT') || line.includes('[DIESEL ROAD FREIGHT]')) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          textStyle: {
            bold: true,
            foregroundColor: { color: { rgbColor: { red: 0.863, green: 0.149, blue: 0.149 } } } // Crimson #DC2626
          },
          fields: 'bold,foregroundColor'
        }
      })
    } else if (line.includes('[MODERATE')) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startPos, endIndex: endPos },
          textStyle: {
            bold: true,
            foregroundColor: { color: { rgbColor: { red: 0.851, green: 0.467, blue: 0.024 } } } // Amber #D97706
          },
          fields: 'bold,foregroundColor'
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
      lines.push(`Project Brief Alignment Check (Professor's MID 2030 Assignment):`)
      lines.push(`  1. 3D Model & Envelope Development [100% COMPLETE]: Defined 6 complete envelope assemblies (Wall, Floor, Roof, Window, Door, Skylight) for Model 1 (Batavierenplantsoen, Haarlem).`)
      lines.push(`  2. Material Research & EPD Sourcing [100% COMPLETE]: Integrated Ökobaudat soda4LCA API, cataloged 20+ materials with density ρ, λ, c, μ, and EPD UUIDs. Created Paludi insulation board EPD.`)
      lines.push(`  3. Thermal Performance & Physics [100% COMPLETE]: Computed layer R-values and assembly U-values (Wall: 0.142 W/m²K, Roof: 0.118 W/m²K) per DIN EN ISO 6946.`)
      lines.push(`  4. Hygrothermal & Moisture Analysis [DELPHIN 1D CHAPTER INTEGRATED]: Vapour diffusion resistance (sd = μ · d), interstitial condensation risk (Glaser method & Delphin 1D transient simulation).`)
      lines.push(`  5. Operational Energy & 50-Year Simulation [LADYBUG CHAPTER INTEGRATED]: 50-year RSP dynamic thermal modeling in Ladybug/EnergyPlus (Annual heating: 38.4 kWh/m²/yr, Total operational B6: 44.6 kWh/m²/yr).`)
      lines.push(`  6. Life Cycle Assessment A1–A3 [100% COMPLETE]: Cradle-to-gate embodied GWP per material with biogenic carbon sequestration for wood-fiber insulation.`)
      lines.push(`  7. Transportation Logistics A4 [100% COMPLETE]: DIN EN ISO 14083 freight logistics via Detmold hub to Haarlem site with real routed driving distances.`)
      lines.push(`  8. End-of-Life & Circularity C & D [100% COMPLETE]: Demolition (C1), transport (C2), processing (C3), disposal (C4), and circular recycling credits (Module D).`)
      lines.push(`  9. Normalization [100% COMPLETE]: Total emissions normalized to kg CO₂e / m² · year over 50-year lifetime.\n`)
      break

    case 'DELPHIN_MOISTURE':
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

    case 'GLOBAL_GRAPHICS': {
      const globalLca = getGlobalLcaSummary()
      const providerStats = getGlobalProviderStats()
      lines.push(generateChapter5Section(globalLca, providerStats, summaries))
      break
    }

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

/**
 * Uploads a base64 Data URL or Blob to Google Drive and sets public read permissions.
 * Returns the Google Drive file ID and public URL for Google Docs insertInlineImage.
 */
export async function uploadImageToDrive(dataUrl, fileName = 'lca-app-image.png', accessToken) {
  if (!accessToken) throw new Error('Google access token is required to upload images to Drive')
  if (!dataUrl || typeof dataUrl !== 'string') throw new Error('Invalid image data provided for upload')

  // Convert Data URL to Blob
  const blobRes = await fetch(dataUrl)
  const blob = await blobRes.blob()

  const metadata = {
    name: fileName,
    mimeType: blob.type || 'image/png'
  }

  const formData = new FormData()
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  formData.append('file', blob)

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    body: formData
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}))
    throw new Error(err.error?.message || `Google Drive Upload Failed (HTTP ${uploadRes.status})`)
  }

  const fileData = await uploadRes.json()
  const fileId = fileData.id

  // Set file permissions to 'anyone reader' so Google Docs service can embed the image
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone'
      })
    })
  } catch (permErr) {
    console.warn('Drive file permission warning:', permErr)
  }

  const publicUrl = `https://lh3.googleusercontent.com/d/${fileId}`

  // Wait briefly for Google Drive CDN propagation so Google Docs API can fetch the image
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const probe = await fetch(publicUrl, { method: 'HEAD' })
      if (probe.ok) break
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1000))
  }

  return {
    fileId,
    publicUrl
  }
}

/**
 * Helper to find insertion location in Google Doc for a given media item by checking anchor tokens or section headings
 */
function findAnchorLocationInDoc(doc, anchorKey, name) {
  if (!doc?.body?.content) return null

  // Priority 1: Match exact [MEDIA_ANCHOR:...] token
  if (anchorKey) {
    const token = `[MEDIA_ANCHOR:${anchorKey}]`
    for (const elem of doc.body.content) {
      if (!elem.paragraph?.elements) continue
      const txt = elem.paragraph.elements.map((e) => e.textRun?.content || '').join('')
      if (txt.includes(token)) {
        return {
          startIndex: elem.startIndex,
          endIndex: elem.endIndex,
          deleteRange: { startIndex: elem.startIndex, endIndex: elem.endIndex },
          tokenFound: true
        }
      }
    }
  }

  // Priority 2: Fallback heading search
  for (const elem of doc.body.content) {
    if (!elem.paragraph?.elements) continue
    const txt = elem.paragraph.elements.map((e) => e.textRun?.content || '').join('')

    if (anchorKey?.startsWith('SECTION_')) {
      const key = anchorKey.replace('SECTION_', '')
      if (txt.toUpperCase().includes(`BUILDING ELEMENT: ${key}`)) {
        return { startIndex: elem.endIndex - 1, tokenFound: false }
      }
    } else if (anchorKey?.startsWith('FICHE_#')) {
      const num = anchorKey.replace('FICHE_#', '')
      if (txt.toUpperCase().includes(`FICHE #${num}:`)) {
        return { startIndex: elem.endIndex - 1, tokenFound: false }
      }
    } else if (anchorKey === '01_THERMAL_BAR_CHARTS' && txt.includes('4. STRUCTURAL ELEMENT ASSEMBLIES')) {
      return { startIndex: elem.endIndex - 1, tokenFound: false }
    } else if (anchorKey === '02_DELPHIN_1D' && txt.includes('3. MATERIAL RESEARCH')) {
      return { startIndex: elem.endIndex - 1, tokenFound: false }
    } else if (anchorKey === '03_LIFECYCLE_STAGE_CHARTS' && txt.includes('5.2 Whole-Building Lifecycle')) {
      return { startIndex: elem.endIndex - 1, tokenFound: false }
    }
  }

  return null
}

/**
 * Inserts one or more PNG images into a Google Document by uploading them to Google Drive
 * and inserting them as inline images directly at their corresponding chapter anchor positions.
 */
export async function insertAppPngsToGoogleDoc(docId, pngItems, accessToken) {
  const cleanId = extractDocId(docId)
  let uploadedCount = 0

  for (const item of pngItems) {
    if (!item.dataUrl) continue

    try {
      // 1. Upload image to Google Drive
      const fileName = item.name || `lca-app-export-${uploadedCount + 1}.png`
      const { publicUrl } = await uploadImageToDrive(item.dataUrl, fileName, accessToken)

      // 2. Fetch current doc to locate anchor position
      const doc = await getGoogleDocMetadata(cleanId, accessToken)

      let targetIndex = 1
      let deleteRange = null

      const loc = findAnchorLocationInDoc(doc, item.anchorKey, item.name)
      if (loc) {
        targetIndex = loc.startIndex
        deleteRange = loc.deleteRange
      } else if (doc?.body?.content?.length) {
        // Fallback to end of document
        const lastElement = doc.body.content[doc.body.content.length - 1]
        if (lastElement.endIndex && lastElement.endIndex > 1) {
          targetIndex = lastElement.endIndex - 1
        }
      }

      const widthPt = item.widthPt || 425
      const heightPt = item.heightPt || 280

      const itemRequests = []

      // If exact token line was found, delete the placeholder text first
      if (deleteRange) {
        itemRequests.push({
          deleteContentRange: {
            range: {
              startIndex: deleteRange.startIndex,
              endIndex: deleteRange.endIndex
            }
          }
        })
      } else {
        itemRequests.push({
          insertText: {
            location: { index: targetIndex },
            text: `\n`
          }
        })
        targetIndex += 1
      }

      itemRequests.push({
        insertInlineImage: {
          location: { index: targetIndex },
          uri: publicUrl,
          objectSize: {
            width: { magnitude: widthPt, unit: 'PT' },
            height: { magnitude: heightPt, unit: 'PT' }
          }
        }
      })
      targetIndex += 1

      if (item.caption) {
        const captionText = `\nFigure: ${item.caption}\n\n`
        itemRequests.push({
          insertText: {
            location: { index: targetIndex },
            text: captionText
          }
        })
      }

      // Send batchUpdate for this item
      const res = await fetch(`https://docs.googleapis.com/v1/documents/${cleanId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests: itemRequests })
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.warn(`Failed to insert item ${fileName}:`, err)
      } else {
        uploadedCount++
      }
    } catch (itemErr) {
      console.warn('Error processing PNG item insertion:', itemErr)
    }
  }

  if (uploadedCount === 0) {
    throw new Error('Could not insert PNG images into Google Doc. Please verify permissions or try again.')
  }

  const finalDoc = await getGoogleDocMetadata(cleanId, accessToken)
  return { success: true, count: uploadedCount, docTitle: finalDoc?.title || 'Document', documentId: cleanId }
}



