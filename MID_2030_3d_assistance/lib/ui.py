"""Eto.Forms wizard: load data -> preview assemblies -> pick 3D
boundaries/blocks -> generate layers -> optional boolean difference.

Run via mid2030_layer_assistant.py inside Rhino 8's Script Editor
(CPython3). The form is modeless (Show(), not ShowModal()) so the Rhino
viewport stays interactive for the picking steps.
"""

import Eto.Forms as forms
import Eto.Drawing as drawing
import rhinoscriptsyntax as rs

try:
    import Rhino.UI
    _MAIN_WINDOW = Rhino.UI.RhinoEtoApp.MainWindow
except Exception:
    _MAIN_WINDOW = None

from . import data_model
from . import session_io
from . import geometry

STEP_TITLES = [
    "1. Load data",
    "2. Preview assemblies",
    "3. Pick 3D boundaries",
    "4. Generate layers",
    "5. Boolean difference (optional)",
]

# Windows/Doors/Skylight are all UnitAssemblyBuilder-style in the app;
# the brief only asked for "windows blocks and doors blocks" explicitly,
# skylight block-picking is added here by the same pattern so all 6
# generated layers actually get something to attach to.
BLOCK_SECTIONS = ["window", "door", "skylight"]
BOUNDARY_SECTIONS = ["floor", "wall", "roof"]


class LayerStackView(forms.Drawable):
    """Schematic preview of one assembly's material stack - proportional
    rectangles labeled with material name/thickness/confidence."""

    def __init__(self):
        super().__init__()
        self.section = None
        self.Height = 320
        self.Paint += self._on_paint

    def show_section(self, section):
        self.section = section
        self.Invalidate()

    def _on_paint(self, sender, e):
        g = e.Graphics
        g.Clear(drawing.Colors.White)
        section = self.section
        width = max(int(self.Width), 200)
        height = max(int(self.Height), 120)
        font = drawing.Font(drawing.FontFamilies.Sans, 9)

        if not section or not section.layers:
            g.DrawText(font, drawing.Colors.Black, 8, 8, "No layers in this assembly yet.")
            return

        pad = 8
        usable_h = height - 2 * pad
        weights = [
            layer.thickness_mm if (layer.thickness_mm and layer.thickness_mm > 0) else 30
            for layer in section.layers
        ]
        total = sum(weights) or 1

        y = float(pad)
        for layer, weight in zip(section.layers, weights):
            h = usable_h * (weight / total)
            color = drawing.Colors.Gainsboro
            if layer.confidence == "low":
                color = drawing.Colors.Moccasin
            elif layer.role == "unit":
                color = drawing.Colors.LightSkyBlue
            rect = drawing.RectangleF(pad, y, width - 2 * pad, max(h, 1))
            g.FillRectangle(color, rect)
            g.DrawRectangle(drawing.Colors.Black, rect)
            if h > 12:
                g.DrawText(font, drawing.Colors.Black, pad + 6, y + 2, layer.preview_label())
            y += h


