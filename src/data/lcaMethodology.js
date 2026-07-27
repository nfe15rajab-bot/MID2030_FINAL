// Static reference content for the "LCA Methodology" tab and the A4
// Written Report's Methodology section — explains the EN 15804/15978
// lifecycle modules and this project's own glossary, phase by phase.
//
// Every formula/constant below is IMPORTED from the real calculation
// modules (transport.js, uvalue.js, lcaAnalysis.js), never re-typed by
// hand, so this content can't drift from what the app actually computes
// — same rule lambdaProviders.json/calculationNarrative.js already
// follow for the same reason.
import { TRANSPORT_ASSUMPTIONS, DETMOLD_TO_HAARLEM_KM, getConsolidatedIntensityKgCo2ePerTonneKm } from '../lib/transport.js'
import { SURFACE_RESISTANCE } from '../lib/uvalue.js'
import { REFERENCE_STUDY_PERIOD_YEARS } from '../lib/lcaAnalysis.js'

export const RSP_YEARS = REFERENCE_STUDY_PERIOD_YEARS

// `inScope` = this project addresses the module at all (by calculation
// OR by written discussion) — distinct from `computed`, which is true
// only when a real formula or per-material researched figure exists.
// A module can be inScope:true, computed:false (B1/B2/B3/B5/B7 below —
// discussed in the report, never assigned an invented number) as well
// as inScope:false (only A5, genuinely untouched anywhere). Every
// module below exists in the EN 15804/15978 standard regardless of
// which of these three states this project puts it in.
export const LCA_MODULES = [
  {
    group: 'Product stage',
    code: 'A1-A3',
    label: 'Raw material supply, transport to factory, manufacturing',
    standard: 'EN 15804',
    inScope: true,
    computed: true,
    formula: 'A1-A3 = declared GWP unit value × quantity',
    formulaNote:
      "Quantity is derived from each layer's own functional unit — area×thickness×coverage for an " +
      "'m³'-declared material, area×coverage for 'm²', mass for 'kg', or a plain count for 'unit' " +
      '(Door/Window/Skylight). See lcaAnalysis.js — deriveQuantity.',
    dataSource: 'Ökobaudat (soda4LCA REST API) — see okobaudatClient.js.',
    description:
      'The embodied impact of getting one unit of material from raw resource to factory gate, ready to ' +
      'ship — almost always published as one combined "A1-A3" figure in an EPD rather than three separate ones.',
  },
  {
    group: 'Product stage',
    code: 'A4',
    label: 'Transport to construction site',
    standard: 'DIN EN ISO 14083',
    inScope: true,
    computed: true,
    formula: [
      'tonnes = massKg / 1000',
      'intensity (kg CO2e/t·km) = 2×(emptyConsumption+loadedVsEmptyDiff)/payloadCapacity/100 × dieselDensity × dieselGhgFactor',
      'transportActivity (t·km) = tonnes × distanceKm',
      'CO2e (kg) = transportActivity × intensity',
    ].join('\n'),
    formulaNote:
      `CONSOLIDATED convention (DIN EN ISO 14083 / GLEC Framework — transport activity × a fleet-average ` +
      `intensity for a truck shared across its whole payload), adopted app-wide 2026-07-27 in place of a ` +
      `dedicated-truck round-trip assumption (kept as a separate reference figure — see the "A4 methodology" ` +
      `A3 sheet in Deliverables). Routed manufacturer → Detmold (${DETMOLD_TO_HAARLEM_KM}km fixed leg per the ` +
      "class spreadsheet's group2_v2!B7, replaced by a real fetched route once available) → Haarlem — never a " +
      'direct manufacturer-to-site distance. Vehicle/fuel assumptions (group2_v2!B2-B6): empty consumption ' +
      `${TRANSPORT_ASSUMPTIONS.emptyConsumptionLPer100Km} L/100km, +${TRANSPORT_ASSUMPTIONS.loadedVsEmptyDiffLPer100Km} ` +
      `L/100km fully loaded, ${TRANSPORT_ASSUMPTIONS.payloadCapacityTonnes}t payload capacity, diesel density ` +
      `${TRANSPORT_ASSUMPTIONS.dieselDensityKgPerL} kg/L, diesel GHG factor ${TRANSPORT_ASSUMPTIONS.dieselGhgFactorKgCo2ePerKg} ` +
      `kgCO2e/kg — fleet intensity = ${getConsolidatedIntensityKgCo2ePerTonneKm().toFixed(4)} kg CO2e/t·km.`,
    dataSource: "transport.js — see class spreadsheet LCA-Table-Project-Analysis, sheet group2_v2.",
    description:
      'Emissions from moving one material shipment from factory to site. This project\'s assigned site is ' +
      'Batavierenplantsoen, Haarlem (Model 1), reached via the shared Detmold hub.',
  },
  {
    group: 'Product stage',
    code: 'A5',
    label: 'Construction / installation',
    standard: 'EN 15804',
    inScope: false,
    computed: false,
    scopeNote:
      "Not addressed anywhere in this project, calculated or discussed — on-site installation impacts " +
      "(equipment use, site waste) are outside this assignment's defined system boundary (brief section " +
      "5.2's task list stops at A1-A3/A4/B4/C&D).",
    description: 'Impacts of the construction process itself once materials reach site — equipment operation, on-site waste, temporary works.',
  },
  {
    group: 'Use stage',
    code: 'B1',
    label: 'Use',
    standard: 'EN 15978',
    inScope: true,
    computed: false,
    formula: null,
    formulaNote:
      'Discussed qualitatively, not computed — no invented number. Natural timber, wood-fibre insulation, and ' +
      'the mineral/EPDM membrane materials used in this design are not expected to off-gas or degrade ' +
      'meaningfully in normal use; no VOC-emission or in-use environmental impact is quantified here.',
    description: 'Any impact from a material simply being in place and in use.',
  },
  {
    group: 'Use stage',
    code: 'B2',
    label: 'Maintenance',
    standard: 'EN 15978',
    inScope: true,
    computed: false,
    formula: null,
    formulaNote:
      'Discussed qualitatively, not computed — no invented number. Routine maintenance (e.g. periodic ' +
      're-coating/re-sealing of exterior cladding and membranes) is assumed to fall within each material\'s own ' +
      'rated service life and is not modeled as a separate GWP contribution — see B4, which already accounts ' +
      'for what happens once that service life is reached.',
    description: 'Routine upkeep required to keep a material performing as intended.',
  },
  {
    group: 'Use stage',
    code: 'B3',
    label: 'Repair',
    standard: 'EN 15978',
    inScope: true,
    computed: false,
    formula: null,
    formulaNote:
      'Discussed qualitatively, not computed — no invented number. Minor repairs short of full replacement ' +
      'are not modeled as their own figure; any repair-level impact is treated as already folded into B4\'s ' +
      'replacement-count assumption once a material reaches the end of its service life.',
    description: 'Impact of fixing damage short of full replacement.',
  },
  {
    group: 'Use stage',
    code: 'B4',
    label: 'Replacement',
    standard: 'EN 15978',
    inScope: true,
    computed: true,
    formula: [
      `replacementCount = MAX(CEIL(${RSP_YEARS} / serviceLifeYears) − 1, 0)`,
      'B4 = replacementCount × (A1-A3 + A4)',
    ].join('\n'),
    formulaNote:
      `A material whose own service life already reaches or exceeds the ${RSP_YEARS}-year reference study ` +
      'period needs zero replacements within it — B4 = 0 is a real, correct answer for those layers, not a ' +
      'missing one. See lcaAnalysis.js — deriveB4.',
    dataSource: "Each material's researched service life (fiche/EPD/manual, 3-tier confidence).",
    description:
      `Impact of replacing a material partway through the building's life, if its own service life is ` +
      `shorter than the ${RSP_YEARS}-year reference study period this project uses.`,
  },
  {
    group: 'Use stage',
    code: 'B5',
    label: 'Refurbishment',
    standard: 'EN 15978',
    inScope: true,
    computed: false,
    formula: null,
    formulaNote:
      'Discussed qualitatively, not computed — no invented number. No larger-scale refurbishment or design ' +
      `change is planned within the ${RSP_YEARS}-year reference study period for this cabin design.`,
    description: "Larger-scale renovation impact partway through the building's life.",
  },
  {
    group: 'Use stage',
    code: 'B6',
    label: 'Operational energy use',
    standard: 'EN 15978',
    inScope: true,
    computed: true,
    formula: `B6 = electricityGwpFactor × intensityLoad × conditionedFloorAreaM2 × ${RSP_YEARS}`,
    formulaNote:
      'A single whole-building figure (LCA Summary → Operational Energy settings), not apportioned per ' +
      'material or assembly — this is what the brief\'s section 4.6 "Operational Energy Demand" asks for. ' +
      '(That section\'s prose loosely tags it "(B4)"; section 5.2\'s actual task list — and this app\'s code ' +
      '— correctly keep B4/Replacement and B6/Operational energy as two separate modules.)',
    dataSource: "lcaAnalysis.js — calculateB6.",
    description:
      "Energy consumed running the building (heating, cooling, etc.) over the reference study period, " +
      "driven by the envelope's own thermal performance (U-values).",
  },
  {
    group: 'Use stage',
    code: 'B7',
    label: 'Water use',
    standard: 'EN 15978',
    inScope: true,
    computed: false,
    formula: null,
    formulaNote:
      "Discussed qualitatively, not computed — no invented number. This project's system boundary (per the " +
      "class brief) covers material embodied carbon and building-envelope-linked operational energy (B6), " +
      "not the cabin's domestic/operational water consumption.",
    description: 'Impact of water consumed operating the building.',
  },
  {
    group: 'End of life',
    code: 'C1',
    label: 'Deconstruction / demolition',
    standard: 'EN 15978',
    inScope: true,
    computed: true,
    formula: null,
    formulaNote: 'Researched per material (EPD-published, AI-suggested, or manual), each tagged with its confidence tier — never derived from a formula.',
    description: 'Impact of taking the material out of the building at end of life.',
  },
  {
    group: 'End of life',
    code: 'C2',
    label: 'Transport to waste processing',
    standard: 'EN 15978',
    inScope: true,
    computed: true,
    formula: 'Same DIN EN ISO 14083 formula as A4 (above), using the shared waste-facility distance in place of the manufacturer-to-site distance.',
    formulaNote: 'A real EPD-published C2 figure is used instead, when one exists — that takes priority over the estimate.',
    description: 'Emissions moving the material from site to wherever it is processed at end of life.',
  },
  {
    group: 'End of life',
    code: 'C3',
    label: 'Waste processing',
    standard: 'EN 15978',
    inScope: true,
    computed: true,
    formula: null,
    formulaNote: 'Researched per material, same as C1.',
    description: 'Sorting/processing the material for recycling, energy recovery, or disposal.',
  },
  {
    group: 'End of life',
    code: 'C4',
    label: 'Disposal',
    standard: 'EN 15978',
    inScope: true,
    computed: true,
    formula: null,
    formulaNote: 'Researched per material, same as C1.',
    description: 'Final landfilling or incineration-without-recovery impact.',
  },
  {
    group: 'Beyond the system boundary',
    code: 'D',
    label: 'Reuse, recovery, recycling potential',
    standard: 'EN 15978',
    inScope: true,
    computed: true,
    formula: null,
    formulaNote: 'Researched per material, always shown as a credit (≤0 kg CO2e) — a benefit, never a burden.',
    description: 'Environmental benefit a material provides beyond its own life, by being reused, recycled, or recovered for energy instead of landfilled.',
  },
]

