#!/usr/bin/env python3
"""
True-to-scale technical section generator for MID 2030.

Parametric mode only (see README for the DXF-override mode, not yet wired
in). Input is a JSON export of exactly what LayerBuilder/sectionStorage.js
already produces in the browser — see README.md for the exact shape.

Usage:
    python generate.py <input.json> <output_dir>

Produces <output_dir>/<section>.dxf and <output_dir>/<section>.pdf. The PDF
is rendered from the SAME DXF document (ezdxf drawing add-on -> SVG ->
PDF), not a separate hand-coded routine, so the two outputs can't drift
apart.

Scale handling: the diagram (stacked rectangles) is drawn in modelspace at
true real-world mm — 1 DXF unit = 1mm — so a Rhino import gives correct
real dimensions. The chosen "1:N" scale is applied explicitly at render
time (Settings(fit_page=False, scale=1/N)), not left to an auto-fit, so
the printed "Scale 1:N" annotation is always what actually got rendered.
The table/title-block text would shrink into illegibility under that same
1/N transform, so its coordinates and text heights are pre-multiplied by N
— it's drawn "big" in modelspace specifically so it comes out at normal
reading size once the whole page is scaled down by 1/N.
"""
from __future__ import annotations

import io
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import ezdxf
import ezdxf.bbox as bbox
from ezdxf import recover
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.svg import SVGBackend
from ezdxf.addons.drawing.layout import Page, Margins, Settings
from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy, ColorPolicy
from ezdxf.enums import TextEntityAlignment
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parents[2]
MATERIALS_JSON = REPO_ROOT / "database" / "materials.json"

# Standard scales to try, largest (most detailed / smallest denominator)
# first, per spec.
CANDIDATE_SCALES = [5, 10, 20, 25, 50]

# Page sizes in mm, landscape. Tried in order until the assembly fits.
PAGE_SIZES_MM = [
    ("A4", 297.0, 210.0),
    ("A3", 420.0, 297.0),
]
MARGIN_MM = 15.0

PANEL_HEIGHT_MM_DEFAULT = 150.0

# How much of each hatch/solid fill's own color is actually visible — 0.0
# opaque, 1.0 fully transparent (ezdxf's own convention, see
# colors.float2transparency). Low opacity so overlapping/adjacent fills
# still read as soft material tints rather than loud, poster-flat blocks
# of color, per spec.
HATCH_OPACITY = 0.72

# Fixed, scale-independent physical sizes (mm on paper) for the
# non-architectural part of the sheet (table + title block). Used to
# reserve page space in pick_scale() and to compute the pre-multiplier
# that keeps this text legible regardless of which drawing scale won.
LABEL_ALLOWANCE_MM = 20.0  # room above the panel for "L01" callouts

SURFACE_RESISTANCE = {
    "wall": (0.13, 0.04),
    "roof": (0.10, 0.04),
    "floor": (0.17, 0.04),
}

# discipline -> hatch treatment. Every real discipline in
# database/materials.json gets its own pattern now (previously only
# Insulation/Structure/Sheathing/Membrane did — Cladding/Roofing/Finishing/
# Fixed Unit silently fell through to a flat solid fill). Scale values are
# tuned for this drawing's actual real-world mm (a handful to a few
# hundred mm per layer) — the original scale=20 was sized for a much
# larger drawing and produced at most one hatch line per layer, which
# combined with the solid-black render bug (see render_pdf) made every
# hatch invisible. Anything still unlisted (Fixed Unit, "Unclassified")
# gets DEFAULT_HATCH's plain low-opacity solid fill.
HATCH_BY_DISCIPLINE = {
    "Insulation": {"pattern": "ANSI31", "scale": 0.4, "solid": False},   # fine diagonal — batt/blown fill
    "Structure": {"pattern": "ANSI37", "scale": 0.6, "solid": False},    # crosshatch — timber convention
    "Sheathing": {"pattern": "ANSI32", "scale": 0.5, "solid": False},    # wider diagonal — board product
    "Cladding": {"pattern": "ANSI34", "scale": 0.5, "solid": False},     # steep diagonal — facade panel
    "Roofing": {"pattern": "ANSI35", "scale": 0.5, "solid": False},      # opposite steep diagonal
    "Finishing": {"pattern": "SOLID", "scale": 1, "solid": True},        # thin interior finish — flat tint
    "Membrane": {"pattern": None, "scale": 1, "solid": False},           # dashed boundary only, no fill
}
DEFAULT_HATCH = {"pattern": "SOLID", "scale": 1, "solid": True}

