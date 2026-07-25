// STUB — build this out in the next Claude Code session.
//
// Purpose: take a material record (see database/schema.md) and render it
// into the fixed "fiche technique" PDF template, saved to /output.
//
// Recommended approach: @react-pdf/renderer — lets you define the template
// as JSX (easy to match a fixed layout precisely) and render server-side
// or in a Node script, no InDesign scripting needed.
//
// TODO next session:
// 1. npm install @react-pdf/renderer
// 2. Design the template component: header/logo, material name, manufacturer,
//    provider location + distance (A4 chain), technical specs table
//    (thickness, density, λ, GWP A1-A3), EN norm, EPD source, notes
// 3. Add a function generateTechnicalSheet(materialRecord) -> writes
//    output/{material-id}.pdf
// 4. Wire this to the frontend: "Export technical sheet" button per layer

// import { renderToFile } from '@react-pdf/renderer'
// ...
