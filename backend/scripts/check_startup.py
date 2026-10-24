#!/usr/bin/env python3
"""Cross-platform startup and environment pre-flight validator."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from traceguard.startup import run_preflight_cli

if __name__ == "__main__":
    sys.exit(run_preflight_cli())
