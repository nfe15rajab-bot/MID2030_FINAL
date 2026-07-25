// STUB — build this out in the next Claude Code session.
//
// Goal: whenever a layer (thickness, order, material, provider) changes in
// the app, push that change into the class-provided Excel LCA template
// automatically, instead of manual copy-paste.
//
// ---------------------------------------------------------------------
// PATH A — near-real-time auto-write (recommended starting point)
// ---------------------------------------------------------------------
// The backend keeps the canonical layer state and writes it to the .xlsx
// file on disk every time it changes (debounced ~1s), using `exceljs`.
// Excel doesn't watch the file for changes on its own, so on the Excel
// side you either:
//   (a) reopen the file after edits (simplest), or
//   (b) set up a Power Query "From File" / "From Folder" query pointed at
//       this file, then hit Data > Refresh (or enable "Refresh every N
//       minutes" under Query Properties) — gets you close to live without
//       fighting Excel's file-locking.
//
// Rough shape:
//
//   import ExcelJS from 'exceljs'
//
//   async function syncLayersToExcel(assemblyId, layers, templatePath) {
//     const workbook = new ExcelJS.Workbook()
//     await workbook.xlsx.readFile(templatePath)
//     const sheet = workbook.getWorksheet(assemblyId) // e.g. 'assembly_3'
//     layers.forEach((layer, i) => {
//       const row = sheet.getRow(FIRST_DATA_ROW + i)
//       row.getCell('material_col').value = layer.name
//       row.getCell('provider_col').value = layer.manufacturer
//       row.getCell('thickness_col').value = layer.thicknessMM
//       row.commit()
//     })
//     await workbook.xlsx.writeFile(templatePath)
//   }
//
// Caveat: this WILL fail with an EBUSY-type error if the .xlsx file is
// currently open and locked in Excel on Windows. Two options: write to a
// copy and prompt "reload," or accept the Power Query pattern above so
// the source file isn't the one open in Excel.
//
// ---------------------------------------------------------------------
// PATH B — true live push into an open Excel window (stretch goal)
// ---------------------------------------------------------------------
// Requires an Office Add-in (task pane) using the Office.js Excel API,
// which can write directly into an open workbook's cells in real time —
// this is the only way to get genuinely live updates while someone is
// looking at the sheet. Needs:
//   - an add-in manifest (XML)
//   - a small hosted web app the task pane loads
//   - sideloading the add-in in Excel (or publishing via Office Store /
//     org catalog for teammates to install)
// This is a real side-project on its own — worth doing only if Path A
// turns out to be too clunky for how your group actually works.
//
// ---------------------------------------------------------------------
// TODO next session:
// 1. npm install exceljs (already in package.json)
// 2. Confirm exact column letters / row layout per assembly_* tab
//    (these are already known from prior work — see memory: assembly_1
//    through assembly_5, 28 material rows, columns A-P roughly covering
//    layer name / thickness / area / volume / weight / GWP / transport)
// 3. Implement syncLayersToExcel() above against a COPY of the real
//    template first, verify output, then point at the live file
// 4. Wire a debounced call to this from the frontend on every layer
//    change (thickness edit, reorder, add/remove, provider change)
