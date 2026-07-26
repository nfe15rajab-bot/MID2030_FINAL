import html2canvas from 'html2canvas'
import JSZip from 'jszip'
import { loadFicheDetail } from './ficheStorage.js'
import { findProvidersForMaterial } from './geo.js'
import providers from '../../database/providers.json'
import referenceLocations from '../../database/reference-locations.json'

/**
 * Converts a DOM element into a crisp PNG Data URL.
 * Sets fixed width and high scale to prevent text wrapping or overlapping.
 */
export async function captureElementToPngDataUrl(element, options = {}) {
  if (!element) throw new Error('No DOM element provided for PNG capture')

  const scale = options.scale || 2
  const backgroundColor = options.backgroundColor || '#ffffff'

  // Temporary container styling check to ensure no clipping
  const canvas = await html2canvas(element, {
    scale,
    backgroundColor,
    useCORS: true,
    allowTaint: true,
    logging: false,
    windowWidth: 1280,
    onclone: (clonedDoc, clonedEl) => {
      // Ensure text overflow and flex layout render comfortably without overset
      clonedEl.style.width = options.width || `${element.scrollWidth || 1000}px`
      clonedEl.style.maxWidth = 'none'
      clonedEl.style.overflow = 'visible'
      clonedEl.style.boxSizing = 'border-box'
      clonedEl.style.transform = 'none'
    }
  })

  return canvas.toDataURL('image/png')
}

/**
 * Downloads a captured DOM element directly as a PNG file.
 */
export async function downloadElementAsPng(element, filename = 'export.png', options = {}) {
  const dataUrl = await captureElementToPngDataUrl(element, options)
  const link = document.createElement('a')
  link.download = filename.endsWith('.png') ? filename : `${filename}.png`
  link.href = dataUrl
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  return dataUrl
}

/**
 * Copies a captured PNG element straight to the user's system clipboard as an image blob.
 */
export async function copyElementPngToClipboard(element, options = {}) {
  const dataUrl = await captureElementToPngDataUrl(element, options)
  const blob = await (await fetch(dataUrl)).blob()
  if (navigator.clipboard && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ])
    return true
  }
  throw new Error('Clipboard Image API not supported in this browser context.')
}

/**
 * Batch captures all Annex Fiche sheets and Charts into a single ZIP archive of high-res PNGs.
 */
export async function exportAllAnnexVisualsAsZip(ficheContainerRef, chartContainerRefs = [], zipFilename = 'MID2030_Annex_Fiches_and_Charts_PNG.zip') {
  const zip = new JSZip()
  const fichesFolder = zip.folder('Les_Fiches_Techniques')
  const chartsFolder = zip.folder('LCA_Graphics_and_Charts')

  // Capture Fiche elements if present
  if (ficheContainerRef && ficheContainerRef.current) {
    const ficheNodes = ficheContainerRef.current.querySelectorAll('.fiche-sheet, .a4-fiche-card, .fiche-panel')
    let count = 1
    for (const node of ficheNodes) {
      try {
        const dataUrl = await captureElementToPngDataUrl(node, { scale: 2 })
        const base64 = dataUrl.split(',')[1]
        const matName = node.querySelector('.fiche-product-name, h3')?.innerText || `fiche_${count}`
        const cleanName = matName.replace(/[^a-zA-Z0-9_-]+/g, '_')
        fichesFolder.file(`Fiche_${count}_${cleanName}.png`, base64, { base64: true })
        count++
      } catch (err) {
        console.warn('Failed capturing fiche node:', err)
      }
    }
  }

  // Capture Chart elements
  if (Array.isArray(chartContainerRefs)) {
    let count = 1
    for (const ref of chartContainerRefs) {
      const node = ref?.current || ref
      if (node && node instanceof HTMLElement) {
        try {
          const dataUrl = await captureElementToPngDataUrl(node, { scale: 2 })
          const base64 = dataUrl.split(',')[1]
          const title = node.querySelector('h4, .bar-chart-title, .section-title')?.innerText || `chart_${count}`
          const cleanTitle = title.replace(/[^a-zA-Z0-9_-]+/g, '_')
          chartsFolder.file(`Chart_${count}_${cleanTitle}.png`, base64, { base64: true })
          count++
        } catch (err) {
          console.warn('Failed capturing chart node:', err)
        }
      }
    }
  }

  const content = await zip.generateAsync({ type: 'blob' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(content)
  link.download = zipFilename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}
