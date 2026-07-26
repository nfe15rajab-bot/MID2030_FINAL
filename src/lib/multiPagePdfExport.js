import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

// Adds one canvas to the PDF, splitting across additional pages if the
// canvas (scaled to the page width) is taller than a single page. Assumes
// the canvas should start on whatever the PDF's current page already is —
// callers handle adding a fresh page BEFORE calling this for anything
// after the first chunk/section.
function addCanvasPaginated(pdf, canvas, pdfWidth, pdfHeight) {
  if (!canvas || canvas.width === 0 || canvas.height === 0) {
    throw new Error('Canvas rendering failed (0 width or height)')
  }

  let imgData = ''
  let format = 'PNG'
  try {
    imgData = canvas.toDataURL('image/png')
    if (!imgData || imgData === 'data:,' || imgData.length < 100) {
      throw new Error('Invalid PNG data URL')
    }
  } catch (e) {
    imgData = canvas.toDataURL('image/jpeg', 0.95)
    format = 'JPEG'
  }

  const imgWidth = pdfWidth
  const imgHeight = (canvas.height * imgWidth) / canvas.width

  let heightLeft = imgHeight
  let position = 0
  pdf.addImage(imgData, format, 0, position, imgWidth, imgHeight)
  heightLeft -= pdfHeight

  while (heightLeft > 0) {
    position = heightLeft - imgHeight
    pdf.addPage()
    pdf.addImage(imgData, format, 0, position, imgWidth, imgHeight)
    heightLeft -= pdfHeight
  }
}

export function isolateClonedElement(clonedDoc, clonedEl, defaultWidth = 800) {
  if (!clonedDoc || !clonedEl) return

  const targetWidth = clonedEl.scrollWidth || clonedEl.offsetWidth || defaultWidth

  clonedEl.style.position = 'static'
  clonedEl.style.left = '0'
  clonedEl.style.top = '0'
  clonedEl.style.display = 'block'
  clonedEl.style.visibility = 'visible'
  clonedEl.style.opacity = '1'
  clonedEl.style.transform = 'none'
  clonedEl.style.margin = '0'
  clonedEl.style.padding = '0'
  clonedEl.style.width = `${targetWidth}px`
  clonedEl.style.maxWidth = 'none'
  clonedEl.style.maxHeight = 'none'
  clonedEl.style.height = 'auto'
  clonedEl.style.overflow = 'visible'

  const container = clonedDoc.createElement('div')
  container.style.position = 'absolute'
  container.style.left = '0'
  container.style.top = '0'
  container.style.display = 'block'
  container.style.margin = '0'
  container.style.padding = '0'
  container.style.background = '#ffffff'
  container.style.width = `${targetWidth}px`
  container.style.overflow = 'visible'

  container.appendChild(clonedEl)

  clonedDoc.body.innerHTML = ''
  clonedDoc.body.style.margin = '0'
  clonedDoc.body.style.padding = '0'
  clonedDoc.body.style.background = '#ffffff'
  clonedDoc.body.style.overflow = 'visible'
  clonedDoc.body.appendChild(container)
}

// A full multi-section report (or poster page) can be tens of thousands
// of px tall. At scale:2 that's a canvas well past what a browser will
// actually allocate (commonly ~16k-32k px per side, ~268M px total area)
// — past that ceiling html2canvas/the browser doesn't error, it silently
// returns a canvas with the overflow portion blank, which is exactly what
// was showing up as blank pages in the exported PDF. Capturing the SAME
// element in slices instead — each sized to an exact whole number of PDF
// pages, so a slice boundary is always also a page boundary, never a
// partial/duplicated page at the seam — keeps every single html2canvas
// call comfortably under any browser's limit, regardless of how long the
// report gets.
//
// Every chunk re-clones and re-lays-out the ENTIRE element (windowHeight
// stays the full document height so layout resolves correctly; only the
// OUTPUT canvas is cropped to this chunk's slice), so a smaller chunk
// size means MORE full-document render passes, not less total work --
// this is the real cost behind a slow export, not any one pass being
// inefficient. 20,000px (pre-scale) at scale:2 -> ~40,000px canvas
// height, ~63M px^2 area for this app's own ~794px-wide report content
// -- still a small fraction of the 268M-px ceiling -- roughly halves the
// chunk count (and so the wall-clock time) versus the original
// conservative 12,000px this was verified safe at.
const MAX_CHUNK_SOURCE_HEIGHT = 20000

