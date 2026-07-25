import { useEffect, useRef, useState } from 'react';
import { searchMaterials } from '../lib/okobaudatClient';
import { findLambdaMatch } from '../data/lambdaProviders';

const DEBOUNCE_MS = 400;

/**
 * Live Ökobaudat search for a given discipline, auto-enriched with our
 * researched λ values where a confident name match exists.
 *
 * @param {string} query
 * @param {string} [discipline] one of the keys in lambdaProviders.json
 *   (Floor / Wall / Roof / Roof windows) — narrows λ matching, not the
 *   Ökobaudat search itself (Ökobaudat has no discipline field to filter on).
 */
export function useMaterialSearch(query, discipline) {
  const [state, setState] = useState({
    loading: false,
    error: null,
    results: [],
    truncated: false,
  });
  const requestId = useRef(0);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setState({ loading: false, error: null, results: [], truncated: false });
      return;
    }

    const thisRequest = ++requestId.current;
    setState((s) => ({ ...s, loading: true, error: null }));

    const timer = setTimeout(async () => {
      try {
        const { results, truncated } = await searchMaterials(query);
        if (thisRequest !== requestId.current) return; // stale response, a newer query superseded it

        const enriched = results.map((r) => {
          const lambdaMatch = findLambdaMatch(r.name, discipline);
          return { ...r, lambdaMatch };
        });

        setState({ loading: false, error: null, results: enriched, truncated });
      } catch (err) {
        if (thisRequest !== requestId.current) return;
        setState({ loading: false, error: String(err), results: [], truncated: false });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, discipline]);

  return state;
}