class AssistantForm(forms.Form):
    def __init__(self):
        super().__init__()
        self.Title = "MID2030 Layer Assistant"
        self.ClientSize = drawing.Size(620, 560)
        self.Padding = drawing.Padding(10)
        self.Resizable = True
        if _MAIN_WINDOW is not None:
            self.Owner = _MAIN_WINDOW

        self.sections = None
        self.meta = None
        self.current_step = 0
        self.selected_key = data_model.SECTION_KEYS[0]

        self.boundaries = {}       # key -> Brep (floor/wall/roof)
        self.reference_ids = {}    # key -> object id (optional OSB reference)
        self.block_ids = {}        # key -> [object id] (window/door/skylight)
        self.generated_ids = {}    # key -> [object id] (after Generate)

        self.title_label = forms.Label(Text=STEP_TITLES[0], Font=drawing.Font(drawing.FontFamilies.Sans, 13, drawing.FontStyle.Bold))
        self.content_host = forms.Panel()
        self.log_area = forms.TextArea(ReadOnly=True, Height=110)

        self.back_btn = forms.Button(Text="Back", Enabled=False)
        self.back_btn.Click += self._on_back
        self.next_btn = forms.Button(Text="Next", Enabled=False)
        self.next_btn.Click += self._on_next

        nav_row = forms.StackLayout(Orientation=forms.Orientation.Horizontal, Spacing=8,
                                     Items=[self.back_btn, self.next_btn])

        root = forms.StackLayout(Orientation=forms.Orientation.Vertical, Spacing=10,
                                  HorizontalContentAlignment=forms.HorizontalAlignment.Stretch)
        root.Items.append(self.title_label)
        root.Items.append(forms.StackLayoutItem(self.content_host, expand=True))
        root.Items.append(forms.Label(Text="Log"))
        root.Items.append(self.log_area)
        root.Items.append(nav_row)
        self.Content = root

        self._refresh_step()

    # ---- logging -------------------------------------------------
    def _log(self, message):
        self.log_area.Append(message + "\n", True)

    def _log_clear(self):
        self.log_area.Text = ""

    # ---- step navigation ------------------------------------------
    def _on_back(self, sender, e):
        if self.current_step > 0:
            self.current_step -= 1
            self._refresh_step()

    def _on_next(self, sender, e):
        if self.current_step < len(STEP_TITLES) - 1:
            self.current_step += 1
            self._refresh_step()

    def _refresh_step(self):
        self.title_label.Text = STEP_TITLES[self.current_step]
        self.back_btn.Enabled = self.current_step > 0
        builder = [
            self._build_step_load,
            self._build_step_preview,
            self._build_step_boundaries,
            self._build_step_generate,
            self._build_step_boolean,
        ][self.current_step]
        self.content_host.Content = builder()
        has_data = self.sections is not None
        can_advance = {
            0: has_data,
            1: has_data,
            2: has_data,
            3: has_data,
            4: has_data,
        }[self.current_step]
        self.next_btn.Enabled = can_advance and self.current_step < len(STEP_TITLES) - 1

    # ---- Step 1: load ------------------------------------------------
    def _build_step_load(self):
        info = forms.Label(Text=(
            "Import a session JSON exported from the app (IdentityPanel -> "
            "'Export session'), or just use the app's current default "
            "material stacks (database/defaultLayers.json)."
        ), Wrap=forms.WrapMode.Word)

        import_btn = forms.Button(Text="Import session JSON...")
        import_btn.Click += self._on_import_session
        default_btn = forms.Button(Text="Use current app defaults")
        default_btn.Click += self._on_use_defaults

        self.load_status = forms.Label(Text=self._status_text(), Wrap=forms.WrapMode.Word)

        return forms.StackLayout(Orientation=forms.Orientation.Vertical, Spacing=10,
                                  HorizontalContentAlignment=forms.HorizontalAlignment.Stretch,
                                  Items=[info, import_btn, default_btn, self.load_status])

    def _status_text(self):
        if not self.sections:
            return "No data loaded yet."
        lines = [f"Loaded from: {self.meta['group'] or 'defaults'} "
                 f"({self.meta['exportedAt'] or 'current app defaults'})"]
        lines.extend(self.meta.get("notes", []))
        return "\n".join(lines)

    def _on_import_session(self, sender, e):
        path = session_io.pick_session_file(self)
        if not path:
            return
        try:
            self.sections, self.meta = session_io.load_session(path)
        except Exception as ex:
            forms.MessageBox.Show(self, f"Couldn't load that session file:\n{ex}", "Import failed")
            return
        self.load_status.Text = self._status_text()
        self.next_btn.Enabled = True

    def _on_use_defaults(self, sender, e):
        try:
            self.sections, self.meta = session_io.load_defaults()
        except Exception as ex:
            forms.MessageBox.Show(self, f"Couldn't load app defaults:\n{ex}", "Load failed")
            return
        self.load_status.Text = self._status_text()
        self.next_btn.Enabled = True

    # ---- Step 2: preview ----------------------------------------------
    def _build_step_preview(self):
        list_box = forms.ListBox()
        list_box.DataStore = [self.sections[k].display_name for k in data_model.SECTION_KEYS]
        list_box.SelectedIndex = data_model.SECTION_KEYS.index(self.selected_key)
        list_box.SelectedIndexChanged += self._on_select_assembly
        list_box.Width = 160

        self.stack_view = LayerStackView()
        self.stack_view.show_section(self.sections[self.selected_key])

        self.preview_info = forms.Label(Text=self._preview_info_text(), Wrap=forms.WrapMode.Word)

        right = forms.StackLayout(Orientation=forms.Orientation.Vertical, Spacing=6,
                                   HorizontalContentAlignment=forms.HorizontalAlignment.Stretch,
                                   Items=[forms.StackLayoutItem(self.stack_view, expand=True), self.preview_info])

        row = forms.StackLayout(Orientation=forms.Orientation.Horizontal, Spacing=10,
                                 Items=[list_box, forms.StackLayoutItem(right, expand=True)])
        return row

    def _preview_info_text(self):
        section = self.sections[self.selected_key]
        bits = [f"Source: {section.source}"]
        if section.owner:
            bits.append(f"Owner: {section.owner}")
        if section.pitch_deg is not None:
            bits.append(f"Pitch: {section.pitch_deg}° (display only - the boundary you pick in 3D already has the real pitch)")
        hint = data_model.ORDER_HINT.get(section.key)
        if hint:
            bits.append(f"Order convention: {hint}")
        return "  |  ".join(bits)

    def _on_select_assembly(self, sender, e):
        idx = sender.SelectedIndex
        if idx < 0:
            return
        self.selected_key = data_model.SECTION_KEYS[idx]
        section = self.sections[self.selected_key]
        self.stack_view.show_section(section)
        self.preview_info.Text = self._preview_info_text()

    # ---- Step 3: boundaries/blocks -------------------------------------
    def _build_step_boundaries(self):
        items = [forms.Label(Text=(
            "Predefined boundaries: Floor, Wall, Roof (pick one surface or "
            "polysurface each - a polysurface can cover multiple faces, "
            "e.g. all walls joined as one object). Then pick the Window "
            "and Door blocks; Skylight blocks too (not in your original "
            "list, added here since Skylight is one of the 6 generated "
            "layers - skip it if you don't want it picked separately)."
        ), Wrap=forms.WrapMode.Word)]

        for key in BOUNDARY_SECTIONS:
            items.append(self._boundary_row(key))
        for key in BLOCK_SECTIONS:
            items.append(self._blocks_row(key))

        return forms.StackLayout(Orientation=forms.Orientation.Vertical, Spacing=10,
                                  HorizontalContentAlignment=forms.HorizontalAlignment.Stretch,
                                  Items=items)

    def _boundary_row(self, key):
        label = forms.Label(Text=self._boundary_label(key), Width=260)
        pick_btn = forms.Button(Text="Pick boundary")
        pick_btn.Click += lambda s, e, k=key, lbl=label: self._on_pick_boundary(k, lbl)
        ref_btn = forms.Button(Text="Pick reference OSB (optional)")
        ref_btn.Click += lambda s, e, k=key, lbl=label: self._on_pick_reference(k, lbl)
        return forms.StackLayout(Orientation=forms.Orientation.Horizontal, Spacing=8,
                                  Items=[label, pick_btn, ref_btn])

    def _boundary_label(self, key):
        section = self.sections[key]
        picked = "✓ picked" if key in self.boundaries else "not picked"
        ref = ", reference set" if key in self.reference_ids else ""
        return f"{section.display_name}: {picked}{ref}"

    def _blocks_row(self, key):
        label = forms.Label(Text=self._blocks_label(key), Width=260)
        pick_btn = forms.Button(Text="Pick blocks")
        pick_btn.Click += lambda s, e, k=key, lbl=label: self._on_pick_blocks(k, lbl)
        return forms.StackLayout(Orientation=forms.Orientation.Horizontal, Spacing=8,
                                  Items=[label, pick_btn])

    def _blocks_label(self, key):
        section = self.sections[key]
        count = len(self.block_ids.get(key, []))
        return f"{section.display_name}: {count} block(s) picked"

    def _on_pick_boundary(self, key, label):
        section = self.sections[key]
        brep = geometry.pick_boundary(f"Select the {section.display_name} boundary surface/polysurface")
        if brep is not None:
            self.boundaries[key] = brep
            self._log(f"{section.display_name}: boundary picked.")
        label.Text = self._boundary_label(key)

    def _on_pick_reference(self, key, label):
        section = self.sections[key]
        obj_id = geometry.pick_reference_object(
            f"Select the existing OSB (or other reference) object for {section.display_name} - Esc to skip")
        if obj_id is not None:
            self.reference_ids[key] = obj_id
            self._log(f"{section.display_name}: reference object set.")
        label.Text = self._boundary_label(key)

    def _on_pick_blocks(self, key, label):
        section = self.sections[key]
        ids = geometry.pick_blocks(f"Select the {section.display_name} block instance(s)")
        if ids:
            self.block_ids[key] = ids
            self._log(f"{section.display_name}: {len(ids)} block(s) picked.")
        label.Text = self._blocks_label(key)

    # ---- Step 4: generate ----------------------------------------------
    def _build_step_generate(self):
        info = forms.Label(Text=(
            "Adds all 6 named layers (with material sublayers) regardless "
            "of what's been picked so far - that part always happens. "
            "3D solids/blocks only get placed into the sections you picked "
            "a boundary or blocks for in step 3. Re-running Generate for a "
            "section you already built adds a second copy - undo (Ctrl+Z) "
            "first if you're iterating on one section."
        ), Wrap=forms.WrapMode.Word)
        generate_btn = forms.Button(Text="Generate Layers")
        generate_btn.Click += self._on_generate
        return forms.StackLayout(Orientation=forms.Orientation.Vertical, Spacing=10,
                                  HorizontalContentAlignment=forms.HorizontalAlignment.Stretch,
                                  Items=[info, generate_btn])

    def _on_generate(self, sender, e):
        self._log_clear()
        for key in data_model.SECTION_KEYS:
            section = self.sections[key]
            top = geometry.ensure_layer(section.display_name)
            for layer in section.layers:
                geometry.ensure_layer(layer.name, parent=top)

            if section.kind == "stack":
                boundary = self.boundaries.get(key)
                if boundary is None:
                    self._log(f"{section.display_name}: no boundary picked yet - layers created, no geometry.")
                    continue
                ref_id = self.reference_ids.get(key)
                ids = geometry.build_stack_geometry(section, boundary, top, reference_object_id=ref_id, log=self._log)
                self.generated_ids[key] = ids
                self._log(f"{section.display_name}: {len(ids)} layer solid(s) created.")
            else:
                blocks = self.block_ids.get(key, [])
                if not blocks:
                    self._log(f"{section.display_name}: no blocks picked yet - layers created, none assigned.")
                    continue
                geometry.assign_units_to_layer(section, top, blocks, log=self._log)
                self.generated_ids[key] = list(blocks)
                self._log(f"{section.display_name}: {len(blocks)} block(s) assigned.")
        self._log("Done.")

    # ---- Step 5: boolean difference -------------------------------------
    def _build_step_boolean(self):
        info = forms.Label(Text=(
            "Optional, and separate from Generate - run this once there's "
            "real existing geometry (structure, framing) to cut the layer "
            "solids against. Pick any objects in the viewport; the named "
            "layers from step 4 make it easy to window-select just the "
            "layer solids you want to trim."
        ), Wrap=forms.WrapMode.Word)
        pick_targets_btn = forms.Button(Text="Pick layer solids to trim")
        pick_targets_btn.Click += self._on_pick_targets
        pick_cutters_btn = forms.Button(Text="Pick existing geometry to subtract")
        pick_cutters_btn.Click += self._on_pick_cutters
        run_btn = forms.Button(Text="Run Boolean Difference")
        run_btn.Click += self._on_run_boolean

        self._bool_targets = getattr(self, "_bool_targets", [])
        self._bool_cutters = getattr(self, "_bool_cutters", [])
        self.bool_status = forms.Label(Text=self._bool_status_text())

        return forms.StackLayout(Orientation=forms.Orientation.Vertical, Spacing=10,
                                  HorizontalContentAlignment=forms.HorizontalAlignment.Stretch,
                                  Items=[info, pick_targets_btn, pick_cutters_btn, self.bool_status, run_btn])

    def _bool_status_text(self):
        return f"{len(self._bool_targets)} layer solid(s) selected, {len(self._bool_cutters)} cutter object(s) selected"

    def _on_pick_targets(self, sender, e):
        picked = rs.GetObjects("Select layer solids to trim")
        self._bool_targets = list(picked) if picked else []
        self.bool_status.Text = self._bool_status_text()

    def _on_pick_cutters(self, sender, e):
        picked = rs.GetObjects("Select existing geometry to subtract")
        self._bool_cutters = list(picked) if picked else []
        self.bool_status.Text = self._bool_status_text()

    def _on_run_boolean(self, sender, e):
        if not self._bool_targets or not self._bool_cutters:
            forms.MessageBox.Show(self, "Pick both layer solids and cutter geometry first.", "Nothing to do")
            return
        results = geometry.boolean_difference(self._bool_targets, self._bool_cutters, log=self._log)
        self._log(f"Boolean difference done: {len(results)} resulting object(s).")
        self._bool_targets, self._bool_cutters = [], []
        self.bool_status.Text = self._bool_status_text()


def run_assistant():
    try:
        form = AssistantForm()
        form.Show()
        return form
    except Exception as ex:
        try:
            forms.MessageBox.Show(None, f"MID2030 Layer Assistant failed to start:\n{ex}", "Error")
        except Exception:
            print(f"MID2030 Layer Assistant failed to start: {ex}")
        raise
