#!/usr/bin/env python3
"""Run a reproducible, episode-level *synthetic* functional benchmark.

This does not estimate real-world Indian UPI performance. Labels are assigned by
which pattern the generator intentionally plants. Rules are frozen; the held-out
split uses independent seeds. The amount-only baseline threshold is selected from
benign development episodes only, then evaluated once on held-out episodes.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from traceguard.domain import Transaction  # noqa: E402
from traceguard.pipeline import analyse_transactions_detailed  # noqa: E402

POSITIVE_KINDS = (
    "pass_through_90m", "fanin_dispersal", "directed_cycle",
    "layered_chain", "repeated_value_burst", "dormant_reactivation", "compound_layered_cycle",
)
NEGATIVE_KINDS = (
    "regular_payroll", "isolated_high_value", "merchant_settlement", "routine_p2p",
)
PRIORITY_SCORE = {"HIGH": 3, "MEDIUM": 2, "LOW": 1, "INSUFFICIENT_HISTORY": 0}


def _make_episode(kind: str, split: str, index: int, rng: random.Random) -> tuple[list[Transaction], int, float]:
    """Return transactions, generator-known label, and max amount for one isolated episode."""
    label = int(kind in POSITIVE_KINDS)
    prefix = f"{split}-{kind}-{index:03d}"
    base = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=rng.randrange(240))
    rows: list[Transaction] = []

    def add(tx_index: int, minute: float, sender: str, recipient: str, amount: float) -> None:
        dt = base + timedelta(minutes=minute)
        rows.append(Transaction(
            transaction_id=f"{prefix}-TX-{tx_index:03d}",
            timestamp_us=int(dt.timestamp() * 1_000_000),
            timestamp=dt.isoformat(timespec="microseconds").replace("+00:00", "Z"),
            sender_id=f"{prefix}-{sender}", recipient_id=f"{prefix}-{recipient}",
            amount=float(round(amount, 2)), transaction_type="TRANSFER", currency="INR",
        ))

    if kind == "pass_through_90m":
        incoming = rng.uniform(800, 1600)
        add(1, 0, "SOURCE", "HUB", incoming)
        add(2, rng.uniform(75, 150), "HUB", "DEST", incoming * rng.uniform(0.78, 0.96))
    elif kind == "fanin_dispersal":
        amounts = [rng.uniform(900, 1200) for _ in range(4)]
        for i, amount in enumerate(amounts, 1):
            add(i, i * 3, f"SOURCE-{i}", "HUB", amount)
        distributable = sum(amounts) * rng.uniform(0.72, 0.90) / 4
        for i in range(4):
            add(10 + i, 15 + i * 5, "HUB", f"DEST-{i}", distributable)
    elif kind == "directed_cycle":
        amount = rng.uniform(900, 1500)
        add(1, 0, "A", "B", amount)
        add(2, 4, "B", "C", amount * 0.9)
        add(3, 8, "C", "A", amount * 0.8)
    elif kind == "layered_chain":
        amount = rng.uniform(900, 1600)
        nodes = ["A", "B", "C", "D", "E"]
        minute = 0.0
        for i in range(4):
            if i:
                minute += rng.uniform(3, 8)
            add(i + 1, minute, nodes[i], nodes[i + 1], amount * (0.90 ** i))
    elif kind == "compound_layered_cycle":
        # Deliberately planted composite pattern. This label means that the
        # generator placed these motifs; it does not mean real fraud occurred.
        amount = rng.uniform(900, 1200)
        nodes = ["A", "B", "C", "D", "E"]
        for i, ratio in enumerate((1.0, 0.90, 0.80, 0.70), 1):
            add(i, (i - 1) * 5, nodes[i - 1], nodes[i], amount * ratio)
        add(5, 20, "E", "C", amount * 0.65)
        for i in range(1, 11):
            add(20 + i, 22 + i * 2, "E", f"DEST-{i}", amount * 0.65)
    elif kind == "repeated_value_burst":
        amount = rng.choice([49000.0, 25000.0, 12000.0])
        for i in range(12):
            add(i + 1, i * 3, "SENDER", f"RECIPIENT-{i}", amount)
    elif kind == "dormant_reactivation":
        base_amount = rng.uniform(70, 130)
        for i in range(6):
            add(i + 1, i * 2, "DORMANT", f"OLD-{i}", base_amount)
        add(20, 31 * 24 * 60, "DORMANT", "NEW", base_amount * rng.uniform(4, 7))
    elif kind == "regular_payroll":
        amount = rng.uniform(700, 1800)
        for i in range(18):
            add(i + 1, i * 120, "EMPLOYER", f"EMPLOYEE-{i}", amount * rng.uniform(0.97, 1.03))
    elif kind == "isolated_high_value":
        add(1, rng.uniform(0, 2000), "CUSTOMER", "MERCHANT", rng.uniform(50_000, 250_000))
    elif kind == "merchant_settlement":
        # A deliberate hard negative: legitimate-looking many-to-one collection
        # plus dispersed payouts can resemble a pattern detector's target class.
        amount = rng.uniform(400, 700)
        for i in range(6):
            add(i + 1, i * 8, f"CUSTOMER-{i}", "MERCHANT", amount * rng.uniform(0.96, 1.04))
        for i in range(5):
            add(20 + i, 90 + i * 120, "MERCHANT", f"SUPPLIER-{i}", amount * rng.uniform(0.45, 0.65))
    elif kind == "routine_p2p":
        # Ordinary, sparsely spaced transfers through a small set of people.
        people = [f"P-{i}" for i in range(8)]
        minute = 0
        for i in range(12):
            sender = people[i % len(people)]
            recipient = people[(i * 3 + 2) % len(people)]
            if sender == recipient:
                recipient = people[(i + 1) % len(people)]
            add(i + 1, minute, sender, recipient, rng.uniform(80, 500))
            minute += rng.uniform(120, 240)
    else:
        raise ValueError(f"Unknown episode kind {kind}")

    return sorted(rows, key=lambda item: (item.timestamp_us, item.transaction_id)), label, max(t.amount for t in rows)


def _metrics(labels: list[int], predictions: list[int], scores: list[float], k_fraction: float = 0.10) -> dict[str, Any]:
    tp = sum(y == 1 and p == 1 for y, p in zip(labels, predictions))
    fp = sum(y == 0 and p == 1 for y, p in zip(labels, predictions))
    fn = sum(y == 1 and p == 0 for y, p in zip(labels, predictions))
    tn = sum(y == 0 and p == 0 for y, p in zip(labels, predictions))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    k = max(1, round(len(labels) * k_fraction))
    order = sorted(range(len(labels)), key=lambda i: (-scores[i], i))[:k]
    p_at_k = sum(labels[i] for i in order) / k
    return {
        "episodes": len(labels), "positive_episodes": sum(labels),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": round(precision, 6), "recall": round(recall, 6), "f1": round(f1, 6),
        "false_positive_rate": round(fp / (fp + tn), 6) if fp + tn else None,
        "precision_at_k": round(p_at_k, 6), "k": k,
    }


def run_benchmark(episodes_per_kind: int = 12, seed: int = 20261024) -> dict[str, Any]:
    if episodes_per_kind < 2:
        raise ValueError("episodes_per_kind must be >= 2 so dev and holdout both exist")
    dev_rng = random.Random(seed)
    test_rng = random.Random(seed + 1_000_003)
    dev_rows: list[dict[str, Any]] = []
    test_rows: list[dict[str, Any]] = []
    start = time.perf_counter()
    for split, rng, target in (("dev", dev_rng, dev_rows), ("holdout", test_rng, test_rows)):
        for kind in POSITIVE_KINDS + NEGATIVE_KINDS:
            for index in range(episodes_per_kind):
                txs, label, max_amount = _make_episode(kind, split, index, rng)
                source_id = f"benchmark-{split}-{kind}-{index}"
                _, cases, graph_stats = analyse_transactions_detailed(txs, source_id)
                max_priority = max((PRIORITY_SCORE.get(case["priority"], 0) for case in cases), default=0)
                target.append({
                    "episode_id": source_id, "pattern_type": kind, "label": label,
                    "max_transaction_amount": max_amount, "max_priority_score": max_priority,
                    "any_risk_case": int(max_priority >= 1),
                    "actionable_case": int(max_priority >= 2),
                    "high_case": int(max_priority >= 3),
                    "case_count": len(cases), "graph_stats": graph_stats,
                    "rule_codes": sorted({code for case in cases for code in case["rule_codes"]}),
                })
    elapsed = time.perf_counter() - start

    benign_dev_amounts = [row["max_transaction_amount"] for row in dev_rows if row["label"] == 0]
    # Threshold comes only from development benign amounts. It is a deliberately
    # simple benchmark; its held-out result is not tuned after observing test rows.
    amount_threshold = sorted(benign_dev_amounts)[max(0, min(len(benign_dev_amounts)-1, int(0.99 * (len(benign_dev_amounts)-1))))]
    labels = [int(row["label"]) for row in test_rows]
    rules_action = [int(row["actionable_case"]) for row in test_rows]
    rules_any = [int(row["any_risk_case"]) for row in test_rows]
    rules_scores = [float(row["max_priority_score"]) for row in test_rows]
    amount_scores = [float(row["max_transaction_amount"]) for row in test_rows]
    amount_preds = [int(score >= amount_threshold) for score in amount_scores]
    return {
        "title": "TraceGuard controlled synthetic episode benchmark",
        "run_date": "2026-10-24",
        "seed": seed,
        "episodes_per_kind_per_split": episodes_per_kind,
        "dev_episode_count": len(dev_rows),
        "heldout_episode_count": len(test_rows),
        "positive_pattern_types": list(POSITIVE_KINDS),
        "negative_pattern_types": list(NEGATIVE_KINDS),
        "label_definition": "1 means a synthetic episode was generated from a planted pattern type in POSITIVE_KINDS; 0 means generated from a listed benign/hard-negative type. These are generator labels, not verified real-world fraud labels.",
        "data_limitations": [
            "All data are deterministic synthetic episodes generated by this script.",
            "Pattern types are aligned with prototype detector rules; results measure fixture coverage, not real-world generalization.",
            "The merchant-settlement hard negative intentionally overlaps with heuristics and can create a case; that is a useful false-alert signal, not ground truth about real settlement behaviour.",
            "No machine-learning model is trained or evaluated by this script.",
            "Holdout episodes use a separate random seed; detector thresholds are not tuned on holdout.",
        ],
        "amount_only_baseline": {
            "method": "Predict episode as positive when its maximum single transaction amount is >= the 99th percentile order statistic of maximum amounts from benign development episodes.",
            "threshold_selected_on_dev_benign_only": round(amount_threshold, 2),
            "holdout_metrics": _metrics(labels, amount_preds, amount_scores),
        },
        "rules_system": {
            "actionable_definition": "Episode is actionable when any case is HIGH or MEDIUM; LOW is retained in the queue as review-only/contextual. This operational cut-off is not calibrated.",
            "actionable_metrics": _metrics(labels, rules_action, rules_scores),
            "any_case_metrics": _metrics(labels, rules_any, rules_scores),
            "high_priority_episode_count": sum(row["high_case"] for row in test_rows),
            "high_priority_episode_false_alerts": sum(row["high_case"] for row in test_rows if row["label"] == 0),
        },
        "by_pattern_type": {
            kind: {
                "count": sum(1 for row in test_rows if row["pattern_type"] == kind),
                "positive_labels": sum(row["label"] for row in test_rows if row["pattern_type"] == kind),
                "episodes_with_any_case": sum(row["any_risk_case"] for row in test_rows if row["pattern_type"] == kind),
                "episodes_with_actionable_case": sum(row["actionable_case"] for row in test_rows if row["pattern_type"] == kind),
                "high_priority_episodes": sum(row["high_case"] for row in test_rows if row["pattern_type"] == kind),
                "missed_positive_episodes": sum(1 for row in test_rows if row["label"] == 1 and not row["actionable_case"] and row["pattern_type"] == kind),
                "detector_rules_seen": sorted({code for row in test_rows if row["pattern_type"] == kind for code in row["rule_codes"]}),
            } for kind in POSITIVE_KINDS + NEGATIVE_KINDS
        },
        "graph_search_incomplete_episode_count": sum(
            1 for row in test_rows if row["graph_stats"].get("graph_analysis_incomplete", 0)
        ),
        "graph_search_budget_exhaustion_events": {
            "cycles": sum(row["graph_stats"].get("cycle_search_budget_exhausted", 0) for row in test_rows),
            "chains": sum(row["graph_stats"].get("chain_search_budget_exhausted", 0) for row in test_rows),
        },
        "elapsed_seconds": round(elapsed, 3),
        "dev_rows": dev_rows,
        "heldout_rows": test_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--episodes-per-kind", type=int, default=12)
    parser.add_argument("--seed", type=int, default=20261024)
    parser.add_argument("--output", type=Path, default=ROOT / "reports" / "controlled_benchmark.json")
    args = parser.parse_args()
    result = run_benchmark(args.episodes_per_kind, args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    summary = {k: v for k, v in result.items() if k not in {"dev_rows", "heldout_rows"}}
    print(json.dumps(summary, indent=2))
    print(f"Wrote full benchmark rows to {args.output}")


if __name__ == "__main__":
    main()
