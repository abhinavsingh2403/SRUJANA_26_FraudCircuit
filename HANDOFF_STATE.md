# Current handoff — 25 October 2026 revision

Scope: non-ML correctness and Evaluation & Auditability. Read `REVISION_NOTES.md` for tested behavior, commands and remaining limitations. Earlier handoff below is historical, not the current verification record.

Changed: frontend app/index/styles and synchronized backend static copies; backend cases/config/db/explain/fixtures/main/pipeline/rules/security/service; new provenance module; API contracts; tests/test_extensions.py and new tests/test_live_evaluation.py; new evaluation browser journey and verifier option. Added revision logs/screenshots and updated final verification/checksums.

Actual checks: 125 backend tests passed; both JS syntax checks, Python compilation, frontend build, HTTP integration, analyst and research browser journeys, and the new evaluation browser journey passed. Desktop/mobile screenshots inspected; diff whitespace check passed. ML training/dataset evaluation and production security testing were not run.

Remaining: local unauthenticated access, self-reported reviewer identity, no external audit anchor, optional model artifacts excluded from run fingerprint, at most 25 runs in evaluation snapshots, no real-world accuracy claim. Keep legacy case IDs; do not invent run metadata for them.

Next exact task: if deployment is requested, design authenticated identities and an external audit anchor with the intended deployment owner before exposure. ML dataset work remains deferred by user request.

---

# TraceGuard integration handoff — 25 October 2026

This build continues the pulled repository at `c8248ec52a6b632df7db0a43689c79c027774b5e`. Earlier handoff claims are superseded by the actual checks below. No remote push was requested or performed.

## Delivered changes

- Preserved the original lemon workbench and all 14 bundled scenario outputs. Added `/research.html` for offline parsing, editable synthetic specs, real isolated simulation, sensitivity sweeps, graph/timeline inspection, advisory text triage, PaySim windows and security events.
- Added shared extraction, engine-derived explanations, deterministic generator, streaming PaySim adapter, chronological baseline benchmark and optional advisory score hook. Labels/flags/balances never become predictors. Missing PaySim data reports not_run/not_configured.
- Added bounded case traces and account/time security-event correlation. Original cases without stored feature traces explicitly report unavailable. Added guarded owned-mock traffic, atomic event deduplication and input-limit checks.
- Fixed real existing integration defects: hardcoded port 8000 outside default ports; unrelated old cases shown after a zero-case run; stale details during CSV import; Vite build output missing JavaScript. Static build now preserves same-origin paths and packages fallback assets.
- Added golden-output regression tests for every bundled scenario, simulation isolation, trace consistency, leakage/tie handling, validation, guard behavior, event boundaries, LLM fallback and a small optional chronological-model smoke test.

Changed code: `backend/traceguard/{extension_common,explain,simulator,paysim_adapter,paysim_window,model_hook,triage,security,extensions_api}.py`; integration changes in `main.py`, `pipeline.py`, `service.py`, `db.py`; `frontend/{app.js,index.html,research.html,research.js,research.css,build.cjs,package.json}` and packaged copies. New scripts/tests/artifacts and updated contracts, READMEs, model card, risks, changelog and decisions are included. `backend/artifacts/changed_files.txt` enumerates the exact working-tree changes.

## Actual commands and results

