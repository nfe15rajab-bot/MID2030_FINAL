// AI-assisted, web-search-grounded autofill for material fiche fields.
// Started alongside `vite` via `npm run dev` (see package.json) and reached
// through Vite's dev proxy at /api/material-autofill (vite.config.js), same
// pattern as section-export-server.js.
//
// Why "grounded": German norm numbers (DIN/EN references) and λ values are
// exactly the kind of specific-sounding fact a language model will
// confidently hallucinate if asked to just "know" them. This endpoint never
// asks the model to answer from memory — every request runs with Gemini's
// Google Search grounding tool enabled, and the prompt requires an explicit
// "no reliable source found" instead of a guess when search doesn't turn up
// something trustworthy. The frontend then still requires a human to click
// Accept before anything is saved — this endpoint only ever *suggests*.
//
// Provider note: originally built against the Claude API's web_search tool;
// swapped to Gemini + Google Search grounding at the user's request (their
// own API key/billing preference). Same HTTP contract either way — only
// callGemini() below is provider-specific, everything else (prompt,
// confidence convention, JSON parsing, the /suggest route) is unchanged.
import { readFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const PORT = 3902
const GEMINI_MODEL = 'gemini-3.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// Same field structure as the manual material-entry feature (FicheTechniquePanel.jsx's
// detail shape, CustomMaterialForm.jsx's λ input) — this endpoint fills those
// same fields, it doesn't introduce a parallel shape.
const FIELD_SPECS = {
  germanName: {
    label: 'Technical german name',
    instruction:
      'The official German-language technical/trade name for this exact product or product family, as used by the manufacturer or in German building-supply listings.',
  },
  specs: {
    label: 'Technical infos / material specifications',
    instruction:
      'Exactly 5-6 short bullet points, one per line, each under 8 words, in "Label: value" format — e.g. "Alloy: AlMg0.7Si", "Density: 2.70 g/cm3", "Standard length: 6-6.1 m", "Finish: Qualicoat Class 1". Cover composition/material, typical dimensions, density, coating/finish, and any other spec a technical data sheet would list. No filler words ("is commonly supplied by", "features a") and no full sentences — label: value pairs only, one per line.',
  },
  norm: {
    label: 'Technical norm',
    instruction:
      'The relevant DIN/EN (or other) technical norm/standard reference(s) that apply to this product category — e.g. "DIN EN 13171". Only return a norm you can point to a real source for.',
  },
  providerWebsite: {
    label: "Provider's website",
    instruction:
      "The official website URL of the named provider/manufacturer (the homepage or a specific product page). Not the material's own spec sheet unless it's hosted by the provider.",
  },
  lambda: {
    label: 'λ (thermal conductivity, W/mK)',
    instruction:
      'The declared thermal conductivity (λ, W/mK) for this exact product or its closest matching product family, from a manufacturer datasheet or a recognized standard (e.g. EN ISO 10456).',
  },
  density: {
    label: 'Density (kg/m³)',
    instruction:
      'The declared bulk density (kg/m3) for this exact product or its closest matching product family, from a manufacturer datasheet or a recognized standard (e.g. EN ISO 10456). This feeds the A4 transport mass calc (mass = area x thickness x density), not just a spec-sheet fact.',
  },
  gwp: {
    label: 'GWP A1-A3 (kg CO2e per declared/functional unit)',
    instruction:
      'The declared Global Warming Potential for modules A1-A3 (kg CO2e per the product\'s declared/functional unit — usually m3, m2, or kg) from a real EPD (Environmental Product Declaration) or a database like Ökobaudat. State which functional unit the number is per, in "note".',
  },
  serviceLife: {
    label: 'Reference/declared service life (years)',
    instruction:
      'The declared or reference service life (RSL) in years for this exact product or its closest matching product family, from a manufacturer EPD, technical datasheet, or a recognized standard (e.g. the German BBSR "Nutzungsdauer von Bauteilen" tables). This feeds the B4 (replacement) calc — a wrong or padded number directly skews it, so only return a value you can point to a real source for.',
  },
  electricityGwpFactor: {
    label: 'Grid electricity GWP factor (kg CO2e per kWh)',
    instruction:
      'The national-average grid electricity carbon intensity (kg CO2e per kWh) for the country/region named in "Material name" below (e.g. "Germany national grid electricity mix, average"), from a recognized source (national environment agency, IEA, Ökobaudat\'s own grid mix dataset). This feeds the B6 (operational energy) calc for the whole building, not a single material.',
  },
  endOfLife: {
    label: 'End-of-life scenario + notes',
    instruction:
      `The most likely end-of-life (C&D waste) scenario for this exact product, grounded in real guidance — manufacturer take-back/recycling programs, EN 15804 module D guidance for this material category, or national C&D waste regulations. Not a generic guess like "recyclable" with no basis. "value" for this field is an OBJECT (not a plain string): { "scenario": <one of exactly "Reuse", "Recycle", "Downcycle", "Energy recovery (incineration)", "Landfill/disposal", or null>, "notes": <short freeform string explaining why, or null> }. The scenario string must be copied verbatim from that list — do not invent a different wording. If you can't ground a scenario in a real source, set both scenario and notes to null rather than guessing.`,
  },
  providerInfo: {
    label: 'Provider/manufacturer name, address, website, and distance to Haarlem, Netherlands',
    instruction:
      `Who actually manufactures/supplies this exact product, and where — this is what unlocks the A4 transport calculation when no provider record exists yet, and the address also gets geocoded to place a pin on a map, so prefer a real street address over just a city. "value" is an OBJECT: { "name": <manufacturer/supplier name or null>, "location": <the most specific real mailing/street address you can confirm for the actual manufacturing/distribution site — a full street address is best; city + country is an acceptable fallback only if no street address is published; or null>, "website": <the provider's official website URL (homepage or a specific manufacturing-site page), or null>, "distanceToHaarlemKm": <approximate straight-line or road distance in km from that location to Haarlem, Netherlands, as a plain number, or null if you can't estimate it confidently>. }. Ground "name", "location", and "website" in a real source (the manufacturer's own site, a distributor listing). "distanceToHaarlemKm" may be your own geographic estimate once location is known (not something you need a separate citation for) — but never invent the name/location/website itself.`,
  },
  circularity: {
    label: 'Circularity details (recyclability % and deconstruction method)',
    instruction:
      `Additional end-of-life circularity details for this exact product, grounded in real guidance (manufacturer recycling/take-back program info, an EPD's end-of-life module, or national C&D waste guidance) — this is shown alongside the end-of-life scenario/notes, not instead of them. "value" is an OBJECT: { "recyclabilityPercent": <the material's recyclability rate at end-of-life as a plain number 0-100, or null if you can't find one grounded in a real source>, "deconstructionMethod": <a short phrase, max ~6 words, describing how it's typically removed/deconstructed, e.g. "mechanically fixed, easily separable", or null> }. Set each sub-field to null individually rather than guessing if it isn't grounded in something you actually found.`,
  },
  endOfLifeImpact: {
    label: 'End-of-life route (%) and EN 15804 module C1/C3/C4/D impacts',
    instruction:
      `The typical/likely end-of-life ROUTE for this exact product as a percentage split, and — only where you can ground them in a real EPD, manufacturer take-back program data, or industry LCA literature for this material category — the associated EN 15804 module impacts (kg CO2e per the same declared/functional unit used for A1-A3). "value" is an OBJECT: { "recycledPct": <0-100 or null>, "landfillPct": <0-100 or null>, "incineratedPct": <0-100 or null>, "c1": <kg CO2e, deconstruction/demolition energy, or null>, "c3": <kg CO2e, waste processing/sorting, or null>, "c4": <kg CO2e, final disposal (landfill degradation + incineration combustion), or null>, "moduleD": <kg CO2e, benefit/credit from recycling or reuse — MUST be negative or zero, never positive, or null> }. The three percentages should sum to roughly 100 when all three are known, but return only the ones you can actually ground — null the rest rather than inventing a split. Do NOT include a "c2" field — transport to waste processing is computed separately in this app from real distance/mass data, never estimated by you.`,
  },
}
const ALLOWED_FIELDS = Object.keys(FIELD_SPECS)
const END_OF_LIFE_SCENARIOS = ['Reuse', 'Recycle', 'Downcycle', 'Energy recovery (incineration)', 'Landfill/disposal']

function loadEnvFile() {
  const envPath = path.join(import.meta.dirname, '.env')
  const env = {}
  if (!existsSync(envPath)) return env
  const raw = readFileSync(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

const ENV = loadEnvFile()
const API_KEY = process.env.GEMINI_API_KEY || ENV.GEMINI_API_KEY || null

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

// Confidence convention reused verbatim from src/data/lambdaProviders.js /
// CLAUDE.md: high = manufacturer datasheet or EN ISO 10456 standard value,
// medium = matched to the closest product family rather than the exact
// SKU, low = estimated/uncertain and flagged for follow-up. Told to the
// model explicitly so its self-rated confidence lines up with how the rest
// of the app already labels researched λ values.
const CONFIDENCE_GUIDE = `Confidence must be one of "high", "medium", or "low":
- "high": sourced from the manufacturer's own datasheet/page for this exact product, or a recognized standard (e.g. EN ISO 10456) for a generic tabulated value.
- "medium": sourced from a datasheet for the closest matching product family, not the exact SKU/variant, or from a secondary but credible source (distributor page, trade publication).
- "low": the best you found is indirect, old, or you're not fully sure it applies to this exact product — still return it, but mark it low and explain why in "note".`

function buildPrompt({ materialName, category, providerName, fields }) {
  const fieldList = fields
    .map((f) => `- "${f}" (${FIELD_SPECS[f].label}): ${FIELD_SPECS[f].instruction}`)
    .join('\n')

  return `You are researching technical data for one building material, for a student LCA (life-cycle assessment) project. Use web search to find real, current sources — do not answer from memory.

Material name: ${materialName}
Category/discipline: ${category || '(not given)'}
Known provider/manufacturer: ${providerName || '(not given)'}

For EACH of the following fields, search the web and report what you find:
${fieldList}

${CONFIDENCE_GUIDE}

Rules:
- Every field's value MUST come from something you actually found via web search this turn. Never state a norm number, standard reference, λ value, end-of-life scenario, or provider name/location you have not confirmed against a real page you searched for.
- If you cannot find a reliable source for a field, set "value" to null (or, for "endOfLife"/"providerInfo", set their nested properties to null), "sourceUrl" to null, "confidence" to null, and set "note" to "no reliable source found" for that field specifically. Do not guess to fill the gap.
- For "lambda", "density", and "gwp", "value" must be a plain number or null — no units in the value itself.
- For "endOfLife" and "providerInfo", "value" is an OBJECT with the shape described above — not a plain string.
- "sourceUrl" must be the exact URL of the page you used for that field.

After you finish searching, respond with ONLY a single JSON object (no markdown fencing, no commentary before or after) with exactly this shape, one key per requested field:
{
${fields.map((f) => {
  let valueShape = '<string or number or null>'
  if (f === 'endOfLife') valueShape = '{ "scenario": <one of the 5 exact strings or null>, "notes": <string or null> }'
  if (f === 'providerInfo') valueShape = '{ "name": <string or null>, "location": <string or null>, "website": <string or null>, "distanceToHaarlemKm": <number or null> }'
  if (f === 'circularity') valueShape = '{ "recyclabilityPercent": <number 0-100 or null>, "deconstructionMethod": <string or null> }'
  return `  "${f}": { "value": ${valueShape}, "sourceUrl": <string or null>, "confidence": "high"|"medium"|"low"|null, "note": <string or null> }`
}).join(',\n')}
}`
}

function extractJson(text) {
  if (!text || typeof text !== 'string') throw new Error('No text provided for JSON extraction')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced && fenced[1] ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object found in model response')
  return JSON.parse(candidate.slice(start, end + 1))
}

async function callGemini(prompt) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    }),
  })

  const body = await res.json()
  if (!res.ok) {
    const detail = body?.error?.message || `HTTP ${res.status}`
    throw new Error(`Gemini API error: ${detail}`)
  }

  const candidate = body.candidates?.[0]
  if (!candidate) {
    throw new Error('Gemini API returned no candidates')
  }

  // Concatenate every text part of the final answer (grounded generation
  // is single-turn from the caller's side — Gemini runs the search(es)
  // server-side and returns the finished answer directly).
  const text = (candidate.content?.parts ?? [])
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')

  // Every URL Gemini actually grounded its answer in this turn (groundingChunks),
  // used as a sanity cross-check against what the model claims per field below
  // — same reasoning as the Anthropic citations check this replaced.
  const citedUrls = new Set()
  for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
    if (chunk.web?.uri) citedUrls.add(chunk.web.uri)
  }

  return { text, citedUrls, raw: body }
}