// Captures one element and adds it to the PDF, chunked per the above.
// `isFirstOverall` controls whether the very first chunk draws on the
// PDF's already-existing current page (the true start of the document)
// or needs its own fresh page first (a later section in a multi-element
// export, e.g. exportMultiSectionPdf's second/third element).
function countChunks(element, pdfWidth, pdfHeight) {
  const width = element.scrollWidth || element.offsetWidth || 800
  const height = element.scrollHeight || element.offsetHeight || 1000
  const sourcePxPerPage = pdfHeight * (width / pdfWidth)
  const pagesPerChunk = Math.max(1, Math.floor(MAX_CHUNK_SOURCE_HEIGHT / sourcePxPerPage))
  const chunkHeight = pagesPerChunk * sourcePxPerPage
  return Math.max(1, Math.ceil(height / chunkHeight))
}

// `onProgress(current, total)` fires after each chunk — this export can
// take a minute or more on a full multi-section report (each chunk is its
// own full html2canvas pass), and with nothing but a static "Generating…"
// label the whole time, a slow-but-working export is easy to mistake for
// a hung/broken one. Reporting real chunk progress lets the caller show
// the difference.
async function captureElementPaginated(pdf, element, pdfWidth, pdfHeight, { scale = 2, isFirstOverall, onProgress, totalChunks = 1, chunksDoneBefore = 0 } = {}) {
  const width = element.scrollWidth || element.offsetWidth || 800
  const height = element.scrollHeight || element.offsetHeight || 1000

  const sourcePxPerPage = pdfHeight * (width / pdfWidth)
  const pagesPerChunk = Math.max(1, Math.floor(MAX_CHUNK_SOURCE_HEIGHT / sourcePxPerPage))
  const chunkHeight = pagesPerChunk * sourcePxPerPage

  let firstChunk = true
  let chunkIndex = 0
  for (let y = 0; y < height; y += chunkHeight) {
    const thisChunkHeight = Math.min(chunkHeight, height - y)
    const canvas = await html2canvas(element, {
      scale,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: true,
      logging: false,
      imageTimeout: 15000,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y,
      width,
      height: thisChunkHeight,
      windowWidth: width,
      windowHeight: height,
      onclone: (clonedDoc, clonedEl) => {
        isolateClonedElement(clonedDoc, clonedEl, width)
      },
    })
    if (!(isFirstOverall && firstChunk)) pdf.addPage()
    addCanvasPaginated(pdf, canvas, pdfWidth, pdfHeight)
    firstChunk = false
    chunkIndex += 1
    onProgress?.(chunksDoneBefore + chunkIndex, totalChunks)
  }
}

export async function exportMultiPagePdf(element, filename, { format = 'a4', orientation = 'portrait', onProgress } = {}) {
  if (!element) throw new Error('No element provided for PDF export')

  const pdf = new jsPDF({ orientation, unit: 'px', format })
  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = pdf.internal.pageSize.getHeight()
  const totalChunks = countChunks(element, pdfWidth, pdfHeight)
  await captureElementPaginated(pdf, element, pdfWidth, pdfHeight, { isFirstOverall: true, onProgress, totalChunks })
  pdf.save(filename)
}

export async function exportMultiSectionPdf(elements, filename, { format = 'a4', orientation = 'portrait', onProgress } = {}) {
  const pdf = new jsPDF({ orientation, unit: 'px', format })
  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = pdf.internal.pageSize.getHeight()

  const validElements = elements.filter(Boolean)
  const chunkCounts = validElements.map((el) => countChunks(el, pdfWidth, pdfHeight))
  const totalChunks = chunkCounts.reduce((sum, c) => sum + c, 0)

  let isFirstOverall = true
  let chunksDoneBefore = 0
  for (let i = 0; i < validElements.length; i++) {
    await captureElementPaginated(pdf, validElements[i], pdfWidth, pdfHeight, { isFirstOverall, onProgress, totalChunks, chunksDoneBefore })
    isFirstOverall = false
    chunksDoneBefore += chunkCounts[i]
  }

  pdf.save(filename)
}
