"""Sanity tests for the deterministic synthetic benchmark generator."""
import random
import unittest

from scripts.run_controlled_benchmark import _make_episode


class ControlledBenchmarkGeneratorTests(unittest.TestCase):
    def test_layered_chain_generator_is_strictly_time_ordered(self):
        transactions, label, _ = _make_episode("layered_chain", "test", 1, random.Random(12345))
        self.assertEqual(label, 1)
        times = [tx.timestamp_us for tx in transactions]
        self.assertEqual(times, sorted(times))
        self.assertEqual(len(transactions), 4)
        self.assertEqual([tx.sender_id.rsplit("-", 1)[-1] for tx in transactions], ["A", "B", "C", "D"])

    def test_negative_generator_labels_are_not_fraud_labels(self):
        transactions, label, _ = _make_episode("merchant_settlement", "test", 1, random.Random(12345))
        self.assertEqual(label, 0)
        self.assertGreater(len(transactions), 0)

    def test_compound_generator_contains_distinct_destinations_for_burst(self):
        transactions, label, _ = _make_episode("compound_layered_cycle", "test", 1, random.Random(12345))
        self.assertEqual(label, 1)
        recipients = {tx.recipient_id for tx in transactions if tx.sender_id.endswith("-E") and "DEST-" in tx.recipient_id}
        self.assertGreaterEqual(len(recipients), 10)


if __name__ == "__main__":
    unittest.main()