function normalizeSuggestions(parsed, fields, citedUrls) {
  const out = {}
  for (const field of fields) {
    const entry = parsed[field]

    // Structured value for endOfLife (scenario + notes) — validated
    // against the fixed enum. Reject rather than guess-map: an
    // off-list/malformed scenario is treated the same as "no reliable
    // source found" rather than being forced into the closest option.
    if (field === 'endOfLife') {
      const scenario = entry?.value?.scenario ?? null
      const notes = entry?.value?.notes ?? null
      const validScenario = END_OF_LIFE_SCENARIOS.includes(scenario) ? scenario : null
      if (!entry || validScenario == null) {
        out[field] = {
          value: null,
          sourceUrl: null,
          confidence: null,
          confidenceLabel: null,
          note: scenario && validScenario == null
            ? `model returned an off-list scenario ("${scenario}") — rejected rather than guess-mapped`
            : (entry?.note || 'no reliable source found'),
        }
        continue
      }
      const sourceUrl = entry.sourceUrl || null
      const confidence = ['high', 'medium', 'low'].includes(entry.confidence) ? entry.confidence : null
      out[field] = {
        value: { scenario: validScenario, notes },
        sourceUrl,
        confidence,
        confidenceLabel: confidence ? `${confidence[0].toUpperCase()}${confidence.slice(1)} – AI web-search suggestion (Gemini)` : null,
        note: entry.note || null,
      }
      continue
    }

    // Structured value for providerInfo (name + location + distance) —
    // reject rather than half-fill: a name with no location is still
    // useless for the A4 distance calc, so require both before treating
    // this as a usable suggestion.
    if (field === 'providerInfo') {
      const name = entry?.value?.name || null
      const location = entry?.value?.location || null
      const rawDistance = entry?.value?.distanceToHaarlemKm
      const distanceToHaarlemKm = typeof rawDistance === 'number' && Number.isFinite(rawDistance) ? rawDistance : null
      if (!entry || !name || !location) {
        out[field] = { value: null, sourceUrl: null, confidence: null, confidenceLabel: null, note: entry?.note || 'no reliable source found' }
        continue
      }
      const sourceUrl = entry.sourceUrl || null
      const confidence = ['high', 'medium', 'low'].includes(entry.confidence) ? entry.confidence : null
      out[field] = {
        value: { name, location, distanceToHaarlemKm },
        sourceUrl,
        confidence,
        confidenceLabel: confidence ? `${confidence[0].toUpperCase()}${confidence.slice(1)} – AI web-search suggestion (Gemini)` : null,
        note: entry.note || (distanceToHaarlemKm == null ? 'distance could not be estimated — enter manually if known' : null),
      }
      continue
    }

    // Structured value for circularity (recyclability % + deconstruction
    // method) — unlike providerInfo, these two sub-fields are independent
    // of each other, so accept either one alone rather than requiring
    // both before treating the suggestion as usable.
    if (field === 'circularity') {
      const rawPercent = entry?.value?.recyclabilityPercent
      const recyclabilityPercent = typeof rawPercent === 'number' && Number.isFinite(rawPercent) ? rawPercent : null
      const deconstructionMethod = entry?.value?.deconstructionMethod || null
      if (!entry || (recyclabilityPercent == null && deconstructionMethod == null)) {
        out[field] = { value: null, sourceUrl: null, confidence: null, confidenceLabel: null, note: entry?.note || 'no reliable source found' }
        continue
      }
      const sourceUrl = entry.sourceUrl || null
      const confidence = ['high', 'medium', 'low'].includes(entry.confidence) ? entry.confidence : null
      out[field] = {
        value: { recyclabilityPercent, deconstructionMethod },
        sourceUrl,
        confidence,
        confidenceLabel: confidence ? `${confidence[0].toUpperCase()}${confidence.slice(1)} – AI web-search suggestion (Gemini)` : null,
        note: entry.note || null,
      }
      continue
    }

    // Structured value for endOfLifeImpact (route % split + C1/C3/C4/D) —
    // every sub-field is independent (same reasoning as circularity
    // above), so accept whatever the model actually grounded rather than
    // requiring all of them. moduleD is forced non-positive: a "credit"
    // that came back positive is either a units mix-up or a hallucinated
    // sign, not usable either way — reject rather than silently flip it.
    if (field === 'endOfLifeImpact') {
      const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
      const recycledPct = num(entry?.value?.recycledPct)
      const landfillPct = num(entry?.value?.landfillPct)
      const incineratedPct = num(entry?.value?.incineratedPct)
      const c1 = num(entry?.value?.c1)
      const c3 = num(entry?.value?.c3)
      const c4 = num(entry?.value?.c4)
      const rawModuleD = num(entry?.value?.moduleD)
      const moduleD = rawModuleD != null && rawModuleD <= 0 ? rawModuleD : null
      const moduleDRejected = rawModuleD != null && rawModuleD > 0

      const anyValue = [recycledPct, landfillPct, incineratedPct, c1, c3, c4, moduleD].some((v) => v != null)
      if (!entry || !anyValue) {
        out[field] = {
          value: null,
          sourceUrl: null,
          confidence: null,
          confidenceLabel: null,
          note: moduleDRejected ? 'model returned a positive module D value — rejected (D must be a credit, <= 0)' : (entry?.note || 'no reliable source found'),
        }
        continue
      }
      const sourceUrl = entry.sourceUrl || null
      const confidence = ['high', 'medium', 'low'].includes(entry.confidence) ? entry.confidence : null
      out[field] = {
        value: { recycledPct, landfillPct, incineratedPct, c1, c3, c4, moduleD },
        sourceUrl,
        confidence,
        confidenceLabel: confidence ? `${confidence[0].toUpperCase()}${confidence.slice(1)} – AI web-search suggestion (Gemini)` : null,
        note: entry.note || (moduleDRejected ? 'model also returned a positive module D value, rejected' : null),
      }
      continue
    }

    if (!entry || entry.value == null || entry.value === '') {
      out[field] = { value: null, sourceUrl: null, confidence: null, confidenceLabel: null, note: entry?.note || 'no reliable source found' }
      continue
    }
    const sourceUrl = entry.sourceUrl || null
    // Soft grounding check: flag (don't discard) if the model's cited URL
    // wasn't among the URLs Gemini's own Google Search grounding actually
    // returned this turn (groundingMetadata.groundingChunks). The human-
    // review step downstream is the real safety net either way — see
    // module header comment.
    const groundedInSearch = sourceUrl ? citedUrls.size === 0 || citedUrls.has(sourceUrl) : false
    const confidence = ['high', 'medium', 'low'].includes(entry.confidence) ? entry.confidence : null
    out[field] = {
      value: entry.value,
      sourceUrl,
      confidence,
      confidenceLabel: confidence ? `${confidence[0].toUpperCase()}${confidence.slice(1)} – AI web-search suggestion (Gemini)` : null,
      note: entry.note || (groundedInSearch ? null : 'source URL could not be cross-checked against this turn\'s search results — verify before accepting'),
    }
  }
  return out
}