export const NORMALIZATION = {
  formula: `normalized = (A1-A3 + A4) / surfaceAreaM2 / ${RSP_YEARS}`,
  unit: 'kg CO2e / m² / yr',
  note:
    "Deliberately excludes B4 and C&D — see lcaAnalysis.js's own comment: this total is what \"feeds the " +
    `graded report's Methodology section as written.\" Per the brief (section 4.8): normalize to kg CO2-eq/m²/year ` +
    `over a ${RSP_YEARS}-year building lifetime.`,
}

export const U_VALUE = {
  standard: 'DIN EN ISO 6946',
  formula: ['R_layer = thickness (m) / λ (W/mK)', 'R_total = Rsi + Rse + Σ R_layer', 'U = 1 / R_total'].join('\n'),
  surfaceResistances: SURFACE_RESISTANCE,
  note:
    'Computed for Wall/Roof/Floor (layer stacks) — see uvalue.js. Not yet computed for Door/Window/Skylight: ' +
    "their declared Uw lives in each unit's own spec text (manufacturer datasheet), not a comparable computed " +
    'figure (see ConfiguratorPanel.jsx / UnitAssemblyBuilder.jsx).',
}

export const GLOSSARY = [
  {
    term: 'GWP',
    name: 'Global Warming Potential',
    definition:
      'A measure of how much a given mass of greenhouse-gas emission contributes to warming, expressed in kg ' +
      'CO2-equivalent (kg CO2e). This project\'s primary metric — the brief\'s stated goal is to "quantify, ' +
      'analyse, and optimize... environmental performance... with a specific focus on Global Warming Potential."',
  },
  {
    term: 'EPD',
    name: 'Environmental Product Declaration',
    definition:
      'A manufacturer-published, independently verified document reporting a specific product\'s life-cycle ' +
      'environmental impacts against a stated system boundary and declared unit. The brief (4.4) asks for a ' +
      'critical read of these — system boundaries, declared units, GWP values/assumptions, and a reflection on ' +
      'data variability and reliability — not just copying the headline number.',
  },
  {
    term: 'Ökobaudat',
    name: 'Ökobaudat',
    definition:
      "The German public building-materials LCA/EPD database this project draws its A1-A3 GWP data from, via " +
      "its public soda4LCA REST API (okobaudatClient.js) — no authentication needed, current dataset version " +
      "discovered at runtime.",
  },
  {
    term: 'Declared / functional unit',
    name: 'Declared unit / functional unit',
    definition:
      'The reference quantity an EPD\'s GWP figure is expressed per — e.g. 1 m², 1 kg, 1 m³. Two materials\' GWP ' +
      'numbers are only comparable, and only multipliable by a real quantity, once their declared units are known and matched.',
  },
  {
    term: 'λ',
    name: 'λ (lambda) — thermal conductivity',
    definition:
      'How readily a material conducts heat, in W/(m·K). Lower λ = better insulator. Sourced per-material in ' +
      'lambdaProviders.json, each tagged high/medium/low confidence depending on whether it came from a ' +
      'manufacturer datasheet, a matched product family, or an estimate.',
  },
  {
    term: 'R-value',
    name: 'R-value — thermal resistance',
    definition: "A layer's resistance to heat flow, in m²K/W: R = thickness / λ. Layer R-values sum (plus interior/exterior surface resistances) to the assembly's total R-value.",
  },
  {
    term: 'U-value',
    name: 'U-value — thermal transmittance',
    definition: 'The whole assembly\'s heat loss rate, in W/m²K: U = 1 / R_total. Lower U = better insulated. Computed per DIN EN ISO 6946 for Wall/Roof/Floor.',
  },
  {
    term: 'Sd-value',
    name: 'Sd-value — vapour-diffusion-equivalent air layer thickness',
    definition:
      "Describes how strongly a membrane (e.g. a vapour-control layer) resists water vapour diffusing through " +
      "it, in metres of still air it's equivalent to. Relevant to the brief's building-physics evaluation (4.2), separate from the GWP/LCA calculation chain above.",
    note:
      "Not computed in this app — carried as free text from each membrane material's own researched " +
      'fiche/datasheet (e.g. "sd = 7.50 ± 0.25m"), not a structured, derived number. Always shown with its source, never silently treated as calculated.',
  },
  {
    term: 'RSP',
    name: 'Reference Study Period',
    definition: `The building lifetime assumed for replacement (B4) and normalization calculations — ${RSP_YEARS} years in this project, per the brief (section 4.8).`,
  },
  {
    term: 'Confidence tiers',
    name: 'Confidence tiers (EPD / AI / manual, high / medium / low)',
    definition:
      'This app never applies a number silently. GWP/end-of-life figures are tagged EPD-sourced, AI-sourced ' +
      '(unverified), or Assumed (manual); λ values are tagged high (manufacturer datasheet or EN ISO 10456 ' +
      'standard value), medium (matched to closest product family), or low (estimated, flagged for follow-up).',
  },
]
