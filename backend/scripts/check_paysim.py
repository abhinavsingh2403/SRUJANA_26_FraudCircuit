"""Inspect a locally obtained PaySim CSV without altering or leaking labels.

Usage: python scripts/check_paysim.py /path/to/PS_20174392719.csv
The script reports basic source/schema/time-step properties. It does not train a model.
"""
from __future__ import annotations

import argparse
import csv
from collections import Counter
from pathlib import Path

REQUIRED = {"step", "type", "amount", "nameOrig", "nameDest", "isFraud"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path)
    args = parser.parse_args()
    if not args.csv_path.is_file():
        parser.error(f"file not found: {args.csv_path}")
    count = 0
    steps: set[int] = set()
    step_counts: Counter[int] = Counter()
    fraud_count = 0
    with args.csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        headers = set(reader.fieldnames or [])
        missing = REQUIRED - headers
        if missing:
            parser.error("missing PaySim fields: " + ", ".join(sorted(missing)))
        for row in reader:
            count += 1
            step = int(row["step"])
            steps.add(step)
            step_counts[step] += 1
            fraud_count += int(row["isFraud"])
    ordered = sorted(steps)
    print(f"rows: {count}")
    print(f"distinct steps: {len(ordered)}")
    print(f"min step: {ordered[0] if ordered else 'n/a'}")
    print(f"max step: {ordered[-1] if ordered else 'n/a'}")
    print(f"fraud labels in source (for evaluation only): {fraud_count}")
    print(f"steps containing multiple rows: {sum(1 for n in step_counts.values() if n > 1)}")
    print("warning: rows sharing the same step have no established within-step chronology")
    print("warning: do not use isFraud/isFlaggedFraud or post-transaction balance columns as model features")
    print("warning: inspect the dataset license and provenance before redistribution")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