// AI Feedback (Assembly Analysis Preview / Deliverables) — commentary
// support, NOT a citable source (see the frontend's own label). Grounds
// its benchmark comparisons via the same web_search-enabled Gemini call
// as /suggest, but the output is prose, not a structured per-field
// suggestion, so it skips extractJson/normalizeSuggestions entirely —
// this route returns the model's text response as-is (trimmed).
function buildFeedbackPrompt({ assemblyLabel, category, uValue, gwpTotal, layerCount, completeLayerCount, layers }) {
  const layerList = layers
    .map((l) => `- ${l.name}: ${l.thicknessMM != null ? `${l.thicknessMM}mm` : 'thickness unknown'}, λ=${l.lambda ?? 'unknown'}, GWP=${l.gwp ?? 'unknown'}`)
    .join('\n')

  return `You are writing brief, evidence-based commentary on one building assembly's computed thermal/environmental performance, for a student LCA (life-cycle assessment) project. Use web search to find real comparison benchmarks — do not answer from memory.

Assembly: ${assemblyLabel} (${category || 'building envelope'})
Computed U-value: ${uValue != null ? `${uValue.toFixed(3)} W/m²K` : 'not computable — incomplete data'}
Computed GWP A1-A3 total: ${gwpTotal != null ? `${gwpTotal.toFixed(1)} kg CO2e` : 'not computable — incomplete data'}
Data completeness: ${completeLayerCount}/${layerCount} layers have complete thickness+λ+GWP data
Layer stack:
${layerList || '(no layers)'}

Write 3-5 short sentences of commentary. Requirements:
- If the U-value is computable, search for and cite a real, current comparison benchmark (e.g. Dutch Bouwbesluit minimum requirements, or typical passive-house-grade values for this element type) and state how this assembly compares — do not just assert "good" or "bad" without a number to compare against.
- If completeness is below 100%, say so plainly and explain that any total shown is understated until the missing layers are filled — do not comment on an incomplete number as if it were final.
- Name specific concerns if any exist (e.g. a layer with no researched λ, an unusually high/low GWP contributor).
- Do NOT invent a benchmark number you have not actually found via search this turn.
- Plain prose only — no markdown headers, no bullet list, no JSON, no LaTeX/math notation (write "λ" or "lambda", never "$\lambda$" or similar). Just the sentences, ready to display as plain text.
- Do not present this as a citable finding — it's commentary for the user to review and rewrite, not a research result.`
}

