import { useState } from 'react';
import { useMaterialSearch } from '../hooks/useMaterialSearch';
import { disciplines, lambdaByDiscipline } from '../data/lambdaProviders';

// Mirrors FicheTechnique.css's field-suggest-badge collapse: high =
// complete/trustworthy, medium and low both = needs attention — one
// consolidated amber, not each component picking its own shade.
const CONFIDENCE_COLOR = {
  high: 'var(--status-complete)',
  medium: 'var(--status-attention)',
  low: 'var(--status-attention)',
};

/**
 * Drop this into your section configurator. Renders discipline tabs, a live
 * Ökobaudat search box, and a browse-by-discipline list of the materials
 * we already have λ values for (from lambda_providers.xlsx).
 *
 * @param {{
 *   defaultDiscipline?: string,
 *   onSelect: (material: {
 *     name: string,
 *     gwpA1A3: number|null,
 *     declaredUnit: string|null,
 *     lambda: number|null,
 *     lambdaSource: string|null,
 *     okobaudatUrl: string|null,
 *   }) => void,
 * }} props
 */
export default function MaterialSearchPanel({ defaultDiscipline, onSelect }) {
  const [discipline, setDiscipline] = useState(defaultDiscipline || disciplines[0]);
  const [query, setQuery] = useState('');
  const { loading, error, results, truncated } = useMaterialSearch(query, discipline);

  const showingLiveSearch = query.trim().length >= 2;
  const browseList = lambdaByDiscipline[discipline] ?? [];

  function handlePick(okobaudatResult) {
    const lam = okobaudatResult.lambdaMatch;
    const density = okobaudatResult.density != null ? Number(okobaudatResult.density) : null;
    onSelect({
      name: okobaudatResult.name,
      gwpA1A3: okobaudatResult.gwpA1A3,
      declaredUnit: okobaudatResult.declaredUnit,
      lambda: lam?.lambda ?? null,
      lambdaSource: lam ? `${lam.source} (${lam.confidenceLabel})` : null,
      density: Number.isFinite(density) ? density : null,
      serviceLifeYears: okobaudatResult.serviceLifeYears ?? null,
      eolC1: okobaudatResult.eolC1 ?? null,
      eolC2: okobaudatResult.eolC2 ?? null,
      eolC3: okobaudatResult.eolC3 ?? null,
      eolC4: okobaudatResult.eolC4 ?? null,
      eolModuleD: okobaudatResult.eolModuleD ?? null,
      okobaudatUrl: okobaudatResult.sourceUrl,
    });
  }

  function handlePickLocal(entry) {
    onSelect({
      name: entry.material,
      gwpA1A3: null, // not fetched yet — encourage a live search to confirm current GWP
      declaredUnit: null,
      lambda: entry.lambda,
      lambdaSource: `${entry.source} (${entry.confidenceLabel})`,
      okobaudatUrl: null,
    });
  }

  return (
    <div className="mid2030-material-search">
      <div className="mms-tabs" role="tablist">
        {disciplines.map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={d === discipline}
            className={`mms-tab${d === discipline ? ' mms-tab--active' : ''}`}
            onClick={() => setDiscipline(d)}
          >
            {d}
          </button>
        ))}
      </div>

      <input
        type="text"
        className="mms-search-input"
        placeholder={`Search Ökobaudat for a ${discipline.toLowerCase()} material…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {showingLiveSearch ? (
        <div className="mms-results">
          {loading && <p className="mms-status">Searching Ökobaudat…</p>}
          {error && (
            <p className="mms-status mms-status--error">
              Ökobaudat search failed: {error}. If this is a CORS error in dev, see the comment
              at the bottom of <code>okobaudatClient.js</code>.
            </p>
          )}
          {!loading && !error && results.length === 0 && (
            <p className="mms-status">No matches in Ökobaudat for "{query}".</p>
          )}
          {results.map((r) => (
            <button key={r.uuid} className="mms-result-card" onClick={() => handlePick(r)}>
              <div className="mms-result-name">{r.name}</div>
              <div className="mms-result-meta">
                <span>
                  {r.gwpA1A3 != null
                    ? `${r.gwpA1A3} kgCO₂e / ${r.declaredUnit ?? 'unit'}`
                    : 'GWP not parsed — open source to confirm'}
                </span>
                {r.lambdaMatch ? (
                  <span
                    className="mms-badge"
                    style={{ color: CONFIDENCE_COLOR[r.lambdaMatch.confidence] }}
                    title={r.lambdaMatch.source}
                  >
                    λ {r.lambdaMatch.lambda ?? r.lambdaMatch.lambdaNote} W/mK ·{' '}
                    {r.lambdaMatch.confidence} match
                  </span>
                ) : (
                  <span className="mms-badge mms-badge--none">no local λ match</span>
                )}
              </div>
            </button>
          ))}
          {truncated && (
            <p className="mms-status mms-status--muted">
              More results exist on Ökobaudat — refine your search to narrow it down.
            </p>
          )}
        </div>
      ) : (
        <div className="mms-browse">
          <p className="mms-status mms-status--muted">
            Materials already researched for {discipline} (from lambda_providers). Search above to
            pull live GWP data from Ökobaudat for any of these, or pick directly below to use the
            λ value only.
          </p>
          {browseList.map((entry) => (
            <button key={entry.id} className="mms-result-card" onClick={() => handlePickLocal(entry)}>
              <div className="mms-result-name">{entry.material}</div>
              <div className="mms-result-meta">
                <span>{entry.provider}</span>
                <span
                  className="mms-badge"
                  style={{ color: CONFIDENCE_COLOR[entry.confidence] }}
                  title={entry.source}
                >
                  λ {entry.lambda ?? entry.lambdaNote} W/mK · {entry.confidence}
                </span>
              </div>
              {entry.notes && <div className="mms-result-note">⚠ {entry.notes}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
