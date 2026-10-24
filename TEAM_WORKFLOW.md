# Three-person workflow: Pratham, Abhinav and Prasoon

## Phase 1 — Astra-first (no parallel rewrites)

**Pratham starts the shared repository and gives Astra `ASTRA_MASTER_PROMPT.md`.** For the first integrated vertical slice, do not let all three agents scaffold competing frontends or rewrite backend modules. They should all work in the same Git repository, not exchange ZIP snapshots.

While Astra is working:
- **Abhinav:** review rule semantics, inspect dataset provenance and prepare the legitimate/high-risk/insufficient-history test scenarios. Do not introduce model claims without evaluation.
- **Prasoon:** review UI requirements and case/evidence fields in `API_CONTRACT.md`; prepare the dashboard visual plan, but do not create a parallel codebase.
- **Pratham:** own Astra orchestration, integration, test results, commits and `HANDOFF_STATE.md`.

## Phase 2 — after Astra's usage/context limit or a stable MVP checkpoint

Assign ownership of files/modules, not entire independent products:

- **Abhinav — detection and data/ML:** behavioural rules, feature correctness, benchmark provenance, model training/evaluation and false-positive validation.
- **Prasoon — frontend:** investigation queue, detail page, graph/timeline, import UI, review actions, responsive behavior and frontend tests.
- **Pratham — integration/release:** API and DB integrity, contract review, integration fixes, final startup scripts, end-to-end smoke tests, README, final demo and repository freeze.

Each person can use Astra/Antigravity to code their assigned module. Keep a single shared main branch and use small feature branches (e.g. `feat/investigation-ui`, `feat/model-evaluation`, `fix/api-integration`). No two agents edit the same files simultaneously.

## Merge protocol

1. Before starting a task, pull latest `main` and read `HANDOFF_STATE.md`.
2. Confirm owned files and relevant acceptance criteria in `IMPLEMENTATION_BOARD.md`.
3. Make a small change; run focused tests.
4. Review the diff for unrelated edits, invented data or secrets.
5. Merge only after the backend tests and applicable frontend tests/build pass.
6. At each handoff, update `HANDOFF_STATE.md` with exact command/results, changed files, known issues and next task.

## Rules

- One shared repository; no copying whole folders between laptops after work starts.
- Keep `PROJECT_SPEC.md` and `API_CONTRACT.md` canonical. If implementation changes, update them in the same PR.
- Never report a test passed if it was not run in the actual current environment.
- Do not claim the demo talks to banks, Indian UPI or the I4C/RBIH Suspect Registry.
