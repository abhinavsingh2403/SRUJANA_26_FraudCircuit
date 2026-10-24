# Known limitations and residual risks (v0.4.0)

This document is intentionally candid. Passing tests does not mean the system is perfect or safe for production.

## Functional and analytical limitations

1. **No ML model:** risk priority is derived from hand-authored rules. Do not imply ML is implemented.
2. **No verified real-world false-positive rate:** synthetic fixtures exercise chosen conditions only. Analyst outcomes are selective and not unbiased labels.
3. **Rule coverage is narrow:** real fraud strategies can evade these signals; legitimate businesses can match them.
4. **Rule thresholds are uncalibrated:** all values are prototype settings and need validation, threshold selection and domain review.
5. **Connected patterns can be correlated:** two rules can reflect overlapping facts. HIGH priority now requires distinct rules and distinct trigger transactions but is still not a calibrated risk probability.
6. **Limited time semantics:** exact timestamp ties are treated together. PaySim `step` data needs a specific adapter; don't invent ordering within a step.
7. **Bounded case grouping and payloads:** cases have a configured maximum timespan; API output can truncate evidence/account/transaction lists. Read counts and truncation flags. Longer chains may be split across cases.
8. **Context is not exculpatory:** stable amounts and repeat counterparties do not establish legitimacy; those signals do not remove risk evidence, but the configured routine-rule branch can assign LOW priority.
9. **Input schema limits:** self-transfers are unsupported; single-currency per import only; currency code is shape-checked rather than registry-validated; unknown fields are ignored and reported.
10. **Floating-point amounts:** appropriate for a prototype risk screen, not an accounting ledger. Use decimal arithmetic and currency-specific precision before any financial settlement calculations.
11. **Idempotent run/case IDs:** identical input produces deterministic IDs; replaying the same scenario can update the same stored case while leaving human review status/outcome unchanged. This is suitable for a reproducible demo, not a production event stream.
12. **Review labels are human-entered:** the API records a selected outcome but cannot independently verify it.
13. **Audit log has limits:** the per-case hash chain detects some edit/reorder changes, but without an external anchor the DB owner can rewrite all hashes or delete the tail.
14. **No authentication or authorization:** routes are unauthenticated. Keep localhost/private local development only; don't place on a public network.
15. **No real-time alert delivery:** current outputs are API cases. No SMS, email, webhook, UPI blocking, payment hold or bank integration exists.
16. **No security certification:** resource limits and input validation are not a comprehensive security review.

## Required before a production claim

A production system would need representative institution-specific data, fraud operations expertise, risk thresholds validated against real costs, privacy/legal review, data access controls, authentication/authorization, audit anchoring/retention, monitoring, drift management, an incident process, red-team/security testing, throughput/latency and recovery testing, operational approval, and integration with sanctioned response workflows. This hackathon prototype does not provide those assurances.
