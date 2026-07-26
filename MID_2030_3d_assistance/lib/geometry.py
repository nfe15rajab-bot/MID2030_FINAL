"""Rhino-side geometry operations: picking boundaries/blocks, building
layer solids from a material stack, and the separate, opt-in boolean
difference step against existing geometry.

Alignment approximation: when a reference object (e.g. an existing OSB
board already in the model) is picked, the assembly's OSB layer is
centered on that object's bounding-box centroid, and every other layer is
positioned before/after it by cumulative true thickness. That's a
"same neighbourhood, correct order and thickness" alignment, not a
guaranteed face-to-face contact fit - nudge with Move/Gumball afterward
if you need exact contact.
"""

import Rhino
import rhinoscriptsyntax as rs
import scriptcontext as sc


def mm_to_doc_units(value_mm):
    if value_mm is None:
        return None
    scale = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Millimeters, sc.doc.ModelUnitSystem)
    return value_mm * scale


def tolerance():
    return sc.doc.ModelAbsoluteTolerance


def pick_boundary(prompt):
    """One surface or polysurface -> its Brep (possibly multi-face, e.g.
    all four walls joined as one polysurface). None if cancelled."""
    obj_id = rs.GetObject(prompt, filter=rs.filter.surface | rs.filter.polysurface, preselect=True)
    if not obj_id:
        return None
    return rs.coercebrep(obj_id)


def pick_reference_object(prompt):
    return rs.GetObject(prompt, preselect=True)


def pick_blocks(prompt):
    """One or more block instances -> list of object ids."""
    ids = rs.GetObjects(prompt, filter=rs.filter.instance, preselect=True)
    return list(ids) if ids else []


def ensure_layer(name, parent=None, color=None):
    full = f"{parent}::{name}" if parent else name
    if rs.IsLayer(full):
        return full
    return rs.AddLayer(name, color=color, parent=parent) or full


def set_layer_metadata(obj_id, layer_obj):
    fields = {
        "MID2030_material": layer_obj.name,
        "MID2030_thicknessMM": "" if layer_obj.thickness_mm is None else str(layer_obj.thickness_mm),
        "MID2030_gwpA1A3": "" if layer_obj.gwp is None else str(layer_obj.gwp),
        "MID2030_confidence": layer_obj.confidence or "",
    }
    for key, value in fields.items():
        rs.SetUserText(obj_id, key, value)


def _face_normal_and_point(face):
    du, dv = face.Domain(0), face.Domain(1)
    u, v = du.Mid, dv.Mid
    return face.NormalAt(u, v), face.PointAt(u, v)


def _signed_offset(point, base_point, normal):
    delta = point - base_point  # Vector3d
    return delta * normal  # Vector3d * Vector3d is the dot product in RhinoCommon


def _bbox_center(object_id):
    bbox = rs.BoundingBox(object_id)
    if not bbox:
        return None
    n = len(bbox)
    x = sum(p.X for p in bbox) / n
    y = sum(p.Y for p in bbox) / n
    z = sum(p.Z for p in bbox) / n
    return Rhino.Geometry.Point3d(x, y, z)


def _offset_face_to_solid(face, start_dist, thickness):
    face_brep = face.DuplicateFace(False)
    if abs(start_dist) > 1e-9:
        normal, _ = _face_normal_and_point(face)
        face_brep.Transform(Rhino.Geometry.Transform.Translation(normal * start_dist))
    moved_face = face_brep.Faces[0]
    return Rhino.Geometry.Brep.CreateFromOffsetFace(moved_face, thickness, tolerance(), False, True)


