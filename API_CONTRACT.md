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

Verifies the per-case SHA-256 review-event chain, transition continuity and agreement with current status/outcome in one SQLite read snapshot. Returns `valid`, `event_count`, `checked_at`, `current_status`, `current_outcome`, `warning`, and `status` (`verified`, `no_events`, `invalid`). Valid results include `head_hash`; failures include `reason` and `broken_at_event_id` (null for a state-level mismatch). `valid=true,status=no_events` means no contradiction was found, not that a decision history was verified. Missing cases return 404.

Damaged chains block new review writes with 422. Startup only hashes logs during migration from a schema without hash columns; it does not repair missing hashes in a modern schema. Reviewer names remain self-reported. Case evidence is outside the review chain. This is **tamper-evident, not tamper-proof**: a database owner can rewrite the entire chain or delete a tail without detection when the remaining state still agrees. No external trusted anchor is used.

### `GET /api/analytics/review-outcomes`

Returns counts for current human-reviewed case outcomes, with an explicit warning that the counts are not system-wide false-positive rate or fraud prevalence. Cases sent to investigation are a selected population.

### `GET /api/evaluation/summary`

Optional `source_kind=synthetic_fixture|uploaded_csv`; omitted means all stored cases, including legacy cases with unknown provenance. Invalid values return 422.

The response preserves `model_status`, `evaluation_status`, `metrics`, `dataset`, `message`, and `required_reporting` from the existing API. Optional model reports are separate from operational counts. No model training or dataset evaluation is performed here.

Additional fields:
- `generated_at`, `scope`.
- `cases`: `total`, `closed`, `priority_counts`, `status_counts`, `outcome_counts`, `review_completion_rate` (closed / total; null with no cases), `last_updated_at`.
- `runs`: `total`, `returned`, `limit` (25), `truncated`, `items` in descending completion order. Counts are unique analysis identities, not execution attempts.
- Each run includes source kind, input SHA-256, engine/settings SHA-256, actual settings, transaction/case counts, priorities, graph diagnostics, truncated-case count, input time bounds and analysis duration. Duration excludes explanation generation and database persistence. Input hashes are canonical transaction hashes, not original CSV-byte hashes.
- `active_policy`, `priority_policy`, `legacy_cases_without_run_metadata`, `limitations`.

Cases, traces and run metadata commit in one transaction. Zero-case runs are retained. Exact replay updates an existing run and preserves current reviews; changes to engine source or settings create distinct run/case identities. Existing cases are not silently relabelled or backfilled with invented run metadata. Source filters omit unknown-provenance legacy cases.

Run fingerprints include source implementation and settings, not optional ML artifact bytes. Engine source is fingerprinted once per process; restart after source edits. Metadata is not cryptographically signed. There are no accuracy or fraud prevalence claims based on these counts.

## Semantics the UI must preserve

- `HIGH` and `MEDIUM` are review-priority labels, not probabilities or verdicts.
- `INSUFFICIENT_HISTORY` is a coverage limitation and not a fraud rule.
- `RULE_SIGNAL`, `CONTEXT_SIGNAL` and `COVERAGE_LIMITATION` have different meanings.
- Context signals do not prove innocence and never automatically suppress risk signals.
- The API is unauthenticated and intended for local/trusted hackathon development only.

## Integration clarifications

Replay/import responses include `graph_summary` and `analysis_warnings`. `graph_analysis_incomplete=1` means at least one cycle/chain expansion budget was exhausted; absence of a graph alert is not a clean finding. Replay-all aggregates warnings and keeps per-scenario diagnostics in `results`. No endpoint or request shape changed during this integration.

`LOW` cases remain investigation leads. The exact existing priority/grouping policy is documented in `backend/docs/rule_policy.md` (or `rule_policy.md` from backend/docs). Context does not remove risk evidence but affects the routine-rule LOW branch. Case detail truncation and per-evidence observed truncation flags must both be inspected. Queue count is returned-row count, never total database count.

## Additive research and lab endpoints (25 October 2026)

