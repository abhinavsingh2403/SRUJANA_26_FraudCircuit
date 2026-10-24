"""Regression tests for specifically reported adversarial gaps."""
import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from traceguard.fixtures import SCENARIOS, scenario_transactions
from traceguard.config import Settings
from traceguard.graph_analysis import detect_graph_patterns
from traceguard.domain import Transaction
from traceguard.main import app
from traceguard.pipeline import analyse_transactions_detailed
from traceguard.service import _analysis_warnings


class AdversarialScenarioTests(unittest.TestCase):
    def analyze(self, scenario_id):
        return analyse_transactions_detailed(scenario_transactions(scenario_id), scenario_id)

    def all_rule_codes(self, cases):
        return {code for case in cases for code in case["rule_codes"]}

    def test_ninety_minute_pass_through_uses_six_hour_window(self):
        _, cases, _ = self.analyze("delayed-pass-through-90m")
        signals = [e for c in cases for e in c["evidence"] if e["rule_id"] == "R1_RAPID_PASS_THROUGH"]
        self.assertTrue(signals)
        self.assertTrue(any(21600 in e["observed"]["matched_windows_seconds"] for e in signals))
        # One pass-through signal remains visible but is not promoted to actionable
        # priority without another distinct signal.
        self.assertTrue(cases)
        self.assertEqual(cases[0]["priority"], "LOW")

    def test_single_inflow_four_recipient_fanout_is_detected(self):
        _, cases, _ = self.analyze("single-inflow-four-way-split")
        self.assertIn("R2B_FAN_OUT_BURST", self.all_rule_codes(cases))

    def test_eight_sender_collector_is_detected(self):
        _, cases, _ = self.analyze("fan-in-collector")
        self.assertIn("R2A_FAN_IN_CLUSTER", self.all_rule_codes(cases))

    def test_repeated_value_pattern_is_detected_without_legal_claim(self):
        _, cases, _ = self.analyze("repeated-value-burst")
        evidence = [e for c in cases for e in c["evidence"] if e["rule_id"] == "R6_REPEATED_VALUE_BURST"]
        self.assertTrue(evidence)
        self.assertTrue(any("not a legal structuring determination" in " ".join(e["caveats"]).lower() for e in evidence))

    def test_cycle_detection_returns_exact_cycle(self):
        _, cases, stats = self.analyze("directed-cycle")
        evidence = [e for c in cases for e in c["evidence"] if e["rule_id"] == "R4_DIRECTED_CYCLE"]
        self.assertTrue(evidence)
        self.assertEqual(stats["directed_cycles_detected"], 1)
        self.assertEqual(evidence[0]["observed"]["cycle_length"], 3)
        self.assertEqual(set(evidence[0]["transaction_ids"]), {"CYCLE-AB", "CYCLE-BC", "CYCLE-CA"})

    def test_graph_budget_warning_is_visible_in_stats_and_case_limitations(self):
        txs = scenario_transactions("directed-cycle")
        run_id, cases, stats = analyse_transactions_detailed(
            txs, "forced-budget-test", Settings(graph_search_expansion_limit=1)
        )
        self.assertTrue(run_id)
        self.assertEqual(stats["graph_analysis_incomplete"], 1)
        warnings = _analysis_warnings(stats)
        self.assertTrue(warnings)
        self.assertTrue(any("graph motifs may have been missed" in warning.lower() for warning in warnings))
        self.assertTrue(cases)
        self.assertTrue(any(any("graph analysis reached its per-event expansion limit" in item.lower()
                                for item in case["limitations"]) for case in cases))

    def test_cycle_with_edges_in_reverse_time_order_is_not_reported(self):
        base = datetime(2026, 10, 24, tzinfo=timezone.utc)
        def tx(txid, minute, sender, recipient, amount):
            dt = base + timedelta(minutes=minute)
            return Transaction(txid, int(dt.timestamp() * 1_000_000),
                               dt.isoformat().replace("+00:00", "Z"), sender, recipient,
                               float(amount), "TRANSFER", "INR")
        # These edges form a directed topological cycle, but B->C occurred before
        # A->B. They cannot be represented as the ordered A->B->C->A flow.
        txs = [tx("AB-late", 10, "A", "B", 1000),
               tx("BC-early", 5, "B", "C", 900),
               tx("CA-close", 15, "C", "A", 800)]
        result = detect_graph_patterns(txs)
        self.assertEqual(result.stats["directed_cycles_detected"], 0)
        self.assertFalse(any(e.rule_id == "R4_DIRECTED_CYCLE"
                             for items in result.evidence_by_transaction.values() for e in items))

    def test_layered_chain_detection_regression(self):
        _, cases, stats = self.analyze("layered-chain")
        evidence = [e for c in cases for e in c["evidence"] if e["rule_id"] == "R5_LAYERED_CHAIN"]
        self.assertTrue(evidence, "Layered-chain fixture must exercise R5")
        self.assertGreaterEqual(max(e["observed"]["chain_hops"] for e in evidence), 4)
        self.assertGreater(stats["layered_chains_detected"], 0)

    def test_layered_chain_rejects_reverse_and_simultaneous_internal_hops(self):
        from dataclasses import replace
        original = scenario_transactions("layered-chain")
        for stamp in (original[1].timestamp_us, original[1].timestamp_us + 1):
            with self.subTest(first_hop_timestamp=stamp):
                txs = [replace(original[0], timestamp_us=stamp), *original[1:]]
                result = detect_graph_patterns(txs)
                self.assertEqual(result.stats["layered_chains_detected"], 0)

    def test_low_pass_through_summary_does_not_invent_context(self):
        _, cases, _ = self.analyze("rapid-pass-through")
        self.assertEqual(cases[0]["context_codes"], [])
        self.assertNotIn("with supporting context", cases[0]["summary"])
        self.assertIn("not evidence of benign activity", cases[0]["summary"])

    def test_dormant_reactivation_is_detected_with_explicit_gap(self):
        _, cases, _ = self.analyze("dormant-reactivation")
        evidence = [e for c in cases for e in c["evidence"] if e["rule_id"] == "R7_DORMANT_REACTIVATION"]
        self.assertTrue(evidence)
        self.assertGreaterEqual(evidence[0]["observed"]["seconds_since_last_outbound"], 30 * 24 * 60 * 60)

    def test_compound_linked_motif_can_be_high_but_single_cycle_not_high(self):
        _, cycle_cases, _ = self.analyze("directed-cycle")
        _, compound_cases, _ = self.analyze("compound-layered-cycle")
        self.assertNotEqual(cycle_cases[0]["priority"], "HIGH")
        self.assertEqual(compound_cases[0]["priority"], "HIGH")


    def test_bounded_graph_search_exposes_incomplete_status(self):
        # Three-edge cycle normally requires more than one graph-edge expansion.
        # A deliberately tiny budget must be surfaced as incomplete, not as clean.
        txs = scenario_transactions("directed-cycle")
        result = detect_graph_patterns(txs, Settings(graph_search_expansion_limit=1))
        self.assertEqual(result.stats["graph_search_expansion_limit"], 1)
        self.assertGreater(result.stats["cycle_search_budget_exhausted"], 0)
        self.assertEqual(result.stats["graph_analysis_incomplete"], 1)

    def test_legitimate_regular_payroll_spacing_does_not_create_case(self):
        _, cases, _ = self.analyze("legitimate-high-volume")
        self.assertEqual(cases, [])

    def test_legitimate_settlement_context_is_not_marked_as_proven_legitimate(self):
        _, cases, _ = self.analyze("legitimate-settlement-context")
        self.assertTrue(cases)
        self.assertEqual(cases[0]["priority"], "LOW")
        self.assertTrue(any("Context signals do not prove legitimacy" in item for item in cases[0]["limitations"]))

    def test_every_scenario_has_documented_expected_outcome_and_runs(self):
        self.assertGreaterEqual(len(SCENARIOS), 12)
        for scenario_id, meta in SCENARIOS.items():
            self.assertTrue(meta.get("expected"), scenario_id)
            _, cases, _ = self.analyze(scenario_id)
            self.assertIsInstance(cases, list)


