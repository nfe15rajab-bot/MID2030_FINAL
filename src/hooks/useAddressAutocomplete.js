import { useEffect, useRef, useState } from 'react'
import { searchAddress } from '../lib/nominatimClient.js'

const DEBOUNCE_MS = 600

/**
 * Debounced Nominatim address search — same "discard stale responses via
 * an incrementing request id" shape as useMaterialSearch.js (Ökobaudat),
 * just pointed at a different geocoder. The 1 req/sec floor itself lives
 * in nominatimClient.js, not here — this only decides *when* to fire.
 *
 * @param {string} query
 * @param {{ countryCodes?: string[] }} [opts]
 */
export function useAddressAutocomplete(query, { countryCodes } = {}) {
  const [state, setState] = useState({ loading: false, error: null, results: [] })
  const requestId = useRef(0)

  useEffect(() => {
    if (!query || query.trim().length < 3) {
      setState({ loading: false, error: null, results: [] })
      return
    }

    const thisRequest = ++requestId.current
    setState((s) => ({ ...s, loading: true, error: null }))

    const timer = setTimeout(async () => {
      try {
        const results = await searchAddress(query, { countryCodes })
        if (thisRequest !== requestId.current) return // superseded by a newer query
        setState({ loading: false, error: null, results })
      } catch (err) {
        if (thisRequest !== requestId.current) return
        setState({ loading: false, error: String(err.message ?? err), results: [] })
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, countryCodes?.join(',')])

  return state
}
