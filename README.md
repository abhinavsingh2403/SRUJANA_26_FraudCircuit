# TraceGuard — F-01 fraud investigation prototype

**Tagline:** See the pattern, not just the payment.

TraceGuard is a hackathon prototype for explaining and prioritising potentially suspicious transaction patterns. It is decision support—not a fraud verdict, not a bank-connected system, and not a production-ready risk engine.

## Current state

- Backend v0.4.0 is included and tested.
- Fourteen deterministic synthetic scenarios exercise selected rules and edge cases.
- API provides replay, CSV import, case investigation, human review, review-audit verification and honest model/evaluation status.
- The current model status is `not_configured`; no fraud performance metrics are claimed.
- A dependency-free HTML/CSS/JavaScript investigation UI is served by FastAPI. A trained/validated ML model is not included.
- A dedicated `frontend/` folder provides the standalone frontend workspace with Vite dev server and proxy support.

## Repository structure

- `backend/`: FastAPI backend, transaction ingestion, graph analysis, review log and comprehensive test suite.
- `frontend/`: Dedicated frontend workspace with modern lemon/dark investigation UI, Vite dev server and proxy support.
- `references/`: Srujana problem statement, rubric and background resources.

1. Read [`AGENTS.md`](AGENTS.md).
2. Read [`PROJECT_SPEC.md`](PROJECT_SPEC.md) and [`API_CONTRACT.md`](API_CONTRACT.md).
3. Read [`ASTRA_MASTER_PROMPT.md`](ASTRA_MASTER_PROMPT.md), then open this whole folder as Astra's workspace. Astra should audit the included UI and implementation, fix any acceptance gaps, and only add ML if it can be properly evaluated in time.
4. Read [`HANDOFF_STATE.md`](HANDOFF_STATE.md) and [`BLUNT_RISK_REVIEW.md`](BLUNT_RISK_REVIEW.md) before changing scope.

## Verify the backend

```bash
cd backend
python -m venv .venv
# Activate .venv for your shell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m compileall -q traceguard scripts tests
python scripts/replay_all.py
python -m uvicorn traceguard.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/` for the UI (`/docs` for API documentation). See [`backend/README.md`](backend/README.md) for Windows activation, environment and API details.

## Important limitations

The bundled scenarios are hand-authored synthetic fixtures. Rules and graph motifs are demonstration heuristics; a controlled synthetic episode benchmark is included for limited regression/coverage testing, not proof of real-world effectiveness. No trained model, representative Indian UPI dataset, real-time bank feed, notification delivery, authentication/authorization, production deployment approval, or zero-false-positive guarantee is included. Read [`BLUNT_RISK_REVIEW.md`](BLUNT_RISK_REVIEW.md) for the residual-risk register and [`RESEARCH_SOURCES.md`](RESEARCH_SOURCES.md) for source links and boundaries.

## Final integration update — 24 October 2026

The existing UI and API have been hardened in place. Reverse/simultaneous internal chain hops are rejected; LOW summaries no longer invent supporting context. UI requests reject stale responses, clear stale review forms on failures, preserve warnings/audit results, disclose truncation, and send CSV bytes unchanged.

Use `backend/README.md` for startup and acceptance commands. Read `HANDOFF_STATE.md` and `backend/docs/validation_run.md` for actual results, changed files and remaining risks. Current reports end in `_integration.json`; earlier reports are preserved as historical evidence. ML is still `not_configured`.
