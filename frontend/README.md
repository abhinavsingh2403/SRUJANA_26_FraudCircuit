# TraceGuard — Frontend Investigation Workbench

The standalone frontend application for **TraceGuard (F-01: Financial Fraud & Transaction Risk)**.

Designed for fraud analysts reviewing linked transaction sequences and explainable rule evidence, rather than consumer-facing fraud alerts.

---

## Visual Design System

- **Aesthetic**: Modern lemon/dark theme with glassmorphic cards and subtle depth (`--lemon: #f6e96b`, `--lemon-soft: #fdf8d2`, `--dark: #111111`).
- **Responsive Layout**: Fluid 12-column grid scaling cleanly from 1536px desktop down to 390px mobile viewports without horizontal scroll overflow.
- **Micro-interactions**: Dwell-based floating transaction graph preview (`.pv`) on 1-second table row hover, animated distribution bars, and smooth modal inspector.

---

## Directory Structure

```
frontend/
├── index.html         # Main investigation workbench markup
├── styles.css         # Complete design system tokens and layout styles
├── app.js             # Client logic, dynamic graph rendering, and API communication
├── vite.config.js     # Development server with reverse-proxy to FastAPI backend
├── package.json       # Frontend project scripts and dependencies
├── .gitignore         # Build artifacts and dependency exclusions
└── README.md          # Frontend architecture and setup guide
```

---

## Key Features

1. **Live Review Queue**:
   - Tabular view with Case ID, review priority badge, fired rule tags, transaction & account counts, amount range (INR formatted), status, and opened timestamp.
   - Synchronized filter pills and accessible dropdowns for Priority (`HIGH`, `MEDIUM`, `LOW`, `INSUFFICIENT_HISTORY`) and Status (`OPEN`, `INVESTIGATING`, `ESCALATED`, `CLOSED`).
   - Multi-page pagination (`← Prev`, `Next →`).
   - View mode toggle (`All cases` / `Latest run`).

2. **Interactive Transaction Graph Engine**:
   - Dynamic topological and flow layering computing layered columns (`L`) and directed edges (`E`).
   - Edge widths proportional to transaction amounts.
   - Distinct dark ink rendering for trigger transactions and muted strokes for context transfers.
   - Inline edge amount labels with halo outline for contrast.
   - 1-second hover preview floating card (`.pv`).
   - Full-screen modal inspector (`.ov .md`).

3. **Analyst Investigation Panel**:
   - Comprehensive detail view including connected account view, transaction timeline (`.tx-table`), evidence cards (`.evidence-card`), caveats, and payload truncation warnings.
   - Human review form supporting status updates and mandatory outcome selection (`CONFIRMED_SUSPICIOUS`, `FALSE_POSITIVE`, `INCONCLUSIVE`) when closing.
   - Per-case SHA-256 tamper-evident review log verification.

4. **Scenario Console & CSV Import**:
   - Dropdown to replay any of the 14 built-in deterministic scenarios.
   - "Run all scenarios" batch runner.
   - File picker for streaming raw CSV imports up to 5 MiB / 100k rows.

---

## Running Locally

### Option A: Independent Vite Dev Server (Recommended for Frontend Dev)

1. Make sure the FastAPI backend is running on `http://127.0.0.1:8000`:
   ```bash
   cd ../backend
   python -m uvicorn traceguard.main:app --port 8000
   ```

2. Start the frontend development server:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:5173` in your browser. All `/api` and `/health` requests are automatically reverse-proxied to `http://127.0.0.1:8000`.

### Option B: Embedded Single-Origin Mode (via FastAPI Backend)

The backend also embeds these assets in `backend/traceguard/static/`:
```bash
cd backend
python -m uvicorn traceguard.main:app --port 8000
```
Open `http://127.0.0.1:8000/`.

---

## Production Build

To bundle the frontend for static deployment:
```bash
npm run build
```
Output files will be generated in `frontend/dist/`.
