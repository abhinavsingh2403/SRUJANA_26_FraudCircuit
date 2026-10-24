import unittest
from datetime import datetime, timedelta, timezone

from traceguard.config import Settings
from traceguard.features import build_features
from traceguard.fixtures import SCENARIOS, scenario_transactions
from traceguard.pipeline import analyse_transactions


class FeatureAndPipelineTests(unittest.TestCase):
    def test_same_timestamp_is_not_treated_as_prior_history(self):
        from traceguard.domain import Transaction
        timestamp = datetime(2026, 10, 24, tzinfo=timezone.utc)
        micros = int(timestamp.timestamp() * 1_000_000)
        t1 = Transaction("IN", micros, timestamp.isoformat().replace("+00:00", "Z"), "A", "M", 1000.0, "TRANSFER")
        t2 = Transaction("OUT", micros, timestamp.isoformat().replace("+00:00", "Z"), "M", "B", 900.0, "TRANSFER")
        features = build_features([t1, t2])
        self.assertEqual(features["OUT"].prior_inbound_count, 0)
        _, cases = analyse_transactions([t1, t2], "same-time")
        self.assertEqual(cases, [])


    def test_supporting_transaction_ids_are_bounded_and_marked(self):
        from traceguard.domain import Transaction
        base = datetime(2026, 10, 24, tzinfo=timezone.utc)
        txs = []
        for i in range(30):
            dt = base + timedelta(minutes=i)
            ts_us = int(dt.timestamp() * 1_000_000)
            txs.append(Transaction(f"IN-{i:02d}", ts_us, dt.isoformat().replace("+00:00", "Z"), f"SOURCE-{i}", "M", 100.0, "TRANSFER"))
        dt = base + timedelta(minutes=31)
        txs.append(Transaction("OUT", int(dt.timestamp() * 1_000_000), dt.isoformat().replace("+00:00", "Z"), "M", "DEST", 1.0, "TRANSFER"))
        features = build_features(txs)["OUT"]
        self.assertEqual(features.prior_inbound_count, 30)
        self.assertEqual(len(features.prior_inbound_transaction_ids), 20)
        self.assertTrue(features.prior_inbound_ids_truncated)

    def test_rapid_pass_through_rule_is_visible_but_low_priority_alone(self):
        _, cases = analyse_transactions(scenario_transactions("rapid-pass-through"), "rapid-pass-through")
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["priority"], "LOW")
        self.assertIn("R1_RAPID_PASS_THROUGH", cases[0]["rule_codes"])

    def test_fan_in_dispersal_is_not_high_from_correlated_flow_rules_alone(self):
        _, cases = analyse_transactions(scenario_transactions("fan-in-dispersal"), "fan-in-dispersal")
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["priority"], "MEDIUM")
        self.assertIn("R1_RAPID_PASS_THROUGH", cases[0]["rule_codes"])
        self.assertIn("R2_FAN_IN_DISPERSAL", cases[0]["rule_codes"])
        self.assertTrue(cases[0]["context_transactions"])

    def test_legitimate_high_volume_fixture_has_no_alerts(self):
        _, cases = analyse_transactions(scenario_transactions("legitimate-high-volume"), "legitimate-high-volume")
        self.assertEqual(cases, [])

    def test_insufficient_history_case_is_not_a_fraud_signal(self):
        _, cases = analyse_transactions(scenario_transactions("insufficient-history"), "insufficient-history")
        matching = [case for case in cases if case["priority"] == "INSUFFICIENT_HISTORY"]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["rule_codes"], [])
        self.assertIn("R3_BASELINE_UNAVAILABLE", [item["rule_id"] for item in matching[0]["evidence"]])
        self.assertTrue(all(item["kind"] == "COVERAGE_LIMITATION" for item in matching[0]["evidence"]))

    def test_account_amount_deviation(self):
        _, cases = analyse_transactions(scenario_transactions("amount-deviation"), "amount-deviation")
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["priority"], "MEDIUM")
        self.assertIn("R3_AMOUNT_DEVIATION", cases[0]["rule_codes"])

    def test_two_rules_on_one_transaction_do_not_automatically_make_high_priority(self):
        from traceguard.cases import _priority
        from traceguard.domain import Evidence
        evidence = [
            Evidence("e1", "R1_RAPID_PASS_THROUGH", "R1", "RULE_SIGNAL", "signal",
                     "TX-1", ("TX-1",), ("A", "B"), {}, ()),
            Evidence("e2", "R2_FAN_IN_DISPERSAL", "R2", "RULE_SIGNAL", "signal",
                     "TX-1", ("TX-1",), ("A", "B"), {}, ()),
        ]
        self.assertEqual(_priority(evidence), "MEDIUM")

    def test_case_ids_are_deterministic(self):
        txs = scenario_transactions("fan-in-dispersal")
        _, cases_a = analyse_transactions(txs, "fan-in-dispersal")
        _, cases_b = analyse_transactions(txs, "fan-in-dispersal")
        self.assertEqual([c["case_id"] for c in cases_a], [c["case_id"] for c in cases_b])

    def test_evidence_ids_reference_known_transactions(self):
        txs = scenario_transactions("fan-in-dispersal")
        known = {tx.transaction_id for tx in txs}
        _, cases = analyse_transactions(txs, "fan-in-dispersal")
        for case in cases:
            for evidence in case["evidence"]:
                self.assertTrue(set(evidence["transaction_ids"]).issubset(known))
                self.assertIn(evidence["trigger_transaction_id"], known)

    def test_scenario_parameter_bounds(self):
        from traceguard.fixtures import apply_scenario_params
        with self.assertRaises(ValueError):
            apply_scenario_params(scenario_transactions("rapid-pass-through"), {"gap_scale": 0})
        with self.assertRaises(ValueError):
            apply_scenario_params(scenario_transactions("rapid-pass-through"), {"amount_scale": 2000})

    def test_case_rule_codes_exclude_coverage_warning(self):
        _, cases = analyse_transactions(scenario_transactions("insufficient-history"), "insufficient-history")
        case = next(c for c in cases if c["priority"] == "INSUFFICIENT_HISTORY")
        self.assertEqual(case["rule_codes"], [])
        self.assertIsNone(case["score_components"]["model_score"])


    def test_short_high_volume_burst_does_not_get_low_priority_from_its_own_history(self):
        from traceguard.domain import Transaction
        base = datetime(2026, 10, 24, tzinfo=timezone.utc)
        txs = []
        for i in range(1, 8):
            dt = base + timedelta(minutes=i * 5)
            txs.append(Transaction(f"CTX-{i}", int(dt.timestamp() * 1_000_000), dt.isoformat().replace("+00:00", "Z"),
                                  "BUSINESS", f"RECIPIENT-{i}", 100.0, "TRANSFER"))
        _, cases = analyse_transactions(txs, "context-only")
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["priority"], "MEDIUM")
        self.assertNotIn("C1_STABLE_AMOUNT_CONTEXT", cases[0]["context_codes"])
        self.assertIn("R2B_FAN_OUT_BURST", cases[0]["rule_codes"])

    def test_legitimate_settlement_case_shows_context_without_suppressing_signal(self):
        _, cases = analyse_transactions(scenario_transactions("legitimate-settlement-context"), "legitimate-settlement-context")
        self.assertEqual(len(cases), 1)
        case = cases[0]
        self.assertIn("R2_FAN_IN_DISPERSAL", case["rule_codes"])
        self.assertIn("C1_STABLE_AMOUNT_CONTEXT", case["context_codes"])
        self.assertEqual(case["priority"], "LOW")
        self.assertTrue(any("legitimate" in caveat.lower() for ev in case["evidence"] for caveat in ev["caveats"]))

    def test_case_payload_truncation_is_explicit(self):
        from traceguard.config import Settings
        txs = scenario_transactions("fan-in-dispersal")
        settings = Settings(max_case_trigger_transactions=1, max_case_context_transactions=1,
                            max_case_account_ids=2, max_case_evidence_items=1)
        _, cases = analyse_transactions(txs, "fan-in-dispersal", settings)
        self.assertEqual(len(cases), 1)
        case = cases[0]
        self.assertTrue(case["truncation"]["trigger_transactions"])
        self.assertTrue(case["truncation"]["context_transactions"])
        self.assertTrue(case["truncation"]["account_ids"])
        self.assertTrue(case["truncation"]["evidence"])
        self.assertEqual(case["counts"]["trigger_transactions_total"], 2)
        self.assertEqual(len(case["transaction_ids"]), 1)

    def test_case_grouping_requires_explicit_evidence_overlap_and_bounds_span(self):
        from traceguard.cases import _related_components
        from traceguard.domain import Evidence, Transaction, TransactionAnalysis
        base = datetime(2026, 10, 24, tzinfo=timezone.utc)
        analyses = []
        txs = []
        for i, hours in enumerate((0, 5, 10, 15, 20, 25, 30)):
            dt = base + timedelta(hours=hours)
            tx = Transaction(
                f"SPAN-{i}", int(dt.timestamp() * 1_000_000),
                dt.isoformat().replace("+00:00", "Z"), "SHARED", f"RECIPIENT-{i}", 10.0, "TRANSFER"
            )
            txs.append(tx)
        for i, tx in enumerate(txs):
            refs = (tx.transaction_id,) if i == 0 else (tx.transaction_id, txs[i - 1].transaction_id)
            ev = Evidence(
                evidence_id=f"ev-{i}", rule_id="R1_RAPID_PASS_THROUGH", title="Test signal",
                kind="RULE_SIGNAL", description="Test-only evidence", trigger_transaction_id=tx.transaction_id,
                transaction_ids=refs, account_ids=("SHARED",), observed={}, caveats=()
            )
            analyses.append(TransactionAnalysis(tx, (ev,), {}))
        groups = _related_components(analyses, max_span_us=24 * 60 * 60 * 1_000_000)
        group_sizes = sorted((len(group) for group in groups), reverse=True)
        self.assertEqual(group_sizes, [5, 2])
        for group in groups:
            times = [row.transaction.timestamp_us for row in group]
            self.assertLessEqual(max(times) - min(times), 24 * 60 * 60 * 1_000_000)

    def test_case_grouping_does_not_merge_on_shared_account_alone(self):
        from traceguard.cases import _related_components
        from traceguard.domain import Evidence, Transaction, TransactionAnalysis
        base = datetime(2026, 10, 24, tzinfo=timezone.utc)
        analyses = []
        for i in range(5):
            dt = base + timedelta(minutes=i)
            tx = Transaction(f"SHARED-{i}", int(dt.timestamp() * 1_000_000), dt.isoformat().replace("+00:00", "Z"),
                             "SAME-ACCOUNT", f"DEST-{i}", 10.0, "TRANSFER")
            ev = Evidence(evidence_id=f"shared-ev-{i}", rule_id="R1_RAPID_PASS_THROUGH", title="Test signal",
                          kind="RULE_SIGNAL", description="Test-only evidence", trigger_transaction_id=tx.transaction_id,
                          transaction_ids=(tx.transaction_id,), account_ids=("SAME-ACCOUNT",), observed={}, caveats=())
            analyses.append(TransactionAnalysis(tx, (ev,), {}))
        groups = _related_components(analyses, max_span_us=24 * 60 * 60 * 1_000_000)
        self.assertEqual(len(groups), 5)

    def test_extreme_amounts_do_not_emit_non_finite_feature_values(self):
        import json
        from traceguard.domain import Transaction
        base = datetime(2026, 10, 24, tzinfo=timezone.utc)
        txs = []
        for tx_id, minute, sender, recipient, amount in [
            ("TINY-IN", 0, "A", "B", 5e-324),
            ("LARGE-OUT", 1, "B", "C", 1e18),
        ]:
            dt = base + timedelta(minutes=minute)
            txs.append(Transaction(tx_id, int(dt.timestamp() * 1_000_000), dt.isoformat().replace("+00:00", "Z"),
                                   sender, recipient, amount, "TRANSFER"))
        features = build_features(txs)
        # Serialization as strict JSON catches NaN and Infinity silently leaking into API payloads.
        json.dumps({key: value.to_dict() for key, value in features.items()}, allow_nan=False)

    def test_all_fixture_payloads_are_strict_json(self):
        import json
        for scenario_id in SCENARIOS:
            _, cases = analyse_transactions(scenario_transactions(scenario_id), scenario_id)
            json.dumps(cases, allow_nan=False)

    def test_amount_deviation_cites_baseline_transactions(self):
        from traceguard.domain import Transaction
        base = datetime(2026, 10, 1, tzinfo=timezone.utc)
        txs = []
        # 6 baseline transactions spaced across days (outside the 24h rolling window, within 30-day baseline)
        for i in range(6):
            dt = base + timedelta(days=i)
            txs.append(Transaction(f"BASE-{i}", int(dt.timestamp() * 1_000_000), dt.isoformat().replace("+00:00", "Z"),
                                   "ACCOUNT-DEV", "DEST", 100.0, "TRANSFER"))
        # Outlier transaction on day 10
        dt_out = base + timedelta(days=10)
        txs.append(Transaction("OUTLIER", int(dt_out.timestamp() * 1_000_000), dt_out.isoformat().replace("+00:00", "Z"),
                               "ACCOUNT-DEV", "DEST", 2500.0, "TRANSFER"))
        _, cases = analyse_transactions(txs, "deviation-test")
        self.assertEqual(len(cases), 1)
        r3_items = [ev for ev in cases[0]["evidence"] if ev["rule_id"] == "R3_AMOUNT_DEVIATION"]
        self.assertEqual(len(r3_items), 1)
        r3 = r3_items[0]
        # Verify baseline transactions from days ago are cited in transaction_ids
        for i in range(6):
            self.assertIn(f"BASE-{i}", r3["transaction_ids"])
        self.assertIn("OUTLIER", r3["transaction_ids"])
        self.assertEqual(r3["observed"]["history_count"], 6)
        self.assertFalse(r3["observed"]["supporting_ids_truncated"])

    def test_amount_deviation_with_capped_baseline_records_truncation(self):
        from traceguard.domain import Transaction
        base = datetime(2026, 10, 1, tzinfo=timezone.utc)
        txs = []
        # 25 baseline transactions (exceeds default max_supporting_transaction_ids of 20)
        for i in range(25):
            dt = base + timedelta(hours=i * 12)
            txs.append(Transaction(f"BASE-{i:02d}", int(dt.timestamp() * 1_000_000), dt.isoformat().replace("+00:00", "Z"),
                                   "ACCOUNT-HEAVY", "DEST", 50.0, "TRANSFER"))
        dt_out = base + timedelta(days=15)
        txs.append(Transaction("OUTLIER-HEAVY", int(dt_out.timestamp() * 1_000_000), dt_out.isoformat().replace("+00:00", "Z"),
                               "ACCOUNT-HEAVY", "DEST", 1000.0, "TRANSFER"))
        _, cases = analyse_transactions(txs, "deviation-cap-test")
        self.assertEqual(len(cases), 1)
        r3_items = [ev for ev in cases[0]["evidence"] if ev["rule_id"] == "R3_AMOUNT_DEVIATION"]
        self.assertEqual(len(r3_items), 1)
        r3 = r3_items[0]
        self.assertEqual(r3["observed"]["history_count"], 25)
        self.assertTrue(r3["observed"]["supporting_ids_truncated"])
        # Capped at 20 supporting + 1 trigger = 21 unique IDs
        self.assertLessEqual(len(r3["transaction_ids"]), 21)

if __name__ == "__main__":
    unittest.main()
