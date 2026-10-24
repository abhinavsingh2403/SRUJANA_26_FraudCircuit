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

## 2026-10-24 — Frontend UI/UX redesign: Lemon/ink case queue & investigation workbench

**Decision:** Integrate the requested lemon/ink UI/UX design system into the dependency-free static frontend (`backend/traceguard/static/{index.html,styles.css,app.js}`). Replace the simple wireframe with a rich analyst workbench featuring:
1. Lemon radial-gradient background (`--lemon-soft`, `--lemon-mid`, `--lemon`) with dark ink contrast and rounded glassmorphism cards.
2. 4 top KPI cards matching live API totals (Visible cases, High priority, Medium priority, Low / coverage limitation).
3. Live review table queue with columns (Case, Priority, Rules fired, Txn / Acct, Amount span, Status, Opened), pill filter buttons synchronized with accessible selects, and multi-page pagination.
4. Quick side panel with case summary, rules chips, single-click Escalate action, and "View graph" modal trigger.
5. Dynamic topological/flow SVG graph generator rendering layered account nodes, amount labels, arrow polygons, and `<title>` transaction tags for both the 1-second dwell hover preview (`.pv`) and full modal dialog (`.ov .md`).
6. Deep investigation workbench retaining the transaction timeline table, evidence items, truncation disclosures, audit chain verification, and human review form with explicit closure outcomes.
7. Interactive Scenario Console and CSV Import dropzone/file upload wired directly to FastAPI endpoints.

**Reason:** User requested integrating the design mockup as the frontend UI/UX of the project. The implementation adheres strictly to `AGENTS.md` by maintaining all backend API contracts, preserving honest disclosures (rules-only mode, unconfigured ML, non-probabilistic priorities), escaping all dynamic text to prevent XSS, and maintaining 100% test pass rate across all 96 unit tests, startup checks, and integration verification.

## 2026-10-24 — Multi-page frontend architecture

**Decision:** Transform the frontend into a structured multi-page application with 4 dedicated module pages:
1. `#/queue` (Case Queue & Investigation Workbench): KPI metrics, live review table, quick side panel, and deep investigation workbench.
2. `#/scenarios` (Scenario Console): 14 scenario cards, parameter sliders (`gap_scale`, `amount_scale`), replay actions, and batch runner.
3. `#/import` (Import Data): Drag-and-drop CSV upload zone, schema specification table, copyable sample CSV template, and atomic rollback disclosures.
4. `#/evaluation` (Evaluation & Audit): Transparent ML status disclosure (`not_configured`), priority classification policy, and live SHA-256 review chain inspector.

Provide both client-side hash routing (`window.location.hash`) and standalone HTML entry points (`scenarios.html`, `import.html`, `evaluation.html`) served via FastAPI endpoint `/{page_name}.html`.

**Reason:** User requested multi-page capability to separate concerns and prevent an overly long single-page scroll. Preserved 100% compatibility with all automated test suites, startup validators, and API contracts.



