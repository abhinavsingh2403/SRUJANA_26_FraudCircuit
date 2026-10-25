"""SQLite case persistence and per-case tamper-evident review history.

The hash chain helps detect edits/reordering of stored review events. It is not
an externally anchored audit log: a database owner can rewrite a chain or delete
its tail. Keep the service local-only and treat the chain as a demo integrity
control, not a production forensic guarantee.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GENESIS_HASH = "GENESIS"
_VALID_STATUSES = {"OPEN", "INVESTIGATING", "ESCALATED", "CLOSED"}
_VALID_OUTCOMES = {"CONFIRMED_SUSPICIOUS", "FALSE_POSITIVE", "INCONCLUSIVE"}
_EVENT_FIELDS = (
    "case_id", "previous_status", "new_status", "previous_outcome",
    "new_outcome", "reviewer", "note", "created_at", "prev_hash",
)


def database_path() -> str:
    return os.environ.get("TRACEGUARD_DB", "./traceguard.db")


def _connect(path: str | None = None) -> sqlite3.Connection:
    db_path = path or database_path()
    if db_path != ":memory:":
        db_path = str(Path(db_path).expanduser())
        Path(db_path).resolve().parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def _connection(path: str | None = None):
    conn = _connect(path)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _event_hash(event: dict[str, Any]) -> str:
    payload = {field: event.get(field) for field in _EVENT_FIELDS}
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _migrate(conn: sqlite3.Connection) -> None:
    case_columns = _columns(conn, "cases")
    if "review_outcome" not in case_columns:
        conn.execute("ALTER TABLE cases ADD COLUMN review_outcome TEXT")

    log_columns = _columns(conn, "review_log")
    legacy_chain = "event_hash" not in log_columns
    for column in ("previous_outcome", "new_outcome", "prev_hash", "event_hash"):
        if column not in log_columns:
            conn.execute(f"ALTER TABLE review_log ADD COLUMN {column} TEXT")

    if not legacy_chain:
        return

    # Migrate the prior skeleton's conflated status/outcome values into separate
    # workflow status and review outcome fields. Unknown statuses are preserved
    # only as historical text in the event log, never accepted by the new API.
    conn.execute("UPDATE cases SET status='CLOSED', review_outcome=COALESCE(review_outcome,'FALSE_POSITIVE') WHERE status='RESOLVED_LEGITIMATE'")
    conn.execute("UPDATE cases SET status='CLOSED', review_outcome=COALESCE(review_outcome,'CONFIRMED_SUSPICIOUS') WHERE status='CONFIRMED_SUSPICIOUS'")
    conn.execute("UPDATE cases SET status='CLOSED', review_outcome=COALESCE(review_outcome,'INCONCLUSIVE') WHERE status='INCONCLUSIVE'")

    # Convert historical event values, while filling outcome fields where the
    # prior API encoded the outcome inside status.
    rows = conn.execute("SELECT id, previous_status, new_status, previous_outcome, new_outcome FROM review_log ORDER BY case_id, id").fetchall()
    for row in rows:
        previous_status = row["previous_status"]
        new_status = row["new_status"]
        previous_outcome = row["previous_outcome"]
        new_outcome = row["new_outcome"]
        if previous_status == "RESOLVED_LEGITIMATE":
            previous_status, previous_outcome = "CLOSED", previous_outcome or "FALSE_POSITIVE"
        elif previous_status == "CONFIRMED_SUSPICIOUS":
            previous_status, previous_outcome = "CLOSED", previous_outcome or "CONFIRMED_SUSPICIOUS"
        elif previous_status == "INCONCLUSIVE":
            previous_status, previous_outcome = "CLOSED", previous_outcome or "INCONCLUSIVE"
        if new_status == "RESOLVED_LEGITIMATE":
            new_status, new_outcome = "CLOSED", new_outcome or "FALSE_POSITIVE"
        elif new_status == "CONFIRMED_SUSPICIOUS":
            new_status, new_outcome = "CLOSED", new_outcome or "CONFIRMED_SUSPICIOUS"
        elif new_status == "INCONCLUSIVE":
            new_status, new_outcome = "CLOSED", new_outcome or "INCONCLUSIVE"
        conn.execute(
            "UPDATE review_log SET previous_status=?, new_status=?, previous_outcome=?, new_outcome=? WHERE id=?",
            (previous_status, new_status, previous_outcome, new_outcome, row["id"]),
        )

    # Backfill hashes for legacy rows that predate the chain. Once populated,
    # subsequent startup does not silently recompute changed hashes.
    cases_with_unhashed = conn.execute(
        "SELECT DISTINCT case_id FROM review_log WHERE prev_hash IS NULL OR event_hash IS NULL"
    ).fetchall()
    for case_row in cases_with_unhashed:
        case_id = case_row["case_id"]
        event_rows = conn.execute("SELECT * FROM review_log WHERE case_id=? ORDER BY id", (case_id,)).fetchall()
        previous_hash = GENESIS_HASH
        for event_row in event_rows:
            event = dict(event_row)
            event["prev_hash"] = previous_hash
            digest = _event_hash(event)
            conn.execute(
                "UPDATE review_log SET prev_hash=?, event_hash=? WHERE id=?",
                (previous_hash, digest, event_row["id"]),
            )
            previous_hash = digest


def initialize(path: str | None = None) -> None:
    with _connection(path) as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cases (
                case_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                priority TEXT NOT NULL,
                status TEXT NOT NULL,
                source_scenario_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                review_outcome TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cases_source ON cases(source_scenario_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cases_run ON cases(run_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS review_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                case_id TEXT NOT NULL,
                previous_status TEXT NOT NULL,
                new_status TEXT NOT NULL,
                reviewer TEXT NOT NULL,
                note TEXT NOT NULL,
                created_at TEXT NOT NULL,
                previous_outcome TEXT,
                new_outcome TEXT,
                prev_hash TEXT,
                event_hash TEXT,
                FOREIGN KEY(case_id) REFERENCES cases(case_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_review_log_case ON review_log(case_id, id)")
        _migrate(conn)
        conn.execute("CREATE TABLE IF NOT EXISTS analysis_runs(run_id TEXT PRIMARY KEY, source_kind TEXT NOT NULL, completed_at TEXT NOT NULL, payload TEXT NOT NULL)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_source_time ON analysis_runs(source_kind, completed_at)")
        conn.execute("CREATE TABLE IF NOT EXISTS case_traces(case_id TEXT PRIMARY KEY,payload TEXT NOT NULL, FOREIGN KEY(case_id) REFERENCES cases(case_id))")


def upsert_cases(cases: list[dict[str, Any]], path: str | None = None, connection=None) -> None:
    now = _now()
    with (nullcontext(connection) if connection is not None else _connection(path)) as conn:
        for case in cases:
            case_id = str(case["case_id"])
            payload = dict(case)
            payload.pop("status", None)
            payload.pop("review_outcome", None)
            conn.execute("""
                INSERT INTO cases(case_id, run_id, priority, status, source_scenario_id, payload_json, created_at, updated_at, review_outcome)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(case_id) DO UPDATE SET
                    run_id=excluded.run_id,
                    priority=excluded.priority,
                    source_scenario_id=excluded.source_scenario_id,
                    payload_json=excluded.payload_json,
                    updated_at=excluded.updated_at
            """, (
                case_id, case["run_id"], case["priority"], case.get("status", "OPEN"),
                case["source_scenario_id"], json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False),
                now, now, case.get("review_outcome"),
            ))


def count_cases(priority: str | None = None, status: str | None = None,
                scenario_id: str | None = None, run_id: str | None = None,
                outcome: str | None = None, path: str | None = None) -> int:
    """Return the total number of cases matching the given filters."""
    sql = "SELECT COUNT(*) FROM cases WHERE 1=1"
    args: list[Any] = []
    for column, value in (("priority", priority), ("status", status),
                          ("source_scenario_id", scenario_id), ("run_id", run_id), ("review_outcome", outcome)):
        if value is not None:
            sql += f" AND {column} = ?"
            args.append(value)
    with _connection(path) as conn:
        return int(conn.execute(sql, args).fetchone()[0])


def list_cases(priority: str | None = None, status: str | None = None,
               scenario_id: str | None = None, run_id: str | None = None,
               outcome: str | None = None, limit: int = 100, offset: int = 0,
               path: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM cases WHERE 1=1"
    args: list[Any] = []
    for column, value in (("priority", priority), ("status", status),
                          ("source_scenario_id", scenario_id), ("run_id", run_id), ("review_outcome", outcome)):
        if value is not None:
            sql += f" AND {column} = ?"
            args.append(value)
    sql += " ORDER BY CASE priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END, updated_at DESC, case_id LIMIT ? OFFSET ?"
    args.append(max(1, min(limit, 500)))
    args.append(max(0, offset))
    with _connection(path) as conn:
        rows = conn.execute(sql, args).fetchall()
    results = []
    for row in rows:
        item = json.loads(row["payload_json"])
        item["status"] = row["status"]
        item["review_outcome"] = row["review_outcome"]
        item["created_at"] = row["created_at"]
        item["updated_at"] = row["updated_at"]
        results.append(item)
    return results


def get_case(case_id: str, path: str | None = None) -> dict[str, Any] | None:
    with _connection(path) as conn:
        row = conn.execute("SELECT * FROM cases WHERE case_id = ?", (case_id,)).fetchone()
    if row is None:
        return None
    item = json.loads(row["payload_json"])
    item["status"] = row["status"]
    item["review_outcome"] = row["review_outcome"]
    item["created_at"] = row["created_at"]
    item["updated_at"] = row["updated_at"]
    return item


def update_review(case_id: str, new_status: str, reviewer: str, note: str,
                  outcome: str | None = None, path: str | None = None) -> dict[str, Any] | None:
    if new_status not in _VALID_STATUSES:
        raise ValueError("Unsupported case status")
    if new_status == "CLOSED" and outcome not in _VALID_OUTCOMES:
        raise ValueError("A closed case requires outcome CONFIRMED_SUSPICIOUS, FALSE_POSITIVE, or INCONCLUSIVE")
    if new_status != "CLOSED" and outcome is not None:
        raise ValueError("Outcome can only be set when status is CLOSED")
    reviewer = reviewer.strip()
    note = note.strip()
    if not reviewer:
        raise ValueError("reviewer must not be blank")
    if len(reviewer) > 100 or len(note) > 1000:
        raise ValueError("reviewer or note exceeds the configured length limit")

    now = _now()
    with _connection(path) as conn:
        # Serialize review-log writers so two simultaneous updates cannot fork a chain.
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT status, review_outcome FROM cases WHERE case_id = ?", (case_id,)).fetchone()
        if row is None:
            return None
        integrity = _verify_review_chain(conn, case_id)
        if not integrity["valid"]:
            raise ValueError("Review log integrity failed; resolve the damaged record before appending")
        previous_status = row["status"]
        previous_outcome = row["review_outcome"]
        latest = conn.execute(
            "SELECT event_hash FROM review_log WHERE case_id=? ORDER BY id DESC LIMIT 1", (case_id,)
        ).fetchone()
        prev_hash = latest["event_hash"] if latest else GENESIS_HASH
        event = {
            "case_id": case_id,
            "previous_status": previous_status,
            "new_status": new_status,
            "previous_outcome": previous_outcome,
            "new_outcome": outcome,
            "reviewer": reviewer,
            "note": note,
            "created_at": now,
            "prev_hash": prev_hash,
        }
        digest = _event_hash(event)
        conn.execute(
            "UPDATE cases SET status=?, review_outcome=?, updated_at=? WHERE case_id=?",
            (new_status, outcome, now, case_id),
        )
        conn.execute("""
            INSERT INTO review_log(case_id, previous_status, new_status, reviewer, note, created_at,
                                  previous_outcome, new_outcome, prev_hash, event_hash)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (case_id, previous_status, new_status, reviewer, note, now,
              previous_outcome, outcome, prev_hash, digest))
    return get_case(case_id, path)


