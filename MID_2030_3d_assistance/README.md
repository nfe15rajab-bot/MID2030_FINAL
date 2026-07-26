# MID2030 Layer Assistant

A Rhino + Eto.Forms tool that reads the web app's material/assembly data
and turns it into organized, named 3D layers in the team's Rhino model —
so whoever finishes the Rhino model doesn't have to hand-copy layer
stacks from the app.

**Status: written but not yet run inside Rhino** — there's no Rhino
install in the environment this was built in, so treat the first run as
a test pass and report anything that errors. The logic follows documented
RhinoCommon/Eto APIs, but Rhino scripting has enough version-to-version
API drift that a small fix or two on first run wouldn't be surprising.

## Requirements

- Rhino 8, using the built-in **Script Editor** (CPython3 — this code
  uses f-strings and Rhino 8's Eto integration, not Rhino 6/7's
  IronPython2 editor).
- This folder must stay a **sibling of `database/`** inside the
  `MID2030_FINAL` repo checkout (i.e. exactly where it is now) — it reads
  `database/materials.json` / `database/defaultLayers.json` directly
  rather than bundling its own copy, so it never drifts from the app.

## Running it

Open Rhino 8 → `ScriptEditor` command → open
`mid2030_layer_assistant.py` from this folder → Run. Or use the
`RunPythonScript` command and point it at the same file.

## What it does (5 steps)

1. **Load data** — either import a session JSON exported from the app
   (`IdentityPanel` → "Export session" button), or click "Use current
   app defaults" to read `database/defaultLayers.json` as-is. If an
   imported session is missing a section, that one section quietly falls
   back to the app default too (rather than failing the whole import) —
   the log says which sections did that.
2. **Preview assemblies** — pick Wall/Roof/Floor/Skylight/Windows/Sliding
   Door from a list; see a schematic of its material stack (name,
   thickness, GWP confidence). Low-confidence materials are highlighted
   amber, matching the app's own "never silently apply a low-confidence
   value" rule.
3. **Pick 3D boundaries** — Floor, Wall, and Roof each need one boundary
   surface or polysurface picked in the viewport (a polysurface can cover
   several faces at once — e.g. all four walls joined as one object, or
   both roof slopes). Windows, Doors, and Skylights need their block
   instances picked instead.
   - **Skylight block-picking wasn't in the original spec** (which only
     mentioned windows and doors) — added here since Skylight is one of
     the 6 generated layers and is a block-based unit assembly in the app
     just like Window/Door. Skip it if that's not wanted.
   - Each boundary also has an *optional* "pick reference OSB" button:
     point at an OSB board your teammate already modeled, and the
     generated OSB layer will center on it, with the rest of the stack
     built out before/after in the app's own order — instead of every
     layer starting flush with the boundary surface.
4. **Generate Layers** — creates all 6 top-level layers (`1 - Wall`
   through `6 - Sliding Door`) with one named sublayer per material,
   **every time**, regardless of what's been picked. Actual 3D
   solids/blocks only get placed into the sections that had a boundary
   or blocks picked — everything else is just an empty, correctly-named,
   correctly-ordered sublayer, ready for someone to model into by hand.
   That's the main value if nothing else works: the layer tree itself.
5. **Boolean difference** — separate and optional, meant to run *after*
   step 4, once there's real structural/framing geometry to cut against.
   Pick the layer solids to trim and the existing geometry to subtract,
   then run it. Nothing is ever subtracted automatically.

## Scope decisions worth knowing about

- **Wall/Roof/Floor** get real extruded solid geometry per material layer
  (true thickness, correct stacking order — index 0 = interior for
  Wall/Floor, index 0 = sky/outermost for Roof, per the app's own
  `SectionPreview.jsx` convention).
- **Window/Door/Skylight** don't get generated geometry for their
  membrane layers (e.g. glazing) — the picked block *is* the "unit"
  layer's geometry (just reparented onto the right sublayer), and
  membrane sublayers are created empty. Auto-fitting glazing/tape
  geometry to an arbitrary block was more complexity than "get the
  layers organized" called for; those sublayers are there to model into
  by hand.
- **OSB alignment is a centroid match, not a guaranteed contact fit** —
  it centers the generated OSB layer on the reference object's
  bounding-box center. Good enough to land the whole stack in the right
  place and order; nudge with Move/Gumball afterward for exact face
  contact.
- **Wall and Roof each have 3 materials named "...OSB..." in the current
  default data** (checked against `database/defaultLayers.json` directly
  — Wall: layers #3/#5/#7, Roof: #3/#7/#11; Floor only has 1). When a
  reference object is picked, the tool aligns to the *first* OSB match by
  default and logs a warning naming all the matches when there's more
  than one — it can't tell which physical OSB board you pointed at in
  Rhino. If your reference is actually the 2nd or 3rd OSB layer, the
  stack will be offset by however many layers sit between them; check the
  result and move it if so.
- **Re-running Generate for a section you've already built adds a second
  copy** of its solids — it doesn't detect or clear previous output.
  Undo (Ctrl+Z) or delete the old sublayer contents first if you're
  iterating on one section.
- Every generated object gets `MID2030_material` / `MID2030_thicknessMM`
  / `MID2030_gwpA1A3` / `MID2030_confidence` user-text attributes, so the
  material behind any solid is traceable later.

## Files

```
mid2030_layer_assistant.py   entry point — run this one
lib/data_model.py            parses session JSON / defaultLayers.json into plain objects
lib/session_io.py            file picker + load orchestration, finds the app's database/ folder
lib/geometry.py              Rhino-side picking, layer creation, solid generation, boolean diff
lib/ui.py                    the Eto.Forms wizard itself
```