function handleFeedback(req, res) {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', async () => {
    if (!API_KEY) {
      sendJson(res, 500, {
        error: 'GEMINI_API_KEY is not configured. Add it to server/.env (see server/.env.example) — never commit the real key.',
      })
      return
    }

    let input
    try {
      input = JSON.parse(body)
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' })
      return
    }

    const { assemblyLabel, category, uValue, gwpTotal, layerCount, completeLayerCount, layers } = input
    if (!assemblyLabel || !Array.isArray(layers)) {
      sendJson(res, 400, { error: 'Body must include "assemblyLabel" and a "layers" array' })
      return
    }

    try {
      const prompt = buildFeedbackPrompt({ assemblyLabel, category, uValue, gwpTotal, layerCount, completeLayerCount, layers })
      const { text } = await callGemini(prompt)
      sendJson(res, 200, { feedback: text.trim() })
    } catch (err) {
      sendJson(res, 502, { error: `Feedback request failed: ${err.message}` })
    }
  })
}

function handleSuggest(req, res) {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', async () => {
    if (!API_KEY) {
      sendJson(res, 500, {
        error: 'GEMINI_API_KEY is not configured. Add it to server/.env (see server/.env.example) — never commit the real key.',
      })
      return
    }

    let input
    try {
      input = JSON.parse(body)
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' })
      return
    }

    const { materialName, category, providerName, fields } = input
    if (!materialName || !Array.isArray(fields) || fields.length === 0) {
      sendJson(res, 400, { error: 'Body must include "materialName" and a non-empty "fields" array' })
      return
    }
    const invalidFields = fields.filter((f) => !ALLOWED_FIELDS.includes(f))
    if (invalidFields.length > 0) {
      sendJson(res, 400, { error: `Unknown field(s): ${invalidFields.join(', ')}. Allowed: ${ALLOWED_FIELDS.join(', ')}` })
      return
    }

    try {
      const prompt = buildPrompt({ materialName, category, providerName, fields })
      const { text, citedUrls } = await callGemini(prompt)
      const parsed = extractJson(text)
      const suggestions = normalizeSuggestions(parsed, fields, citedUrls)
      sendJson(res, 200, { suggestions })
    } catch (err) {
      sendJson(res, 502, { error: `Autofill request failed: ${err.message}` })
    }
  })
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/suggest') {
    handleSuggest(req, res)
    return
  }
  if (req.method === 'POST' && req.url === '/feedback') {
    handleFeedback(req, res)
    return
  }
  sendJson(res, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  console.log(`[material-autofill-server] listening on http://localhost:${PORT}${API_KEY ? '' : ' (WARNING: no GEMINI_API_KEY configured — see server/.env.example)'}`)
})
