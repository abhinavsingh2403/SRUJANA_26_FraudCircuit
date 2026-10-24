# Agent instructions — TraceGuard

These instructions apply to Astra, Antigravity agents and human contributors.

## Sources of truth

1. The original F-01 problem statement and Srujana rubric are in `references/`.
2. `PROJECT_SPEC.md` defines desired behaviour.
3. `API_CONTRACT.md` and `backend/docs/api_contract.md` describe the running backend API. If they ever disagree, inspect `backend/traceguard/main.py` and run the tests, then reconcile all docs/types/tests in one change.
4. Actual code and actual command output outrank assumptions in earlier chat or older files.
5. `RESEARCH_SOURCES.md` separates verified source claims from design decisions and limitations.

Do not silently reconcile conflicts. Record decisions in `DECISIONS.md` with the reason and affected files.

## Never do these things

- Do not claim an endpoint, model, notification, bank connection or feature exists unless you can point to the implementation and test it.
- Do not invent model metrics or claim that synthetic-data metrics prove Indian UPI performance.
- Do not label a person/account as fraudulent. A case is an investigation lead, not proof.
- Do not use target labels, existing fraud flags or post-event balance fields as model predictors.
- Do not add more frameworks or infrastructure just because an agent suggests them.
- Do not rewrite working backend code to match an invented frontend API. Update the real backend, API contract, types and tests together only when a requirements-based change is justified.
- Do not replace useful interactive features with mock buttons, placeholder charts or fake responses.
- Do not install or wire paid services or secrets without an explicit reason.
- Do not expose the unauthenticated development API to the public internet.

## Required process for every task

1. Read the relevant files first.
2. State the smallest concrete task to be done internally and edit only relevant files.
3. Run the smallest related tests while iterating.
4. Run all backend tests after a backend/API change.
5. Run frontend lint/tests/build after a frontend change.
6. Inspect `git diff` and check for unintentional file rewrites or secrets.
7. Update `HANDOFF_STATE.md` with files changed, commands actually run, results, remaining issues and the next exact task.
8. Make a small Git commit before switching owners or reaching an agent usage limit.

A test that was not run must be marked “not run,” not “passed.”

## Product design constraints

- Build for a fraud analyst reviewing linked transactions, not for a consumer trying to find out if their own payment is fraudulent.
- Priority (`HIGH`, `MEDIUM`, `INSUFFICIENT_HISTORY`) is a review ordering, not a probability or verdict.
- Separate `RULE_SIGNAL`, `CONTEXT_SIGNAL` and `COVERAGE_LIMITATION` evidence.
- Context signals never suppress risk signals automatically.
- Display truncation counts and limitations from the API.
- Human review outcome (`CONFIRMED_SUSPICIOUS`, `FALSE_POSITIVE`, `INCONCLUSIVE`) is separate from workflow status (`OPEN`, `INVESTIGATING`, `ESCALATED`, `CLOSED`).
- The model score remains null/not configured until a real evaluated model is integrated.

## 36-hour priority order

P0: reliable frontend ↔ backend vertical slice.
P1: excellent case investigation UX, CSV import and edge handling.
P2: optional benchmark model only after verifying data provenance/licence and point-in-time features.
P3: robustness, docs, demo recording and rehearsals.

If time becomes short, cut optional ML/visual polish before cutting test coverage, honest disclosures or the working demo.
