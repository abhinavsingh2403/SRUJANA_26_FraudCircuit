# TraceGuard — simulation update

This ZIP updates `dataset-wali-branch`, starting at commit `69b211c167f75c3477ce158de749217873155749`. It preserves the existing application and dataset/model files. No model was retrained and no new accuracy claim is made.

## Run on Windows

Open a terminal in the extracted project folder:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn traceguard.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000 and select **Simulation**. No Node installation or frontend build is needed to run the packaged application. Use Python 3.11 or newer. On macOS/Linux, use `python3` and `.venv/bin/python` instead.

## Use the new tab

1. Choose an existing synthetic scenario, optionally change amount/time multipliers, and select **Load simulation**.
2. Use **Next transaction**, **Previous**, **Play/Pause**, or the step slider. Change playback delay independently of transaction time.
3. Inspect account totals, the chronological ledger, rule evidence and coverage limitations. **Final output** evaluates all transactions; **Download final report** exports the source configuration and actual engine result as JSON.
4. For a custom case, choose **Custom pattern**, expand the specification editor and edit the JSON. Five existing pattern types are supported; the existing Research workspace has a form-based editor and text parser.

Only transactions revealed at the selected step enter the rule engine. No future findings are painted onto earlier steps. The final result uses the same analysis pipeline as scenario replay. Each step can regroup cases and change their IDs. Playback never writes cases, reviews or evaluation runs. This tab replays synthetic scenario cases and custom generated patterns; it does not stream live bank transactions or replay arbitrary imported CSV files.

## Fixes included

- Replaced an undefined notification function in the sample-data action.
- Sample imports report missing/failed files and partial failure instead of unconditional success.
- Removed misleading live-data wording and graph narratives asserting laundering intent, invented ratios or unverified paths.
- Normalized simulator defaults so equivalent default and JSON requests generate the same transaction/run IDs.
- Limited JSON request bodies to 256 KiB and rejected unapproved browser origins for mutations. CSV retains its existing streaming limit.
- Added frontend lint/browser-test commands, consistent packaged assets and optional-ML test isolation.

## Validation performed

- Backend: `python -m unittest discover -s tests -q` — 135 tests passed.
- Python compile check and all synthetic scenario replay script — passed.
- Frontend: `npm run lint` and `npm run build` — passed.
- Chromium: five browser tests passed, covering playback, pause, rewind, seek, final report download, invalid custom input, failed API request/retry, main-module navigation, research simulator and mobile width. Desktop/mobile visual inspection performed.
- Every prefix of every bundled scenario is compared against direct engine analysis; evidence cannot reference unrevealed transactions. Custom final outputs are compared with the existing simulation engine. Database non-persistence and input rejection are tested.

To rerun browser tests: start from `frontend`, run `npm ci`, `npx playwright install chromium`, then `npm test`. The tests start their own localhost backend and use an isolated database. Python dependencies must be installed in the environment used by the `python` command. Optional model inference tests require `backend/requirements-ml.txt`; without those dependencies that test is explicitly skipped.

## Remaining boundaries

This remains a local analyst prototype, not a production banking service. Authentication, authorization, tenancy and rate limiting are not implemented. The browser-origin guard is not authentication and does not prevent direct non-browser clients. Keep the backend on localhost. The audit chain lacks an external anchor. Synthetic demonstrations cannot establish real-world fraud accuracy; rule matches are investigation leads, not verdicts. Arbitrary imported cases can have truncated retained graphs. Bounded graph analysis can miss patterns and reports that limitation. This work does not establish that all possible bugs or security vulnerabilities have been eliminated.