- Initial core dependency failure was resolved by installing `backend/requirements.txt`; the untouched baseline then passed 96 tests.
- `python -m unittest discover -s tests -v`: **112 tests passed**, including optional ML toy smoke test in the validation environment. Latest full output: `backend/artifacts/unittest.log`. Optional ML test skips when sklearn is absent; ordinary tests require no dataset/network.
- `python -m compileall -q traceguard scripts tests lab`: passed.
- `python scripts/replay_all.py`: ran successfully; outputs saved in `artifacts/replay_all.json`. Golden comparison proves all 14 original scenario outputs unchanged, not just case counts.
- `node --check` on frontend and packaged JavaScript: passed. `npm run build`: passed with all required pages and `/static/` assets copied.
- Original real browser journey: **15 checks passed**, report `backend/reports/browser_integration.json`. Covers replay, queue, detail, review/outcome, audit verification, 105-case pagination, CSV errors, imported-markup safety, truncation, unavailable API, stale responses and mobile bounds. Failure-state transport injections are identified separately in that report/script.
- Research browser: **10 checks passed**, including offline parse/run, real graph-edge inspection, sliders/sweep, advisory triage, missing-data state, no persistence, API-failure handling and desktop/mobile bounds. Final live HTTP checks passed. Reports: `backend/artifacts/research_browser.json` and `backend/reports/http_integration.json`.
- `python scripts/verify_lab.py`: passed against two isolated owned-loopback services. One synthetic case and two matching events; `artifacts/lab_integration.json`.
- `scripts/self_test_limits.py` ran against loopback: oversized 413; malformed, duplicate-ID and PaySim-shaped CSV 422. `artifacts/self_test_report.md` records observations. No scanner was run.
- `make_triage_dataset.py` and `eval_triage.py`: ran; 96 synthetic narratives; family-disjoint train 66/test 30; macro-F1 **0.1714**; HIGH recall undefined because no HIGH test support. Injection errors remain visible. `artifacts/triage_eval.json` is authoritative.
- `run_paysim_benchmark.py`: ran and reported **not_run**, metrics null because no source file was supplied. The toy unit test exercises the adapter/model plumbing only, not PaySim performance.
- Separate 100k stress modes completed: randomized-unlabeled **29.587 seconds, one MEDIUM case**; structured-payroll **18.571 seconds, zero cases**. Reports preserve generator, seed and interpretation. These are pipeline timings in the earlier validation runtime, not load/concurrency or real-world accuracy tests. Rules/default graph behavior were not changed, so no threshold retuning or synthetic benchmark re-optimization was performed.

## Remaining limits / unfinished advanced scope

- No licensed real PaySim dataset or live LLM evaluation; no Indian UPI performance claim. Optional gradient boosting is not implemented.
- Trace scalar gates and actual fired evidence are implemented; unmatched graph candidate paths are not retained, so detailed graph near misses are explicitly unavailable. Shaded rule-window timeline bands are not implemented. Simulated replay animates the final result, not a streaming detector. Simulator advisory comparison is marked not_run unless narrative triage is requested separately.
- Stored traces retain at most 20 trigger rows per case; PaySim graph/trace displays at most 200 rows; case payloads are bounded. Large-window label metrics can undercount truncated trigger alerts, and explicitly disclose this limit.
- The text classifier is weak synthetic-template recognition; its severity must not drive operational action. Missing optional packages/models return unavailable. Trusted local joblib artifacts must not be replaced by untrusted files.
- API and event ingestion are unauthenticated local-demo endpoints. Review chains have no external anchor. No production readiness, immutable audit history, bank integration, perfect coverage or absence of bugs is claimed.

## One next task

Implement exact transaction-level PaySim alert accounting independent of bounded case payloads, with a truncation-sized labelled toy regression, before reporting large-window evaluation metrics. Then evaluate only on a provenance/licence-reviewed local dataset with fixed chronological splits.

# 2026-10-25 simulation and hardening update (supersedes older build status)

Source: dataset-wali-branch at 69b211c167f75c3477ce158de749217873155749.

Changed backend simulator/default normalization, extensions API, sample-import reporting, new HTTP request guards, optional model-test loading and playback regression tests. Changed main/research navigation, sample action notifications and graph narrative; added Simulation HTML/CSS/JS. Added ESLint/Playwright configuration and tests, updated build asset filtering and packaged static copies. Updated API contracts, security notes, decisions and RUN_UPDATED_BUILD.md.

Commands actually executed: backend unittest discovery (135 tests passed), compileall, scripts/replay_all.py; frontend npm run lint, npm run build; npm test with Chromium executable override (five tests passed). Inspected desktop/mobile screenshots. Browser install via Playwright CDN failed in this environment; validation used the Chromium binary from @sparticuz/chromium instead. No claim of testing Firefox/WebKit or Windows. Optional XGBoost dependencies were present during the full test run; model training was not run.

Remaining boundaries: localhost only; no authentication, tenancy or rate limiting; origin checks are not authorization. No live banking feed, externally anchored audit, real-world performance claim, arbitrary CSV playback or guarantee of universal defect/security coverage. Full report and user startup instructions are in RUN_UPDATED_BUILD.md.

Next exact task if extending scope: persist the full source transaction stream per import with explicit retention/access rules, then implement replay of imported runs against that complete history; do not treat a truncated case payload as the original input.
