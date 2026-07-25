import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

// Adds one canvas to the PDF, splitting across additional pages if the
// canvas (scaled to the page width) is taller than a single page — shared
// by exportMultiPagePdf (one long element) and exportMultiSectionPdf
// (several independent elements, each paginated the same way) so the
// slicing math only lives in one place. Assumes the canvas should start
// on whatever the PDF's current page already is — callers handle adding
// a fresh page BEFORE calling this for anything after the first section.
function addCanvasPaginated(pdf, canvas, pdfWidth, pdfHeight) {
  const imgData = canvas.toDataURL('image/png')
  const imgWidth = pdfWidth
  const imgHeight = (canvas.height * imgWidth) / canvas.width

  let heightLeft = imgHeight
  let position = 0
  pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
  heightLeft -= pdfHeight

  while (heightLeft > 0) {
    position = heightLeft - imgHeight
    pdf.addPage()
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pdfHeight
  }
}

// Same html2canvas+jsPDF pipeline used everywhere else in this app
// (FicheTechniquePanel, LayerBuilder, LcaEpdTab), extended to paginate —
// every prior use of this pipeline was a single fixed-size sheet; the A4
// Report Draft is the first genuinely multi-page document, so this is
// the one new piece of plumbing, not a parallel export system.
// format/orientation are jsPDF's own options.
export async function exportMultiPagePdf(element, filename, { format = 'a4', orientation = 'portrait' } = {}) {
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff' })
  const pdf = new jsPDF({ orientation, unit: 'px', format })
  addCanvasPaginated(pdf, canvas, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight())
  pdf.save(filename)
}

/**
 * Like exportMultiPagePdf, but for N independent DOM sections that should
 * each start on their own physical page — used by A3PosterDraft.jsx's
 * two-sheet export (per-assembly content, then building totals/sources)
 * so the page break lands at a real content boundary instead of wherever
 * a single tall canvas happened to hit the page-height mark (which could
 * just as easily cut a table row or a diagram band in half as land
 * between them). Each section still falls back to the same
 * slice-pagination internally if IT ALONE is taller than one page — this
 * only changes where a new page starts between sections, not the safety
 * net within one.
 */
export async function exportMultiSectionPdf(elements, filename, { format = 'a4', orientation = 'portrait' } = {}) {
  const pdf = new jsPDF({ orientation, unit: 'px', format })
  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = pdf.internal.pageSize.getHeight()

  for (let i = 0; i < elements.length; i++) {
    const canvas = await html2canvas(elements[i], { scale: 2, backgroundColor: '#ffffff' })
    if (i > 0) pdf.addPage()
    addCanvasPaginated(pdf, canvas, pdfWidth, pdfHeight)
  }

  pdf.save(filename)
}