class FrontendAndCorsTests(unittest.TestCase):
    def setUp(self):
        import os, tempfile
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = os.environ.get("TRACEGUARD_DB")
        os.environ["TRACEGUARD_DB"] = self.temp.name + "/traceguard-test.db"
        self.ctx = TestClient(app)
        self.client = self.ctx.__enter__()

    def tearDown(self):
        import os
        self.ctx.__exit__(None, None, None)
        if self.old_db is None: os.environ.pop("TRACEGUARD_DB", None)
        else: os.environ["TRACEGUARD_DB"] = self.old_db
        self.temp.cleanup()

    def test_frontend_home_is_served(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("TraceGuard", response.text)
        self.assertIn("/static/app.js", response.text)

    def test_frontend_assets_are_served(self):
        self.assertEqual(self.client.get("/static/app.js").status_code, 200)
        self.assertEqual(self.client.get("/static/styles.css").status_code, 200)

    def test_cors_allows_configured_vite_origin(self):
        response = self.client.options("/api/cases", headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:5173")

    def test_cors_does_not_reflect_unknown_origin(self):
        response = self.client.options("/api/cases", headers={
            "Origin": "http://evil.example",
            "Access-Control-Request-Method": "GET",
        })
        self.assertNotEqual(response.headers.get("access-control-allow-origin"), "http://evil.example")

    def test_startup_check_verifies_environment_and_assets(self):
        from traceguard.startup import check_environment
        result = check_environment()
        self.assertTrue(result["static_assets_ok"])
        self.assertTrue(result["db_writable"])
        self.assertTrue(result["settings_valid"])
        self.assertGreaterEqual(result["scenarios_loaded"], 14)


if __name__ == "__main__":
    unittest.main()
