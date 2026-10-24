# TraceGuard — final coding handoff

**Problem:** Srujana Tech Fest 2026 · Finance F-01 · Financial Fraud and Transaction Risk Detection.  
**State:** Backend v0.4.0 plus a small, same-origin investigation UI, rule/graph analysis, synthetic scenarios, controlled synthetic benchmark reports and tests.

> **Honesty boundary:** No trained ML model is configured. The included controlled benchmark labels are generated from synthetic pattern templates aligned with the prototype rules. They are useful for regression tests and trade-off inspection, not evidence of performance on real fraud or Indian UPI. There is no bank connection, notification delivery or production security posture.

## Start here

1. Read `AGENTS.md`, then `PROJECT_SPEC.md` and `API_CONTRACT.md`.
2. Read `HANDOFF_STATE.md`, `BLUNT_RISK_REVIEW.md`, and `backend/docs/known_limitations.md`.
3. Extract the ZIP and open the entire root folder in Astra. Give it `ASTRA_MASTER_PROMPT.md`.
4. Astra must inspect current code and reports before changing anything. The UI already exists in `backend/traceguard/static/`; do not create a parallel frontend unless a specific gap justifies it.
5. Keep the ML model `not_configured` unless a real dataset, time-safe feature pipeline and held-out evaluation are completed and documented.

## Verify locally

From `backend/`:

```bash
python -m venv .venv
# Activate the environment for your shell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m compileall -q traceguard scripts tests
python scripts/replay_all.py
uvicorn traceguard.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/` for the workbench and `/docs` for the API. Windows activation and environment notes are in `backend/README.md`.

## What is included

- Strict CSV import validation and configured resource limits.
- Fourteen deterministic synthetic scenarios, including pass-through at 90 minutes, multi-sender collector, four-way split, repeated-value burst, directed cycle, layered chain, dormant reactivation, compound pattern, legitimate high-volume activity and insufficient history.
- Transparent behavioural/context rules; bounded, time-aware directed graph analysis; case grouping and evidence.
- SQLite case review workflow with outcome separation and per-case hash-chain verification (tamper-evident, not tamper-proof).
- Same-origin dashboard for scenario replay, case queue/detail, evidence/timeline/account graph, CSV import and human review.
- Controlled synthetic episode benchmark and 100k-row stress reports, with explicit limits.

## Residual limitations

No model is trained/configured; no representative Indian UPI dataset or real-world false-positive rate exists; no authentication/authorization; no external audit anchor; and no SMS/email/WhatsApp/webhook or bank/payment-rail integration. A real Chromium journey now passes; see `backend/docs/validation_run.md`. Rehearse on the teammate machine before presenting. Read `BLUNT_RISK_REVIEW.md` before presenting the system to judges.
