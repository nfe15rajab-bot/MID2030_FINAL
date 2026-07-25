import React, { forwardRef } from 'react'
import FicheMap, { MARKER_COLORS, providerMarkerColor } from './FicheMap.jsx'
import { toSpecsBullets, trimToWords } from '../lib/ficheText.js'

// Read-only "fiche technique" sheet — matches the class reference layout
// exactly. Deliberately plain text everywhere (no <input>/<textarea>):
// html2canvas doesn't reliably paint live form-control values into the
// captured canvas, the same reason SectionPreview.jsx is read-only text
// fed by LayerBuilder's editable state rather than being editable itself.
// FicheTechniquePanel.jsx owns the actual editable form and feeds this
// component via the `detail` prop.
const FicheTechnique = forwardRef(function FicheTechnique(
  { material, closestToSite, detail, mapSnapshotUrl, onMapReady },
  ref
) {
  const categoryLabel = material.discipline
    ? `${material.discipline} elements`
    : material.category
      ? `${material.category} elements`
      : 'Uncategorized (live search / not in catalog)'

  // Condensed "label: value" bullets instead of a paragraph — see
  // toSpecsBullets' header comment for why it handles both the new
  // bullet-format AI output and older paragraph-style saved text.
  const specsBullets = toSpecsBullets(detail.specs)

  // Left-column circularity bullets: recyclability%/deconstruction method
  // (circularity* fields) plus the existing end-of-life scenario/notes
  // (endOfLifeScenario/endOfLifeNotes, also shown in full below in the
  // fiche-eol-band) — condensed to the same short label:value format so
  // this block balances against the specs bullets on the right.
  const circularityBullets = [
    detail.circularityRecyclabilityPercent
      ? `Recyclability: ${detail.circularityRecyclabilityPercent}%`
      : null,
    detail.endOfLifeScenario ? `Disposal route: ${detail.endOfLifeScenario}` : null,
    detail.circularityDeconstructionMethod
      ? `Deconstruction: ${trimToWords(detail.circularityDeconstructionMethod, 6)}`
      : null,
    detail.endOfLifeNotes ? `Notes: ${trimToWords(detail.endOfLifeNotes, 8)}` : null,
  ].filter(Boolean)

  return (
    <div className="fiche-sheet" ref={ref}>
      <div className="fiche-header">
        <h2>Category : {categoryLabel}</h2>
      </div>

      <div className="fiche-body">
        <div className="fiche-col fiche-col-left">
          <div className="fiche-product-name">{material.name}</div>
          {detail.photoDataUrl ? (
            <img src={detail.photoDataUrl} alt={material.name} className="fiche-photo" />
          ) : (
            <div className="fiche-photo-placeholder">No photo uploaded</div>
          )}
          {circularityBullets.length > 0 && (
            <div className="fiche-field fiche-circularity">
              <div className="fiche-label">End of life / circularity</div>
              <ul className="fiche-bullet-list">
                {circularityBullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="fiche-col fiche-col-middle">
          <div className="fiche-field">
            <div className="fiche-label">Technical german name :</div>
            <div className="fiche-value">{detail.germanName || '—'}</div>
          </div>
          <div className="fiche-field">
            <div className="fiche-label">Technical infos / material specifications</div>
            {specsBullets.length > 0 ? (
              <ul className="fiche-bullet-list">
                {specsBullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            ) : (
              <div className="fiche-value">—</div>
            )}
          </div>
          <div className="fiche-field">
            <div className="fiche-label">Technical norm :</div>
            <div className="fiche-value">{detail.norm || '—'}</div>
          </div>
        </div>

        <div className="fiche-col fiche-col-right">
          <div className="fiche-label">Location</div>
          <FicheMap
            providerLatLng={
              closestToSite?.lat != null
                ? { lat: closestToSite.lat, lng: closestToSite.lng }
                : detail.providerLat != null && detail.providerLng != null
                  ? { lat: detail.providerLat, lng: detail.providerLng }
                  : null
            }
            providerVerified={!!closestToSite}
            snapshotUrl={mapSnapshotUrl}
            onMapReady={onMapReady}
          />
          <div className="fiche-map-legend">
            <span>
              <span
                className="fiche-legend-swatch"
                style={{ background: providerMarkerColor(!!closestToSite) }}
              />
              Provider {closestToSite ? '(verified)' : '(unverified)'}
            </span>
            <span><span className="fiche-legend-swatch" style={{ background: MARKER_COLORS.haarlem }} />Haarlem</span>
            <span><span className="fiche-legend-swatch" style={{ background: MARKER_COLORS.detmold }} />Detmold</span>
          </div>

          <div className="fiche-field">
            <div className="fiche-sublabel">Distance to Haarlem</div>
            <div className="fiche-value-large">
              {closestToSite
                ? `${closestToSite.distanceToSiteKm.toFixed(0)} km`
                : detail.providerDistanceKm
                  ? `${detail.providerDistanceKm} km`
                  : '—'}
            </div>
          </div>

          <div className="fiche-field">
            <div className="fiche-label">Provider :</div>
            <div className="fiche-value">{closestToSite?.name || detail.providerName || '—'}</div>
          </div>
          <div className="fiche-field">
            <div className="fiche-label">Provider's location :</div>
            <div className="fiche-value">{closestToSite?.address || detail.providerLocation || '—'}</div>
          </div>
          <div className="fiche-field">
            <div className="fiche-label">Provider's website :</div>
            <div className="fiche-value">{closestToSite?.website || detail.providerWebsite || '—'}</div>
          </div>
        </div>
      </div>

      <div className="fiche-eol-band">
        <div className="fiche-label">End of life :</div>
        <div className="fiche-eol-body">
          <span className="fiche-eol-scenario">{detail.endOfLifeScenario || 'Unresearched'}</span>
          {detail.endOfLifeNotes && <span className="fiche-eol-notes">{detail.endOfLifeNotes}</span>}
          {detail.endOfLifeConfidenceLabel && (
            <span className={`field-suggest-badge field-suggest-badge--${detail.endOfLifeConfidence}`}>
              {detail.endOfLifeConfidenceLabel}
            </span>
          )}
          {detail.endOfLifeSource && (
            <a href={detail.endOfLifeSource} target="_blank" rel="noreferrer" className="fiche-eol-source">source</a>
          )}
        </div>
      </div>
    </div>
  )
})

export default FicheTechnique
