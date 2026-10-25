# Model card: TraceGuard v0.4.0 backend

## Status

No trained ML model is shipped or configured. `/api/evaluation/summary` returns `model_status=not_configured`, `evaluation_status=not_run`, and `metrics=null` by design. Rule outputs must not be presented as ML results.

## Intended use

Hackathon prototype and engineering demonstration for case-based transaction-risk triage on deterministic synthetic scenarios and, after provenance review, public benchmark data. The prototype helps identify patterns for human review.

## Out-of-scope uses

- Declaring that a person or account committed fraud.
- Automatically freezing, blocking or rejecting payments.
- Production banking, real-time payment, AML compliance, law enforcement or credit decisions.
- Claiming effectiveness on Indian UPI based only on synthetic or non-Indian datasets.

## Current signals

- `R1_RAPID_PASS_THROUGH`: a current outgoing amount is a configured large share of prior recent inbound total and follows the latest prior inflow within the configured window.
- `R2_FAN_IN_DISPERSAL`: multiple distinct prior inbound senders and multiple outgoing destinations in a rolling window.
- `R3_AMOUNT_DEVIATION`: high outlier relative to prior outgoing amounts from the same sender over the baseline window.
- `R3_BASELINE_UNAVAILABLE`: a coverage-only cue when the account baseline is too small but the amount is high relative to prior ledger-wide median. It is not a fraud signal.
- `C1_STABLE_AMOUNT_CONTEXT`: current amount is within tolerance of the sender's prior outgoing median; context only.
- `C2_REPEATED_COUNTERPARTY_CONTEXT`: recipient appeared in prior outgoing history; context only.

Also implemented: R2A collector, R2B short fan-out, R4 temporal cycle, R5 four-edge chain, R6 repeated-value burst, R7 dormant reactivation, and C3 inbound amount context. See `rule_policy.md`.

Thresholds are demo heuristics, not calibrated bank policy. Risk and context signals may be correlated. Context does not suppress a risk alert automatically.

## Priority policy

- `HIGH`: at least three distinct risk-rule types across at least four trigger transactions, with linked structural and corroborating evidence sharing at least two transaction IDs and two accounts, plus R6 or R7. Structural rules are R4/R5/R6; corroborating rules are R1/R2/R3/R7.
- `LOW`: R1 alone; or only R2/R2A/R2B signals with at least one C1/C2/C3 context item. These cases remain visible; LOW is not evidence of benign activity.
- `MEDIUM`: other cases with at least one configured risk signal.
- `INSUFFICIENT_HISTORY`: coverage-only cases. Context alone does not create a case.

This is the existing operational policy in `traceguard/cases.py`, not a calibrated probability. Context never removes risk evidence, but does affect the LOW priority branch. No thresholds or priority decisions were tuned during this integration.


## Known limitations

- Rules and thresholds have not been validated on representative real transaction data.
- The implementation can produce false alerts and miss suspicious activity; rule coverage is not comprehensive.
- Connected-account relationships only cover imported rows and bounded evidence windows.
- Events with equal timestamps have no assumed relative order.
- Grouping uses a maximum time span, so one longer chain can be represented as separate cases.
- The backend does not connect to bank or UPI systems; it has no live alert delivery.
- There is no built-in model, model score, automatic threshold calibration or drift monitor.

## Required evaluation before ML integration

Use source-aware chronological splitting, keep all rows from one discrete source time step within the same split, exclude target labels/existing flags/post-event data, and fit preprocessing only on training data. Report average precision, precision/recall, false positives, precision at top K, threshold, class prevalence and dataset limitations. Include legitimate high-volume cases and at least one failure case. Don't quote metrics until actually run and reproducible.

## Advisory extensions — 25 October 2026

The earlier no-model statement applies to transaction/PaySim scoring. A separate optional TF-IDF plus logistic regression **text** classifier is now bundled, with its reproducible report at `artifacts/triage_eval.json`. It uses 96 authored synthetic narratives, with scenario-family-disjoint training (66) and test (30). Labels and text derive from the same scenario templates, so performance measures template recognition only. Observed macro-F1 is 0.1714; HIGH and INSUFFICIENT_INFORMATION have no test support; HIGH recall is null. Injection results include failures. No real narrative or live LLM quality has been demonstrated. Text severity never changes authoritative rule priority.

PaySim remains not configured/not run without a licensed local dataset. The optional benchmark fits preprocessing on training only, keeps complete timestamp steps together, selects a validation alert-budget threshold and reports test metrics separately. Predictors exclude labels, flags, balances and future events. Test-time historical features may use earlier test events, matching sequential inference. The type/log-amount baseline is the no-history ablation. Rank scores are not calibrated probabilities. Sampling omits history, and PaySim's synthetic labels encode simulator assumptions; it is not Indian UPI. No gradient-boosted model is included.

Artifacts are trusted local joblib files, never accepted through upload endpoints. Install optional dependencies or regenerate artifacts with `scripts/eval_triage.py` before using the text baseline in a different environment. Version compatibility is not guaranteed across arbitrary sklearn versions.
