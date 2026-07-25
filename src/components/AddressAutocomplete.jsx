import React, { useEffect, useRef, useState } from 'react'
import { useAddressAutocomplete } from '../hooks/useAddressAutocomplete.js'

// Type-ahead address search backed by Nominatim (nominatimClient.js).
// Deliberately dumb about what "selecting" means — it just hands the
// caller { displayName, lat, lng } and lets them decide what to do with
// the coordinates (e.g. FicheTechniquePanel drops them into the fiche's
// provider fields and plots a pin on FicheMap). Free typing without ever
// picking a suggestion is still allowed — onChange fires on every
// keystroke same as a plain <input>, only onSelect additionally carries
// coordinates.
export default function AddressAutocomplete({ value, onChange, onSelect, countryCodes, placeholder }) {
  const [open, setOpen] = useState(false)
  const { loading, error, results } = useAddressAutocomplete(open ? value : '', { countryCodes })
  const containerRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handlePick(result) {
    onSelect(result)
    setOpen(false)
  }

  return (
    <div className="address-autocomplete" ref={containerRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && value.trim().length >= 3 && (
        <div className="address-autocomplete-dropdown">
          {loading && <div className="address-autocomplete-status">Searching…</div>}
          {error && (
            <div className="address-autocomplete-status address-autocomplete-status--error">
              Search failed: {error}
            </div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="address-autocomplete-status">No matches</div>
          )}
          {results.map((r, i) => (
            <button
              type="button"
              key={`${r.lat}-${r.lng}-${i}`}
              className="address-autocomplete-option"
              onClick={() => handlePick(r)}
            >
              {r.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
