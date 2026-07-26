import React, { useState } from 'react'

// Categorical donut ("camembert") — each layer's share of an assembly's
// total GWP contribution. Palette is the dataviz skill's validated
// 8-hue default (fixed order, never cycled) — re-validate with
// scripts/validate_palette.js before changing any of these hexes.
const SLOT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const OTHER_COLOR = '#898781' // muted ink — "Other" is a bucket, not an identity, so it doesn't spend a hue slot
const MAX_SLICES = SLOT_COLORS.length
const PAD_DEG = 1.4 // surface-color gap between segments, not a stroke — see dataviz skill's "surface gap" spacer
const DIRECT_LABEL_MIN_DEG = 25 // below this a value label wouldn't fit — legend + tooltip carry it instead

function polarPoint(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function donutSlicePath(cx, cy, rOuter, rInner, startDeg, endDeg) {
  const largeArc = endDeg - startDeg > 180 ? 1 : 0
  const [x0, y0] = polarPoint(cx, cy, rOuter, startDeg)
  const [x1, y1] = polarPoint(cx, cy, rOuter, endDeg)
  const [x2, y2] = polarPoint(cx, cy, rInner, endDeg)
  const [x3, y3] = polarPoint(cx, cy, rInner, startDeg)
  return [
    `M${x0},${y0}`,
    `A${rOuter},${rOuter} 0 ${largeArc} 1 ${x1},${y1}`,
    `L${x2},${y2}`,
    `A${rInner},${rInner} 0 ${largeArc} 0 ${x3},${y3}`,
    'Z',
  ].join(' ')
}

// Sized by MAGNITUDE of contribution (kg CO2e), never the raw signed
// value — this data routinely diverges (biogenic-carbon materials are
// net-negative, high-carbon materials net-positive; a real pie slice
// can't be negative-sized). Sign is never lost, though: every label and
// the legend always show the real signed value, and the caption below
// the chart says so explicitly — the ring answers "how much of the
// total swing does this layer account for", the numbers answer "which
// direction".
export default function LayerSharePieChart({ title, unit, slices, exportable = false }) {
  const [hoverKey, setHoverKey] = useState(null)

  const known = slices.filter((s) => s.value != null && s.value !== 0)
  const unknownCount = slices.length - known.length

  if (known.length === 0) {
    return (
      <div className="layer-share-chart">
        <div className="bar-chart-header">
          <h4 className="bar-chart-title">{title}{unit ? ` (${unit})` : ''}</h4>
        </div>
        <p className="layer-share-empty">No known values yet to chart a share breakdown.</p>
      </div>
    )
  }

  const sorted = [...known].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  const head = sorted.slice(0, MAX_SLICES)
  const tail = sorted.slice(MAX_SLICES)

  const entries = head.map((s, i) => ({ ...s, color: SLOT_COLORS[i], magnitude: Math.abs(s.value) }))
  if (tail.length > 0) {
    const otherValue = tail.reduce((sum, s) => sum + s.value, 0)
    const otherMagnitude = tail.reduce((sum, s) => sum + Math.abs(s.value), 0)
    entries.push({
      key: '__other__',
      label: `Other (${tail.length} smaller layer${tail.length === 1 ? '' : 's'})`,
      value: otherValue,
      formattedValue: otherValue.toFixed(2),
      color: OTHER_COLOR,
      magnitude: otherMagnitude,
      isOther: true,
    })
  }

  const totalMagnitude = entries.reduce((sum, e) => sum + e.magnitude, 0)
  const signedTotal = known.reduce((sum, s) => sum + s.value, 0)

  const cx = 90
  const cy = 90
  const rOuter = 80
  const rInner = 48

  let cursor = 0
  const arcs = entries.map((e) => {
    const angle = totalMagnitude > 0 ? (e.magnitude / totalMagnitude) * 360 : 0
    const startDeg = cursor
    const endDeg = cursor + angle
    cursor = endDeg
    const pad = Math.min(PAD_DEG, angle * 0.4)
    return { ...e, startDeg: startDeg + pad / 2, endDeg: endDeg - pad / 2, midDeg: (startDeg + endDeg) / 2, angle }
  })

  return (
    <div className="layer-share-chart">
      <div className="bar-chart-header">
        <h4 className="bar-chart-title">{title}{unit ? ` (${unit})` : ''}</h4>
      </div>

      <div className="layer-share-body">
        <svg viewBox="0 0 180 180" width={180} height={180} role="img" aria-label={title}>
          {arcs.map((a) => (
            <g
              key={a.key}
              onMouseEnter={() => setHoverKey(a.key)}
              onMouseLeave={() => setHoverKey((k) => (k === a.key ? null : k))}
            >
              <path
                d={donutSlicePath(cx, cy, rOuter, rInner, a.startDeg, a.endDeg)}
                fill={a.color}
                opacity={hoverKey == null || hoverKey === a.key ? 1 : 0.45}
              />
              {a.angle >= DIRECT_LABEL_MIN_DEG && (
                <text
                  x={polarPoint(cx, cy, (rOuter + rInner) / 2, a.midDeg)[0]}
                  y={polarPoint(cx, cy, (rOuter + rInner) / 2, a.midDeg)[1]}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="10"
                  fill="#fff"
                >
                  {a.formattedValue}
                </text>
              )}
            </g>
          ))}
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize="15" fontWeight="700" fill="#222">
            {signedTotal.toFixed(1)}
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="#888">
            total {unit}
          </text>
        </svg>

        <ul className="layer-share-legend">
          {arcs.map((a) => (
            <li
              key={a.key}
              className={hoverKey != null && hoverKey !== a.key ? 'layer-share-legend-row--dim' : ''}
              onMouseEnter={() => setHoverKey(a.key)}
              onMouseLeave={() => setHoverKey((k) => (k === a.key ? null : k))}
            >
              <span className="layer-share-swatch" style={{ background: a.color }} />
              <span className="layer-share-legend-label">{a.label}</span>
              <span className="layer-share-legend-value">{a.formattedValue}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="layer-share-caveat">
        Ring is sized by magnitude of contribution, not the signed value — this data routinely includes
        both net-emitting and net-carbon-storing layers, which a slice can't show as "negative-sized". Every
        label and legend row shows the real signed {unit || 'value'}; negative means net carbon storage, not
        a smaller contribution.
        {unknownCount > 0 && ` ${unknownCount} layer${unknownCount === 1 ? '' : 's'} excluded — value not yet known.`}
      </p>
    </div>
  )
}
