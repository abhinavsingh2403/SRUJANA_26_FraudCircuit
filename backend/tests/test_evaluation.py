import unittest
from traceguard.evaluation import average_precision, binary_metrics, chronological_split, precision_at_k


class EvaluationTests(unittest.TestCase):
    def test_chronological_split_does_not_split_same_step(self):
        steps = [1, 1, 2, 3, 3, 4, 5, 6, 6, 7]
        result = chronological_split(steps, 0.6, 0.2)
        train_steps = {steps[i] for i in result.train_indices}
        val_steps = {steps[i] for i in result.validation_indices}
        test_steps = {steps[i] for i in result.test_indices}
        self.assertFalse(train_steps & val_steps)
        self.assertFalse(train_steps & test_steps)
        self.assertFalse(val_steps & test_steps)
        self.assertEqual(len(result.train_indices) + len(result.validation_indices) + len(result.test_indices), len(steps))

    def test_invalid_chronological_ratios(self):
        with self.assertRaises(ValueError):
            chronological_split([1, 2, 3], 0.8, 0.3)

    def test_chronological_split_rejects_fractional_or_non_finite_steps(self):
        for steps in ([1, 2.5, 3, 4], [1, float("nan"), 3, 4], [True, 2, 3, 4]):
            with self.subTest(steps=steps):
                with self.assertRaises(ValueError):
                    chronological_split(steps)

    def test_binary_metrics(self):
        result = binary_metrics([0, 1, 1, 0], [0.1, 0.9, 0.2, 0.8], threshold=0.5)
        self.assertEqual(result["tp"], 1)
        self.assertEqual(result["fp"], 1)
        self.assertEqual(result["fn"], 1)
        self.assertEqual(result["tn"], 1)
        self.assertEqual(result["precision"], 0.5)
        self.assertEqual(result["recall"], 0.5)


    def test_average_precision_with_tie_group(self):
        value = average_precision([1, 0, 1, 0], [0.9, 0.9, 0.2, 0.1])
        self.assertAlmostEqual(value, 0.5833333333, places=6)

    def test_precision_at_k(self):
        self.assertEqual(precision_at_k([0, 1, 1, 0], [0.9, 0.8, 0.7, 0.1], 2), 0.5)

    def test_average_precision_requires_a_positive(self):
        with self.assertRaises(ValueError):
            average_precision([0, 0], [0.2, 0.1])

    def test_metrics_reject_invalid_scores(self):
        with self.assertRaises(ValueError):
            binary_metrics([0, 1], [0.2, 4.0])


if __name__ == "__main__":
    unittest.main()
