import json
import os
import sqlite3
import tempfile
import unittest

from traceguard import db


class DatabaseMigrationTests(unittest.TestCase):
    def test_legacy_resolved_legitimate_status_migrates_and_hashes_review_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "legacy.db")
            conn = sqlite3.connect(path)
            conn.execute("""CREATE TABLE cases (
                case_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, priority TEXT NOT NULL,
                status TEXT NOT NULL, source_scenario_id TEXT NOT NULL, payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
            conn.execute("""CREATE TABLE review_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL,
                previous_status TEXT NOT NULL, new_status TEXT NOT NULL,
                reviewer TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL)""")
            payload = {"case_id": "case_legacy", "run_id": "run_legacy", "priority": "MEDIUM",
                       "source_scenario_id": "legacy", "transaction_ids": [], "context_transaction_ids": [],
                       "account_ids": [], "rule_codes": [], "evidence": [], "summary": "legacy"}
            conn.execute("INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                         ("case_legacy", "run_legacy", "MEDIUM", "RESOLVED_LEGITIMATE", "legacy",
                          json.dumps(payload), "2026-10-24T00:00:00Z", "2026-10-24T00:00:00Z"))
            conn.execute("INSERT INTO review_log(case_id, previous_status, new_status, reviewer, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                         ("case_legacy", "OPEN", "RESOLVED_LEGITIMATE", "reviewer", "legacy note", "2026-10-24T00:01:00Z"))
            conn.commit()
            conn.close()

            db.initialize(path)
            case = db.get_case("case_legacy", path)
            self.assertEqual(case["status"], "CLOSED")
            self.assertEqual(case["review_outcome"], "FALSE_POSITIVE")
            history = db.review_history("case_legacy", path)
            self.assertEqual(history[0]["new_status"], "CLOSED")
            self.assertEqual(history[0]["new_outcome"], "FALSE_POSITIVE")
            audit = db.verify_review_chain("case_legacy", path)
            self.assertTrue(audit["valid"], audit)


if __name__ == "__main__":
    unittest.main()
