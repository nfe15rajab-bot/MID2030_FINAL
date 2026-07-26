// Uploads a captured chart/diagram PNG to Google Drive and inserts it
// into a Google Doc as an inline image. Two separate API calls, not one
// -- insertInlineImage's `uri` field is fetched server-side by Google's
// own infrastructure, not from the browser, so a data: URL or a
// signed-out Drive file won't work; the image has to already be a
// publicly-reachable URL by the time the Docs request runs.
//
// Uses the drive.file OAuth scope already granted at sign-in (see
// googleAuth.js) -- that scope only lets this app create/manage files
// it uploads itself, never read or touch anything else already in the
// user's Drive.
import { getGoogleDocMetadata } from './googleDocsSync.js'

/**
 * Uploads a PNG (as a data: URL, e.g. from pngExport.js's
 * captureElementToPngDataUrl) to Drive and makes it link-viewable.
 * @returns {Promise<{fileId: string, url: string}>}
 */
export async function uploadImageToDrive(dataUrl, filename, accessToken) {
  const blob = await (await fetch(dataUrl)).blob()

  const metadata = { name: filename, mimeType: 'image/png' }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', blob)

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}))
    throw new Error(err.error?.message || `Drive upload failed (HTTP ${uploadRes.status})`)
  }
  const { id: fileId } = await uploadRes.json()

  // Without this, insertInlineImage's server-side fetch gets a 403 --
  // the file exists but only this app's own account could see it.
  const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
  if (!permRes.ok) {
    const err = await permRes.json().catch(() => ({}))
    throw new Error(err.error?.message || `Could not make the uploaded image link-viewable (HTTP ${permRes.status})`)
  }

  return { fileId, url: `https://drive.google.com/uc?export=view&id=${fileId}` }
}

/**
 * Appends one inline image at the current end of the document, on its
 * own line, sized proportionally to a fixed width. Re-reads the doc's
 * own end index right before inserting (rather than tracking how far a
 * separate text-insert batchUpdate shifted every later index) -- this
 * call is self-contained and safe to run after any other edit.
 */
export async function appendImageToDoc(docId, imageUrl, accessToken, { widthPt = 400, aspectRatio = 0.6 } = {}) {
  const doc = await getGoogleDocMetadata(docId, accessToken)
  let insertIndex = 1
  if (doc?.body?.content?.length) {
    const lastElement = doc.body.content[doc.body.content.length - 1]
    if (lastElement.endIndex && lastElement.endIndex > 1) insertIndex = lastElement.endIndex - 1
  }

  const requests = [
    { insertText: { location: { index: insertIndex }, text: '\n' } },
    {
      insertInlineImage: {
        location: { index: insertIndex + 1 },
        uri: imageUrl,
        objectSize: {
          width: { magnitude: widthPt, unit: 'PT' },
          height: { magnitude: Math.round(widthPt * aspectRatio), unit: 'PT' },
        },
      },
    },
  ]

  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Failed to insert image (HTTP ${res.status})`)
  }
}

/**
 * Uploads then appends in one step -- the shape most callers want.
 */
export async function appendChartImageToDoc(docId, dataUrl, filename, accessToken, sizeOptions) {
  const { url } = await uploadImageToDrive(dataUrl, filename, accessToken)
  await appendImageToDoc(docId, url, accessToken, sizeOptions)
}
