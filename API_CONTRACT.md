# TraceGuard API contract — v0.4.0

**Base URL:** `http://127.0.0.1:8000` during local development. The running FastAPI app at `/openapi.json` is the machine-readable source of truth for request/response schemas. `/docs` provides interactive documentation.

The frontend must call these actual endpoints. Do not invent alternative routes or expect a response format that is not present in the running app.

## Endpoints

### `GET /health`

Current response shape:

```json
{
  "status": "ok",
  "service": "traceguard-backend",
  "model_status": "not_configured"
}
```

### `GET /api/scenarios`

Returns `{ "scenarios": [...] }`. Each scenario has `id`, `title`, `purpose`, and `expected`. The 14 bundled scenarios are synthetic demo fixtures, not ground-truth incident labels.

### `POST /api/scenarios/{scenario_id}/replay`

Optional JSON body:

```json
{"params":{"gap_scale":1.0,"amount_scale":1.0}}
```

Only `gap_scale` (0.05–100) and `amount_scale` (0.01–1000) are supported. Unknown parameters return HTTP 422. Unknown scenario ID returns 404. The response contains `scenario_id`, `run_id`, transaction/case counts, `expected_outcome`, `cases`, and a synthetic-data notice.

### `POST /api/scenarios/replay-all`

Runs all 14 deterministic synthetic scenarios and persists the resulting cases. The current fixture set contains 130 transaction rows. The current default rules produce 13 cases on a fresh database; this is a deterministic fixture result, not a fraud-detection metric.

### `POST /api/transactions/import`

Send raw UTF-8 CSV bytes as the request body (recommended header `Content-Type: text/csv`), not JSON-encoded text.

Required columns: `transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type`. Optional: `currency`.

The API returns `run_id`, `transaction_count`, `currency`, `case_count`, `cases_returned`, `cases_truncated`, `dropped_columns`, `warnings`, a bounded `cases` preview and a notice. Invalid input returns HTTP 422; a too-large request returns HTTP 413. There is no partial import. Default limits are 5 MiB, 100,000 rows and 128 columns. PaySim files are refused by this canonical endpoint and need a separately reviewed adapter.

### `GET /api/cases`

Query parameters:
- `priority`: `HIGH`, `MEDIUM`, `LOW`, `INSUFFICIENT_HISTORY`
- `status`: `OPEN`, `INVESTIGATING`, `ESCALATED`, `CLOSED`
- `scenario_id`, `run_id`
- `outcome`: `CONFIRMED_SUSPICIOUS`, `FALSE_POSITIVE`, `INCONCLUSIVE`
- `limit`: integer 1–500 (default 100)
- `offset`: integer >= 0 (default 0)

Returns `{ "count": <returned-row-count>, "total": <total-matching-count>, "offset": <offset>, "limit": <limit>, "cases": [...] }`. `count` is the number of records included in this response; `total` is the total number of cases matching the filter parameters in the database.

### `GET /api/cases/{case_id}`

Returns one case plus `review_history`. Relevant case fields:

- `case_id`, `run_id`, `source_scenario_id`
- `priority`, `status`, `review_outcome`
- `transaction_ids`, `context_transaction_ids`, `account_ids`
- `rule_codes`, `context_codes`, `evidence`
- `trigger_transactions`, `context_transactions`
- `score_components`, `summary`, `limitations`, `counts`, `truncation`

Evidence records include `evidence_id`, `rule_id`, `title`, `kind`, `description`, `trigger_transaction_id`, `transaction_ids`, `account_ids`, `observed`, and `caveats`.

Read `counts` and `truncation` because related transaction/account/evidence lists are intentionally bounded. `trigger_transaction_id` is the explicit trigger anchor; do not infer it by selecting the last item in `transaction_ids`.

### `PATCH /api/cases/{case_id}/review`

Example in-progress review:

```json
{"status":"INVESTIGATING","reviewer":"analyst","note":"Review connected sequence"}
```

Example closure:

```json
{"status":"CLOSED","outcome":"FALSE_POSITIVE","reviewer":"analyst","note":"Reviewed using available context"}
```

Allowed statuses: `OPEN`, `INVESTIGATING`, `ESCALATED`, `CLOSED`. Closing requires one explicit outcome: `CONFIRMED_SUSPICIOUS`, `FALSE_POSITIVE`, or `INCONCLUSIVE`. Outcome cannot be supplied while status is not `CLOSED`. Reviewer defaults to `analyst`; reviewer max is 100 chars and note max is 1000 chars. An outcome is human-entered and not independently verified by the system. Reopening a case clears the current outcome but leaves the review events in history.

### `GET /api/cases/{case_id}/audit`

Verifies the per-case SHA-256 review-event chain and returns `valid`, `event_count`, and related chain metadata. This is **tamper-evident, not tamper-proof**: no external trusted anchor is used.

### `GET /api/analytics/review-outcomes`

Returns counts for current human-reviewed case outcomes, with an explicit warning that the counts are not system-wide false-positive rate or fraud prevalence. Cases sent to investigation are a selected population.

### `GET /api/evaluation/summary`

Until a trained model and benchmark evaluation are genuinely integrated, expected fields include:

```json
{
  "model_status": "not_configured",
  "evaluation_status": "not_run",
  "metrics": null,
  "dataset": null
}
```

Do not fill these values with mocked or estimated results. Update the endpoint only after an actual training/evaluation workflow and saved artifact/metrics exist.

## Semantics the UI must preserve

- `HIGH` and `MEDIUM` are review-priority labels, not probabilities or verdicts.
- `INSUFFICIENT_HISTORY` is a coverage limitation and not a fraud rule.
- `RULE_SIGNAL`, `CONTEXT_SIGNAL` and `COVERAGE_LIMITATION` have different meanings.
- Context signals do not prove innocence and never automatically suppress risk signals.
- The API is unauthenticated and intended for local/trusted hackathon development only.

## Integration clarifications

Replay/import responses include `graph_summary` and `analysis_warnings`. `graph_analysis_incomplete=1` means at least one cycle/chain expansion budget was exhausted; absence of a graph alert is not a clean finding. Replay-all aggregates warnings and keeps per-scenario diagnostics in `results`. No endpoint or request shape changed during this integration.

`LOW` cases remain investigation leads. The exact existing priority/grouping policy is documented in `backend/docs/rule_policy.md` (or `rule_policy.md` from backend/docs). Context does not remove risk evidence but affects the routine-rule LOW branch. Case detail truncation and per-evidence observed truncation flags must both be inspected. Queue count is returned-row count, never total database count.
