"""Application services; deliberately independent of FastAPI."""
from __future__ import annotations

from typing import Any
from time import perf_counter
import json

from . import db
from .config import DEFAULT_SETTINGS, Settings
from .fixtures import SCENARIOS, apply_scenario_params, scenario_transactions
from .ingestion import parse_csv_bytes
from .pipeline import analyse_transactions_detailed


def list_scenarios() -> list[dict[str, str]]:
    return [{"id": key, **value} for key, value in SCENARIOS.items()]


def _analysis_warnings(graph_summary: dict[str, int]) -> list[str]:
    """Translate bounded graph-search diagnostics into an explicit user warning."""
    if not graph_summary.get("graph_analysis_incomplete", 0):
        return []
    cycles = graph_summary.get("cycle_search_budget_exhausted", 0)
    chains = graph_summary.get("chain_search_budget_exhausted", 0)
    return [
        "Bounded graph analysis reached its per-event expansion limit "
        f"({cycles} cycle search(es), {chains} chain search(es)). "
        "Some graph motifs may have been missed; absence of a graph alert is not evidence of clean activity."
    ]


def _persist(run_id, source, txs, cases, graph, settings, started):
    from .security import save_traces, prepare_traces
    from .provenance import run_record
    record = run_record(run_id, source, txs, cases, graph, settings, (perf_counter()-started)*1000)
    traces = prepare_traces(cases, txs, settings)
    with db._connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        db.upsert_cases(cases, connection=conn)
        current = {r['case_id']: r for r in conn.execute("SELECT case_id, status, review_outcome FROM cases WHERE run_id=?", (run_id,))}
        for case in cases:
            case['status'] = current[case['case_id']]['status']
            case['review_outcome'] = current[case['case_id']]['review_outcome']
        save_traces(cases, txs, settings, connection=conn, prepared=traces)
        conn.execute("INSERT INTO analysis_runs VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET completed_at=excluded.completed_at, payload=excluded.payload",
                     (run_id, record['source_kind'], record['completed_at'], json.dumps(record, allow_nan=False)))


def replay_scenario(scenario_id: str, params: dict[str, float] | None = None,
                    settings: Settings = DEFAULT_SETTINGS) -> dict[str, Any]:
    if scenario_id not in SCENARIOS:
        raise KeyError(scenario_id)
    txs = apply_scenario_params(scenario_transactions(scenario_id), params)
    started = perf_counter()
    run_id, cases, graph_summary = analyse_transactions_detailed(txs, scenario_id, settings)
    _persist(run_id, scenario_id, txs, cases, graph_summary, settings, started)
    return {
        "scenario_id": scenario_id,
        "run_id": run_id,
        "transaction_count": len(txs),
        "case_count": len(cases),
        "graph_summary": graph_summary,
        "analysis_warnings": _analysis_warnings(graph_summary),
        "expected_outcome": SCENARIOS[scenario_id]["expected"],
        "cases": cases,
        "notice": "Synthetic fixture; outcome is not evidence of real-world model performance.",
    }


def replay_all(settings: Settings = DEFAULT_SETTINGS) -> dict[str, Any]:
    results = [replay_scenario(scenario_id, settings=settings) for scenario_id in SCENARIOS]
    all_cases = [case for result in results for case in result["cases"]]
    return {
        "scenario_count": len(results),
        "transaction_count": sum(result["transaction_count"] for result in results),
        "case_count": len(all_cases),
        "results": results,
        "cases": all_cases,
        "analysis_warnings": sorted({warning for result in results for warning in result["analysis_warnings"]}),
        "notice": "All scenarios are deterministic synthetic fixtures, not real incidents.",
    }


def import_csv(raw: bytes, settings: Settings = DEFAULT_SETTINGS) -> dict[str, Any]:
    ingestion = parse_csv_bytes(raw, settings)
    started = perf_counter()
    run_id, cases, graph_summary = analyse_transactions_detailed(ingestion.transactions, "csv-import", settings)
    _persist(run_id, "csv-import", ingestion.transactions, cases, graph_summary, settings, started)
    preview_limit = settings.response_case_preview_limit
    return {
        "run_id": run_id,
        "transaction_count": ingestion.row_count,
        "currency": ingestion.currency,
        "case_count": len(cases),
        "graph_summary": graph_summary,
        "cases_returned": min(len(cases), preview_limit),
        "cases_truncated": len(cases) > preview_limit,
        "dropped_columns": ingestion.dropped_columns,
        "warnings": ingestion.warnings,
        "analysis_warnings": _analysis_warnings(graph_summary),
        "cases": cases[:preview_limit],
        "notice": "Uploaded CSV is treated as one ledger and, if supplied, one currency. No fraud labels are used by the runtime rules.",
    }
