import React from 'react'
import { useSharedData } from '../hooks/useSharedData.js'

// Small live-updating "last edited by / at" indicator for the shared
// λ/GWP overlay (aiMaterialDataStorage.js / sharedData/materialData in
// Firestore) — lets a teammate glance at the top of the layer builder or
// material search panel and see whether someone else just touched the
// shared dataset, Google-Docs style, without accepting/reloading
// anything themselves. Purely informational — reads the same document
// aiMaterialDataStorage.js's background listener already keeps
// localStorage in sync with; this is a second, independent subscription
// used only for display.
export default function SharedDataBanner() {
  const { data, loading, source } = useSharedData('sharedData/materialData')

  if (loading) return null

  if (source === 'fallback') {
    return (
      <p className="shared-data-banner shared-data-banner--offline">
        Shared λ/GWP sync unavailable — using this browser's local data only.
      </p>
    )
  }

  if (!data?.lastEditedBy) return null

  return (
    <p className="shared-data-banner">
      Shared λ/GWP data last updated by <strong>{data.lastEditedBy}</strong>
      {data.lastEditedAt && ` at ${new Date(data.lastEditedAt).toLocaleString()}`}
    </p>
  )
}