def build_stack_geometry(section, boundary_brep, top_layer_name, reference_object_id=None, log=None):
    """One solid per material layer, per face of boundary_brep, stacked in
    the section's own layer order (see data_model.ORDER_HINT). Returns the
    list of created object ids.

    Re-running this for a section you already generated will add a second
    copy of its solids rather than replacing the first - undo or clear the
    section's sublayers yourself first if you're iterating.
    """
    def emit(msg):
        if log:
            log(msg)

    created_ids = []
    thicknesses = [mm_to_doc_units(l.thickness_mm) for l in section.layers]
    osb_indices = section.find_osb_indices()
    osb_index = osb_indices[0] if osb_indices else None

    ref_point = _bbox_center(reference_object_id) if reference_object_id else None
    if reference_object_id and osb_index is None:
        emit(f"{section.display_name}: reference object picked, but no material named "
             "'...OSB...' found in this assembly - stacking from the boundary surface instead.")
    elif reference_object_id and len(osb_indices) > 1:
        names = ", ".join(f"#{i} {section.layers[i].name}" for i in osb_indices)
        emit(f"{section.display_name}: {len(osb_indices)} OSB layers in this stack ({names}) - "
             f"aligning to the FIRST one (#{osb_index}) by default. If your reference object is "
             "actually a different OSB layer, the stack will land the wrong number of layers "
             "away from it - move the result afterward, or pick a reference that's clearly the "
             "innermost/first OSB.")

    for face in boundary_brep.Faces:
        normal, base_point = _face_normal_and_point(face)

        stack_start = 0.0
        if ref_point is not None and osb_index is not None:
            datum = _signed_offset(ref_point, base_point, normal)
            osb_thickness = thicknesses[osb_index] or 0.0
            osb_start = datum - osb_thickness / 2.0
            pre_thickness = sum(t for t in thicknesses[:osb_index] if t)
            stack_start = osb_start - pre_thickness

        cursor = stack_start
        for layer, thickness in zip(section.layers, thicknesses):
            sublayer = ensure_layer(layer.name, parent=top_layer_name)
            if not thickness or thickness <= 0:
                emit(f"Skipped '{layer.name}' in {section.display_name} - no thickness set in the app yet.")
                continue
            solid = _offset_face_to_solid(face, cursor, thickness)
            cursor += thickness
            if solid is None or not solid.IsValid:
                emit(f"Could not build geometry for '{layer.name}' in {section.display_name} "
                     "(offset/solid creation failed) - skipped, sublayer left empty.")
                continue
            obj_id = sc.doc.Objects.AddBrep(solid)
            if obj_id:
                rs.ObjectLayer(obj_id, sublayer)
                set_layer_metadata(obj_id, layer)
                created_ids.append(obj_id)

    sc.doc.Views.Redraw()
    return created_ids


def assign_units_to_layer(section, top_layer_name, block_ids, log=None):
    """Door/Window/Skylight: the picked block(s) ARE the unit layer's
    geometry (reparented, not regenerated). Membrane layers (e.g. glazing)
    get an empty sublayer ready to model by hand - this tool doesn't guess
    membrane geometry against an arbitrary block."""
    def emit(msg):
        if log:
            log(msg)

    unit_layer = section.unit_layer
    if unit_layer:
        sublayer = ensure_layer(unit_layer.name, parent=top_layer_name)
        for obj_id in block_ids:
            rs.ObjectLayer(obj_id, sublayer)
            set_layer_metadata(obj_id, unit_layer)
    else:
        emit(f"No 'unit' layer found for {section.display_name} in the app data - "
             "blocks left on their current layer.")

    for membrane in section.membrane_layers:
        ensure_layer(membrane.name, parent=top_layer_name)
        emit(f"Created empty sublayer for '{membrane.name}' ({section.display_name}) - "
             "model this by hand; the tool doesn't auto-generate membrane geometry.")


def boolean_difference(target_ids, cutter_ids, log=None):
    """Later/optional step: subtract existing geometry (cutter_ids) from
    already-generated layer solids (target_ids). Never called automatically."""
    def emit(msg):
        if log:
            log(msg)

    cutter_breps = [b for b in (rs.coercebrep(cid) for cid in cutter_ids) if b]
    if not cutter_breps:
        emit("No valid existing geometry selected to subtract - nothing done.")
        return []

    result_ids = []
    for tid in target_ids:
        target_brep = rs.coercebrep(tid)
        if not target_brep:
            continue
        layer_path = rs.ObjectLayer(tid)
        results = Rhino.Geometry.Brep.CreateBooleanDifference([target_brep], cutter_breps, tolerance())
        if not results:
            emit(f"Boolean difference produced nothing for object {tid} - left it as-is.")
            continue
        rs.DeleteObject(tid)
        for res in results:
            new_id = sc.doc.Objects.AddBrep(res)
            if new_id:
                rs.ObjectLayer(new_id, layer_path)
                result_ids.append(new_id)

    sc.doc.Views.Redraw()
    return result_ids