COLOR_BY_DISCIPLINE = {
    "Insulation": 3,     # green
    "Structure": 30,     # brown/orange
    "Sheathing": 30,
    "Membrane": 5,        # blue
    "Roofing": 8,         # gray
    "Cladding": 1,        # red
    "Finishing": 9,
    "Fixed Unit": 8,
}
DEFAULT_COLOR = 8

_ASCII_SAFE = {
    "—": "-", "–": "-", "‑": "-",
    "λ": "lambda", "λ ": "lambda ",
    "²": "^2", "³": "^3",
    "Ö": "Oe", "ö": "oe", "ä": "ae", "Ä": "Ae", "ü": "ue", "Ü": "Ue",
    "⚠": "WARNING:",
    "×": "x",
}


def ascii_safe(text: str) -> str:
    """SVG->reportlab font fallback renders unmapped glyphs as tofu boxes
    for several common non-ASCII characters we'd otherwise use (em-dash,
    lambda, degree/superscript signs). Swap in plain-ASCII equivalents so
    the PDF is reliably legible rather than gambling on font coverage."""
    for bad, good in _ASCII_SAFE.items():
        text = text.replace(bad, good)
    return text


@dataclass
class Layer:
    index: int
    name: str
    material_id: str | None
    thickness_mm: float | None
    lambda_wmk: float | None
    gwp: float | None
    discipline: str


def load_materials_catalog() -> dict:
    with open(MATERIALS_JSON, encoding="utf-8") as f:
        materials = json.load(f)
    return {m["id"]: m for m in materials}


