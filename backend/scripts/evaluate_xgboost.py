#!/usr/bin/env python3
"""
TraceGuard — Standalone Realistic XGBoost Fraud Model Evaluator
"""
import sys
import json
import argparse
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
import joblib

REALISTIC_FEATURE_COLUMNS = [
    'log_amount', 'hour', 'is_transfer', 'log_balance_dest'
]

def load_model(artifact_dir=None):
    if artifact_dir is None:
        artifact_dir = Path(__file__).resolve().parents[1] / "artifacts"
    bundle_path = Path(artifact_dir) / "xgboost_pipeline.joblib"
    if not bundle_path.is_file():
        raise FileNotFoundError(f"Model bundle not found at: {bundle_path}")
    return joblib.load(bundle_path)

def score_records(records, bundle=None):
    """
    Score a list of transaction dictionaries against the realistic XGBoost model.
    """
    if bundle is None:
        bundle = load_model()
    model = bundle["model"]
    feature_cols = bundle.get("feature_columns", REALISTIC_FEATURE_COLUMNS)

    rows = []
    for r in records:
        step = int(r.get("step", 1))
        amount = float(r.get("amount", 0.0))
        old_dest = float(r.get("oldbalanceDest", 0.0))
        ttype = str(r.get("type", "TRANSFER")).upper()

        log_amt = float(np.log1p(amount))
        hour = float(step % 24)
        day = float(step // 24)
        is_transfer = float(ttype == 'TRANSFER')
        log_dest = float(np.log1p(old_dest))

        row = {
            'log_amount': log_amt,
            'hour': hour,
            'is_transfer': is_transfer,
            'log_balance_dest': log_dest,
            'day': day
        }
        rows.append([row.get(col, 0.0) for col in feature_cols])

    X = pd.DataFrame(rows, columns=feature_cols)
    probs = model.predict_proba(X)[:, 1]
    return [float(p) for p in probs]

def main():
    parser = argparse.ArgumentParser(description="Evaluate or test realistic XGBoost fraud classifier")
    parser.add_argument("--metrics-only", action="store_true", help="Print saved evaluation report")
    args = parser.parse_args()

    artifacts_dir = Path(__file__).resolve().parents[1] / "artifacts"
    eval_file = artifacts_dir / "xgboost_evaluation.json"

    if args.metrics_only or eval_file.is_file():
        with open(eval_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        print("Model:", data.get("model_name"), f"(Version: {data.get('version', '3.0')})")
        m = data.get("metrics", {})
        print(f"Accuracy:  {m.get('accuracy_pct')}% ({m.get('accuracy'):.4f})")
        print(f"Precision: {m.get('precision'):.4f} ({m.get('precision')*100:.2f}%)")
        print(f"Recall:    {m.get('recall'):.4f} ({m.get('recall')*100:.2f}%)")
        print(f"F1 Score:  {m.get('f1_score'):.4f}")
        print(f"ROC-AUC:   {m.get('roc_auc'):.4f}")
        print(f"PR-AUC:    {m.get('pr_auc'):.4f}")
        cm = m.get("confusion_matrix", {})
        print(f"Confusion Matrix: FP={cm.get('false_positives')}, FN={cm.get('false_negatives')}, TP={cm.get('true_positives')}, TN={cm.get('true_negatives')}")
        return

    # Sample verification test
    bundle = load_model(artifacts_dir)
    print("Bundle loaded successfully. Testing sample inference...")
    sample_fraud = [{
        "step": 1,
        "type": "TRANSFER",
        "amount": 181.0,
        "oldbalanceDest": 0.0
    }]
    score = score_records(sample_fraud, bundle)
    print(f"Sample transaction fraud score: {score[0]:.4f}")

if __name__ == "__main__":
    main()
