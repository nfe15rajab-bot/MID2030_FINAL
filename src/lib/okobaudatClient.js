// Ökobaudat client — talks to the public soda4LCA REST API.
// Docs: https://www.oekobaudat.de/en/guidance/software-developers.html
// No API key needed, no auth needed, it's fully open data (BMWSB/BBSR).
//
// IMPORTANT — read before wiring this up:
// 1. Ökobaudat publishes a NEW datastock roughly once a year (e.g. OBD_2021_II,
//    a newer EN15804+A2 one now). Hardcoding a datastock UUID will go stale.
//    This client discovers the right datastock at runtime instead — see
//    `getDefaultDatastock()`. It caches the result for the session.
// 2. CORS: the soda4LCA API is generally reachable directly from the browser,
//    but if you hit a CORS error in dev, add the Vite proxy at the bottom of
//    this file to vite.config.js — that sidesteps it with zero backend code.
// 3. Every returned process still needs its OWN detail call to read the actual
//    GWP (A1-A3) numbers — the search endpoint only returns names/UUIDs/units.
//    searchMaterials() below does this automatically for the top N results;
//    tune MAX_DETAIL_FETCHES if it feels slow.

const BASE = '/okobaudat-api/resource';
const MAX_DETAIL_FETCHES = 8;

let datastockCache = null;

/**
 * Lists all available datastocks (database versions/editions) and picks the
 * best one to use: prefers a name/description mentioning "A2" (current
 * EN 15804+A2 standard) over older A1 stocks.
 */
export async function getDefaultDatastock() {
  if (datastockCache) return datastockCache;

  const res = await fetch(`${BASE}/datastocks?format=json`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Ökobaudat datastocks request failed: ${res.status}`);
  }
  const data = await res.json();
  // Real API shape: { dataStock: [{ uuid, shortName, name: [{value, lang}], description: [...] }] }
  const stocks = data.dataStock ?? data.data ?? data.datastocks ?? data;

  if (!Array.isArray(stocks) || stocks.length === 0) {
    throw new Error('Ökobaudat returned no datastocks — API shape may have changed, check manually at oekobaudat.de');
  }

  const localizedText = (field) =>
    Array.isArray(field) ? field.map((f) => f.value ?? '').join(' ') : field ?? '';

  const scoreOf = (s) => {
    const text = `${localizedText(s.name)} ${localizedText(s.description)} ${s.shortName ?? ''}`.toLowerCase();
    let score = 0;
    if (text.includes('a2')) score += 2;
    if (text.includes('sphera')) score += 1;
    if (text.includes('a1')) score -= 1; // deprioritize the older standard
    return score;
  };

  const best = [...stocks].sort((a, b) => scoreOf(b) - scoreOf(a))[0];
  datastockCache = { uuid: best.uuid ?? best.id, raw: best, all: stocks };
  return datastockCache;
}

/**
 * Full-text search for processes (materials/products) by name.
 * @param {string} query
 * @param {{ pageSize?: number, datastockUuid?: string }} [opts]
 */
export async function searchProcesses(query, opts = {}) {
  if (!query || query.trim().length < 2) return [];

  const { pageSize = 20 } = opts;
  let { datastockUuid } = opts;
  if (!datastockUuid) {
    const stock = await getDefaultDatastock();
    datastockUuid = stock.uuid;
  }

  const url = new URL(`${BASE}/datastocks/${datastockUuid}/processes`, window.location.origin);
  url.searchParams.set('search', 'true');
  url.searchParams.set('name', query.trim());
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Ökobaudat search failed: ${res.status}`);
  }
  const json = await res.json();
  const list = json.data ?? [];
  return list.map((p) => ({
    uuid: p.uuid,
    name: p.name?.[0]?.value ?? p.name ?? '(unnamed)',
    classification: p.classification ?? null,
    referenceYear: p.referenceYear ?? null,
    datastockUuid,
  }));
}

/**
 * Fetches full process detail (needed to read GWP A1-A3, declared unit, density…).
 */
export async function getProcessDetail(datastockUuid, processUuid) {
  const url = `${BASE}/datastocks/${datastockUuid}/processes/${processUuid}?format=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Ökobaudat process detail failed: ${res.status}`);
  }
  const json = await res.json();
  return parseProcess(json);
}

