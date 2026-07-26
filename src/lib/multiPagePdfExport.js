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

export async function exportMultiPagePdf(element, filename, { format = 'a4', orientation = 'portrait' } = {}) {
  if (!element) throw new Error('No element provided for PDF export')

  const width = element.scrollWidth || element.offsetWidth || 800
  const height = element.scrollHeight || element.offsetHeight || 1000

  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    allowTaint: true,
    logging: false,
    imageTimeout: 15000,
    scrollX: 0,
    scrollY: 0,
    x: 0,
    y: 0,
    width: width,
    height: height,
    windowWidth: width,
    windowHeight: height,
    onclone: (clonedDoc, clonedEl) => {
      isolateClonedElement(clonedDoc, clonedEl, width)
    }
  })
  const pdf = new jsPDF({ orientation, unit: 'px', format })
  addCanvasPaginated(pdf, canvas, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight())
  pdf.save(filename)
}

export async function exportMultiSectionPdf(elements, filename, { format = 'a4', orientation = 'portrait' } = {}) {
  const pdf = new jsPDF({ orientation, unit: 'px', format })
  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = pdf.internal.pageSize.getHeight()

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    if (!el) continue
    const width = el.scrollWidth || el.offsetWidth || 1200
    const height = el.scrollHeight || el.offsetHeight || 1000
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: true,
      logging: false,
      imageTimeout: 15000,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0,
      width: width,
      height: height,
      windowWidth: width,
      windowHeight: height,
      onclone: (clonedDoc, clonedEl) => {
        isolateClonedElement(clonedDoc, clonedEl, width)
      }
    })
    if (i > 0) pdf.addPage()
    addCanvasPaginated(pdf, canvas, pdfWidth, pdfHeight)
  }

  pdf.save(filename)
}
