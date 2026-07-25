# MID 2030 — Model 1 Assembly Builder

Web tool supporting the MID 2030 (Theory and Sustainable Construction) final
project: LCA of a timber cabin at Batavierenplantsoen, Haarlem (Model 1,
Group 02). This app is a production aid for generating the graded
deliverables (section PDFs, material fiches, Excel push) faster and more
consistently across the team — it is not itself a deliverable.

## Team & ownership

Each person edits their own assembly; changes should stay visibly
attributed to them so the rest of the team can see what's been decided.

- Michael — door & window
- Nada — skylight / roof windows, and owns all transport (A4) + LCA calc logic
- Sukriti — wall
- Moamen — floor
- Alejandro — roof
- Hinal — (role TBD)

## Architecture

```
src/
  components/   ConfiguratorPanel, LayerBuilder (Wall/Roof/Floor layer
                stacks), UnitAssemblyBuilder (Door/Window/Skylight single
                units), ModelViewer, ProviderMap, MaterialSearchPanel
                (Ökobaudat search + λ picker)
  data/         componentSpecs.js, hotspots.js, lambdaProviders.{js,json}
  lib/          okobaudatClient.js (Ökobaudat REST API)
  hooks/        useMaterialSearch.js
  App.jsx, main.jsx, styles.css
public/models/  model_1.glb (Three.js viewer source)
server/         (backend, if/when transport & LCA calc move server-side)
```

**Data flow for a material layer:** user opens a hotspot on the 3D model →
`LayerBuilder` opens for that section → `MaterialSearchPanel` lets them
search Ökobaudat live or browse `lambdaProviders.json` → on select, the
material's GWP (A1–A3) and λ get written into the layer's state → that state
is what eventually feeds the U-value calc, the section PDF, and the Excel
push.

## Material & λ data — single source of truth

- `src/data/lambdaProviders.json` is generated from the `lambda_providers`
  sheet in the class LCA Excel file. **Never hand-edit the JSON and the
  spreadsheet separately — they will drift.** If λ values change, re-export
  from the sheet.
- Confidence levels (`high` / `medium` / `low`) reflect how the number was
  sourced: manufacturer datasheet or EN ISO 10456 standard value (high),
  matched to the closest product family (medium), or estimated/flagged for
  team follow-up (low). Surface this to the user — never silently apply a
  low-confidence value.
- `src/lib/okobaudatClient.js` talks to the public Ökobaudat REST API
  (soda4LCA, no auth needed). It discovers the current datastock version at
  runtime rather than hardcoding a UUID, since Ökobaudat releases a new
  edition roughly yearly.
- Ökobaudat name ↔ our material name matching is fuzzy (word overlap), not
  a guaranteed join. Always show the match and its source/confidence to the
  user rather than applying it silently.

## Known environment quirks

- If Ökobaudat fetches fail with a CORS error in `npm run dev`, apply the
  Vite proxy documented in the comment block at the bottom of
  `okobaudatClient.js`. A production deploy needs a small serverless proxy
  instead — there's no dev server to do the rewriting there.
- Always spot-check the first few parsed GWP numbers against the linked
  Ökobaudat page (`sourceUrl` on each result) before trusting them — the
  ILCD+EPD format varies slightly across dataset generations and the parser
  is best-effort.

## Excel template

The class-provided template (`LCA-Table-Project-Analysis`) has the professor's
format locked into its first three sheets — treat those as read-only
structure. Group work lives in `group2` (midterm) and `group2_v2` (current,
more complete transport/A4 assumptions). Any Excel-push feature must write
into `group2_v2`'s column layout exactly, not redesign it.

## Conventions

- Match existing patterns in a file before introducing a new one — e.g. new
  components should follow how `LayerBuilder.jsx` already manages state,
  not a parallel pattern.
- After any change touching data fetching or the 3D viewer, run `npm run
  dev` and check both the terminal and browser console before calling a
  task done.
- Skylight is back in scope (2026-07-24) — an earlier note here said it
  was dropped per the professor's feedback; that's been reversed. Door,
  Window, and Skylight are all real, editable, in-scope assemblies now,
  same as Wall/Roof/Floor — just single manufactured units
  (`UnitAssemblyBuilder.jsx`, specs + GWP + a short membranes list)
  instead of a layer stack (`LayerBuilder.jsx`). If you see stale "out of
  scope"/"dropped" copy referencing skylight anywhere, it's leftover from
  before this change — fix it rather than assuming it's still accurate.