/** Pulls the fields we actually care about out of the (verbose) ILCD+EPD JSON. */
function parseProcess(json) {
  const name =
    json?.processInformation?.dataSetInformation?.name?.baseName?.[0]?.value ?? '(unnamed)';

  const declaredUnit =
    json?.processInformation?.quantitativeReference?.referenceFlowRefObjectId ??
    json?.exchanges?.exchange?.[0]?.flowProperties?.referenceUnit ??
    null;

  // GWP (A1-A3) lives under LCIAResults / indicator "GWP" (or GWP-total for A2 stocks),
  // module A1-A3. The exact indicator name varies slightly by dataset generation,
  // so we match loosely.
  const lciaResults = json?.LCIAResults?.LCIAResult ?? [];
  const gwpResult = (Array.isArray(lciaResults) ? lciaResults : [lciaResults]).find((r) => {
    const indicatorName = r?.referenceToLCIAMethodDataSet?.shortDescription?.[0]?.value ?? '';
    return /gwp|global warming/i.test(indicatorName);
  });

  // Same lookup, generalized to any EN 15804 module string — reused below
  // for A1-A3 and for the end-of-life modules (C1-C4, D). Real EPDs that
  // report full lifecycle data list all of these as sibling `module`
  // entries under the same GWP indicator result found above; EPDs that
  // only cover the product stage (most of them) simply won't have C1-C4/D
  // entries, so this returns null for those — same "absence is common and
  // expected, not a bug" reasoning as the service life extraction below.
  function moduleValue(moduleName) {
    if (!gwpResult) return null;
    const entry = (gwpResult.other?.anies ?? gwpResult.other ?? []).find?.(
      (m) => m.module === moduleName
    );
    return entry ? Number(entry.value ?? entry['#text']) : null;
  }

  const gwpA1A3 = moduleValue('A1-A3');
  // End-of-life modules — tier 1 ("verified — EPD sourced") of the
  // end-of-life 3-tier fill (see EndOfLifeImpactField.jsx). C2 (transport
  // to waste processing) is included here too in case a real EPD publishes
  // it, but the app never treats its OWN absence as a gap to research —
  // C2 is otherwise always computed locally (mass x waste-facility
  // distance via the same transport formula as A4), not guessed.
  const eolC1 = moduleValue('C1');
  const eolC2 = moduleValue('C2');
  const eolC3 = moduleValue('C3');
  const eolC4 = moduleValue('C4');
  const eolModuleD = moduleValue('D');

  const density =
    json?.processInformation?.dataSetInformation?.['common:other']?.anies?.find?.(
      (p) => /density|rohdichte/i.test(p?.name ?? '')
    )?.value ?? null;

  // Reference/declared service life ("RSL") — same best-effort extraction
  // as density above. Real-world coverage is spotty: many EPDs don't
  // declare this field at all, or bury it somewhere this loose match
  // won't catch, so a null here is common and expected — that's exactly
  // what routes a layer to the AI-search/manual fallback tiers in the UI
  // rather than a bug in this parser.
  const serviceLifeYearsRaw =
    json?.processInformation?.dataSetInformation?.['common:other']?.anies?.find?.(
      (p) => /service.?life|nutzungsdauer|rsl\b|reference service life/i.test(p?.name ?? '')
    )?.value ?? null;
  const serviceLifeYears = serviceLifeYearsRaw != null ? Number(serviceLifeYearsRaw) : null;

  return {
    name,
    declaredUnit,
    gwpA1A3, // kg CO2e per declared unit — null if the parser couldn't find it, ALWAYS spot-check against the Ökobaudat web page before trusting a number
    density,
    serviceLifeYears: Number.isFinite(serviceLifeYears) ? serviceLifeYears : null,
    eolC1,
    eolC2,
    eolC3,
    eolC4,
    eolModuleD,
    sourceUrl: null, // filled in by caller, who has the uuid/datastock
  };
}

/**
 * High-level convenience: search + fetch detail for the top results in one go.
 * This is what the React hook below calls.
 */
export async function searchMaterials(query, opts = {}) {
  const hits = await searchProcesses(query, opts);
  const toFetch = (hits || []).slice(0, MAX_DETAIL_FETCHES);

  const detailed = await Promise.all(
    toFetch.map(async (hit) => {
      try {
        const detail = await getProcessDetail(hit.datastockUuid, hit.uuid);
        return {
          ...hit,
          ...detail,
          sourceUrl: `https://oekobaudat.de/OEKOBAU.DAT/resource/datastocks/${hit.datastockUuid}/processes/${hit.uuid}?format=html&lang=en`,
        };
      } catch (err) {
        // Don't let one bad dataset kill the whole search — surface it as unresolved instead.
        return { ...hit, gwpA1A3: null, error: String(err) };
      }
    })
  );

  return { results: detailed, totalHits: hits.length, truncated: hits.length > toFetch.length };
}

/*
---------------------------------------------------------------------------
If you hit a CORS error in dev (browser console: "blocked by CORS policy"),
add this to vite.config.js and swap BASE above to '/okobaudat-api/resource':

  server: {
    proxy: {
      '/okobaudat-api': {
        target: 'https://oekobaudat.de/OEKOBAU.DAT',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/okobaudat-api/, ''),
      },
    },
  },

This only helps `npm run dev` — a production deploy would need an actual
serverless proxy (e.g. a one-line Vercel/Netlify function) since there's no
dev server to do the rewriting for you.
---------------------------------------------------------------------------
*/
