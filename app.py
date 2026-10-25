"""TraceGuard Production Application Entrypoint for Render and Cloud Deployments.

This entrypoint binds to the host and port provided by the environment
(e.g., Render $PORT) and ensures the backend package is directly in sys.path.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Add backend directory to sys.path so traceguard is importable as top-level package
_root_dir = Path(__file__).resolve().parent
_backend_dir = _root_dir / "backend"
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

# Import the FastAPI ASGI app from traceguard.main
from traceguard.main import app  # noqa: E402

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"Starting TraceGuard on {host}:{port}")
    uvicorn.run("app:app", host=host, port=port, log_level="info")
