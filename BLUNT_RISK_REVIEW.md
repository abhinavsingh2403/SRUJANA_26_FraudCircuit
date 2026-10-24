# Blunt risk review — do not call TraceGuard perfect

This is a hardened hackathon prototype, not a bank-grade fraud engine. In the recorded environment, 96 automated tests pass, the core API paths are exercised, a same-origin workbench exists, and 100k-row synthetic stress scripts completed. Those facts do not prove zero bugs, real-world detection effectiveness, production security or zero false positives.

## Current state

- Backend v0.4.0 and a dependency-free same-origin HTML/CSS/JavaScript workbench are included.
- No trained/validated ML model ships with the package. Evaluation API deliberately returns `model_status=not_configured`, `evaluation_status=not_run`, `metrics=null`.
- Detection uses transparent heuristics and bounded graph/sequence candidate analysis; review priorities are operational levels, not calibrated fraud probabilities.
- Controlled synthetic benchmark and two 100k-row stress reports are provided with their limitations.

## Key residual risks

| Risk | Current treatment | Remaining limitation |
|---|---|---|
| False positives | Context evidence, low-priority review cases, constructed benign fixtures and a separate actionable cutoff. | Synthetic benchmark still yields 24 false positive `any-case` outcomes among 48 constructed negative episodes (FPR 0.5); the selected HIGH/MEDIUM cutoff yields 0 FPs on this small generated set but misses 12/84 generated positive episodes. These are not real-world rates; labels and rules share a constructed design. |
| Missed fraud | Pass-through windows, fan-in/dispersal, repeated-value bursts, time-aware cycles, layered chains, dormant reactivation and amount deviation. | Real fraud typologies and account behaviours extend far beyond these rules. No real-world recall estimate exists. |
| Model validity | No model metrics are returned until a model is implemented and evaluated. | No trained model, calibrated probability or representative Indian UPI dataset is provided. |
| Correlated signals | HIGH requires multiple rule types across distinct trigger transactions, including key flow/cycle/chain signals per policy. | Rules may still reflect the same underlying behaviour and are not statistically independent evidence. |
| Coarse timestamps | Ties are treated as simultaneous; no invented event order within identical timestamps. Temporal cycle/chain detection checks chronology. | Data such as PaySim `step` cannot reveal within-step ordering; some patterns cannot be resolved from coarse timestamps. |
| Graph search | Bounded graph search, explicit budget/incomplete stats, maximum case span and response truncation metadata. | A bounded search may not find all possible paths/cycles in dense graphs. Call it bounded graph analysis, not exhaustive graph discovery. |
| 100k-row performance | 100k randomized-unlabelled input: 46.314 s; 100k structured-payroll input: 26.496 s; no graph budget exhaustion in recorded runs. | Environment-specific single runs, not a repeatable SLA, throughput guarantee or proof for other graph shapes. The random input is unlabelled, so case count is not a false-positive count. |
| CSV abuse/data handling | Byte, row, field, column, duplicate/header, timezone, currency, numeric, label/flag/balance-column and self-transfer validation. | Unknown sensitive data columns may still be uploaded; unknown columns are ignored/reported, not a comprehensive DLP system. Keep synthetic data for the demo. |
| Currency and amounts | One currency per import and positive finite bounded amounts. | Float calculations are for risk screening, not settlement/accounting. No FX conversion or external currency-code registry validation. |
| Review labels | Workflow status distinct from human-entered outcome. | The system cannot independently verify analyst decisions; outcome analytics are selection-biased and not a system false-positive rate. |
| Audit integrity | Per-case SHA-256 review-history chain detects in-chain edits/reordering. | Not immutable or forensic-grade: database owner can rewrite the whole chain or delete its tail without an external anchor/signature. |
| API security | Validation and request-size bounds; local CORS allowlist; parameterized SQLite operations. | No authentication/authorization, tenant isolation, rate limiting, deployment hardening, external security audit or certification. Bind locally and do not expose publicly. |
| Notification and operations | Cases are returned/stored via the API and visible in the local UI. | No real-time bank feed, email/SMS/WhatsApp/webhook delivery, government registry or payment-rail integration. |
| UI | Included same-origin dependency-free workbench passed a Chromium 153 journey, HTTP/static and API tests; see current integration reports. | Full manual browser accessibility/responsive/layout verification is still required on the team's machine. |

## Synthetic benchmark — exact interpretation

The bundled controlled benchmark uses 132 generated episodes (84 rule-aligned positive templates and 48 benign/hard-negative templates) with a separate deterministic generator seed for holdout. At the chosen actionable cutoff (HIGH/MEDIUM): TP=72, FN=12, FP=0, TN=48; precision=1.0, recall=0.8571. When any case including LOW is counted as an alert: TP=84, FN=0, FP=24, TN=24; precision=0.7778 and false-positive rate=0.5. Because the synthetic positive labels are generated from pattern templates intentionally related to the implemented rule catalogue, these results measure fixture/logic coverage and the consequence of the operational cutoff. They do **not** establish real-world performance, and must not be pitched as such.

## Data and claims

- PaySim is synthetic mobile-money data, not Indian UPI transaction ground truth. Its simulator-specific fields require a reviewed adapter; do not feed its labels/flags/balances into model features.
- The 100k random stress has no labels. Its cases cannot be called false positives.
- A pattern can be suspicious and legitimate; rule match is not proof of fraud.

## Allowed pitch

“TraceGuard is a prototype that prioritises and explains potentially suspicious transaction sequences using transparent rules and bounded connected-account analysis. Its synthetic benchmark tests known scenarios; real-world Indian payment effectiveness has not been established. ML remains unconfigured until independently evaluated.”

Do not claim “zero false positives,” “detects all fraud,” “bank-grade,” “real-time Indian UPI protection,” “government registry integrated,” “immutable audit,” or any accuracy/recall/precision on real-world data.

## Required before production (out of scope for 36-hour hackathon)

Representative institution-specific data, approved integration and governance, independent model validation/calibration and subgroup testing, authentication and authorization, privacy/retention controls, rate limiting, external audit anchoring, monitoring and drift response, incident handling, recovery/throughput tests and risk-operations approval.

## Integration-specific residuals

The R5 chronology fix reduced random-stress chain candidates from 117 to 52; the one MEDIUM case remains. Older reports are historical. No thresholds were tuned. Some per-rule supporting lists are capped before case assembly; case-level totals are totals of assembled references, not a complete ledger. Existing per-evidence truncation flags are displayed, but not every rule exposes a separate support-total field. Dense single-account imports can be slower than these two generators: the expansion budget does not bound every adjacency scan or feature-history traversal. UI queue supports pagination beyond 100 matching cases via limit/offset controls; API supports up to 500 per page. Review-history length is not paginated. Concurrent multi-user, accessibility audit, security audit and teammate setup were not performed. Browser tests cover injected transport faults separately from the real API path.
