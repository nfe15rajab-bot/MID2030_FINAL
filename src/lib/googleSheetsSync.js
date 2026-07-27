// Google Sheets push for the group2-template spreadsheet data — the LIVE
// equivalent of spreadsheetExcelExport.js's exportSpreadsheetExcel, just
// written straight into a real Google Sheet via the Sheets API instead of
// downloaded as an .xlsx. Same exact column layout (A-Y, verbatim class
// template headers), same formulas, same legend — this is the same data,
// a different delivery mechanism, not a second parallel spreadsheet
// design. See spreadsheetExcelExport.js's own header comment for why the
// column order/formulas are what they are.
import { TPL_HEADERS_GROUP2, buildGroup2Grid } from './group2GridBuilder.js'

const SHEET_TAB_NAME = 'group2'

export function extractSheetId(input) {
  if (!input || typeof input !== 'string') return ''
  const str = input.trim()
  const match = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (match && match[1]) return match[1]
  return str
}

async function sheetsApiFetch(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const msg = errBody.error?.message || `HTTP ${res.status}: ${res.statusText}`
    throw new Error(`Google Sheets error: ${msg}`)
  }
  return res.json()
}

/** Fetches spreadsheet title + sheet/tab names — used to verify access and to check whether the group2 tab already exists. */
export async function getGoogleSheetMetadata(spreadsheetId, accessToken) {
  const cleanId = extractSheetId(spreadsheetId)
  return sheetsApiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}?fields=spreadsheetId,properties.title,sheets.properties`, accessToken)
}

/** Creates a brand-new spreadsheet (for a team member with no existing sheet to target) and returns its id + edit URL. */
export async function createNewSpreadsheet(title, accessToken) {
  const body = { properties: { title }, sheets: [{ properties: { title: SHEET_TAB_NAME } }] }
  const res = await sheetsApiFetch('https://sheets.googleapis.com/v4/spreadsheets', accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return { spreadsheetId: res.spreadsheetId, url: res.spreadsheetUrl }
}

/** Adds the group2 tab to an existing spreadsheet that doesn't have one yet. */
async function addGroup2Sheet(spreadsheetId, accessToken) {
  await sheetsApiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_TAB_NAME } } }] }),
  })
}

function colLetter(n) {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * Pushes the full group2-template dataset (rows from getSpreadsheetRows(),
 * meta from getSpreadsheetMeta()) into the target spreadsheet's `group2`
 * tab — creating that tab first if it doesn't exist, clearing whatever
 * was there before (a prior, possibly smaller/stale push), then writing
 * the header + every data row + the legend in one batch. valueInputOption
 * USER_ENTERED so formula strings (K, G, N, P, X, Y) are parsed as real
 * live Sheets formulas, exactly like the xlsx export's ExcelJS formulas —
 * not pasted as literal text.
 */
export async function pushGroup2DataToGoogleSheet(spreadsheetId, rows, meta, accessToken) {
  const cleanId = extractSheetId(spreadsheetId)

  const metaRes = await getGoogleSheetMetadata(cleanId, accessToken)
  const hasGroup2Tab = (metaRes.sheets || []).some((s) => s.properties?.title === SHEET_TAB_NAME)
  if (!hasGroup2Tab) {
    await addGroup2Sheet(cleanId, accessToken)
  }

  const grid = buildGroup2Grid(rows, meta)
  const lastCol = colLetter(TPL_HEADERS_GROUP2.length)
  const lastRow = grid.length

  // Clear the tab's previous content first — a re-push after adding/
  // removing layers could otherwise leave stale rows/legend text past
  // the new grid's end (e.g. a previous 60-row push shrinking to 50 rows
  // this time would leave rows 51-60 from the old push behind).
  await sheetsApiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/'${SHEET_TAB_NAME}'!A1:Z2000:clear`,
    accessToken,
    { method: 'POST', body: JSON.stringify({}) }
  )

  await sheetsApiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/'${SHEET_TAB_NAME}'!A1:${lastCol}${lastRow}?valueInputOption=USER_ENTERED`,
    accessToken,
    { method: 'PUT', body: JSON.stringify({ values: grid }) }
  )

  return {
    spreadsheetTitle: metaRes.properties?.title,
    spreadsheetId: cleanId,
    url: `https://docs.google.com/spreadsheets/d/${cleanId}/edit`,
    rowsWritten: lastRow,
  }
}
