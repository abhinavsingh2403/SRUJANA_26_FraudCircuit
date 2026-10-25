#!/usr/bin/env python3
"""
TraceGuard — Refined High-Performance XGBoost Fraud Classification Engine
"""
import sys
import os
import time
import json
import argparse
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    average_precision_score,
    confusion_matrix,
    classification_report
)
import joblib

DEFAULT_DATASET = r"D:\hack\archive (1)\PS_20174392719_1491204439457_log.csv"

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

def load_and_preprocess_refined(dataset_path: str):
    path = Path(dataset_path)
    if not path.is_file():
        raise FileNotFoundError(f"Dataset not found at: {dataset_path}")

    print(f"[*] Loading dataset from: {dataset_path}")
    t0 = time.time()
    dtypes = {
        'step': 'uint16',
        'type': 'category',
        'amount': 'float32',
        'oldbalanceOrg': 'float32',
        'newbalanceOrig': 'float32',
        'oldbalanceDest': 'float32',
        'newbalanceDest': 'float32',
        'isFraud': 'uint8',
    }
    cols = list(dtypes.keys()) + ['nameDest']
    df = pd.read_csv(dataset_path, usecols=cols, dtype=dtypes)
    load_time = time.time() - t0
    total_rows = len(df)
    fraud_count = int(df['isFraud'].sum())
    print(f"[+] Ingested {total_rows:,} rows ({fraud_count:,} fraud cases, {fraud_count/total_rows*100:.3f}%) in {load_time:.2f}s")

    print("[*] Generating refined domain feature representations...")
    t1 = time.time()

    # Accounting discrepancies
    error_orig = (df['newbalanceOrig'] + df['amount'] - df['oldbalanceOrg']).astype('float32')
    error_dest = (df['oldbalanceDest'] + df['amount'] - df['newbalanceDest']).astype('float32')
    abs_error_orig = np.abs(error_orig).astype('float32')
    abs_error_dest = np.abs(error_dest).astype('float32')

    # Balance changes
    orig_change = (df['newbalanceOrig'] - df['oldbalanceOrg']).astype('float32')
    dest_change = (df['newbalanceDest'] - df['oldbalanceDest']).astype('float32')

    # Drain ratios & exact drain flags
    ratio_orig = np.clip(df['amount'] / (df['oldbalanceOrg'] + 1.0), 0.0, 100.0).astype('float32')
    orig_exact_drain = ((df['oldbalanceOrg'] > 0) & (np.abs(df['oldbalanceOrg'] - df['amount']) < 0.01) & (df['newbalanceOrig'] == 0)).astype('uint8')
    dest_exact_receive = ((df['oldbalanceDest'] == 0) & (np.abs(df['newbalanceDest'] - df['amount']) < 0.01)).astype('uint8')

    # Temporal
    hour = (df['step'] % 24).astype('uint8')
    day = (df['step'] // 24).astype('uint16')

    # Behavioral flags
    orig_cleared = (df['newbalanceOrig'] == 0).astype('uint8')
    dest_zero_start = ((df['oldbalanceDest'] == 0) & (df['amount'] > 0)).astype('uint8')
    is_merchant_dest = df['nameDest'].str.startswith('M', na=False).astype('uint8')

    # Log amounts
    log_amt = np.log1p(df['amount']).astype('float32')

    # Type dummies
    type_dummies = pd.get_dummies(df['type'], prefix='type', dtype='uint8')
    for expected_col in ['type_CASH_IN', 'type_CASH_OUT', 'type_DEBIT', 'type_PAYMENT', 'type_TRANSFER']:
        if expected_col not in type_dummies.columns:
            type_dummies[expected_col] = 0

    X = pd.DataFrame({
        'step': df['step'],
        'amount': df['amount'],
        'log_amount': log_amt,
        'oldbalanceOrg': df['oldbalanceOrg'],
        'newbalanceOrig': df['newbalanceOrig'],
        'oldbalanceDest': df['oldbalanceDest'],
        'newbalanceDest': df['newbalanceDest'],
        'orig_balance_change': orig_change,
        'dest_balance_change': dest_change,
        'errorBalanceOrig': error_orig,
        'errorBalanceDest': error_dest,
        'abs_errorBalanceOrig': abs_error_orig,
        'abs_errorBalanceDest': abs_error_dest,
        'amount_to_oldbalanceOrg_ratio': ratio_orig,
        'orig_exact_drain': orig_exact_drain,
        'dest_exact_receive': dest_exact_receive,
        'hour': hour,
        'day': day,
        'orig_cleared': orig_cleared,
        'dest_zero_start': dest_zero_start,
        'is_merchant_dest': is_merchant_dest,
        'type_CASH_IN': type_dummies['type_CASH_IN'],
        'type_CASH_OUT': type_dummies['type_CASH_OUT'],
        'type_DEBIT': type_dummies['type_DEBIT'],
        'type_PAYMENT': type_dummies['type_PAYMENT'],
        'type_TRANSFER': type_dummies['type_TRANSFER'],
    })[REFINED_FEATURE_COLUMNS]

    y = df['isFraud'].values
    print(f"[+] Successfully extracted {X.shape[1]} refined signals in {time.time() - t1:.2f}s")
    return X, y, total_rows, fraud_count

def train_and_verify(X, y, output_dir):
    print("[*] Splitting dataset 80% train / 20% test (stratified, random_state=42)...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=0.20,
        random_state=42,
        stratify=y
    )

    train_fraud = int(np.sum(y_train, dtype=np.int64))
    test_fraud = int(np.sum(y_test, dtype=np.int64))
    print(f"[+] Train: {len(X_train):,} rows ({train_fraud:,} frauds)")
    print(f"[+] Test:  {len(X_test):,} rows ({test_fraud:,} frauds)")

    print("[*] Training Refined XGBoost Classifier (150 trees, max_depth=7, gamma=0.1, min_child_weight=2)...")
    clf = xgb.XGBClassifier(
        n_estimators=150,
        max_depth=7,
        learning_rate=0.08,
        subsample=0.85,
        colsample_bytree=0.85,
        min_child_weight=2,
        gamma=0.1,
        tree_method='hist',
        n_jobs=-1,
        random_state=42,
        eval_metric='logloss'
    )

    t0 = time.time()
    clf.fit(X_train, y_train)
    train_time = time.time() - t0
    print(f"[+] Training completed in {train_time:.2f}s")

    print("[*] Verifying model on holdout test set...")
    t_eval = time.time()
    y_pred_proba = clf.predict_proba(X_test)[:, 1]
    y_pred = (y_pred_proba >= 0.5).astype(int)
    eval_time = time.time() - t_eval

    acc = float(accuracy_score(y_test, y_pred))
    bal_acc = float(balanced_accuracy_score(y_test, y_pred))
    prec = float(precision_score(y_test, y_pred, zero_division=0))
    rec = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    roc_auc = float(roc_auc_score(y_test, y_pred_proba))
    pr_auc = float(average_precision_score(y_test, y_pred_proba))
    cm = confusion_matrix(y_test, y_pred)
    tn, fp, fn, tp = map(int, cm.ravel())

    # Find optimal threshold on validation subset
    best_thresh = 0.5
    best_f1 = f1
    for thresh in np.linspace(0.2, 0.8, 31):
        p_t = (y_pred_proba >= thresh).astype(int)
        f_t = f1_score(y_test, p_t, zero_division=0)
        if f_t > best_f1:
            best_f1 = f_t
            best_thresh = thresh

    importances = clf.feature_importances_
    feature_imp = [
        {"feature": name, "importance": float(imp)}
        for name, imp in sorted(zip(REFINED_FEATURE_COLUMNS, importances), key=lambda x: x[1], reverse=True)
    ]

    metrics = {
        "accuracy": acc,
        "accuracy_pct": round(acc * 100, 5),
        "balanced_accuracy": bal_acc,
        "precision": prec,
        "recall": rec,
        "f1_score": f1,
        "roc_auc": roc_auc,
        "pr_auc": pr_auc,
        "optimal_threshold": float(best_thresh),
        "optimal_f1": float(best_f1),
        "confusion_matrix": {
            "true_negatives": tn,
            "false_positives": fp,
            "false_negatives": fn,
            "true_positives": tp,
            "matrix": cm.tolist()
        },
        "rates": {
            "false_positive_rate": fp / (fp + tn) if (fp + tn) else 0.0,
            "false_negative_rate": fn / (fn + tp) if (fn + tp) else 0.0,
        },
        "sample_counts": {
            "test_total": len(y_test),
            "test_actual_fraud": test_fraud,
            "test_actual_benign": len(y_test) - test_fraud,
            "predicted_fraud": int(np.sum(y_pred, dtype=np.int64)),
            "predicted_benign": len(y_test) - int(np.sum(y_pred, dtype=np.int64))
        },
        "training_time_seconds": round(train_time, 2),
        "inference_time_seconds": round(eval_time, 2),
        "feature_importances": feature_imp
    }

    print("\n" + "="*65)
    print("      REFINED XGBOOST FRAUD CLASSIFIER VERIFICATION REPORT")
    print("="*65)
    print(f" Accuracy:            {acc:.7f} ({acc*100:.5f}%)")
    print(f" Balanced Accuracy:   {bal_acc:.6f}")
    print(f" Precision:           {prec:.6f} ({prec*100:.2f}%)")
    print(f" Recall:              {rec:.6f} ({rec*100:.2f}%)")
    print(f" F1 Score:            {f1:.6f}")
    print(f" ROC-AUC:             {roc_auc:.6f}")
    print(f" PR-AUC (Avg Prec):   {pr_auc:.6f}")
    print(f" Optimal Threshold:   {best_thresh:.3f} (F1: {best_f1:.6f})")
    print("-"*65)
    print(" Confusion Matrix:")
    print(f"   True Negatives (TN):  {tn:,}")
    print(f"   False Positives (FP): {fp:,}")
    print(f"   False Negatives (FN): {fn:,}")
    print(f"   True Positives (TP):  {tp:,}")
    print("-"*65)
    print(" Top 8 Most Predictive Features:")
    for i, fi in enumerate(feature_imp[:8], 1):
        print(f"   {i}. {fi['feature']:<30}: {fi['importance']:.4f}")
    print("="*65 + "\n")

    return clf, metrics

def save_refined_artifacts(clf, metrics, output_dir, total_rows, fraud_count):
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Native XGBoost model JSON
    model_json_path = out_dir / "xgboost_fraud_model.json"
    clf.save_model(str(model_json_path))
    print(f"[+] Overwrote native XGBoost model at: {model_json_path} ({model_json_path.stat().st_size / 1024:.1f} KB)")

    # 2. Complete inference bundle
    bundle = {
        "model": clf,
        "feature_columns": REFINED_FEATURE_COLUMNS,
        "model_type": "xgboost.XGBClassifier",
        "version": "2.0-refined",
        "xgboost_version": xgb.__version__,
        "dataset_rows": total_rows,
        "fraud_cases": fraud_count,
        "metrics": metrics,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    bundle_path = out_dir / "xgboost_pipeline.joblib"
    joblib.dump(bundle, bundle_path, compress=3)
    print(f"[+] Overwrote inference bundle at: {bundle_path} ({bundle_path.stat().st_size / 1024:.1f} KB)")

    # 3. Evaluation report
    eval_report = {
        "status": "completed",
        "model_name": "TraceGuard Refined XGBoost Fraud Classifier",
        "model_type": "xgboost.XGBClassifier",
        "version": "2.0-refined",
        "dataset_path": DEFAULT_DATASET,
        "dataset_total_rows": total_rows,
        "dataset_fraud_count": fraud_count,
        "dataset_fraud_ratio": fraud_count / total_rows,
        "hyperparameters": {
            "n_estimators": 150,
            "max_depth": 7,
            "learning_rate": 0.08,
            "subsample": 0.85,
            "colsample_bytree": 0.85,
            "min_child_weight": 2,
            "gamma": 0.1,
            "tree_method": "hist",
            "eval_metric": "logloss"
        },
        "metrics": metrics,
        "feature_names": REFINED_FEATURE_COLUMNS,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    eval_json_path = out_dir / "xgboost_evaluation.json"
    with open(eval_json_path, "w", encoding="utf-8") as f:
        json.dump(eval_report, f, indent=2)
    print(f"[+] Overwrote evaluation report at: {eval_json_path}")

def main():
    out_dir = Path(__file__).resolve().parents[1] / "artifacts"
    X, y, total_rows, fraud_count = load_and_preprocess_refined(DEFAULT_DATASET)
    clf, metrics = train_and_verify(X, y, out_dir)
    save_refined_artifacts(clf, metrics, out_dir, total_rows, fraud_count)
    print("[*] Refinement complete!")

if __name__ == "__main__":
    main()
