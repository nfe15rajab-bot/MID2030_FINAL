import React, { useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

// Single-series bar chart, plain SVG, no charting library — matches this
// app's existing minimal aesthetic (one accent color throughout). Mark
// spec: bars capped at 24px thick, 4px rounded data-end / square
// baseline, value labeled at the tip, hairline baseline, hover tooltip.
// A single series needs no legend (the chart title already says what's
// plotted) — see dataviz skill's marks-and-anatomy.md.
//
// Missing/out-of-scope bars render as a dashed outline rather than a
// zero-height bar — a real 0 W/m²K or 0 kg CO2e would misstate an
// assembly that's simply unresearched, not actually zero.
const BAR_WIDTH = 22
// Category labels are rotated (see the category <text> below) rather than
// horizontal — a wall/roof assembly can have up to 9 layers, and horizontal
// labels under a 22px-wide bar started overlapping their neighbors well
// before that (verified directly against a 9-layer wall). Rotating trades
// horizontal crowding for vertical room; BAR_GAP and the angle below were
// both widened/steepened from a first pass that still left ~10px of
// diagonal overlap between adjacent 13-character labels — verified via
// each label's actual rendered (post-rotation) bounding box, not just the
// pre-rotation layout box, since a rotated element's untransformed bbox
// doesn't reflect what's visually overlapping.
const BAR_GAP = 44
const CHART_HEIGHT = 160
const LABEL_HEIGHT = 68
const LABEL_ROTATION_DEG = -48

// exportable: opt-in (see AssemblyAnalysisTab.jsx) rather than always-on —
// A4ReportDraft.jsx renders this same component straight into a page that
// itself gets captured/exported as a whole (see A3PosterDraft's pattern);
// a button baked into that printed sheet would be both meaningless (mid-
// export, nothing to click) and visually wrong to have appear in the PDF.
export default function BarChart({ title, unit, bars, exportable = false }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const [exporting, setExporting] = useState(false)
  const containerRef = useRef(null)

  const knownValues = bars.filter((b) => b.value != null).map((b) => b.value)
  const maxValue = knownValues.length > 0 ? Math.max(...knownValues) : 1
  const scale = (v) => (maxValue > 0 ? (v / maxValue) * (CHART_HEIGHT - 24) : 0)

  const width = bars.length * (BAR_WIDTH + BAR_GAP) + BAR_GAP
  const totalHeight = CHART_HEIGHT + LABEL_HEIGHT

  async function handleExportPdf() {
    if (!containerRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(containerRef.current, { scale: 2, backgroundColor: '#ffffff' })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height)
      const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      pdf.save(`${filename || 'chart'}.pdf`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="bar-chart" ref={containerRef}>
      <div className="bar-chart-header">
        <h4 className="bar-chart-title">{title}{unit ? ` (${unit})` : ''}</h4>
        {exportable && (
          <button type="button" className="bar-chart-export-button" onClick={handleExportPdf} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        )}
      </div>
      <svg viewBox={`0 0 ${width} ${totalHeight}`} width={width} height={totalHeight} role="img" aria-label={title}>
        {/* baseline — hairline, recessive */}
        <line x1={0} y1={CHART_HEIGHT} x2={width} y2={CHART_HEIGHT} stroke="#ddd" strokeWidth={1} />

        {bars.map((bar, i) => {
          const x = BAR_GAP + i * (BAR_WIDTH + BAR_GAP)
          const isKnown = bar.value != null
          const barHeight = isKnown ? Math.max(scale(bar.value), 2) : 28
          const y = CHART_HEIGHT - barHeight

          return (
            <g
              key={bar.key ?? bar.label}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
            >
              {isKnown ? (
                <path
                  d={`M${x},${CHART_HEIGHT} L${x},${y + 4} Q${x},${y} ${x + 4},${y} L${x + BAR_WIDTH - 4},${y} Q${x + BAR_WIDTH},${y} ${x + BAR_WIDTH},${y + 4} L${x + BAR_WIDTH},${CHART_HEIGHT} Z`}
                  fill="var(--accent)"
                />
              ) : (
                <rect
                  x={x}
                  y={y}
                  width={BAR_WIDTH}
                  height={barHeight}
                  fill="none"
                  stroke="#bbb"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  rx={4}
                />
              )}

              {/* direct label at the tip — sparing, one per bar since there are only 3-4 */}
              <text x={x + BAR_WIDTH / 2} y={y - 6} textAnchor="middle" fontSize="10" fill="#555">
                {isKnown ? bar.formattedValue : (bar.outOfScope ? 'n/a' : '—')}
              </text>

              {/* category label below baseline — angled and right-anchored (reads
                  bottom-to-top toward its own bar) so labels no longer collide with
                  their neighbors the way horizontal, center-anchored text did once a
                  section had more than 4-5 layers. */}
              <text
                x={x + BAR_WIDTH / 2}
                y={CHART_HEIGHT + 12}
                textAnchor="end"
                fontSize="10"
                fill="#666"
                transform={`rotate(${LABEL_ROTATION_DEG} ${x + BAR_WIDTH / 2} ${CHART_HEIGHT + 12})`}
              >
                {bar.label}
              </text>

              {/* larger invisible hit target for hover, per interaction guidance */}
              <rect x={x - 6} y={0} width={BAR_WIDTH + 12} height={CHART_HEIGHT} fill="transparent" />
            </g>
          )
        })}
      </svg>

      {hoverIndex != null && (
        <div className="bar-chart-tooltip">
          <strong>{bars[hoverIndex].label}</strong>{': '}
          {bars[hoverIndex].value != null
            ? `${bars[hoverIndex].formattedValue}${unit ? ` ${unit}` : ''}`
            : bars[hoverIndex].tooltipNote || 'no data'}
        </div>
      )}
    </div>
  )
}
