"""Data model for the MID2030 layer assistant.

Parses either an exported session JSON (the web app's "Export session"
button, src/lib/sessionExport.js, schemaVersion 1) or the app's bundled
defaults (database/defaultLayers.json) into small Python objects the rest
of the tool works with. Both sources share the same per-layer field
shape, so one parser (MaterialLayer.from_raw) covers both.
"""

import json
import os

SECTION_KEYS = ["wall", "roof", "floor", "skylight", "window", "door"]

# Generated-layer numbering per the team's own naming ("door" is always
# shown as "Sliding Door", matching the app's own hotspot label for it).
SECTION_DISPLAY = {
    "wall": "1 - Wall",
    "roof": "2 - Roof",
    "floor": "3 - Floor",
    "skylight": "4 - Skylight",
    "window": "5 - Windows",
    "door": "6 - Sliding Door",
}

# wall/roof/floor come from LayerBuilder.jsx: an ordered material stack
# that becomes real 3D layer geometry. door/window/skylight come from
# UnitAssemblyBuilder.jsx: one manufactured "unit" + optional thin
# "membrane" layers - handled as block placement, not stack geometry.
STACK_SECTIONS = {"wall", "roof", "floor"}
UNIT_SECTIONS = {"door", "window", "skylight"}

# Purely descriptive (SectionPreview.jsx's own convention, copied here for
# the preview panel) - NOT used in any geometry math. The boundary surface
# picked in Rhino already carries the real-world orientation.
ORDER_HINT = {
    "wall": "index 0 = interior side -> last = exterior/cladding side",
    "floor": "index 0 = interior/top finish -> last = ground/bottom",
    "roof": "index 0 = sky/outermost roofing -> last = interior/bottom",
}


class MaterialLayer:
    def __init__(self, raw):
        self.raw = raw
        self.instance_id = raw.get("instanceId")
        self.name = raw.get("name") or "(unnamed material)"
        self.thickness_mm = raw.get("thicknessMM")
        self.role = raw.get("role")  # None | "unit" | "membrane"
        self.count = raw.get("count")
        self.gwp = raw.get("gwpA1A3PerFunctionalUnit")
        self.confidence = raw.get("gwpConfidence")
        self.lambda_w_mk = raw.get("thermalConductivityWmK")
        self.density = raw.get("densityKgM3")

    @classmethod
    def from_raw(cls, raw):
        return cls(raw)

    @property
    def is_osb(self):
        return "osb" in self.name.lower()

    def preview_label(self):
        bits = [self.name]
        if self.thickness_mm is not None:
            bits.append(f"{self.thickness_mm:g} mm")
        else:
            bits.append("no thickness set")
        if self.confidence:
            bits.append(f"{self.confidence} confidence")
        return " – ".join(bits)


class AssemblySection:
    def __init__(self, key, layers, owner=None, saved_at=None, pitch_deg=None,
                 unit_spec=None, source="default"):
        self.key = key
        self.display_name = SECTION_DISPLAY[key]
        self.kind = "stack" if key in STACK_SECTIONS else "unit"
        self.layers = layers
        self.owner = owner
        self.saved_at = saved_at
        self.pitch_deg = pitch_deg
        self.unit_spec = unit_spec or {}
        self.source = source  # "session" | "default"

    @property
    def unit_layer(self):
        for layer in self.layers:
            if layer.role == "unit":
                return layer
        return None

    @property
    def membrane_layers(self):
        return [l for l in self.layers if l.role == "membrane"]

    def find_osb_indices(self):
        return [i for i, layer in enumerate(self.layers) if layer.is_osb]

    def find_osb_index(self):
        """First OSB match, if any - real stacks often have more than one
        (Wall and Roof both carry 3 in the current default data, e.g. an
        inner and outer racking layer plus the roof deck), so this is a
        default guess, not a unique identification. See find_osb_indices()
        and geometry.build_stack_geometry()'s multi-match warning."""
        indices = self.find_osb_indices()
        return indices[0] if indices else None


def app_root_from_here(start_dir):
    """Walk upward from a folder to find the app repo root (the folder
    containing database/materials.json). Works regardless of exactly how
    deep this tool's own folder sits, as long as it's somewhere inside
    the repo checkout."""
    current = os.path.abspath(start_dir)
    for _ in range(6):
        candidate = os.path.join(current, "database", "materials.json")
        if os.path.isfile(candidate):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None


def load_defaults(app_root):
    path = os.path.join(app_root, "database", "defaultLayers.json")
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    sections = {}
    for key in SECTION_KEYS:
        layer_dicts = raw.get(key, [])
        layers = [MaterialLayer.from_raw(d) for d in layer_dicts]
        sections[key] = AssemblySection(key, layers, source="default")
    return sections


def load_session(session_path, app_root):
    """Loads an exported session JSON (schemaVersion 1). Any section the
    session doesn't have data for falls back to the app's default for
    just that section, rather than failing the whole import."""
    with open(session_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if raw.get("schemaVersion") != 1:
        raise ValueError(
            "Unrecognized session schemaVersion %r (this tool understands "
            "schemaVersion 1, from sessionExport.js)." % raw.get("schemaVersion")
        )

    defaults = load_defaults(app_root)
    sections = {}
    session_sections = raw.get("sections") or {}
    notes = []

    for key in SECTION_KEYS:
        record = session_sections.get(key)
        if not record or not record.get("layers"):
            sections[key] = defaults[key]
            notes.append(f"'{key}' not in session -> used app defaults")
            continue
        layers = [MaterialLayer.from_raw(d) for d in record.get("layers", [])]
        sections[key] = AssemblySection(
            key,
            layers,
            owner=record.get("owner"),
            saved_at=record.get("savedAt"),
            pitch_deg=record.get("pitchDeg"),
            unit_spec=record.get("unitSpec"),
            source="session",
        )

    session_info = raw.get("session") or {}
    meta = {
        "exportedAt": raw.get("exportedAt"),
        "group": session_info.get("groupName") or session_info.get("group"),
        "notes": notes,
    }
    return sections, meta
