# Continue prompt — resume TraceGuard after Astra handoff

Read `AGENTS.md`, `HANDOFF_STATE.md`, `PROJECT_SPEC.md`, `API_CONTRACT.md`, `IMPLEMENTATION_BOARD.md`, and the latest commit diff before editing. Do not restart the project or regenerate files wholesale.

1. Verify the current branch and clean/dirty working tree.
2. Run the exact tests/build listed in `HANDOFF_STATE.md`; record current output.
3. Continue the single next task written in `HANDOFF_STATE.md` and chosen from `IMPLEMENTATION_BOARD.md`.
4. Keep the actual backend API and frontend types aligned; make no undocumented route or schema changes.
5. Run relevant tests, then the full backend suite and frontend build.
6. Update `HANDOFF_STATE.md` and make a small commit before handing off again.

Do not claim an ML model is configured unless a trained artifact, reproducible evaluation results and runtime inference integration exist. Do not claim zero false positives, production readiness, bank connectivity or confirmed Indian UPI effectiveness.
