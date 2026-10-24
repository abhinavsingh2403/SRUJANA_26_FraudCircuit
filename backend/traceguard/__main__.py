"""Launcher module entry point for TraceGuard (`python -m traceguard`).

Enables running the service from any current working directory.
"""
from __future__ import annotations

import argparse
import os
import sys

import uvicorn

from .startup import check_environment


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the TraceGuard local investigation prototype.")
    parser.add_argument("--host", default=os.environ.get("TRACEGUARD_HOST", "127.0.0.1"), help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("TRACEGUARD_PORT", "8000")), help="Port to bind (default: 8000)")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    parser.add_argument("--check-only", action="store_true", help="Run pre-flight checks and exit")
    args = parser.parse_args()

    # Always verify pre-flight checks before starting server
    check_environment()
    if args.check_only:
        print("[OK] TraceGuard pre-flight checks passed.")
        return

    uvicorn.run("traceguard.main:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
