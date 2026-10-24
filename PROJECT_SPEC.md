# TraceGuard — canonical product and implementation specification

**Version:** 1.3 · **Prepared:** 24 October 2026  
**Event:** Srujana Tech Fest 2026 · 48-hour software hackathon  
**Problem statement:** Finance F-01 — Financial Fraud and Transaction Risk Detection

## 1. Product statement

**TraceGuard is an explainable transaction-risk investigation workbench.** It helps an analyst identify potentially suspicious transaction events, connect related transactions/accounts, inspect the observed evidence and prioritise review.

Tagline: **See the pattern, not just the payment.**

TraceGuard is a decision-support prototype. It must not state or imply that a rule match proves fraud, that a model has verified real-world Indian UPI performance, or that the application blocks/freeze payments. It has no connection to bank or payment-rail data.

## 2. Problem and user

A single transfer may look ordinary while a sequence involving rapid pass-through, multiple counterparties, unusual amounts or linked accounts may warrant investigation. Analysts need a way to prioritise cases and see why they were raised without treating unusual legitimate activity as proof of fraud.

Primary user: a fraud analyst/investigator reviewing available transaction records. The initial workflow is batch CSV import and deterministic scenario replay; it is not an actual real-time banking feed.

## 3. Required end-to-end workflow

1. **Load data:** choose one bundled synthetic scenario or import a canonical CSV.
2. **Validate:** reject malformed/oversized/mixed-currency/duplicate-ID inputs with readable errors; never partially import a malformed batch.
3. **Analyse:** compute point-in-time features and evaluate transparent rules.
4. **Connect:** group related risk-bearing events through shared risk/coverage transaction references, with bounded case windows and explicit truncation metadata.
5. **Explain:** show exact rule/context evidence, supporting transaction IDs, observed values, caveats and coverage limitations.
6. **Prioritise:** apply the documented heuristic review-priority policy; do not label priority as a probability.
7. **Investigate:** analyst opens a case, inspects its timeline/network, changes workflow status and—when closing—records a review outcome.
8. **Audit/evaluate:** allow review-history verification and show the real model/evaluation state. Never invent metrics.

## 4. Features already implemented in backend v0.4.0

### Risk signals

- `R1_RAPID_PASS_THROUGH`: an outgoing amount is a large configured share of prior recent inflows and follows the latest prior inflow within a configured interval.
- `R2_FAN_IN_DISPERSAL`: multiple distinct prior inbound senders and multiple outgoing recipients exist within a rolling window.
- `R3_AMOUNT_DEVIATION`: an outgoing amount is a high outlier relative to that sender's strictly prior outgoing history.
- `R3_BASELINE_UNAVAILABLE`: a coverage-only cue when account history is insufficient but the amount is high relative to the prior ledger-wide median. This is **not** a fraud rule.

Additional implemented signals are R2A collector, R2B fan-out burst, R4 temporal cycle, R5 four-edge chain, R6 repeated-value burst and R7 dormant reactivation. Full policy and all 14 scenario results: `backend/docs/rule_policy.md`.

### Context signals (non-suppressive)

- `C1_STABLE_AMOUNT_CONTEXT`: current amount is within tolerance of the sender's prior outgoing median.
- `C2_REPEATED_COUNTERPARTY_CONTEXT`: current recipient appeared in the sender's prior outgoing history.
- `C3_STABLE_INBOUND_AMOUNT_CONTEXT`: current amount matches prior recipient inflows.

These provide context. They do not prove legitimacy or suppress risk evidence. C1/C2/C3 context can assign LOW priority to the configured routine-rule subset; see the policy below.

### Evidence schema

Each evidence record includes `evidence_id`, `rule_id`, `title`, `kind`, `description`, explicit `trigger_transaction_id`, `transaction_ids`, `account_ids`, `observed`, and `caveats`. Use `trigger_transaction_id` as the trigger anchor; do not infer it from the order of `transaction_ids`.

### Review priority

- `HIGH`: at least three distinct risk-rule types across at least four trigger transactions, with linked structural and corroborating evidence sharing at least two transaction IDs and two accounts, plus R6 or R7. Structural rules are R4/R5/R6; corroborating rules are R1/R2/R3/R7.
- `LOW`: R1 alone; or only R2/R2A/R2B signals with at least one C1/C2/C3 context item. These cases remain visible; LOW is not evidence of benign activity.
- `MEDIUM`: other cases with at least one configured risk signal.
- `INSUFFICIENT_HISTORY`: coverage-only cases. Context alone does not create a case.

This is the existing operational policy in `traceguard/cases.py`, not a calibrated probability. Context never removes risk evidence, but does affect the LOW priority branch. No thresholds or priority decisions were tuned during this integration.

### Case grouping and response bounds

- Transactions at identical timestamps are evaluated against the same prior history; no within-timestamp ordering is inferred.
- Connected event components are grouped via explicit shared risk/coverage transaction references, with a maximum span. Sharing an account alone does not join cases.
- Grouping has a maximum time-span bound. A longer transitive chain can appear as separate cases; the response includes this limitation.
- Transaction/evidence/account arrays are bounded. Always read `counts` and `truncation` before assuming a response contains all linked records.
- Case/run IDs are deterministic for identical source IDs and transaction content. Replaying identical demo input may reuse the existing case and its human review state; this is demo idempotency, not a production streaming ingestion contract.