All existing scenario/rule defaults are preserved. The live `/docs` page describes strict request schemas. Validation errors return 422; unknown case IDs return 404. All services remain unauthenticated local prototypes.

| Method and path | Request / behavior |
|---|---|
| POST `/api/simulate/parse` | `{text}`; 1–2000 characters, no control characters. Offline rules return editable `spec`, `method`, assumptions, warnings and extracted spans. |
| GET `/api/simulate/patterns` | Supported patterns, defaults and bounded JSON schema. |
| POST `/api/simulate/run` | `{spec, overrides:{gap_scale,amount_scale}}`; returns synthetic transactions, actual engine cases, trace, graph and timeline. Never persists. |
| POST `/api/simulate/sweep` | `{spec,parameter,values}`; at most ten values. Parameters: gap_scale, amount_scale, n_senders, onward_share. Returns actual priorities, rules and changes. |
| GET `/api/paysim/status` | Streaming local file validation, hash, recurrence and step range; explicit unavailable state without `PAYSIM_PATH`. |
| POST `/api/paysim/window/run` | `{start_step,end_step,lookback_steps:48,types:null,max_rows:10000,reveal_labels:false,overlay:null}`. Maximum 100,000 rows, whole timestamp buckets, six-hour graph gap profile. Optional overlay `{pattern:"PASS_THROUGH_CHAIN",at_step,params:{}}`. Labels remain absent unless revealed. No persistence. |
| POST `/api/triage/text` | `{text,case_id:null}`; advisory severity, method, extracted facts, missing information, quotes, optional agreement and notice. Does not change case priority. |
| GET `/api/triage/evaluation` | Saved family-held-out synthetic-template evaluation, or `not_run` with null metrics. |
| POST `/api/security-events` | One event or array of 1–200 events. Fields: event_id, timezone-aware timestamp, source, event_type, optional account_id, count, bounded details string. Exact duplicates ignored; conflicting IDs reject the entire batch. |
| GET `/api/security-events` | Filters event_type, account_id, timezone-aware since; limit 1–200 and offset 0–100000. |

Case detail additionally exposes `trace` and `related_security_events`. New imports/replays retain at most 20 trigger traces per case with a truncation flag, computed using full input history. Historical cases without stored traces report unavailable. Correlation uses retained accounts and trigger-time bounds ±1 hour, returns at most 200 events, and never changes priority. Truncated cases can omit relevant events.

Trace fired flags come from the actual rule and graph functions. Numeric gates expose observations and configured thresholds. A bar represents one gate, not the complete predicate. Graph searches do not retain unmatched candidate paths: graph near-miss observations are null, with explicit path constraints and budget diagnostics. This is a known limit, not evidence that a graph rule nearly fired. Non-finite diagnostic ratios are represented as null.

`/health` and `/api/evaluation/summary` report optional PaySim artifact status. If evaluated model artifacts exist, case `score_components.model_score` is the maximum retained-trigger model rank, never a calibrated probability or input to priority. Loading optional models requires `requirements-ml.txt`; absent/broken models do not block rule analysis. Only trusted local model files are supported.

## Step-by-step simulation

`POST /api/simulate/step` accepts exactly one of `scenario_id` (an ID from `/api/scenarios`) or `spec` (the existing hypothetical spec), plus optional `overrides` (`gap_scale`, `amount_scale`) and integer `step` (0–200). A step past the generated transaction count is rejected with 422. The response includes `step`, `total_steps`, `complete`, `current_transaction`, `graph`, `cases`, `run_id`, `graph_summary` and `notice`. Only the first `step` transactions sorted by timestamp and ID are analyzed; step zero is empty. No storage writes occur. Final fixture output matches the normal pipeline. Equal timestamps have a deterministic ID tie-break, not an asserted causal order.

JSON mutation bodies are limited to 256 KiB (413 on excess). Unapproved Origin headers on mutations return 403; same-origin and configured CORS origins remain permitted. This does not authenticate clients. The legacy `/api/realtime/seed` name remains compatible but imports sample files, not a real-time feed; status is `ok`, `partial`, or `error` with per-file results.
