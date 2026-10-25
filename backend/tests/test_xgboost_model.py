"""
Unit tests for XGBoost fraud detection model integration, feature engineering, and inference.
"""
import unittest
from pathlib import Path
import json

from importlib.util import find_spec

class XGBoostModelTests(unittest.TestCase):
    def test_artifacts_exist(self):
        artifacts = Path(__file__).resolve().parents[1] / "artifacts"
        self.assertTrue((artifacts / "xgboost_fraud_model.json").is_file(), "XGBoost JSON model missing")
        self.assertTrue((artifacts / "xgboost_pipeline.joblib").is_file(), "XGBoost joblib bundle missing")
        self.assertTrue((artifacts / "xgboost_evaluation.json").is_file(), "XGBoost evaluation report missing")

    def test_evaluation_metrics_validity(self):
        artifacts = Path(__file__).resolve().parents[1] / "artifacts"
        eval_path = artifacts / "xgboost_evaluation.json"
        with open(eval_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        self.assertEqual(data["status"], "completed")
        self.assertEqual(data["model_type"], "xgboost.XGBClassifier")
        m = data["metrics"]
        self.assertGreaterEqual(m["accuracy"], 0.85, "Accuracy should be in realistic target range >= 85%")
        self.assertLessEqual(m["accuracy"], 0.95, "Accuracy should not be overfit > 95%")
        self.assertGreater(m["precision"], 0.85)
        self.assertGreater(m["recall"], 0.75)
        self.assertGreater(m["f1_score"], 0.80)
        self.assertGreater(m["roc_auc"], 0.90)
        self.assertIn("true_positives", m["confusion_matrix"])

    @unittest.skipUnless(all(find_spec(m) for m in ['numpy', 'joblib', 'sklearn', 'xgboost']), 'Optional ML dependencies not installed')
    def test_inference_on_known_patterns(self):
        from scripts.evaluate_xgboost import load_model, score_records
        bundle = load_model()
        test_records = [
            # Benign normal payment: small amount, healthy balances at daytime
            {
                "step": 12,
                "type": "PAYMENT",
                "amount": 25.0,
                "oldbalanceDest": 50000.0,
            },
            # Known fraud pattern: high-value transfer to empty destination
            {
                "step": 2,
                "type": "TRANSFER",
                "amount": 500000.0,
                "oldbalanceDest": 0.0,
            }
        ]
        scores = score_records(test_records, bundle)
        self.assertEqual(len(scores), 2)
        self.assertLess(scores[0], 0.5, "Benign daytime transaction should have low fraud probability")
        self.assertGreater(scores[1], 0.7, "High-value nighttime drain transfer should have high fraud probability")

if __name__ == "__main__":
    unittest.main()
