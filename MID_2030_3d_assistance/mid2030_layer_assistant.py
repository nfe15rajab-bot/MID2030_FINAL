"""MID2030 Layer Assistant - entry point.

Run this inside Rhino 8's Script Editor (or point the `RunPythonScript`
command at this file). Requires Rhino 8's CPython3 engine (uses f-strings
and Eto.Forms). See README.md in this folder for setup and scope notes.
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from lib.ui import run_assistant

run_assistant()
