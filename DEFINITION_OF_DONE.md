# Definition of done — demo-ready TraceGuard

## P0 — Required for any demo

- [ ] Backend runs on a clean environment using documented commands.
- [ ] Existing backend tests pass, or any current failures have a precise documented cause and have not been hidden.
- [ ] Frontend runs and uses the actual backend endpoints for the main workflow.
- [ ] A judge can trigger scenario replay and see actual returned cases.
- [ ] Case details display trigger transactions, context transactions, evidence, caveats and limitations.
- [ ] Connected-account graph edges correspond to real transactions shown in the case; truncation is visible.
- [ ] At least one legitimate high-volume scenario does not create a case under the configured rules.
- [ ] Insufficient history is labelled as a coverage limitation, not fraud.
- [ ] Reviewer status changes work. Closing requires a human outcome. Review history/audit is visible.
- [ ] Invalid CSV and API errors are shown clearly; the UI does not show success on failure.
- [ ] Model status/metrics are truthful. No mock metric charts or invented percentages.
- [ ] Demo can run offline after dependencies/data are installed.

## P1 — Strongly recommended

- [ ] Time-aware benchmark evaluation is reproducible and has no known label/flag/post-event leakage.
- [ ] The model is only connected to the API if the artifact and held-out evaluation are real; otherwise it remains explicitly unconfigured.
- [ ] Tests cover duplicate headers/IDs, too many columns/rows, oversized CSV, nonfinite/invalid amount, timezone errors, equal timestamp ties, bounded case output, case-span split, review closure/outcome rules, review-chain tamper detection and time-split edge cases.
- [ ] Fresh setup is verified on a teammate's machine.
- [ ] README, provenance, model card/known limitations and architecture are accurate.

## P2 — Finish/presentation

- [ ] One-minute demo is recorded and reproducible.
- [ ] A legitimate-but-unusual scenario is shown next to a suspicious candidate.
- [ ] One controlled change demonstrates how the evidence/priority changes.
- [ ] Repository contains only necessary files; no database, virtual environment, private data or secrets.
- [ ] All third-party code, assets and datasets are attributed and usage terms were checked.

Checking every box establishes demo readiness only; it does not establish production readiness or fraud-detection effectiveness on real Indian transactions.
