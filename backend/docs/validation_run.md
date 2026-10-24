# Final integration validation — 24 October 2026

## Baseline failures and confirmed gaps

- Initial unittest discovery: 54 discovered, two import errors because FastAPI was absent. Installed exact `requirements.txt`; then all 89 original tests passed.
- Compilation, JS syntax and replay succeeded before changes; replay produced 14 scenarios / 130 rows / 13 cases.
- Added regressions failed before fixes: two subcases exposed reverse-time and simultaneous internal R5 hops; LOW summary claimed supporting context even though R1-only case context_codes was empty.
- UI inspection found stale review forms after failures, unguarded out-of-order detail responses, transient-only run/audit warnings, skipped truncation disclosure with empty transaction arrays, and CSV File.text() replacement of invalid UTF-8 before server validation.
- Stale HIGH/LOW/grouping documentation was reconciled to existing code; no priority thresholds changed.

## Commands actually run and results

Run from `backend/` unless noted. Python 3.12.14; Node 24.22.1.

| Command | Actual result |
|---|---|
| `python -m pip install -r requirements.txt` | Pinned runtime/test dependencies installed |
| `python -m unittest discover -s tests -v` | 96 tests passed; final log `reports/unittest_integration.txt` |
| `python -m compileall -q traceguard scripts tests` | Exit 0 |
| `node --check traceguard/static/app.js` | Exit 0 |
| `node --check scripts/browser_journey.cjs` | Exit 0 |
| `python scripts/check_startup.py` | Exit 0; pre-flight environment, assets and DB verified |
| `python scripts/replay_all.py` | 14 scenarios, 130 rows, 13 cases; `reports/replay_integration.json` |
| `python scripts/verify_integration.py --browser` (environment below) | Chromium journey (15 acceptance checks) and actual local HTTP checks passed |
| `python scripts/run_controlled_benchmark.py --output reports/controlled_benchmark_integration.json` | Completed, separate dev/holdout seeds retained |
| `python scripts/stress_100k_benign.py --rows 100000 --mode randomized-unlabeled --output reports/stress_100k_random_integration.json` | 46.314 seconds; one MEDIUM case; 52 chain candidates; zero budget exhaustion |
| `python scripts/stress_100k_benign.py --rows 100000 --mode structured-payroll --output reports/stress_100k_structured_integration.json` | 26.496 seconds; zero cases; zero budget exhaustion |
| `python -m pip wheel --no-deps --no-build-isolation . -w /tmp/tg-wheels` | Wheel built; zip inspection asserted index.html/app.js/styles.css included |

Stress commands were separate invocations. Their timings measure pipeline work excluding generation/HTTP and are environment-specific, not SLAs or concurrent-user load tests. The random generator is unlabelled; its case is not a false-positive count. Generator, seed and interpretation remain in each JSON report; source is `scripts/stress_100k_benign.py`.

## Live API and browser evidence

`reports/http_integration.json` verifies HTTP 200 for `/`, `/static/app.js`, `/health`, `/api/scenarios`, `/api/cases`, `/api/evaluation/summary`; POST replay-all returns 14/130/13; malformed CSV is atomic HTTP 422; missing closure outcome is 422; review save and audit verification succeed. The harness uses a fresh temporary DB, loopback-only Uvicorn and cleans it up.

`reports/browser_integration.json` records Chromium 153.0.8010.0, 15 acceptance groups and no page errors: fresh empty queue; real replay, graph edges tied to API transaction IDs, timeline/evidence; review outcome validation/closure/reopen/audit; zero-case replay scoping without leaving stale cases; 105-case import, pagination controls and multi-page queue navigation; malformed and invalid UTF-8 CSV; a real 135-row bounded CSV with repeated payments and HTML-like account text; API-unavailable/recovery and failed-detail states; out-of-order responses; empty-array truncation; persistent incomplete warnings; replay-all and evaluation; 1366px/390px overflow checks and named form controls.

Primary workflow uses real HTTP responses. Fault/race tests intercept transport explicitly. The incomplete-result fixture is produced by the actual pipeline with expansion limit 1, then injected into the UI transport; it is not claimed as a naturally exhausted default demo run. Empty-array truncation is also an injected contract edge case. The real CSV independently exercises actual response truncation. A 390px screenshot was inspected internally; it is not bundled.

Initial browser attempts failed because Playwright's default Chromium was missing and its download returned an invalid archive. A temporary npm `@sparticuz/chromium` 153.0.0 package supplied Chromium; its automatic extraction failed on chown, so the bundled binary/libs were extracted locally. The successful run used `TRACEGUARD_CHROMIUM=/tmp/tg-chromium` and `NODE_PATH` pointing to runtime Playwright. No browser security flags disabling web security were used. These temporary tools are not shipped or runtime dependencies. Standard teammate setup is documented in backend README.

Initial standalone live-server attempts also hit an inherited SOCKS proxy setting and a process-lifetime/connection-refused issue. The successful reproducible harness uses `trust_env=False` for loopback HTTP and starts the server within its own process lifetime. These failed attempts were not counted as successes.

## Controlled benchmark interpretation

132 holdout episodes: 84 positive-template and 48 negative/hard-negative. HIGH/MEDIUM cutoff remains TP=72, FN=12, FP=0, TN=48; any-case cutoff remains TP=84, FN=0, FP=24, TN=24. The 90-minute pass-through remains LOW; routine P2P and merchant-settlement hard negatives also appear as LOW. Separate generator seeds and dev-only amount-baseline threshold selection are unchanged. These labels deliberately align with synthetic templates; the results establish neither real Indian UPI performance nor an independently validated model. ML remains not_configured, evaluation not_run and metrics null.

## Not run / remaining limitations

No teammate Windows installation, full keyboard/screen-reader audit, concurrent-user load test, external security review or ML training/evaluation. Local unauthenticated demo only. Audit hashes have no external anchor; full rewrite/tail deletion remain possible. A new DB path is recommended after rule changes because replay does not delete cases that cease to qualify. Report files from earlier snapshots remain historical; use `_integration` reports for this revision.
