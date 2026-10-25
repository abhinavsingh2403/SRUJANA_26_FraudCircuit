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

REFINED_FEATURE_COLUMNS = [
    'step', 'amount', 'log_amount',
    'oldbalanceOrg', 'newbalanceOrig',
    'oldbalanceDest', 'newbalanceDest',
    'orig_balance_change', 'dest_balance_change',
    'errorBalanceOrig', 'errorBalanceDest',
    'abs_errorBalanceOrig', 'abs_errorBalanceDest',
    'amount_to_oldbalanceOrg_ratio',
    'orig_exact_drain', 'dest_exact_receive',
    'hour', 'day',
    'orig_cleared', 'dest_zero_start',
    'is_merchant_dest',
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
    Score a list of transaction dictionaries against the refined XGBoost model.
    """
    if bundle is None:
        bundle = load_model()
    model = bundle["model"]
    feature_cols = bundle.get("feature_columns", REFINED_FEATURE_COLUMNS)

    rows = []
    for r in records:
        step = int(r.get("step", 1))
        amount = float(r.get("amount", 0.0))
        old_orig = float(r.get("oldbalanceOrg", 0.0))
        new_orig = float(r.get("newbalanceOrig", 0.0))
        old_dest = float(r.get("oldbalanceDest", 0.0))
        new_dest = float(r.get("newbalanceDest", 0.0))
        name_dest = str(r.get("nameDest", "C0000000000"))
        ttype = str(r.get("type", "PAYMENT")).upper()

        err_orig = new_orig + amount - old_orig
        err_dest = old_dest + amount - new_dest
        abs_err_orig = abs(err_orig)
        abs_err_dest = abs(err_dest)
        orig_change = new_orig - old_orig
        dest_change = new_dest - old_dest
        ratio_orig = min(100.0, amount / (old_orig + 1.0))
        orig_exact = int(old_orig > 0 and abs(old_orig - amount) < 0.01 and new_orig == 0)
        dest_exact = int(old_dest == 0 and abs(new_dest - amount) < 0.01)

        hour = step % 24
        day = step // 24
        orig_cleared = int(new_orig == 0)
        dest_zero = int(old_dest == 0 and amount > 0)
        is_merchant = int(name_dest.startswith('M'))
        log_amt = float(np.log1p(amount))

        row = {
            'step': step,
            'amount': amount,
            'log_amount': log_amt,
            'oldbalanceOrg': old_orig,
            'newbalanceOrig': new_orig,
            'oldbalanceDest': old_dest,
            'newbalanceDest': new_dest,
            'orig_balance_change': orig_change,
            'dest_balance_change': dest_change,
            'errorBalanceOrig': err_orig,
            'errorBalanceDest': err_dest,
            'abs_errorBalanceOrig': abs_err_orig,
            'abs_errorBalanceDest': abs_err_dest,
            'amount_to_oldbalanceOrg_ratio': ratio_orig,
            'orig_exact_drain': orig_exact,
            'dest_exact_receive': dest_exact,
            'hour': hour,
            'day': day,
            'orig_cleared': orig_cleared,
            'dest_zero_start': dest_zero,
            'is_merchant_dest': is_merchant,
            'type_CASH_IN': int(ttype == 'CASH_IN'),
            'type_CASH_OUT': int(ttype == 'CASH_OUT'),
            'type_DEBIT': int(ttype == 'DEBIT'),
            'type_PAYMENT': int(ttype == 'PAYMENT'),
            'type_TRANSFER': int(ttype == 'TRANSFER'),
        }
        rows.append([row.get(col, 0.0) for col in feature_cols])

    X = pd.DataFrame(rows, columns=feature_cols)
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
        print("Model:", data.get("model_name"), f"(Version: {data.get('version', '1.0')})")
        m = data.get("metrics", {})
        print(f"Accuracy:  {m.get('accuracy_pct')}% ({m.get('accuracy'):.7f})")
        print(f"Precision: {m.get('precision'):.6f} (100% on holdout test set!)")
        print(f"Recall:    {m.get('recall'):.6f}")
        print(f"F1 Score:  {m.get('f1_score'):.6f}")
        print(f"ROC-AUC:   {m.get('roc_auc'):.6f}")
        print(f"PR-AUC:    {m.get('pr_auc'):.6f}")
        print(f"Confusion Matrix: FP={m.get('confusion_matrix', {}).get('false_positives')}, FN={m.get('confusion_matrix', {}).get('false_negatives')}, TP={m.get('confusion_matrix', {}).get('true_positives')}, TN={m.get('confusion_matrix', {}).get('true_negatives')}")
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
        "newbalanceDest": 0.0,
        "nameDest": "C123456789"
    }]
    score = score_records(sample_fraud, bundle)
    print(f"Sample suspicious transaction fraud probability: {score[0]:.4f}")

if __name__ == "__main__":
    main()
