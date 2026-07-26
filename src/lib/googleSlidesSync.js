// Google Slides Integration for MID 2030 LCA Assembly Builder
// Auto-assigns LCA results to slides matching assembly numbers or titles.

import { classifyAssemblySustainability } from './sustainabilityRubric.js'

export const DEFAULT_SLIDES_URL =
  'https://docs.google.com/presentation/d/1U5Vbp1SDXvJSBcgOqkJMqALGR0VUxmN02ksH5SudWNw/edit?usp=sharing'
export const DEFAULT_SLIDES_ID = '1U5Vbp1SDXvJSBcgOqkJMqALGR0VUxmN02ksH5SudWNw'

const ASSEMBLY_ORDER_KEYS = ['wall', 'floor', 'roof', 'skylight', 'window', 'door']

export function extractPresentationId(input) {
  if (!input || typeof input !== 'string') return DEFAULT_SLIDES_ID
  const str = input.trim()
  const match = str.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/)
  if (match && match[1]) {
    return match[1]
  }
  return str
}

export async function getGooglePresentationMetadata(presentationId, accessToken) {
  const cleanId = extractPresentationId(presentationId)
  const res = await fetch(`https://slides.googleapis.com/v1/presentations/${cleanId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    const msg = errorData.error?.message || `HTTP ${res.status}: ${res.statusText}`
    throw new Error(`Google Slides Error: ${msg}`)
  }

  return await res.json()
}

function fmt(n, digits = 2) {
  return n != null ? Number(n).toFixed(digits) : '—'
}

/**
 * Formats LCA result summary text for a given assembly summary.
 */
export function formatAssemblyLcaForSlide(summary, assemblyNum) {
  if (!summary || !summary.hasData) {
    return `ASSEMBLY ${assemblyNum}: ${summary?.label?.toUpperCase() || 'ELEMENT'}\nStatus: Pending configuration\nNo layer or thermal metrics entered yet.`
  }

  const lines = []
  lines.push(`ASSEMBLY ${assemblyNum}: ${summary.label.toUpperCase()}`)
  lines.push(`Assigned Owner: ${summary.owner || 'Group 02 Lead'}`)
  lines.push(`--------------------------------------------------`)
  lines.push(`• Thermal Transmittance (U-value): ${summary.uValue != null ? fmt(summary.uValue, 3) + ' W/m²K' : 'N/A'}`)
  lines.push(`• Embodied Carbon (A1–A3 GWP): ${summary.a1a3KnownCount > 0 ? fmt(summary.a1a3Total, 1) + ' kg CO₂e' : 'N/A'}`)
  lines.push(`• Logistics Freight (A4 GWP): ${summary.a4KnownCount > 0 ? fmt(summary.a4Total, 1) + ' kg CO₂e' : 'N/A'}`)
  lines.push(`• Annual Normalized Footprint: ${summary.normalized != null ? fmt(summary.normalized, 2) + ' kg CO₂e/m²/yr' : 'N/A'}`)

  const { uValue: uTier, gwp: gwpTier } = classifyAssemblySustainability(summary.key, summary.uValue, summary.normalized)
  if (uTier) lines.push(`• Thermal Rating: ${uTier.label}`)
  if (gwpTier) lines.push(`• Carbon Rating: ${gwpTier.label}`)

  if (summary.layerResults && summary.layerResults.length > 0) {
    lines.push(`\nConstituent Material Layers (Exterior → Interior):`)
    summary.layerResults.forEach((l, idx) => {
      lines.push(
        `  ${idx + 1}. ${l.name} (${fmt(l.thicknessMM, 1)}mm | λ: ${fmt(l.thermalConductivityWmK, 3)} | GWP: ${fmt(l.a1a3, 1)} kg CO₂e)`
      )
    })
  }

  return lines.join('\n')
}

/**
 * Updates matching slides in the presentation with LCA results for each assembly.
 */
export async function syncLcaResultsToGoogleSlides(presentationId, summaries = [], accessToken) {
  const cleanId = extractPresentationId(presentationId)
  const presentation = await getGooglePresentationMetadata(cleanId, accessToken)

  const slides = presentation.slides || []
  if (slides.length === 0) {
    throw new Error('Presentation contains no slides.')
  }

  const byKey = Object.fromEntries(summaries.map((s) => [s.key, s]))
  const requests = []
  const updatedSlideInfo = []

  slides.forEach((slide, slideIdx) => {
    const slideObjectId = slide.objectId
    let slideTitleText = ''
    let bodyShapeId = null
    let bodyShapeTextLength = 0

    if (slide.pageElements) {
      for (const el of slide.pageElements) {
        if (el.shape) {
          const shapeText = el.shape.text?.textElements
            ?.map((t) => t.textRun?.content || '')
            .join('') || ''

          const isTitle =
            el.shape.placeholder?.type === 'TITLE' ||
            el.shape.placeholder?.type === 'CENTERED_TITLE' ||
            /assembly|lca/i.test(shapeText)

          if (isTitle && !slideTitleText) {
            slideTitleText = shapeText.trim()
          } else if (!bodyShapeId && el.shape.shapeType === 'TEXT_BOX') {
            bodyShapeId = el.objectId
            bodyShapeTextLength = shapeText.length
          } else if (el.shape.placeholder?.type === 'BODY' || el.shape.placeholder?.type === 'SUBTITLE') {
            bodyShapeId = el.objectId
            bodyShapeTextLength = shapeText.length
          }
        }
      }
    }

    let matchedAssemblyNum = null
    const titleMatch = slideTitleText.match(/assembly\s*(\d+)/i)
    if (titleMatch && titleMatch[1]) {
      matchedAssemblyNum = parseInt(titleMatch[1], 10)
    } else {
      if (slideIdx + 1 <= 6) {
        matchedAssemblyNum = slideIdx + 1
      }
    }

    if (!matchedAssemblyNum || matchedAssemblyNum < 1 || matchedAssemblyNum > 6) {
      return
    }

    const assemblyKey = ASSEMBLY_ORDER_KEYS[matchedAssemblyNum - 1]
    const summary = byKey[assemblyKey]
    const formattedText = formatAssemblyLcaForSlide(summary, matchedAssemblyNum)

    if (bodyShapeId) {
      if (bodyShapeTextLength > 0) {
        requests.push({
          deleteText: {
            objectId: bodyShapeId,
            textRange: { type: 'ALL' }
          }
        })
      }
      requests.push({
        insertText: {
          objectId: bodyShapeId,
          insertionIndex: 0,
          text: formattedText
        }
      })
    } else {
      const newShapeId = `lca_box_asm_${matchedAssemblyNum}_${slideIdx}`
      requests.push({
        createShape: {
          objectId: newShapeId,
          shapeType: 'TEXT_BOX',
          elementProperties: {
            pageObjectId: slideObjectId,
            size: {
              width: { magnitude: 550, unit: 'PT' },
              height: { magnitude: 280, unit: 'PT' }
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: 30,
              translateY: 110,
              unit: 'PT'
            }
          }
        }
      })
      requests.push({
        insertText: {
          objectId: newShapeId,
          insertionIndex: 0,
          text: formattedText
        }
      })
    }

    updatedSlideInfo.push({
      slideNum: slideIdx + 1,
      assemblyNum: matchedAssemblyNum,
      assemblyLabel: summary?.label || assemblyKey
    })
  })

  if (requests.length === 0) {
    throw new Error('No matching "Assembly X" slides found in the presentation.')
  }

  const res = await fetch(`https://slides.googleapis.com/v1/presentations/${cleanId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ requests })
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.error?.message || `Failed to update Google Slides (HTTP ${res.status})`)
  }

  return {
    success: true,
    presentationTitle: presentation.title,
    updatedSlides: updatedSlideInfo
  }
}
