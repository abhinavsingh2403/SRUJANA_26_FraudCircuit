# Decision log

## 2026-10-24 — One canonical specification and API contract

**Decision:** Use `PROJECT_SPEC.md` and `API_CONTRACT.md` at the package root as the requirements sources. Keep `backend/docs/api_contract.md` synchronized with the root contract. Do not include older conflicting MVP documents as implementable sources.

**Reason:** Earlier project notes contained API/status/scenario mismatches with the actual backend. Silent assumptions would cause frontend/backend integration defects.

## 2026-10-24 — Build the end-to-end slice before model training

**Decision:** Start with scenario replay → cases → evidence/timeline/graph → review outcome. ML comes after the vertical slice if dataset and time allow.

**Reason:** This is an open-technology 48-hour hackathon judged heavily on working implementation and a one-minute demo; an unintegrated model provides little demo value.

## 2026-10-24 — Review priorities are not fraud probabilities

**Decision:** Use four priority categories (HIGH, MEDIUM, LOW, INSUFFICIENT_HISTORY) and explicit rule evidence; no percent-risk label. HIGH requires multiple risk rule types across multiple trigger transactions. Context evidence does not auto-suppress risk.

**Reason:** Rules can correlate and are not calibrated on representative real transactions.

## 2026-10-24 — Synthetic data and ML status are explicit

**Decision:** Demo uses deterministic synthetic fixtures. No model score/metrics until an actual model and evaluation exist.

**Reason:** Hand-authored fixtures are acceptance tests, not a representative benchmark or proof of fraud-detection efficacy.

## 2026-10-24 — Review hash chain has limited security scope

**Decision:** Keep SHA-256 chain for demonstration of review-event integrity, while clearly stating that it has no external anchor and is not tamper-proof against the database owner.

**Reason:** Honest demonstration is safer than claiming forensic-grade or immutable audit integrity.

## 24 October final integration reconciliation

Code was the authority. PROJECT_SPEC, backend README/model card and older demo text described an obsolete HIGH policy and omitted LOW, C3, several rules, and explicit-evidence grouping. They now point to `backend/docs/rule_policy.md`. Thresholds and classification policy were preserved; only the impossible-time R5 path was corrected, with failing-before/passing-after regressions and fresh benchmark/stress runs. LOW summary wording was corrected because an R1-only case has no supporting context.

Keep the dependency-free same-origin UI. Add request sequencing, persistent run/audit warnings, raw-byte CSV upload and accessibility labels rather than a second frontend. Optional Playwright runs in an isolated database; fault injection is explicitly separated from the real API journey. Include static assets in built wheels via package-data.

No Git repository existed in the supplied archive or workspace. No commit hash is claimed; preserve the supplied archive's history via the updated handoff and checksums, and let the team initialize Git.
