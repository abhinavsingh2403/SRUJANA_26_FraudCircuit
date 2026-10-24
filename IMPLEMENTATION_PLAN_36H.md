# TraceGuard — final 36-hour execution plan

The package already includes backend v0.4.0, a small same-origin workbench, a rule/graph engine, 14 synthetic scenarios and tests/benchmark reports. Do not start by creating a second frontend. The 36-hour plan below is a priority order, not a guarantee that every optional item will fit.

| Window | Work | Exit gate |
|---|---|---|
| Hours 0–2 | Pratham/Astra inspects package, reruns backend tests and starts the server; team initializes one shared repository. | App starts and tests pass or failures are documented. |
| Hours 2–6 | Run the UI manually through scenario replay, queue, case detail, graph/timeline, review and audit. Fix only real interaction/API bugs. | One complete workflow works using real API data. |
| Hours 6–10 | Test invalid CSV, empty queue, API unavailable, missing history, high-volume legitimate scenario and truncated outputs. Verify keyboard/layout states. | No known P0 bug; demo and error states are coherent. |
| Hours 10–16 | Review the synthetic benchmark and current rule trade-offs. Fix only justified defects; add regression tests; rerun controlled benchmark. | Results reproducible, limits explicit; no threshold changes made solely to flatter metrics. |
| Hours 16–24 | If a valid dataset is already accessible, review licence/provenance and point-in-time schema. Attempt one baseline/model only if the data path and evaluation can be completed. | Reproducible evaluation OR documented decision to leave model not configured. |
| Hours 24–30 | Run the 100k random and structured stress tests separately; review graph budget/incomplete warnings and service startup on a teammate's laptop. | Exact environment/time and stress interpretation documented; no generalization claims. |
| Hours 30–34 | Freeze features, update docs, verify links/source attribution, run tests and syntax checks, clean repository. | A fresh teammate can run the demo from instructions. |
| Hours 34–36 | Rehearse one-minute demo twice, prepare an offline backup recording, freeze archive/commit. | No unchecked code after final rehearsal. |

## Cut first if time shrinks

Cut animations, extra charts, new framework migration, a second model, hosted LLM explanations and deployment. Do not cut the working scenario-to-case flow, false-positive demonstration, input validation, tests or honest limitations.

## Controlled benchmark trade-off to explain

The current synthetic holdout contains 132 generated episodes (84 planted-pattern positives and 48 listed negatives). At the current operational cutoff of HIGH/MEDIUM as actionable, the held-out result is TP=72, FP=0, FN=12, TN=48; the 12 non-actionable positives are the planted 90-minute pass-through episodes that remain visible as LOW cases. Counting any case as a positive gives TP=84, FP=24, FN=0, TN=24. These are only results on hand-authored rule-aligned synthetic episodes—not real-world fraud rates or validated Indian UPI performance. Preserve that caveat in the presentation.