def review_history(case_id: str, path: str | None = None) -> list[dict[str, Any]]:
    with _connection(path) as conn:
        rows = conn.execute(
            """SELECT id, case_id, previous_status, new_status, previous_outcome, new_outcome,
                      reviewer, note, created_at, prev_hash, event_hash
               FROM review_log WHERE case_id = ? ORDER BY id""", (case_id,)
        ).fetchall()
    return [dict(row) for row in rows]


def _verify_review_chain(conn, case_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT status, review_outcome FROM cases WHERE case_id=?", (case_id,)).fetchone()
    if row is None:
        return None
    history = [dict(r) for r in conn.execute("SELECT * FROM review_log WHERE case_id=? ORDER BY id", (case_id,))]
    result = {
        "case_id": case_id, "valid": True, "event_count": len(history),
        "checked_at": _now(), "status": "verified" if history else "no_events",
        "current_status": row["status"], "current_outcome": row["review_outcome"],
        "warning": "Checks stored event hashes, continuity and current review state only. Reviewer names are self-reported. Case evidence is not covered by this chain. Without an external anchor a database owner can rewrite the whole chain or delete its tail.",
    }
    def failure(reason, event=None):
        return {**result, "valid": False, "status": "invalid", "reason": reason,
                "broken_at_event_id": event["id"] if event else None}
    previous = GENESIS_HASH
    last_state = ("OPEN", None)
    for event in history:
        if event["prev_hash"] != previous:
            return failure("previous_hash_mismatch", event)
        if _event_hash(event) != event["event_hash"]:
            return failure("event_hash_mismatch", event)
        if last_state is not None and last_state != (event["previous_status"], event["previous_outcome"]):
            return failure("review_transition_mismatch", event)
        if event["new_status"] not in _VALID_STATUSES or (event["new_status"] == "CLOSED" and event["new_outcome"] not in _VALID_OUTCOMES) or (event["new_status"] != "CLOSED" and event["new_outcome"] is not None):
            return failure("invalid_review_state", event)
        last_state = (event["new_status"], event["new_outcome"])
        previous = event["event_hash"]
    if history and last_state != (row["status"], row["review_outcome"]):
        return failure("current_state_mismatch")
    if not history and (row["status"] != "OPEN" or row["review_outcome"] is not None):
        return failure("missing_review_history")
    return {**result, "head_hash": previous}


def verify_review_chain(case_id: str, path: str | None = None) -> dict[str, Any] | None:
    with _connection(path) as conn:
        conn.execute("BEGIN")  # one read snapshot, including current state
        return _verify_review_chain(conn, case_id)


def review_outcome_summary(path: str | None = None) -> dict[str, Any]:
    with _connection(path) as conn:
        total = int(conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0])
        closed = int(conn.execute("SELECT COUNT(*) FROM cases WHERE status='CLOSED'").fetchone()[0])
        rows = conn.execute(
            "SELECT review_outcome, COUNT(*) AS count FROM cases WHERE review_outcome IS NOT NULL GROUP BY review_outcome"
        ).fetchall()
    counts = {outcome: 0 for outcome in sorted(_VALID_OUTCOMES)}
    for row in rows:
        counts[str(row["review_outcome"])] = int(row["count"])
    reviewed = sum(counts.values())
    return {
        "total_cases": total,
        "closed_cases": closed,
        "reviewed_cases_with_outcome": reviewed,
        "outcome_counts": counts,
        "warning": "These are outcomes among cases that humans reviewed and labelled, not the system-wide false-positive rate or fraud prevalence. Investigation queues are selected samples and may be biased.",
    }


def all_review_history(limit: int = 100, path: str | None = None) -> list[dict[str, Any]]:
    with _connection(path) as conn:
        rows = conn.execute(
            "SELECT case_id, previous_status, new_status, previous_outcome, new_outcome, reviewer, note, created_at, prev_hash, event_hash "
            "FROM review_log ORDER BY id DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
