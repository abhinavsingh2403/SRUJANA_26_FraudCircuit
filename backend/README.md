# TraceGuard backend — 36-hour MVP foundation

**Purpose:** case-based transaction-risk triage with transparent evidence. This is a hackathon prototype, not a fraud verdict and not connected to banks or payment rails.

## What is implemented

- Strict canonical CSV import with size/row/field limits, duplicate-ID/header checks, timezone normalization, one-currency-per-import guard and label/flag/balance-field exclusion.
- Tie-safe, point-in-time transaction features: transactions sharing the exact timestamp are evaluated against the same prior history; no within-timestamp order is inferred.
- Transparent signals: pass-through, fan-in/collector/fan-out, amount deviation, time-ordered cycles and chains, repeated-value bursts, dormant reactivation, and a coverage-only insufficient-history cue.
- Non-suppressive context signals: stable amount context and repeated-counterparty context. They do not prove innocence or remove risk evidence; context affects the configured LOW-priority branch.
- Deterministic case grouping with a maximum span and bounded response payloads; truncation and total counts are explicit.
- Review priority follows the exact HIGH/MEDIUM/LOW/INSUFFICIENT_HISTORY policy in `docs/rule_policy.md`. LOW remains reviewable.
- SQLite case persistence and human review outcomes separated from workflow status.
- A per-case SHA-256 review-history hash chain that detects some stored-event edits/reordering. It is not a production-grade or externally anchored audit log.
- Scenario replay, import and case-review API, API tests, migration tests, evaluation helpers and synthetic fixtures.

**No trained ML model is included.** The evaluation endpoint explicitly returns `not_configured` and `not_run`; no benchmark performance is claimed. See `docs/model_card.md` and `docs/known_limitations.md`.

## Quick start

Python 3.11+ is required. The team should use one supported Python version and commit the resolved dependency environment for consistent setup. On Windows PowerShell:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python scripts/replay_all.py
python -m uvicorn traceguard.main:app --reload --host 127.0.0.1 --port 8000
```

If Python 3.13 is unavailable, use another installed Python version >=3.11. If shell activation is blocked, call `.venv\Scripts\python.exe` directly for pip and test commands.

On Linux/WSL:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python scripts/replay_all.py
python -m uvicorn traceguard.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/` for the workbench; `/docs` contains API documentation. Use a local DB path while developing, e.g. `TRACEGUARD_DB=/tmp/traceguard-dev.db` on Linux/macOS or `$env:TRACEGUARD_DB='C:\temp\traceguard.db'` in PowerShell.

