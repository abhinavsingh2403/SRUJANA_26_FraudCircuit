# Astra master prompt — TraceGuard final integration and hardening

You are continuing an existing project. **Do not regenerate it from scratch and do not return only a plan.** Inspect the supplied code and reports; then fix real acceptance gaps in priority order.

## Required first actions

1. Read `AGENTS.md`, `PROJECT_SPEC.md`, `API_CONTRACT.md`, `DEFINITION_OF_DONE.md`, `HANDOFF_STATE.md`, `BLUNT_RISK_REVIEW.md` and `backend/README.md`.
2. Inspect the source in `backend/traceguard/`, the existing UI in `backend/traceguard/static/`, and the reports in `backend/reports/`. Documentation can be stale; actual code and command results are the authority.
3. From `backend/`, run `python -m unittest discover -s tests -v`, `python -m compileall -q traceguard scripts tests`, and `python scripts/replay_all.py`.
4. Start FastAPI and verify `/`, `/static/app.js`, `/health`, `/api/scenarios`, `/api/scenarios/replay-all`, `/api/cases`, `/api/evaluation/summary`, CSV error handling, review status update and audit verification.
5. Run `node --check traceguard/static/app.js` if Node is available. If browser automation is available, add/run one end-to-end browser journey. Do not claim a browser test passed unless it actually ran.
6. Report actual failures before attempting broad changes.

## Current intended scope

The project currently has a dependency-free same-origin HTML/CSS/JavaScript UI. **Extend that UI before considering a React/Vite rewrite.** A second frontend would add integration risk within 36 hours. Preserve the backend contract unless a real requirement needs a change.

Primary path:
1. Replay a controlled synthetic scenario.
2. Show generated cases in the queue.
3. Open case detail with trigger/context transactions, supporting evidence, caveats, connected account relationships and truncation/limitations.
4. Update review status/outcome.
5. Verify the case's review hash chain and explain its security limits.

The UI must call the actual API, not mock the primary workflow. All imported field values must be inserted as text, not executable HTML. Keep the app same-origin for the local demo.

## Priorities

P0: Fix any real UI/API contract mismatch and make the complete demo reproducible. Test API unavailable, malformed CSV, empty case queue and truncated evidence states.
P1: Review the current 14 scenarios and graph/rule behavior. Keep rules explainable, prevent impossible-time cycles, preserve individual repeated transactions, and surface graph-search budget exhaustion as an incomplete-analysis warning.
P2: Review the controlled benchmark's known trade-offs. In its current synthetic holdout, LOW cases include hard-negative merchant settlement and routine P2P patterns; a 90-minute pass-through is visible as LOW rather than actionable. Do not tune thresholds merely to improve a synthetic score. Any change must preserve separate dev/holdout design and add regression tests.
P3: Only attempt ML if data provenance/licence, schema, point-in-time features, chronological splitting and a meaningful held-out test can be completed. No feature leakage from labels, existing flags or future/post-event fields. If the model cannot be evaluated, leave `model_status=not_configured`.

## Never claim

- That synthetic benchmark metrics represent real Indian UPI performance.
- That a rule match proves fraud or that a LOW case is benign.
- Zero false positives, complete fraud coverage, bank integration, I4C/RBIH Suspect Registry access, immutable audit history or production readiness.
- That a test, browser journey or load test passed if it did not run.

## Before handoff

Run the complete backend tests after any API/rule change, check JS syntax, rerun controlled benchmark if rules changed, and include the 100k stress modes separately (the random and structured modes are run separately because a combined tool run previously timed out). Keep each report's data generator and limitations. Update `HANDOFF_STATE.md`, `CHANGELOG.md` and README to match actual code. Record commands/results, changed files, known risks and one next task. Do not fabricate a Git commit hash; the repository may be initialized by the team.
