# Current rules and priority policy

- `HIGH`: at least three distinct risk-rule types across at least four trigger transactions, with linked structural and corroborating evidence sharing at least two transaction IDs and two accounts, plus R6 or R7. Structural rules are R4/R5/R6; corroborating rules are R1/R2/R3/R7.
- `LOW`: R1 alone; or only R2/R2A/R2B signals with at least one C1/C2/C3 context item. These cases remain visible; LOW is not evidence of benign activity.
- `MEDIUM`: other cases with at least one configured risk signal.
- `INSUFFICIENT_HISTORY`: coverage-only cases. Context alone does not create a case.

This is the existing operational policy in `traceguard/cases.py`, not a calibrated probability. Context never removes risk evidence, but does affect the LOW priority branch. No thresholds or priority decisions were tuned during this integration.

## Scenario replay check

| Scenario | Rows | Cases | Priorities |
|---|---:|---:|---|
| `rapid-pass-through` | 2 | 1 | LOW |
| `fan-in-dispersal` | 7 | 1 | MEDIUM |
| `legitimate-high-volume` | 15 | 0 | None |
| `legitimate-settlement-context` | 10 | 1 | LOW |
| `insufficient-history` | 26 | 1 | INSUFFICIENT_HISTORY |
| `delayed-pass-through-90m` | 2 | 1 | LOW |
| `fan-in-collector` | 8 | 1 | LOW |
| `single-inflow-four-way-split` | 5 | 1 | MEDIUM |
| `repeated-value-burst` | 20 | 1 | MEDIUM |
| `directed-cycle` | 3 | 1 | MEDIUM |
| `layered-chain` | 4 | 1 | MEDIUM |
| `dormant-reactivation` | 7 | 1 | MEDIUM |
| `compound-layered-cycle` | 14 | 1 | HIGH |
| `amount-deviation` | 7 | 1 | MEDIUM |

## Bounded graph analysis

Each transaction ID remains a distinct edge, including repeated amounts and repeated account pairs. Cycle and four-edge chain paths require strictly increasing timestamps at every hop; simultaneous events do not establish flow order. Searches return a selected candidate path per trigger, not an exhaustive catalogue. Expansion-limit counters indicate incomplete analysis, and warnings appear in run responses and case limitations. A zero exhaustion count does not prove exhaustive coverage or absence of fraud.

Case grouping joins explicit shared risk/coverage transaction references within the maximum span; simply sharing an account is insufficient. Returned evidence/support arrays and graph rendering are bounded. The UI table preserves individual returned transaction IDs even where graph lines overlap.

## Signals

R1: pass-through in 1h/6h/24h windows; R2: fan-in/dispersal; R2A: collector; R2B: short fan-out; R3: prior account amount deviation; R4: time-ordered directed cycle; R5: time-ordered four-edge chain; R6: repeated-value burst; R7: dormant reactivation. R3_BASELINE_UNAVAILABLE is coverage-only. C1/C2/C3 are outgoing amount, repeated-counterparty and inbound amount context. Settings and evidence observed values specify exact heuristic bounds.

The holdout uses a distinct generator seed; synthetic labels deliberately align with rule templates. The 90-minute R1-only episode remains LOW; merchant settlement and routine P2P hard negatives can also create LOW cases. Neither is a validated real-world classification. ML remains not_configured.