## Quick API check

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/scenarios
curl -X POST http://127.0.0.1:8000/api/scenarios/replay-all
curl 'http://127.0.0.1:8000/api/cases?limit=20'
curl http://127.0.0.1:8000/api/evaluation/summary
```

The API is local development only. Do not expose it to the public internet.

## API overview

- `GET /health`
- `GET /api/scenarios`
- `POST /api/scenarios/{scenario_id}/replay` — optional body `{"params":{"gap_scale":1,"amount_scale":1}}`
- `POST /api/scenarios/replay-all`
- `POST /api/transactions/import` — raw UTF-8 CSV request body, `Content-Type: text/csv`
- `GET /api/cases?priority=&status=&scenario_id=&run_id=&outcome=&limit=&offset=`
- `GET /api/cases/{case_id}`
- `PATCH /api/cases/{case_id}/review`
- `GET /api/cases/{case_id}/audit`
- `GET /api/analytics/review-outcomes`
- `GET /api/evaluation/summary`

Exact schemas and caveats: `docs/api_contract.md`.

## Canonical CSV schema

Required columns:

`transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type`

Optional column: `currency` (one consistent three-letter code shape per import; the code is not checked against an external ISO registry). `timestamp` must be ISO-8601 with an explicit timezone. A single import is treated as one ledger and one currency. If no currency is provided, amounts are unit-unspecified. The importer does not perform FX conversion. Self-transfers are not supported by this prototype and are rejected. Unknown extra columns are ignored and reported; known labels, fraud flags and balance columns are excluded and reported. Imports are all-or-nothing on validation errors.

PaySim CSV is not directly accepted by the canonical importer. It requires an explicit, reviewed adapter because its `step` is simulated time and its label/flag/balance fields must not leak into the feature set. `scripts/check_paysim.py` inspects a locally obtained file's basic time-step properties; it does not train or evaluate a model.

## Scenarios

The 14 deterministic scenarios are declared in `traceguard/fixtures.py`:

| Scenario | Rows | Cases | Priorities |
|---|---:|---:|---|
| `rapid-pass-through` | 2 | 1 | LOW |
| `fan-in-dispersal` | 7 | 1 | MEDIUM |
| `legitimate-high-volume` | 15 | 0 | None |
| `legitimate-settlement-context` | 10 | 1 | LOW |
| `insufficient-history` | 26 | 1 | INSUFFICIENT_HISTORY |
| `delayed-pass-through-90m` | 2 | 1 | LOW |
| `fan-in-collector` | 8 | 1 | LOW |
| `single-inflow-four-way-split` | 5 | 1 | MEDIUM |
| `repeated-value-burst` | 20 | 1 | MEDIUM |
| `directed-cycle` | 3 | 1 | MEDIUM |
| `layered-chain` | 4 | 1 | MEDIUM |
| `dormant-reactivation` | 7 | 1 | MEDIUM |
| `compound-layered-cycle` | 14 | 1 | HIGH |
| `amount-deviation` | 7 | 1 | MEDIUM |

They are hand-authored synthetic fixtures. Expected outcomes are qualitative acceptance checks, not labels for real-world fraud prevalence or model efficacy.

## Design and safety boundaries

- Thresholds in `traceguard/config.py` are prototype heuristics, not calibrated banking limits.
- No trained ML model ships with this backend. `model_score` stays `null` until an evaluated model is integrated.
- Context signals never automatically suppress risk signals. An unusual pattern can be legitimate; human review outcomes are separate from machine priority.
- `HIGH`, `MEDIUM`, `LOW`, and `INSUFFICIENT_HISTORY` are review priorities, not calibrated fraud probabilities or proof.
- Feature calculations respect timestamp ties. They do not infer an order between transactions with the same timestamp.
- Case grouping has a time-span cap; related activity may therefore appear in more than one case. Bounded API fields include total counts and truncation flags.
- Review-log hashes are tamper-evident for in-chain changes but are not anchored externally. A database owner can still rewrite a complete chain or delete its tail.
- No authentication, authorization, tenancy, rate limit, or production security controls are implemented. Use synthetic data and a trusted local environment.

## Repository map

| Path | Responsibility |
|---|---|
| `traceguard/config.py` | Thresholds and resource limits |
| `traceguard/domain.py` | Typed records |
| `traceguard/ingestion.py` | Strict CSV parsing and field exclusions |
| `traceguard/features.py` | Point-in-time features |
| `traceguard/rules.py` | Rule and context evidence |
| `traceguard/cases.py` | Grouping, response bounds and priority policy |
| `traceguard/pipeline.py` | Detection orchestration |
| `traceguard/fixtures.py` | Deterministic synthetic scenarios |
| `traceguard/db.py` | SQLite persistence, reviews and hash-chain verification |
| `traceguard/startup.py` | Cross-platform environment pre-flight validator |
| `traceguard/__main__.py` | Module launcher entry point (`python -m traceguard`) |
| `traceguard/service.py` | Framework-independent application services |
| `traceguard/main.py` | FastAPI layer |
| `traceguard/evaluation.py` | Small metric and time-split helpers; not a model trainer |
| `tests/` | Unit, API, edge-case and migration tests |
| `docs/` | API, provenance, model card, validation and limitations |

## Before adding ML

1. Obtain a benchmark from its publisher and record version, license, provenance and preprocessing.
2. Choose the scoring point (pre-transaction or post-transaction) before designing predictors.
3. Group the same source time step entirely within a split. Use chronological train/validation/test data.
4. Exclude labels, existing flags and post-event features from inference. Inspect leakage risks rather than relying only on column names.
5. Report average precision/PR-AUC, precision, recall, false positives, precision at top K, the threshold and the test prevalence.
6. Test legitimate bursts, sparse history, duplicate/invalid inputs, data drift and no-positive/no-negative evaluation splits.
7. Never present synthetic benchmark performance as proven effectiveness on Indian UPI.

See `docs/data_provenance.md`, `docs/model_card.md`, `docs/known_limitations.md` and `docs/research_and_design_decisions.md`.

## Integration verification (24 October 2026)

From `backend/` after installing requirements:

```bash
python -m unittest discover -s tests -v
python -m compileall -q traceguard scripts tests
node --check traceguard/static/app.js
python scripts/check_startup.py
python scripts/replay_all.py
python scripts/verify_integration.py
python scripts/run_controlled_benchmark.py --output reports/controlled_benchmark_integration.json
python scripts/stress_100k_benign.py --rows 100000 --mode randomized-unlabeled --output reports/stress_100k_random_integration.json
python scripts/stress_100k_benign.py --rows 100000 --mode structured-payroll --output reports/stress_100k_structured_integration.json
```

Run the two stress commands separately. They measure synthetic pipeline execution, excluding generation and HTTP upload, and are not concurrent-user load tests.

Optional browser verification (Node required only for tests, not the application):

```bash
npm install --no-save playwright
npx playwright install chromium
python scripts/verify_integration.py --browser
```

The harness starts/stops its own loopback server with a fresh temporary database. Primary scenario/import/review/audit requests use the real API. Fault/race and forced incomplete-response tests explicitly intercept transport. `TRACEGUARD_CHROMIUM` can specify an existing Chromium executable; `NODE_PATH` can locate an externally installed Playwright. No browser binaries or node_modules ship in the archive.

Current evidence and initial failed attempts: `docs/validation_run.md`. Old reports are historical; use reports ending `_integration.json` for this source revision. Replaying refreshes matching case payloads but does not delete older cases that revised rules no longer generate. Use a new `TRACEGUARD_DB` path for a clean demonstration. No existing database is bundled.
