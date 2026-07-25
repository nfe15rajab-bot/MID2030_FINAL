import React from 'react'
import ProviderMap from './ProviderMap.jsx'

// Controlled dropdown + map: the parent owns which material is selected, so
// it can be driven either by this dropdown directly or by something else
// (e.g. clicking a layer in the Providers tab) — same selection either way.
export default function MaterialProviderMap({ materials, selectedMaterialId, onSelect }) {
  if (materials.length === 0) {
    return <p className="empty-state">No materials registered for this category yet.</p>
  }

  const materialId = selectedMaterialId || materials[0]?.id || ''

  return (
    <div>
      <select value={materialId} onChange={(e) => onSelect(e.target.value)}>
        {materials.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <ProviderMap materialId={materialId} />
    </div>
  )
}
