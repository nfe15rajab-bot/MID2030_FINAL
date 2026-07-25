# MID 2030 — LCA Automation App

Internal tool for Group 02 (Model 1, Batavierenplantsoen, Haarlem) to speed up
Task 4.1–4.5: material/layer definition, U-value calculation, Ökobaudat
lookups, transport distance (A4), and technical sheet ("fiche technique") PDF
generation.

## Structure

```
mid2030-lca-app/
├── index.html            # Vite entry point
├── src/
│   ├── main.jsx
│   ├── App.jsx            # top-level layout: layer builder + U-value panel
│   ├── components/
│   │   └── LayerBuilder.jsx   # drag-reorder layer stack (working)
│   └── lib/
│       └── uvalue.js       # U-value calculation logic (working)
├── database/
│   ├── schema.md           # material record shape
│   └── materials.json      # seed data — REPLACE with your group2 Excel data
├── server/                 # NOT built yet — next steps below
│   ├── okobaudat-proxy.js  # stub: CORS proxy + query helper for Ökobaudat API
│   └── pdf-generator.js    # stub: fills the technical sheet template
└── output/                 # generated PDFs land here (gitignored)
```

## What's working right now

- **Layer builder** (`src/components/LayerBuilder.jsx`): add a material layer,
  set thickness, drag to reorder, remove. Reads λ (thermal conductivity) and
  density from `database/materials.json`.
- **U-value calc** (`src/lib/uvalue.js`): live U-value from the layer stack
  using R = d/λ per layer, plus configurable Rsi/Rse per DIN EN ISO 6946.

## What's also working right now

- **3D model viewer** (`src/components/ModelViewer.jsx`): Three.js, loads a
  `.glb` from `public/models/model_1.glb`, orthographic (axonometric) camera,
  orbit controls, auto-frames to the model's actual size, shows load
  progress. This is step 1 of Task 1 — just get the model rendering.
  Next steps (not built yet): clickable hotspots tied to named mesh groups
  (wall/roof/floor/door/window), which open the layer configurator for
  that section.

  **Your 400MB `model_1.obj` needs converting first** — see the top-level
  conversion instructions (obj2gltf + optional gltf-pipeline/Draco
  compression) and drop the result at `public/models/model_1.glb`.

- **Provider map** (`src/components/ProviderMap.jsx`): Leaflet + OpenStreetMap
  (free, no API key). Pick a material, see the site (Batavierenplantsoen,
  Haarlem), Detmold, and every registered provider for that material, with
  straight-line distance to both and the closest one to each highlighted.
  Provider data lives in `database/providers.json` — a couple of entries
  (Forbo, Metsä Wood) have real approximate coordinates already; the rest
  are placeholders to fill in.

## What's stubbed (next Claude Code session)

1. **Ökobaudat proxy** (`server/okobaudat-proxy.js`) — the Ökobaudat REST API
   (soda4LCA-based) doesn't send CORS headers for browser fetches, so this
   needs a small Node/Express (or serverless function) that:
   - queries `https://oekobaudat.de/OEKOBAU.DAT/resource/datastocks/.../processes`
   - filters by `compliance` UUID (EN 15804+A1 vs +A2)
   - returns GWP (A1-A3), density, declared unit → feeds into `materials.json`
     or directly into the layer builder's search box
2. **PDF generator** (`server/pdf-generator.js`) — fills the fixed technical
   sheet template (material, provider, distance, specs, GWP) using
   `@react-pdf/renderer` or a Python `reportlab` service, writes to `output/`.
3. **Geocoding for providers** — `database/providers.json` has `lat`/`lng`
   placeholders (`null`) for most entries. Use Nominatim (OSM's free
   geocoder — 1 request/sec max, requires a descriptive User-Agent header
   per their usage policy) to resolve real provider addresses to
   coordinates, one-time, and cache the result (`geocodedAt` field is there
   for this).
4. **Real road distance (optional upgrade)** — current distances in
   `src/lib/geo.js` are straight-line (haversine), matching the "geometric
   estimate" method already used in the Excel tab. Swap in a routing API
   (OSRM's public demo server, or OpenRouteService free tier) for actual
   road-km before final submission — same function signature, different
   distance source.
5. **Excel sync** (`server/excel-sync.js`) — two documented paths: near-real-
   time auto-write via `exceljs` (recommended starting point) or a true-live
   Office.js Add-in (bigger stretch goal, do only if Path A feels clunky).
   Full detail in that file.
6. **Wire the database** — swap `materials.json` / `providers.json` seed rows
   for the real group2/group2_v2 tab data (manufacturers, GWP benchmarks,
   distances, provider addresses).

## Getting started

```bash
npm install
npm run dev
```

AI-assisted material autofill (`server/material-autofill-server.js`) needs a
Gemini (Google AI Studio) API key: copy `server/.env.example` to
`server/.env` and fill in `GEMINI_API_KEY`. `server/.env` is gitignored —
never commit a real key. Without it, the rest of the app works fine; only
the "Suggest" buttons will error.

## Continuing in VS Code / Claude Code

Open this folder in VS Code with the Claude Code extension and pick up at
"What's stubbed" above — the proxy and PDF generator are the two pieces
that need a backend and are best done interactively there.
