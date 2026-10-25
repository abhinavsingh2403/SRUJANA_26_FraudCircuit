# TraceGuard revision — 25 October 2026

## What changed

Evaluation & Auditability now shows actual database evidence: source-scoped case/review counts, completion rate with an explicit empty denominator, recent analysis runs (including zero-case runs), engine/settings/input fingerprints, graph-search exhaustion, payload truncation, and observed analysis time. It offers refresh, current-policy inspection, and downloadable JSON snapshots. It deliberately does not invent accuracy, recall, fraud prevalence, or an ML evaluation.

Removed misleading fixed claims that all data is synthetic/rules-only, that LOW means benign, and that insufficient history means an account is less than 30 days old. Priority policy is delivered by the backend, using the same central policy constants as the decision code. The fan-in outflow ratio is now a Settings value shared by rules and explanation gates. Legitimate defaults, fixture inputs and algorithmic constants remain explicit; removing every numerical constant would make the rules undefined.

Audit verification now checks event hashes, transition continuity and agreement with current review status/outcome in a single database snapshot. It distinguishes no events from verified history and supplies failure reasons and a downloadable verification result. New reviews are rejected if existing integrity checks fail. Startup no longer rehashes damaged modern logs. Original pre-hash schema migration remains supported and tested.

Analysis run and case identities now depend on the engine source fingerprint and settings as well as canonical inputs. This prevents an older human review from silently attaching to a differently configured analysis. Exact replay preserves current review status in both storage and its API response. Existing IDs remain accessible; rerunning an old input after this update creates a versioned identity instead of modifying the old case.

Case records, diagnostic traces and run metadata commit atomically. Expensive explanation work runs before the SQLite write lock, and empty case sets skip the repeated explanation scan. The evaluation page uses SQL aggregates and returns at most 25 recent runs with explicit total/omission counts. Trace totals now include trigger transactions omitted by payload caps. Scenario scaling preserves currency.

## Verification actually performed

- `cd backend && python -m unittest discover -s tests -q`: **125 tests passed**. Includes new empty-state, source-isolation, zero-case/deduplication, replay-state, tamper, restart, tail deletion, transition, versioned identity, rollback, strict limit, legacy-provenance, list-bound and trace-truncation checks.
- `node --check frontend/app.js`, `node --check frontend/research.js`, `python -m compileall -q backend/traceguard`: passed.
- `npm --prefix frontend run build`: passed; packaged backend static assets synchronized.
- `cd backend && python scripts/verify_integration.py`: actual loopback HTTP checks passed.
- `python scripts/verify_integration.py --browser`: original analyst workflow and research browser journeys passed in headless Chromium 153, with no page JavaScript errors.
- `python scripts/verify_integration.py --evaluation-browser`: new evaluation journey passed, including empty/no-event states, actual reviews and downloads, source filters, failed-request stale-data clearing, recovery, missing-case errors and desktop/mobile overflow checks.
- Desktop and mobile screenshots inspected. `git diff --check`: passed.

Browser commands used `TRACEGUARD_CHROMIUM` to select the test environment's available Chromium binary. A default Playwright browser may instead be installed locally. Runtime requirements are unchanged. There is no separate configured frontend lint or unit-test command; JavaScript syntax, build and browser acceptance checks were run.

Evidence: `backend/artifacts/revision_unittest.log`, `revision_integration.log`, `revision_evaluation_integration.log`, `revision_evaluation_browser.json`, and `evaluation_desktop.png` / `evaluation_mobile.png`. Reports without the `revision_` prefix may be historical evidence from the uploaded project; this note and `backend/artifacts/final_verification.json` describe this revision.

## Deliberate boundaries

ML dataset files, training scripts, optional model code and model artifacts were not changed or retrained. No real-world detection-quality measurement was performed. Synthetic scenario golden expectations still check behavior; only run/case identity fields are excluded because the identity scheme intentionally changed.

The app remains a local, unauthenticated prototype. Reviewer names are self-reported. The review hash chain does not authenticate users, sign evidence, or prevent a database owner from rebuilding a chain/deleting a tail while preserving consistent state. Run metadata is not signed. Fingerprints do not include optional ML artifact bytes; restart after engine-source changes. Diagnostic traces still recompute features and graph analysis for nonempty cases. The latest-runs display is bounded, not a full execution-attempt log. These are remaining limitations, not claims of production readiness or exhaustive security coverage.

## Run the updated application

```bash
cd TraceGuard/backend
python -m pip install -r requirements.txt
python -m traceguard
```

Open the local address printed by the server, then choose **Evaluation & Audit**. Replay a scenario or import a canonical CSV to populate run metadata. Existing cases without metadata are explicitly counted as legacy; their provenance is not fabricated.