## 5. Input requirements and safeguards

Canonical CSV required columns:

`transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type`

Optional: `currency`.

- UTF-8 CSV, ISO-8601 timestamps with explicit timezone; normalized to UTC.
- Unique transaction IDs per import.
- Sender/recipient identifiers non-empty and bounded; control characters rejected.
- Amount positive, finite and under a configurable numeric safety ceiling.
- One currency per import; currency field shape is checked as three letters, not verified against an ISO registry. Without currency, amounts are unit-unspecified. No FX conversion occurs.
- Self-transfers are unsupported by this prototype and rejected.
- Default request limits: 5 MiB body, 100,000 rows, 128 columns, bounded error details and bounded case response arrays.
- Known label/target, fraud-flag and common balance columns are excluded/reported; unknown extra columns are ignored/reported. This is not a comprehensive data-loss-prevention system.
- PaySim schema is refused by the canonical importer. It requires a separate adapter to preserve its discrete `step` semantics and prevent target/flag/post-event leakage.

## 6. Review outcomes and integrity

Workflow status values: `OPEN`, `INVESTIGATING`, `ESCALATED`, `CLOSED`.

Closing requires one explicit human-entered outcome: `CONFIRMED_SUSPICIOUS`, `FALSE_POSITIVE`, or `INCONCLUSIVE`. Non-closed statuses cannot carry a current outcome. Reopening clears the current outcome but retains historical review events.

The review-log API verifies a per-case SHA-256 chain. This detects some event edits/reordering; it is not externally anchored and cannot protect against a database owner rewriting the full chain or deleting the tail. Outcome summaries are counts among reviewed cases, not an unbiased system-wide false-positive rate.

## 7. User interface included in v0.4.0

A dependency-free HTML/CSS/JavaScript investigation workbench is served by FastAPI from `backend/traceguard/static/`. This is a deliberate 36-hour reliability choice: the main demo is same-origin and does not require a separate Node/Vite build. Do not scaffold a second React app by default. Replace the UI only if a concrete acceptance gap requires it and enough time remains to test the replacement end to end.

### Included UI paths

1. **Overview / case queue:** current case counts and filters by priority/status, with a visible synthetic/demo label.
2. **Scenario console:** loads all 14 bundled scenarios, supports replay-one and replay-all, and shows returned counts and warnings.
3. **Case investigation:** summary, priority/status, linked account view built from actual returned transaction edges, trigger/context timeline, evidence details, limitations and truncation.
4. **Review actions:** statuses `OPEN`, `INVESTIGATING`, `ESCALATED`, `CLOSED`; closing requires a human outcome. Review history and audit-chain verification are exposed.
5. **CSV import:** sends raw CSV bytes to the API and displays server errors/warnings.
6. **Evaluation status:** shows the actual API status; ML remains `not_configured`, and no fake model charts/metrics are rendered.

### UI acceptance checks still required on the team's machine

- A Chromium journey now exercises the real primary workflow plus separately injected failure states. See `backend/reports/browser_integration.json`. Still rehearse on the teammate demo machine.
- Verify loading, empty, unavailable-server and failed-upload states visually.
- Verify case selection, replay, filters, graph/timeline and review changes use actual API responses.
- Make sure truncated lists visibly disclose truncation and no graph edge is invented.
- Check keyboard focus/labels and a 1366×768 screen plus a narrower viewport.

If the UI needs improvement, extend the current static app first. Avoid adding a React build chain solely for fashion; the same-origin UI is simpler for a short hackathon.

## 8. ML integration (conditional; not implemented yet)

Do not block the complete workflow on ML. Once the frontend and core tests work, a trained baseline is worth attempting if the dataset can be acquired legally and processed within remaining time.

- Verify publisher, license/terms, exact file, schema, row count, label semantics and source hash.
- PaySim is synthetic mobile-money data, not Indian UPI. Its `step` field is discrete simulation time; keep all rows from a step in the same split and do not impose an order among rows sharing a step.
- Exclude `isFraud` (target), `isFlaggedFraud` (existing flag) and post-event balance fields from input features for this project. Inspect for leakage rather than relying only on column names.
- Define what is available at scoring time before selecting features. Fit preprocessing only on training data. Keep chronological train/validation/test splits. Check class counts in every split.
- Compare to a simple baseline. Report average precision, precision, recall, false positives, precision at top K, class prevalence, threshold and limitations. Select any threshold on validation data, not the test set.
- If data, evaluation, or integration is not done, leave model status `not_configured`. Never fabricate a result or train on the hand-authored demo fixtures and present it as fraud-detection performance.

## 9. Out of scope for the 36-hour MVP

- Live bank/UPI/Account Aggregator integrations.
- Bank-grade fraud probabilities or zero-false-positive claims.
- Automated payment blocking/account freezing.
- Production authentication/authorization/tenancy, regulatory compliance or formal security certification.
- SMS/WhatsApp/email notification delivery.
- Heavy streaming infrastructure, microservices, Kafka, a separate graph database or a new graph neural network unless a requirement and time budget justify it.

## 10. Success criteria

The minimum winning-quality direction is not a long list of features. It is a reliable, replayable, evidence-first investigation loop; honest data/model status; correct treatment of legitimate activity and insufficient history; reproducible tests; a clear one-minute demo; and documentation/repository a judge can understand.
