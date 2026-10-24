import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from traceguard.main import app


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = os.environ.get("TRACEGUARD_DB")
        os.environ["TRACEGUARD_DB"] = os.path.join(self.temp.name, "test.db")
        self.client_context = TestClient(app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        if self.old_db is None:
            os.environ.pop("TRACEGUARD_DB", None)
        else:
            os.environ["TRACEGUARD_DB"] = self.old_db
        self.temp.cleanup()

    def test_health(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["model_status"], "not_configured")

    def test_list_scenarios(self):
        response = self.client.get("/api/scenarios")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.json()["scenarios"]), 4)

    def test_replay_one_and_list_case(self):
        replay = self.client.post("/api/scenarios/rapid-pass-through/replay", json={})
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["case_count"], 1)
        case_id = replay.json()["cases"][0]["case_id"]
        cases = self.client.get("/api/cases")
        self.assertEqual(cases.status_code, 200)
        self.assertIn(case_id, [case["case_id"] for case in cases.json()["cases"]])

    def test_unknown_scenario_404(self):
        response = self.client.post("/api/scenarios/not-a-scenario/replay", json={})
        self.assertEqual(response.status_code, 404)

    def test_unknown_replay_parameter_422(self):
        response = self.client.post("/api/scenarios/rapid-pass-through/replay", json={"params": {"magic": 1}})
        self.assertEqual(response.status_code, 422)

    def test_review_change_is_logged_and_hash_chain_verifies(self):
        replay = self.client.post("/api/scenarios/rapid-pass-through/replay", json={})
        case_id = replay.json()["cases"][0]["case_id"]
        response = self.client.patch(f"/api/cases/{case_id}/review", json={
            "status": "INVESTIGATING", "reviewer": "tester", "note": "Inspect transfer chain"
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "INVESTIGATING")
        self.assertEqual(len(response.json()["review_history"]), 1)
        self.assertEqual(response.json()["review_history"][0]["new_status"], "INVESTIGATING")
        audit = self.client.get(f"/api/cases/{case_id}/audit")
        self.assertEqual(audit.status_code, 200, audit.text)
        self.assertTrue(audit.json()["valid"])

    def test_closed_case_requires_explicit_human_outcome(self):
        replay = self.client.post("/api/scenarios/rapid-pass-through/replay", json={})
        case_id = replay.json()["cases"][0]["case_id"]
        response = self.client.patch(f"/api/cases/{case_id}/review", json={
            "status": "CLOSED", "reviewer": "tester", "note": "Not enough context"
        })
        self.assertEqual(response.status_code, 422)

    def test_outcome_is_rejected_for_non_closed_status(self):
        replay = self.client.post("/api/scenarios/rapid-pass-through/replay", json={})
        case_id = replay.json()["cases"][0]["case_id"]
        response = self.client.patch(f"/api/cases/{case_id}/review", json={
            "status": "INVESTIGATING", "outcome": "FALSE_POSITIVE", "reviewer": "tester", "note": "Invalid pairing"
        })
        self.assertEqual(response.status_code, 422)

    def test_false_positive_and_confirmed_suspicious_are_separate_outcomes(self):
        replay = self.client.post("/api/scenarios/replay-all")
        cases = replay.json()["cases"]
        self.assertGreaterEqual(len(cases), 2)
        case_a, case_b = cases[0], cases[1]
        first = self.client.patch(f"/api/cases/{case_a['case_id']}/review", json={
            "status": "CLOSED", "outcome": "FALSE_POSITIVE", "reviewer": "tester", "note": "Verified legitimate"
        })
        second = self.client.patch(f"/api/cases/{case_b['case_id']}/review", json={
            "status": "CLOSED", "outcome": "CONFIRMED_SUSPICIOUS", "reviewer": "tester", "note": "Confirmed in synthetic fixture only"
        })
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json()["review_outcome"], "FALSE_POSITIVE")
        self.assertEqual(second.json()["review_outcome"], "CONFIRMED_SUSPICIOUS")
        summary = self.client.get("/api/analytics/review-outcomes").json()
        self.assertEqual(summary["outcome_counts"]["FALSE_POSITIVE"], 1)
        self.assertEqual(summary["outcome_counts"]["CONFIRMED_SUSPICIOUS"], 1)
        self.assertIn("not the system-wide false-positive rate", summary["warning"])

    def test_case_filters_return_only_matching_results(self):
        replay = self.client.post("/api/scenarios/replay-all")
        cases = replay.json()["cases"]
        self.assertTrue(cases)
        case = cases[0]
        filtered = self.client.get("/api/cases", params={"run_id": case["run_id"], "scenario_id": case["source_scenario_id"], "limit": 10})
        self.assertEqual(filtered.status_code, 200)
        self.assertTrue(all(item["run_id"] == case["run_id"] for item in filtered.json()["cases"]))
        self.assertTrue(all(item["source_scenario_id"] == case["source_scenario_id"] for item in filtered.json()["cases"]))

    def test_reopening_case_clears_current_outcome_but_preserves_history(self):
        replay = self.client.post("/api/scenarios/rapid-pass-through/replay", json={})
        case_id = replay.json()["cases"][0]["case_id"]
        closed = self.client.patch(f"/api/cases/{case_id}/review", json={
            "status": "CLOSED", "outcome": "FALSE_POSITIVE", "reviewer": "tester", "note": "Reviewed"
        })
        self.assertEqual(closed.status_code, 200, closed.text)
        reopened = self.client.patch(f"/api/cases/{case_id}/review", json={
            "status": "INVESTIGATING", "reviewer": "tester", "note": "New evidence received"
        })
        self.assertEqual(reopened.status_code, 200, reopened.text)
        self.assertIsNone(reopened.json()["review_outcome"])
        self.assertEqual(len(reopened.json()["review_history"]), 2)
        audit = self.client.get(f"/api/cases/{case_id}/audit").json()
        self.assertTrue(audit["valid"], audit)

    def test_review_hash_chain_detects_event_edit(self):
        from traceguard import db
        replay = self.client.post("/api/scenarios/rapid-pass-through/replay", json={})
        case_id = replay.json()["cases"][0]["case_id"]
        self.client.patch(f"/api/cases/{case_id}/review", json={
            "status": "INVESTIGATING", "reviewer": "tester", "note": "Original note"
        })
        with db._connection() as conn:
            conn.execute("UPDATE review_log SET note='tampered' WHERE case_id=?", (case_id,))
        audit = self.client.get(f"/api/cases/{case_id}/audit")
        self.assertEqual(audit.status_code, 200)
        self.assertFalse(audit.json()["valid"])

    def test_unknown_case_404(self):
        self.assertEqual(self.client.get("/api/cases/nope").status_code, 404)

    def test_csv_import_and_sensitive_columns_removed(self):
        raw = (
            "transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type,isFraud,oldbalanceOrg\n"
            "X1,2026-10-24T09:00:00Z,A,B,100,TRANSFER,1,0\n"
        )
        response = self.client.post("/api/transactions/import", content=raw, headers={"content-type": "text/csv"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["transaction_count"], 1)
        self.assertIn("isFraud", response.json()["dropped_columns"])

    def test_bad_csv_422(self):
        response = self.client.post("/api/transactions/import", content="not,a,canonical,csv\n", headers={"content-type": "text/csv"})
        self.assertEqual(response.status_code, 422)


    def test_blank_reviewer_rejected(self):
        replay = self.client.post("/api/scenarios/rapid-pass-through/replay", json={})
        case_id = replay.json()["cases"][0]["case_id"]
        response = self.client.patch(f"/api/cases/{case_id}/review", json={
            "status": "INVESTIGATING", "reviewer": "   ", "note": ""
        })
        self.assertEqual(response.status_code, 422)

    def test_oversized_content_length_rejected_before_body_read(self):
        from traceguard.config import DEFAULT_SETTINGS
        response = self.client.post(
            "/api/transactions/import", content=b"",
            headers={"content-type": "text/csv", "content-length": str(DEFAULT_SETTINGS.max_upload_bytes + 1)},
        )
        self.assertEqual(response.status_code, 413)

    def test_evaluation_does_not_invent_metrics(self):
        response = self.client.get("/api/evaluation/summary")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["evaluation_status"], "not_run")
        self.assertIsNone(response.json()["metrics"])
        self.assertIn("controlled synthetic episode benchmark", response.json()["message"])
        self.assertIn("not evidence of real-world", response.json()["message"])

    def test_openapi_document_exists(self):
        response = self.client.get("/openapi.json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("/api/cases", response.json()["paths"])

    def test_case_pagination_with_limit_and_offset(self):
        self.client.post("/api/scenarios/replay-all")
        page1 = self.client.get("/api/cases", params={"limit": 5, "offset": 0})
        self.assertEqual(page1.status_code, 200)
        data1 = page1.json()
        self.assertEqual(data1["count"], 5)
        self.assertEqual(data1["total"], 13)
        self.assertEqual(data1["offset"], 0)
        self.assertEqual(data1["limit"], 5)

        page2 = self.client.get("/api/cases", params={"limit": 5, "offset": 5})
        self.assertEqual(page2.status_code, 200)
        data2 = page2.json()
        self.assertEqual(data2["count"], 5)
        self.assertEqual(data2["total"], 13)
        self.assertEqual(data2["offset"], 5)

        ids1 = {c["case_id"] for c in data1["cases"]}
        ids2 = {c["case_id"] for c in data2["cases"]}
        self.assertTrue(ids1.isdisjoint(ids2))

        page3 = self.client.get("/api/cases", params={"limit": 5, "offset": 10})
        self.assertEqual(page3.status_code, 200)
        self.assertEqual(page3.json()["count"], 3)
        self.assertEqual(page3.json()["total"], 13)

    def test_zero_case_scenario_replay_scoping(self):
        replay = self.client.post("/api/scenarios/legitimate-high-volume/replay", json={})
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["case_count"], 0)
        run_id = replay.json()["run_id"]
        scoped = self.client.get("/api/cases", params={"run_id": run_id})
        self.assertEqual(scoped.status_code, 200)
        self.assertEqual(scoped.json()["count"], 0)
        self.assertEqual(scoped.json()["total"], 0)
        self.assertEqual(scoped.json()["cases"], [])


if __name__ == "__main__":
    unittest.main()
