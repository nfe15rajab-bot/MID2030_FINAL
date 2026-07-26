"""File-picking + orchestration for loading app data: either an exported
session JSON, or the app's bundled defaults (database/defaultLayers.json).
"""

import os

import Eto.Forms as forms

from . import data_model


def find_app_root():
    here = os.path.dirname(os.path.abspath(__file__))
    root = data_model.app_root_from_here(here)
    if root is None:
        raise RuntimeError(
            "Could not find the app's database/materials.json above this "
            "script. Keep MID_2030_3d_assistance as a sibling folder of "
            "database/ inside the MID2030_FINAL repo checkout."
        )
    return root


def pick_session_file(parent=None):
    dialog = forms.OpenFileDialog()
    dialog.Title = "Import MID2030 session export (.json)"
    try:
        dialog.Filters.Add(forms.FileFilter("Session export (*.json)", ".json"))
    except Exception:
        pass  # filter is a convenience only - a missing/renamed API here shouldn't block picking a file
    result = dialog.ShowDialog(parent)
    if result != forms.DialogResult.Ok:
        return None
    return dialog.FileName


def load_defaults():
    app_root = find_app_root()
    sections = data_model.load_defaults(app_root)
    meta = {
        "exportedAt": None,
        "group": None,
        "notes": ["Using current app defaults (database/defaultLayers.json) - no session imported."],
    }
    return sections, meta


def load_session(session_path):
    app_root = find_app_root()
    return data_model.load_session(session_path, app_root)
