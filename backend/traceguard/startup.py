"""Cross-platform startup and environment validation for TraceGuard.

Verifies runtime environment, dependency availability, directory and asset
resolvability from arbitrary working directories, and database writability.
"""
from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

from .config import DEFAULT_SETTINGS
from .db import database_path, initialize
from .fixtures import SCENARIOS


def check_environment() -> dict[str, Any]:
    """Perform non-destructive pre-flight checks and return status dictionary.

    Raises RuntimeError if critical environment requirements are not met.
    """
    results: dict[str, Any] = {
        "python_version": sys.version.split()[0],
        "platform": sys.platform,
        "static_assets_ok": False,
        "db_writable": False,
        "scenarios_loaded": len(SCENARIOS),
        "settings_valid": False,
    }

    # 1. Python version check (>= 3.11)
    if sys.version_info < (3, 11):
        raise RuntimeError(f"Python 3.11+ is required; running {sys.version}")

    # 2. Static files check from package location, not CWD
    pkg_dir = Path(__file__).resolve().parent
    static_dir = pkg_dir / "static"
    required_assets = ("index.html", "app.js", "styles.css")
    for asset in required_assets:
        asset_path = static_dir / asset
        if not asset_path.is_file() or asset_path.stat().st_size == 0:
            raise RuntimeError(f"Missing required static asset: {asset_path}")
    results["static_assets_ok"] = True

    # 3. Settings validation
    if DEFAULT_SETTINGS.max_upload_bytes <= 0 or DEFAULT_SETTINGS.max_csv_rows <= 0:
        raise RuntimeError("Invalid default settings")
    results["settings_valid"] = True

    # 4. Database writability test
    db_file = database_path()
    if db_file != ":memory:":
        target_dir = Path(db_file).expanduser().resolve().parent
        target_dir.mkdir(parents=True, exist_ok=True)
    try:
        initialize()
        results["db_writable"] = True
    except Exception as exc:
        raise RuntimeError(f"Database initialization failed: {exc}") from exc

    return results


def run_preflight_cli() -> int:
    try:
        res = check_environment()
        print(f"[OK] TraceGuard startup pre-flight passed on {res['platform']} (Python {res['python_version']}).")
        print(f"     Static assets verified at {Path(__file__).resolve().parent / 'static'}")
        print(f"     {res['scenarios_loaded']} synthetic scenarios ready.")
        return 0
    except Exception as exc:
        print(f"[FAIL] Startup pre-flight check failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(run_preflight_cli())
