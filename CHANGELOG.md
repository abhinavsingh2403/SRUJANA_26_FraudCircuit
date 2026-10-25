## 25 October 2026 — live evaluation and integrity corrections

- Replace fixed evaluation claims with source-filtered database counts, run provenance, real limits and JSON exports.
- Check review hashes/transitions/current state; never auto-rehash a damaged modern chain; reject appends to damaged logs.
- Version analysis identities by engine/settings; preserve review state on replay; atomically persist cases/traces/run metadata.
- Centralize priority policy and fan-in threshold, retain accurate trace truncation totals, and preserve currency during fixture scaling.
- 125 backend tests plus HTTP, analyst/research/evaluation browser checks passed. ML dataset work unchanged.

# Research integration — 25 October 2026

- Preserved all 14 original scenario outputs; added isolated deterministic simulation, full-input feature traces with bounded persistence, PaySim streaming/window adapters, advisory text triage and local-lab security telemetry.
- Added an offline research page without replacing the lemon workbench.
- Fixed hardcoded port-8000 API routing, stale unrelated cases after zero-case replay, stale detail while importing, and missing JS in the static build output.
- Added regression tests, synthetic family-held-out triage evaluation, chronological toy model smoke test, guarded lab sequence and observed input-limit checks.
- No real PaySim evaluation or live LLM evaluation; optional advanced graph near-miss visualization and gradient boosting remain unimplemented.

# Changelog

## 2026-10-24 — Final acceptance hardening, pagination, and release packaging

- Added queue pagination support for queries exceeding 100 cases (`offset` and `total` added to `db.list_cases` and `GET /api/cases`; UI renders previous/next page navigation).
- Added run-scoped results view toggle ("Latest run" / "All cases") so zero-case replays and imports don't leave unrelated older cases on screen.
- Added cross-platform pre-flight startup checker (`traceguard/startup.py`, `traceguard/__main__.py`, and `scripts/check_startup.py`) verifying Python version, static asset paths, database writability, and scenario readiness from any working directory.
- Fixed R3 amount-deviation supporting transaction citations to reference the 30-day account baseline rather than the 24-hour window, and added explicit `supporting_ids_truncated` truncation flags.
- Expanded backend test suite from 91 to 96 tests covering pagination, zero-case run scoping, R3 baseline references with and without truncation, and cross-platform pre-flight checks.
- Browser journey tests updated to include zero-case replay and a 105-case pagination run.
- Completed and recorded two independent 100,000-row stress runs: randomized-unlabeled (46.314s, 1 MEDIUM case, 52 chains) and structured-payroll (26.496s, 0 cases, 0 budget exhaustion).
- Controlled benchmark metrics confirmed unchanged (Actionable: TP 72, FN 12, FP 0, TN 48, precision 1.0, recall 0.857; Any-case: TP 84, FN 0, FP 24, TN 24).
- Packaged clean release archive with verified SHA-256 sums and tested clean extraction.

## 2026-10-24 — Final integration and chronology hardening

- Fixed R5 reverse/simultaneous internal hops; added failing-before regressions. LOW summaries no longer assert nonexistent supporting context. Existing thresholds and priority decisions unchanged.
- Kept same-origin static UI: guarded late requests, cleared stale forms/metrics on failures, persisted run and audit warnings, surfaced truncation independently of transaction arrays, retained CSV bytes, added control labels/keyboard import and queue-cap notice.
- Added real-loopback HTTP and optional Playwright acceptance harnesses; 91 unit/API tests and 13 browser acceptance groups pass. Reran benchmark and both 100k modes separately. Added static wheel package-data and verified built wheel assets.
- Reconciled current rule/priority/grouping docs, README and handoff. Archived earlier reports remain historical. See `backend/docs/validation_run.md` for failed attempts, environment, exact results and remaining limitations.


## v0.4.0 — hardened F-01 prototype + local investigation UI (24 October 2026)

- Added a dependency-free same-origin HTML/CSS/JavaScript workbench served by FastAPI, to reduce build/integration risk inside the 36-hour plan.
- Added controlled synthetic episode benchmark script/report with separate dev and held-out generator seeds; report clearly states labels align with synthetic pattern templates and are not real fraud labels.
- Added current 100k-row performance reports for randomized unlabeled transactions and structured regular payouts, with the generator and limitations recorded.
- Added detection/graph coverage for 90-minute pass-through via 6-hour/24-hour windows, fan-in collector, four-way fan-out, repeated-value burst, time-ordered directed cycle, layered chain and dormant reactivation.
- Bounded graph search; impossible temporal cycles are not reported; graph-search budget exhaustion is surfaced.
- Strengthened HIGH review priority to require different risk rule types across distinct trigger transactions. This remains a heuristic priority policy, not a calibrated fraud probability.
- Added CORS allowlist for optional local Vite development while the shipped demo uses same-origin assets.
- Expanded test suite to 89 tests in this validation environment.

## Still not included / not proven

- No trained/validated ML model, representative Indian UPI dataset or real-world fraud performance.
- No true false-positive/false-negative rates on real transactions. The synthetic benchmark is a limited logic/threshold regression check.
- No bank/UPI integration, government registry access, real notification delivery, authentication/authorization or production security certification.
- Full browser automation journey has not yet been recorded; verify on the team's machine.

The changelog is a record of implementation state, not a claim of fraud-detection efficacy or production readiness.
