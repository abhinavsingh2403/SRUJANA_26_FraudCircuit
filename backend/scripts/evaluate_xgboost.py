#!/usr/bin/env python3
"""
TraceGuard — Standalone XGBoost Fraud Model Evaluator & Verification
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

FEATURE_COLUMNS = [
    'step', 'amount', 'oldbalanceOrg', 'newbalanceOrig',
    'oldbalanceDest', 'newbalanceDest',
    'errorBalanceOrig', 'errorBalanceDest',
    'hour', 'day', 'orig_cleared', 'dest_zero_start',
    'type_CASH_IN', 'type_CASH_OUT', 'type_DEBIT', 'type_PAYMENT', 'type_TRANSFER'
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
    Score a list of transaction dictionaries against the trained XGBoost model.
    Each dict should have: step, type, amount, oldbalanceOrg, newbalanceOrig, oldbalanceDest, newbalanceDest
    """
    if bundle is None:
        bundle = load_model()
    model = bundle["model"]

    rows = []
    for r in records:
        step = int(r.get("step", 1))
        amount = float(r.get("amount", 0.0))
        old_orig = float(r.get("oldbalanceOrg", 0.0))
        new_orig = float(r.get("newbalanceOrig", 0.0))
        old_dest = float(r.get("oldbalanceDest", 0.0))
        new_dest = float(r.get("newbalanceDest", 0.0))
        ttype = str(r.get("type", "PAYMENT")).upper()

        err_orig = new_orig + amount - old_orig
        err_dest = old_dest + amount - new_dest
        hour = step % 24
        day = step // 24
        orig_cleared = int(new_orig == 0)
        dest_zero = int(old_dest == 0 and amount > 0)

        row = {
            'step': step,
            'amount': amount,
            'oldbalanceOrg': old_orig,
            'newbalanceOrig': new_orig,
            'oldbalanceDest': old_dest,
            'newbalanceDest': new_dest,
            'errorBalanceOrig': err_orig,
            'errorBalanceDest': err_dest,
            'hour': hour,
            'day': day,
            'orig_cleared': orig_cleared,
            'dest_zero_start': dest_zero,
            'type_CASH_IN': int(ttype == 'CASH_IN'),
            'type_CASH_OUT': int(ttype == 'CASH_OUT'),
            'type_DEBIT': int(ttype == 'DEBIT'),
            'type_PAYMENT': int(ttype == 'PAYMENT'),
            'type_TRANSFER': int(ttype == 'TRANSFER'),
        }
        rows.append([row[col] for col in FEATURE_COLUMNS])

    X = pd.DataFrame(rows, columns=FEATURE_COLUMNS)
    probs = model.predict_proba(X)[:, 1]
    return [float(p) for p in probs]

def main():
    parser = argparse.ArgumentParser(description="Evaluate or test XGBoost fraud classifier")
    parser.add_argument("--metrics-only", action="store_true", help="Print saved evaluation report")
    args = parser.parse_args()

    artifacts_dir = Path(__file__).resolve().parents[1] / "artifacts"
    eval_file = artifacts_dir / "xgboost_evaluation.json"

    if args.metrics_only or eval_file.is_file():
        with open(eval_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        print("Model:", data.get("model_name"))
        m = data.get("metrics", {})
        print(f"Accuracy:  {m.get('accuracy_pct')}% ({m.get('accuracy'):.6f})")
        print(f"Precision: {m.get('precision'):.6f}")
        print(f"Recall:    {m.get('recall'):.6f}")
        print(f"F1 Score:  {m.get('f1_score'):.6f}")
        print(f"ROC-AUC:   {m.get('roc_auc'):.6f}")
        print(f"PR-AUC:    {m.get('pr_auc'):.6f}")
        print("Confusion Matrix:", m.get("confusion_matrix"))
        return

    # Sample verification test
    bundle = load_model(artifacts_dir)
    print("Bundle loaded successfully. Testing sample inference...")
    sample_fraud = [{
        "step": 1,
        "type": "TRANSFER",
        "amount": 181.0,
        "oldbalanceOrg": 181.0,
        "newbalanceOrig": 0.0,
        "oldbalanceDest": 0.0,
        "newbalanceDest": 0.0
    }]
    score = score_records(sample_fraud, bundle)
    print(f"Sample suspicious transaction fraud probability: {score[0]:.4f}")

if __name__ == "__main__":
    main()
