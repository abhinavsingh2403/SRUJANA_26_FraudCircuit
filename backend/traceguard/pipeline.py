"""Framework-independent transaction analysis pipeline."""
from __future__ import annotations

from dataclasses import replace
from typing import Iterable

from .cases import build_cases, make_run_id
from .config import DEFAULT_SETTINGS, Settings
from .domain import Transaction, TransactionAnalysis
from .features import iter_features
from .rules import evaluate_rules
from .graph_analysis import detect_graph_patterns


def analyse_transactions_detailed(
    transactions: Iterable[Transaction],
    source_scenario_id: str = "csv-import",
    settings: Settings = DEFAULT_SETTINGS,
    review_start_us: int | None = None,
) -> tuple[str, list[dict[str, object]], dict[str, int]]:
    txs = sorted(list(transactions), key=lambda t: (t.timestamp_us, t.transaction_id))
    if not txs:
        return make_run_id(source_scenario_id, [], settings), [], {
            "transactions_analyzed": 0, "directed_cycles_detected": 0,
            "layered_chains_detected": 0, "cycle_search_budget_exhausted": 0,
            "chain_search_budget_exhausted": 0,
            "graph_search_expansion_limit": settings.graph_search_expansion_limit,
            "graph_analysis_incomplete": 0,
        }
    ids = [t.transaction_id for t in txs]
    if len(set(ids)) != len(ids):
        raise ValueError("transaction_id values must be unique within an analysis run")

    graph_result = detect_graph_patterns(txs, settings)
    transaction_by_id = {tx.transaction_id: tx for tx in txs}
    analyses: list[TransactionAnalysis] = []

    # Stream features into rule evaluation rather than retaining one large feature
    # object per transaction. This lowers peak memory for the 100k-row upload limit.
    for transaction_id, features in iter_features(txs, settings):
        tx = transaction_by_id[transaction_id]
        evidence = evaluate_rules(tx, features, settings)
        evidence.extend(graph_result.evidence_by_transaction.get(transaction_id, []))
        enriched = []
        for item in evidence:
            involved_accounts = set(item.account_ids)
            for related_id in item.transaction_ids:
                related = transaction_by_id.get(related_id)
                if related:
                    involved_accounts.update((related.sender_id, related.recipient_id))
            enriched.append(replace(item, account_ids=tuple(sorted(involved_accounts))))
        analyses.append(TransactionAnalysis(tx, tuple(enriched), {"coverage": features.coverage, "account_history_count": features.account_history_count}))
    run_id = make_run_id(source_scenario_id, txs, settings)
    review_analyses = analyses if review_start_us is None else [a for a in analyses if a.transaction.timestamp_us >= review_start_us]
    cases = build_cases(review_analyses, txs, source_scenario_id, run_id, settings)
    if graph_result.stats.get("graph_analysis_incomplete", 0):
        warning = (
            "Bounded graph analysis reached its per-event expansion limit "
            f"({graph_result.stats.get('cycle_search_budget_exhausted', 0)} cycle search(es), "
            f"{graph_result.stats.get('chain_search_budget_exhausted', 0)} chain search(es)). "
            "Some graph motifs may have been missed; no graph alert is not evidence of clean activity."
        )
        for case in cases:
            if warning not in case.limitations:
                case.limitations.append(warning)
    payloads = [case.to_dict() for case in cases]
    from .model_hook import advisory_scores
    scores = advisory_scores(txs, settings)
    for case in payloads:
        if case["priority"] == "INSUFFICIENT_HISTORY":
            continue
        values = [scores[t] for t in case["transaction_ids"] if t in scores]
        if values:
            case["score_components"].update(model_score=max(values), model_status="configured", model_notice="model rank score, not a probability")
    return run_id, payloads, graph_result.stats


def analyse_transactions(
    transactions: Iterable[Transaction],
    source_scenario_id: str = "csv-import",
    settings: Settings = DEFAULT_SETTINGS,
) -> tuple[str, list[dict[str, object]]]:
    """Backward-compatible API; detailed callers can also capture graph stats."""
    run_id, cases, _ = analyse_transactions_detailed(transactions, source_scenario_id, settings)
    return run_id, cases
