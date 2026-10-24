# Implementation board — current package state

Mark a task done only after it has run/tested. Keep `HANDOFF_STATE.md` aligned with the board.

## P0 — Complete the current working UI path

- [x] Backend API and deterministic case pipeline exist.
- [x] Same-origin HTML/CSS/JavaScript workbench is served by FastAPI.
- [x] Scenario replay, case queue/detail, CSV import, review workflow, audit verification and evaluation status are wired in source.
- [x] API tests cover health, UI/static assets, CORS allowlist, replay, import, reviews and audit.
- [ ] Manually verify the complete workflow in a real browser on a teammate's machine.
- [ ] Verify responsive layout, keyboard focus, error states and no clipped/truncated evidence.
- [ ] Recheck demo on a clean DB/browser and record a backup video.

## P1 — Rule/graph and benchmark honesty

- [x] Fourteen deterministic synthetic fixtures cover reported adversarial patterns.
- [x] Time-aware bounded directed-cycle and layered-chain candidate detection included.
- [x] Multi-window pass-through, repeated-value burst and dormant-reactivation rules included.
- [x] Graph search budgets expose incomplete analysis.
- [x] Controlled synthetic benchmark with separate deterministic dev/holdout episode seeds is bundled.
- [x] 100k-row random-unlabelled and structured-payroll stress modes tested separately.
- [ ] Team must review benchmark assumptions and explain the all-cases versus actionable-case trade-off.

## P2 — ML only if it can be validated properly

- [ ] Verify dataset publisher, access terms/licence, exact schema and file hash.
- [ ] Build point-in-time features; exclude targets/flags/post-event leakage.
- [ ] Group all events from the same discrete timestamp step inside one split.
- [ ] Compare baseline with one model, choose threshold on validation only, report held-out metrics honestly.
- [ ] Integrate model only if inference uses the tested feature pipeline; otherwise keep `not_configured`.

## P3 — Finalize

- [ ] Run backend tests and JS check from a clean environment.
- [ ] Run a real-browser smoke flow if browser automation is available; otherwise manual verification must be recorded.
- [ ] Rebuild archive and hash manifest after changes.
- [ ] Rehearse one-minute demo using synthetic data only.
