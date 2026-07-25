# Section generator (standalone, not yet wired into the app)

True-to-scale technical section diagrams (DXF + PDF) for a wall/roof/floor
assembly, driven by the same layer data `LayerBuilder` produces in the
browser. Python + `ezdxf`, run manually for now — see "Wiring into the app"
below for what's still needed to make this a button in the UI.

## Setup

```
pip install -r requirements.txt
```

Needs a real system font for text (`arial.ttf` by default — see "Known
issues" below for why). If that's not available on your machine, change
the font name in `build_dxf()`.

## Usage

```
python generate.py <input.json> <output_dir>
```

Writes `<output_dir>/<section>.dxf` and `<output_dir>/<section>.pdf`.

### Input JSON shape

Exactly what `sectionStorage.js` stores per section in the browser
(`localStorage['mid2030:section:{wall|roof|floor}']`), plus the section
name:

```jsonc
{
  "section": "Roof",              // "Wall" | "Roof" | "Floor"
  "owner": "Alejandro",
  "savedAt": "2026-07-11T08:29:46.245Z",
  "pitchDeg": 30,                 // Roof only — rotates the whole layer-stack panel
                                   // to this angle (see build_dxf's block-reference
                                   // rotation); ignored for Wall/Floor.
  "layers": [
    {
      "materialId": "roof-steico-flex-260",  // looked up in database/materials.json for discipline
      "name": "STEICOflex 036 — Wood Fibre Insulation Batt, 260mm (roof)",
      "thicknessMM": 260,
      "thermalConductivityWmK": 0.036,
      "gwpA1A3PerFunctionalUnit": null
    }
  ]
}
```

`test_wall.json` / `test_roof.json` are real exports from the app (not
placeholders) — `test_roof.json`'s layers came from actually building the
roof assembly in Section Configurator using the team's reference typical-
section drawing, then saving it.

### DXF override mode

Not implemented yet. Per the spec: if a Rhino-exported DXF is supplied for
a section, its cut-line geometry should become the base drawing instead of
the generated stack, with only the table/scale-bar/title-block overlaid.
Auto-detected from whether a DXF path is passed. Flagging this as a gap
rather than a silent no-op — nobody's supplied one yet, so it's untested.

## What it does

- Filters layers to those with a real `thicknessMM`; layers missing it are
  **excluded from the scaled diagram** (can't draw a real-world width for
  an unknown thickness) but stay in the data table, flagged both on stdout
  and in the sheet itself. Never silently defaults a missing value.
- Draws each drawable layer as a true-scale rectangle (width = real mm),
  on its own DXF layer (`{SECTION}_L{NN}_{MATERIAL-SLUG}`), hatched by
  discipline (`HATCH_BY_DISCIPLINE`/`COLOR_BY_DISCIPLINE` in generate.py):
  Insulation → fine diagonal (ANSI31), Structure → crosshatch (ANSI37),
  Sheathing → wide diagonal (ANSI32), Cladding → steep diagonal (ANSI34),
  Roofing → opposite steep diagonal (ANSI35), Membrane → dashed boundary
  only (no fill), Finishing/anything else → flat tint. All fills render at
  low opacity (`HATCH_OPACITY`, 72% transparent) so overlapping layers
  read as soft material tints, not poster-flat blocks — boundary outlines
  and table/title-block text stay fully opaque for legibility.
- Roof only: the whole layer-stack panel is built into its own block
  (centered on the block's own origin) and inserted with `rotation =
  pitchDeg`, so the diagram reflects the assembly's real pitch angle
  (manual input, same value `SectionPreview.jsx` renders live in the
  browser) instead of always drawing flat. Wall/Floor insert at
  rotation=0 — unaffected.
- Tries each standard scale (1:5 → 1:50) on A4 then A3, actually
  **measuring** the rendered bounding box (`ezdxf.bbox.extents`) rather
  than guessing whether the table/title block fit — picks the first
  (most detailed) combination that verifiably fits.
- Adds a real DXF `DIMENSION` entity as the scale bar (not a drawn line
  pretending to be one).
- Renders the PDF from the same DXF via `ezdxf.addons.drawing` → SVG →
  `svglib`/`reportlab`. No separate hand-coded PDF layout — table, title
  block, and diagram are all DXF entities, so the two files can't drift.
- Validates every DXF via `ezdxf.recover.readfile()` + `auditor.run()`
  before calling it done — the same tolerant/repairing read path
  Rhino-adjacent tooling uses. I don't have Rhino itself to test an actual
  import against, so this is the strongest check available; flag if that
  matters enough to verify with real Rhino.

## Known issues / decisions worth knowing about

- **Font**: `ezdxf`'s default "Standard" text style resolves to the classic
  AutoCAD `txt.shx` shape font. Its bundled glyph tracer has a winding-
  order bug for compound letters (`O`, `o`, `0`, ...) — they rendered as
  solid black boxes instead of rings once piped through SVG. Fixed by
  pointing the `Standard` style at `arial.ttf` instead
  (`doc.styles.get("Standard").dxf.font = "arial.ttf"`). If this ever runs
  somewhere without Arial available, swap in another real TTF.
- **Scale application**: the render explicitly sets
  `Settings(fit_page=False, scale=1/N)` rather than letting the renderer
  auto-fit content to the page. Auto-fit would silently compute its own
  scale to make things fit, which could differ from the "Scale 1:N" text
  printed on the sheet — a mislabeled scale defeats the point of a
  true-to-scale drawing. The table/title-block geometry is pre-multiplied
  by `N` so it comes out at normal reading size after the page-wide 1/N
  shrink (see the module docstring in `generate.py` for the full
  reasoning).
- Non-ASCII characters (em-dash, "λ") are replaced with plain-ASCII
  equivalents (`-`, `"lambda"`) in all DXF TEXT content — separate from
  the font bug above, just avoiding any further font-coverage gambles.

## Wired into the app

"Export true-to-scale DXF + PDF" in `LayerBuilder.jsx`, next to the
original "Export PDF (quick preview)" button (the `html2canvas` one —
kept as-is, it's a fast on-screen-preview export, not to-scale, useful
for a quick check without waiting on Python).

Pieces:
- `server/section-export-server.js` — a small Node HTTP server (no
  Express, just `node:http`) on port 3901. Receives the section JSON,
  writes it to a temp file, shells out to `python generate.py`, reads
  back the DXF/PDF, returns them as base64 in a JSON response, cleans up
  the temp dir. Started alongside Vite via `npm run dev`
  (`concurrently` — see `package.json`); `npm run dev:vite-only` skips it
  if you don't need the export button for a given session.
- `vite.config.js` — proxies `/api/section-export/*` to
  `localhost:3901`, so the browser never needs to know it's a separate
  process/port (same pattern as the existing `/okobaudat-api` proxy).
- `src/lib/sectionExportClient.js` — `fetch`s the endpoint, turns the
  base64 responses into Blobs, triggers the two downloads.

Known rough edge: `server-export-server.js` finds Python by trying a
hardcoded path first
(`C:\Users\Shadow\AppData\Local\Programs\Python\Python312\python.exe`)
before falling back to `python3`/`python` on PATH — because on this
machine, `python`/`python3` on PATH resolve to the Windows Store's stub
alias (fails with "Python was not found...") rather than the real
install, even though a real Python 3.12 is installed elsewhere. If this
runs on a different machine, update `PYTHON_CANDIDATES` in that file, or
just make sure a real `python`/`python3` resolves correctly on PATH.

Also found (and fixed) while wiring this up: `LayerBuilder.jsx`'s
`onOkobaudatSelect` had the exact same "silently default missing
thickness" bug that `addLayer` had before — any material added via live
Ökobaudat search got a fake `thicknessMM: 10` (Ökobaudat doesn't return
physical thickness, so there was nothing real to default to). Fixed the
same way: left `null`, flagged like everything else.
