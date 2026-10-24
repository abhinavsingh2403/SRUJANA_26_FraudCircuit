#!/usr/bin/env python3
"""Stress the rule pipeline on generated benign transaction streams.

Two generators are provided:
1) structured regular payouts with known benign intent in the generator;
2) random account/time/amount transactions, which are unlabeled and must NOT be
   called false positives just because this generator intends them as noise.

Results measure execution/alert volume under these exact synthetic generators,
not real-world false-positive rates or fraud effectiveness.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from traceguard.domain import Transaction  # noqa: E402
from traceguard.pipeline import analyse_transactions_detailed  # noqa: E402


def build_transactions(rows: int, mode: str, seed: int) -> list[Transaction]:
    rng = random.Random(seed)
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    txs: list[Transaction] = []
    for i in range(rows):
        if mode == "structured-payroll":
            group = i // 10
            position = i % 10
            minute = position * 120
            sender = f"BUSINESS-{group:06d}"
            recipient = f"EMPLOYEE-{group:06d}-{position:02d}"
            amount = round(1000 * rng.uniform(0.98, 1.02), 2)
        elif mode == "randomized-unlabeled":
            # Dense enough to exercise graph and rolling-window paths. No ground
            # truth labels exist, so any cases are candidate volume, not proven FPs.
            accounts = max(500, rows // 20)
            sender_index = rng.randrange(accounts)
            recipient_index = rng.randrange(accounts - 1)
            if recipient_index >= sender_index:
                recipient_index += 1
            sender, recipient = f"ACC-{sender_index:07d}", f"ACC-{recipient_index:07d}"
            minute = rng.randrange(24 * 60)
            amount = round(10 ** rng.uniform(1.5, 5.0), 2)
        else:
            raise ValueError(mode)
        dt = base + timedelta(minutes=minute, seconds=(i % 17))
        txs.append(Transaction(
            transaction_id=f"STRESS-{mode}-{i:07d}",
            timestamp_us=int(dt.timestamp() * 1_000_000),
            timestamp=dt.isoformat(timespec="microseconds").replace("+00:00", "Z"),
            sender_id=sender, recipient_id=recipient, amount=amount,
            transaction_type="TRANSFER", currency="INR",
        ))
    return sorted(txs, key=lambda tx: (tx.timestamp_us, tx.transaction_id))


def run(rows: int, mode: str, seed: int) -> dict[str, object]:
    txs = build_transactions(rows, mode, seed)
    start = time.perf_counter()
    _, cases, graph_stats = analyse_transactions_detailed(txs, f"stress-{mode}-{seed}")
    elapsed = time.perf_counter() - start
    priorities = {key: sum(1 for case in cases if case["priority"] == key)
                  for key in ("HIGH", "MEDIUM", "LOW", "INSUFFICIENT_HISTORY")}
    return {
        "mode": mode, "seed": seed, "rows": len(txs), "elapsed_seconds": round(elapsed, 3),
        "cases": len(cases), "cases_by_priority": priorities, "graph_stats": graph_stats,
        "interpretation": (
            "Known regular-payout generator; observed cases are deviations from this constructed benign pattern."
            if mode == "structured-payroll" else
            "Unlabeled randomized graph stress. Case counts are not false-positive counts because transactions have no reliable ground truth."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=100_000)
    parser.add_argument("--seed", type=int, default=20261024)
    parser.add_argument("--mode", choices=("structured-payroll", "randomized-unlabeled", "both"), default="both")
    parser.add_argument("--output", type=Path, default=ROOT / "reports" / "stress_100k.json")
    args = parser.parse_args()
    if args.rows < 1 or args.rows > 100_000:
        parser.error("rows must be between 1 and 100000")
    modes = ("structured-payroll", "randomized-unlabeled") if args.mode == "both" else (args.mode,)
    results = [run(args.rows, mode, args.seed) for mode in modes]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, indent=2))
    print(f"Wrote results to {args.output}")


if __name__ == "__main__":
    main()
