"""Application entrypoint for Render default 'gunicorn your_application.wsgi' command."""
from __future__ import annotations

import sys
from pathlib import Path

# Add backend and root directory to sys.path
_root_dir = Path(__file__).resolve().parent.parent
_backend_dir = _root_dir / "backend"
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))
if str(_root_dir) not in sys.path:
    sys.path.insert(0, str(_root_dir))

from traceguard.main import app  # noqa: E402

# Export both 'app' and 'application'
application = app