def load_input(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def sanitize_dxf_layer_name(text: str) -> str:
    text = ascii_safe(text).upper()
    text = re.sub(r"[^A-Z0-9]+", "-", text).strip("-")
    return text[:60] or "MATERIAL"


def build_layers(raw_layers: list[dict], catalog: dict) -> list[Layer]:
    layers = []
    for i, raw in enumerate(raw_layers):
        material = catalog.get(raw.get("materialId")) if raw.get("materialId") else None
        discipline = (material or {}).get("discipline") or "Unclassified"
        layers.append(
            Layer(
                index=i + 1,
                name=ascii_safe(raw["name"]),
                material_id=raw.get("materialId"),
                thickness_mm=raw.get("thicknessMM"),
                lambda_wmk=raw.get("thermalConductivityWmK"),
                gwp=raw.get("gwpA1A3PerFunctionalUnit"),
                discipline=discipline,
            )
        )
    return layers


def calculate_uvalue(layers: list[Layer], element_type: str) -> dict:
    rsi, rse = SURFACE_RESISTANCE.get(element_type, SURFACE_RESISTANCE["wall"])
    missing = False
    r_total = rsi + rse
    for l in layers:
        if not l.thickness_mm or not l.lambda_wmk:
            missing = True
            continue
        r_total += (l.thickness_mm / 1000.0) / l.lambda_wmk
    if missing or not layers:
        return {"r_total": None, "u_value": None, "missing_data": True}
    return {"r_total": r_total, "u_value": 1.0 / r_total, "missing_data": False}


def content_extents_mm(doc: ezdxf.document.Drawing) -> tuple[float, float]:
    """Measures the ACTUAL rendered bounding box of everything drawn so
    far, rather than guessing how much space the table/title block need
    — hatch patterns, dimension entities, and text all have geometry
    ezdxf can measure directly, so there's no reason to hand-estimate."""
    box = bbox.extents(doc.modelspace(), fast=True)
    if not box.has_data:
        return 0.0, 0.0
    return box.extmax.x - box.extmin.x, box.extmax.y - box.extmin.y


def build_dxf(
    section: str,
    owner: str,
    saved_at: str | None,
    layers: list[Layer],
    uvalue: dict,
    scale: int,
    panel_height_mm: float,
    pitch_deg: float | None = None,
) -> ezdxf.document.Drawing:
    doc = ezdxf.new("R2018", setup=True)
    doc.units = ezdxf.units.MM
    # ezdxf's default "Standard" text style resolves to the classic AutoCAD
    # txt.shx shape font, whose bundled glyph tracer has a winding-order
    # bug for compound (hole-containing) letters — "O", "o", "0" etc. all
    # render as solid boxes instead of rings once it goes through SVG. A
    # real TrueType font traces correctly.
    doc.styles.get("Standard").dxf.font = "arial.ttf"
    msp = doc.modelspace()

    doc.layers.add("TITLEBLOCK", color=7)
    doc.layers.add("TABLE", color=7)
    doc.layers.add("DIMENSIONS", color=7)

    drawable = [l for l in layers if l.thickness_mm]
    flagged = [l for l in layers if not l.thickness_mm]
    total_thickness = sum(l.thickness_mm for l in drawable)

    # ------------------------------------------------------------------
    # Diagram: true real-world mm, built into its own block rather than
    # straight into modelspace. Roof gets rotated to its real pitch angle
    # (matching the client-side parametric preview, SectionPreview.jsx) —
    # a block insert is the clean way to rotate a whole group of
    # polylines/hatches/text as one rigid unit without hand-transforming
    # every point. Wall/Floor just insert at rotation=0, i.e. behave
    # exactly as before. The panel is drawn centered on the block's own
    # local origin (not a corner) so the rotation pivots around the
    # panel's center — same convention as the web preview's
    # `transform-origin: center center`, and it's inserted at
    # (total_thickness/2, panel_height/2) so its UNROTATED footprint still
    # lands at the same x:0..total_thickness, y:0..panel_height region the
    # scale bar/table below assume, unchanged from before.
    # ------------------------------------------------------------------
    panel_block = doc.blocks.new(f"{section.upper()}_PANEL")
    half_w = total_thickness / 2
    half_h = panel_height_mm / 2
    x = -half_w
    for l in drawable:
        dxf_layer_name = f"{section.upper()}_L{l.index:02d}_{sanitize_dxf_layer_name(l.name)}"
        color = COLOR_BY_DISCIPLINE.get(l.discipline, DEFAULT_COLOR)
        doc.layers.add(dxf_layer_name, color=color)

        pts = [(x, -half_h), (x + l.thickness_mm, -half_h), (x + l.thickness_mm, half_h), (x, half_h)]
        panel_block.add_lwpolyline(pts, close=True, dxfattribs={"layer": dxf_layer_name})

        hatch_spec = HATCH_BY_DISCIPLINE.get(l.discipline, DEFAULT_HATCH)
        if l.discipline == "Membrane":
            doc.layers.add(f"{dxf_layer_name}_OUTLINE", color=color, linetype="DASHED")
            panel_block.add_lwpolyline(pts, close=True, dxfattribs={"layer": f"{dxf_layer_name}_OUTLINE"})
        else:
            hatch = panel_block.add_hatch(dxfattribs={"layer": dxf_layer_name})
            # set_pattern_fill's own `color` kwarg defaults to ACI 7
            # (white) and OVERWRITES whatever add_hatch(color=...) set —
            # previously not passed here at all, which combined with the
            # ColorPolicy.BLACK bug above meant no discipline color (or
            # pattern-hatch color) ever actually reached the page.
            if hatch_spec["solid"]:
                hatch.set_solid_fill(color=color)
            else:
                hatch.set_pattern_fill(hatch_spec["pattern"], scale=hatch_spec["scale"], color=color)
            hatch.dxf.transparency = ezdxf.colors.float2transparency(HATCH_OPACITY)
            hatch.paths.add_polyline_path(pts, is_closed=True)

        # Short numeric callout ("L03") just above the layer, not rotated
        # — full material names live in the table below instead. Keeps
        # the diagram's real bounding box small and predictable, which is
        # what pick_scale() assumes.
        label_layer = f"{dxf_layer_name}_LABEL"
        doc.layers.add(label_layer, color=7)
        callout_height = min(6.0, max(2.5, l.thickness_mm * 0.5))
        panel_block.add_text(
            f"L{l.index:02d}",
            height=callout_height,
            dxfattribs={"layer": label_layer},
        ).set_placement(
            (x + l.thickness_mm / 2, half_h + 2),
            align=TextEntityAlignment.BOTTOM_CENTER,
        )

        x += l.thickness_mm

    # Only Roof actually rotates — Wall/Floor sections have no pitch
    # concept, so a missing/zero pitch_deg (or a non-roof section) just
    # inserts flat, identical to the pre-rotation behavior.
    rotation = pitch_deg if (section.lower() == "roof" and pitch_deg) else 0.0
    msp.add_blockref(
        panel_block.name,
        insert=(half_w, half_h),
        dxfattribs={"layer": "0", "rotation": rotation},
    )

    # Scale bar: a real DIMENSION entity over a 100mm (or shorter, if the
    # assembly itself is thinner) reference run, still true real-world mm.
    if total_thickness > 0:
        bar_len = min(100.0, total_thickness) if total_thickness < 100 else 100.0
        dim = msp.add_linear_dim(
            base=(0, -20),
            p1=(0, 0),
            p2=(bar_len, 0),
            dxfattribs={"layer": "DIMENSIONS"},
        )
        dim.render()

    # ------------------------------------------------------------------
    # Table + title block: fixed physical size on paper. Everything here
    # is pre-multiplied by `scale` so that after the page-wide 1/scale
    # render transform, it lands back at its intended real reading size
    # (see module docstring).
    # ------------------------------------------------------------------
    def pt(x_mm: float, y_mm: float) -> tuple[float, float]:
        return x_mm * scale, y_mm * scale

    def th(mm: float) -> float:
        return mm * scale

    table_top_mm = -(LABEL_ALLOWANCE_MM + 15)
    row_h = 9.0
    col_x = [0, 14, 150, 205, 245, 285]
    headers = ["#", "Material", "Thickness (mm)", "lambda (W/mK)", "GWP A1-A3"]
    for ci, h in enumerate(headers):
        msp.add_text(h, height=th(3.2), dxfattribs={"layer": "TABLE"}).set_placement(
            pt(col_x[ci], table_top_mm), align=TextEntityAlignment.BOTTOM_LEFT
        )
    y = table_top_mm - row_h
    for l in layers:
        display_name = l.name if len(l.name) <= 46 else l.name[:43] + "..."
        row = [
            str(l.index),
            display_name,
            f"{l.thickness_mm:g}" if l.thickness_mm else "unknown",
            f"{l.lambda_wmk:g}" if l.lambda_wmk else "-",
            f"{l.gwp:g}" if l.gwp is not None else "-",
        ]
        for ci, val in enumerate(row):
            msp.add_text(val, height=th(3.0), dxfattribs={"layer": "TABLE"}).set_placement(
                pt(col_x[ci], y), align=TextEntityAlignment.BOTTOM_LEFT
            )
        y -= row_h
    table_bottom_mm = y
    msp.add_lwpolyline(
        [
            pt(0, table_top_mm + row_h),
            pt(col_x[-1] + 45, table_top_mm + row_h),
            pt(col_x[-1] + 45, table_bottom_mm),
            pt(0, table_bottom_mm),
        ],
        close=True,
        dxfattribs={"layer": "TABLE"},
    )

    if flagged:
        y -= row_h * 0.6
        names = ", ".join(l.name for l in flagged)
        msp.add_text(
            f"NOTE: {len(flagged)} layer(s) excluded from diagram - thickness not yet specified: {names}",
            height=th(2.8),
            dxfattribs={"layer": "TABLE", "color": 1},
        ).set_placement(pt(0, y - row_h), align=TextEntityAlignment.BOTTOM_LEFT)
        y -= row_h

    y -= row_h
    if uvalue["missing_data"]:
        summary = "U-value: not available (add layers with thickness + lambda to calculate)"
    else:
        summary = f"R_total = {uvalue['r_total']:.3f} m2K/W   U-value = {uvalue['u_value']:.3f} W/m2K"
    gwp_known = [l for l in layers if l.gwp is not None]
    gwp_total = sum(l.gwp for l in gwp_known)
    gwp_line = (
        f"GWP A1-A3 sum: {gwp_total:.1f} kg CO2e ({len(gwp_known)}/{len(layers)} layers have data)"
        if gwp_known
        else "GWP A1-A3 sum: not available"
    )
    scale_line = f"Scale 1:{scale}"
    msp.add_text(scale_line, height=th(3.5), dxfattribs={"layer": "DIMENSIONS"}).set_placement(
        pt(0, y), align=TextEntityAlignment.BOTTOM_LEFT
    )
    y -= row_h
    msp.add_text(summary, height=th(3.2), dxfattribs={"layer": "TABLE"}).set_placement(
        pt(0, y), align=TextEntityAlignment.BOTTOM_LEFT
    )
    msp.add_text(gwp_line, height=th(3.2), dxfattribs={"layer": "TABLE"}).set_placement(
        pt(0, y - row_h), align=TextEntityAlignment.BOTTOM_LEFT
    )

    tb_y = y - row_h * 3
    fields = [
        ("Project", "MID 2030 - Model 1"),
        ("Section", section),
        ("Drawn by", ascii_safe(owner) or "Unassigned"),
        ("Saved", (saved_at or "-")[:10]),  # YYYY-MM-DD — full ISO timestamp overflows the field
        ("Sheet", "1 of 1"),
    ]
    for i, (label, value) in enumerate(fields):
        fx = i * 55
        msp.add_text(label.upper(), height=th(2.2), dxfattribs={"layer": "TITLEBLOCK", "color": 8}).set_placement(
            pt(fx, tb_y), align=TextEntityAlignment.BOTTOM_LEFT
        )
        msp.add_text(value, height=th(3.5), dxfattribs={"layer": "TITLEBLOCK"}).set_placement(
            pt(fx, tb_y - 5), align=TextEntityAlignment.BOTTOM_LEFT
        )

    return doc


def validate_roundtrip(dxf_path: Path) -> list[str]:
    """Re-opens the written DXF via ezdxf.recover + runs an audit, the
    same tolerant path Rhino-adjacent tools use. Returns a list of
    problem descriptions (empty = clean)."""
    doc, auditor = recover.readfile(str(dxf_path))
    auditor.run()
    return [str(err) for err in auditor.errors]


def render_pdf(doc: ezdxf.document.Drawing, out_pdf: Path, page_w_mm: float, page_h_mm: float, scale: int) -> None:
    msp = doc.modelspace()
    # COLOR (not BLACK) — this used to force every entity to render black
    # regardless of its actual DXF color, which combined with the
    # set_pattern_fill color bug below made every hatch and discipline
    # color invisible no matter what COLOR_BY_DISCIPLINE said.
    config = Configuration(background_policy=BackgroundPolicy.WHITE, color_policy=ColorPolicy.COLOR)
    context = RenderContext(doc)
    backend = SVGBackend()
    frontend = Frontend(context, backend, config=config)
    frontend.draw_layout(msp)

    page = Page(width=page_w_mm, height=page_h_mm, margins=Margins.all(MARGIN_MM))
    # Explicit scale, not auto-fit — 1 paper mm = `scale` model mm — so the
    # printed "Scale 1:N" annotation always matches what actually renders.
    settings = Settings(fit_page=False, scale=1.0 / scale, crop_at_margins=False)
    svg_string = backend.get_string(page, settings=settings)

    svg_bytes = io.BytesIO(svg_string.encode("utf-8"))
    drawing = svg2rlg(svg_bytes)
    renderPDF.drawToFile(drawing, str(out_pdf))


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("Usage: python generate.py <input.json> <output_dir>", file=sys.stderr)
        return 2

    input_path = Path(argv[1])
    output_dir = Path(argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)

    data = load_input(input_path)
    section = data["section"]
    element_type = section.lower()
    owner = data.get("owner", "")
    saved_at = data.get("savedAt")
    # Roof-only (see LayerBuilder.jsx's roof-pitch input / sectionStorage.js)
    # — absent for Wall/Floor, and build_dxf() only actually rotates when
    # section is "Roof" anyway, so a stray value on a non-roof export is
    # harmless.
    pitch_deg = data.get("pitchDeg")

    catalog = load_materials_catalog()
    layers = build_layers(data["layers"], catalog)

    flagged = [l for l in layers if not l.thickness_mm]
    if flagged:
        print(f"[WARN] {section}: {len(flagged)} layer(s) missing thickness - excluded from the "
              f"scaled diagram, kept in the data table:")
        for l in flagged:
            print(f"        - L{l.index:02d} {l.name} (materialId={l.material_id})")

    lambda_missing = [l for l in layers if l.thickness_mm and not l.lambda_wmk]
    if lambda_missing:
        print(f"[WARN] {section}: {len(lambda_missing)} layer(s) have thickness but missing lambda "
              f"(fine for the diagram, but U-value can't be calculated):")
        for l in lambda_missing:
            print(f"        - L{l.index:02d} {l.name}")

    uvalue = calculate_uvalue(layers, element_type)

    # Try each (page, scale) combo, most detailed first, and MEASURE the
    # actual rendered bounding box rather than guessing whether the table/
    # title block fit — hand-estimated space reservations were exactly
    # the bug in the first pass of this tool.
    doc = None
    scale = page_name = page_w = page_h = None
    fits = False
    for candidate_page_name, candidate_page_w, candidate_page_h in PAGE_SIZES_MM:
        usable_w = candidate_page_w - 2 * MARGIN_MM
        usable_h = candidate_page_h - 2 * MARGIN_MM
        for candidate_scale in CANDIDATE_SCALES:
            candidate_doc = build_dxf(
                section, owner, saved_at, layers, uvalue, candidate_scale, PANEL_HEIGHT_MM_DEFAULT, pitch_deg
            )
            content_w, content_h = content_extents_mm(candidate_doc)
            if content_w / candidate_scale <= usable_w and content_h / candidate_scale <= usable_h:
                doc, scale, page_name, page_w, page_h = (
                    candidate_doc, candidate_scale, candidate_page_name, candidate_page_w, candidate_page_h
                )
                fits = True
                break
            # keep the last-tried candidate as a fallback in case nothing fits
            doc, scale, page_name, page_w, page_h = (
                candidate_doc, candidate_scale, candidate_page_name, candidate_page_w, candidate_page_h
            )
        if fits:
            break

    if not fits:
        print(f"[WARN] {section}: assembly doesn't fit any standard scale/page combo even at "
              f"1:{CANDIDATE_SCALES[-1]} on {PAGE_SIZES_MM[-1][0]} — using it anyway, sheet will overflow margins.")
    print(f"[INFO] {section}: scale 1:{scale} on {page_name}")
    if element_type == "roof":
        print(f"[INFO] {section}: pitch {pitch_deg if pitch_deg else 0}°"
              + ("" if pitch_deg else " (no pitchDeg supplied — drawn flat)"))

    dxf_path = output_dir / f"{section.lower()}.dxf"
    doc.saveas(dxf_path)
    print(f"[OK] wrote {dxf_path}")

    problems = validate_roundtrip(dxf_path)
    if problems:
        print(f"[FAIL] round-trip validation found {len(problems)} issue(s):")
        for p in problems:
            print(f"        - {p}")
    else:
        print("[OK] round-trip validation clean (ezdxf.recover + audit)")

    pdf_path = output_dir / f"{section.lower()}.pdf"
    render_pdf(doc, pdf_path, page_w, page_h, scale)
    print(f"[OK] wrote {pdf_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
