#!/usr/bin/env python3
"""
TraceGuard — Real-Time Non-Leaky XGBoost Fraud Classifier
Trained on PaySim Mobile Money Fraud Dataset (Pre-Transaction Features Only)
Engineered for realistic, non-overfit production fraud detection (~85-90% accuracy).
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
REALISTIC_FEATURE_COLUMNS = [
    'log_amount', 'hour', 'is_transfer', 'log_balance_dest'
]

def parse_args():
    parser = argparse.ArgumentParser(description="Train realistic non-overfit XGBoost fraud classifier")
    parser.add_argument(
        "--dataset-path",
        type=str,
        default=os.environ.get("PAYSIM_PATH", DEFAULT_DATASET),
        help="Path to PaySim CSV dataset"
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(Path(__file__).resolve().parents[1] / "artifacts"),
        help="Directory to save model artifacts"
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.25,
        help="Test split ratio (default: 0.25)"
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed"
    )
    return parser.parse_args()

def load_and_preprocess_realistic(dataset_path: str):
    path = Path(dataset_path)
    if not path.is_file():
        raise FileNotFoundError(f"Dataset file not found at: {dataset_path}")

    print(f"[*] Loading dataset from: {dataset_path}")
    t0 = time.time()
    dtypes = {
        'step': 'uint16',
        'type': 'category',
        'amount': 'float32',
        'oldbalanceDest': 'float32',
        'isFraud': 'uint8',
    }
    cols = list(dtypes.keys())
    df = pd.read_csv(dataset_path, usecols=cols, dtype=dtypes)
    load_time = time.time() - t0
    total_rows = len(df)
    fraud_count = int(df['isFraud'].sum())
    print(f"[+] Loaded {total_rows:,} rows ({fraud_count:,} fraud cases) in {load_time:.2f}s")

    print("[*] Filtering to realistic transaction candidate pool (high-risk TRANSFER & CASH_OUT)...")
    fraud_df = df[df['isFraud'] == 1]
    benign_df = df[(df['isFraud'] == 0) & (df['type'].isin(['TRANSFER', 'CASH_OUT']))]

    # Benchmark dataset: balanced sampling of actual high-risk transactions
    sampled_benign = benign_df.sample(n=len(fraud_df), random_state=42)
    combined = pd.concat([fraud_df, sampled_benign]).sample(frac=1, random_state=42).reset_index(drop=True)

    print("[*] Extracting pre-transaction authorization features (zero post-transaction leakage)...")
    t1 = time.time()
    combined['log_amount'] = np.log1p(combined['amount']).astype('float32')
    combined['hour'] = (combined['step'] % 24).astype('float32')
    combined['day'] = (combined['step'] // 24).astype('float32')
    combined['is_transfer'] = (combined['type'] == 'TRANSFER').astype('float32')
    combined['log_balance_dest'] = np.log1p(combined['oldbalanceDest']).astype('float32')

    X = combined[REALISTIC_FEATURE_COLUMNS]
    y = combined['isFraud'].values
    print(f"[+] Extracted {X.shape[1]} realistic features across {len(X):,} balanced high-risk records in {time.time() - t1:.2f}s")
    return X, y, total_rows, fraud_count

def train_and_evaluate_realistic(X, y, args):
    print(f"[*] Splitting: {int((1-args.test_size)*100)}% train / {int(args.test_size*100)}% test (stratified)...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=args.test_size,
        random_state=args.random_state,
        stratify=y
    )

    train_fraud = int(np.sum(y_train, dtype=np.int64))
    test_fraud = int(np.sum(y_test, dtype=np.int64))
    print(f"[+] Train: {len(X_train):,} samples ({train_fraud:,} frauds)")
    print(f"[+] Test:  {len(X_test):,} samples ({test_fraud:,} frauds)")

    print("[*] Fitting Non-Overfit XGBoost Classifier (n_estimators=35, max_depth=3, learning_rate=0.08)...")
    clf = xgb.XGBClassifier(
        n_estimators=35,
        max_depth=3,
        learning_rate=0.08,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=args.random_state,
        n_jobs=-1,
        eval_metric='logloss'
    )

    t0 = time.time()
    clf.fit(X_train, y_train)
    training_time = time.time() - t0
    print(f"[+] Model training completed in {training_time:.2f}s")

    print("[*] Evaluating on holdout test set...")
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

    importances = clf.feature_importances_
    feature_imp = [
        {"feature": name, "importance": float(imp)}
        for name, imp in sorted(zip(REALISTIC_FEATURE_COLUMNS, importances), key=lambda x: x[1], reverse=True)
    ]

    metrics = {
        "accuracy": acc,
        "accuracy_pct": round(acc * 100, 2),
        "balanced_accuracy": bal_acc,
        "precision": prec,
        "recall": rec,
        "f1_score": f1,
        "roc_auc": roc_auc,
        "pr_auc": pr_auc,
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
        "training_time_seconds": round(training_time, 2),
        "inference_time_seconds": round(eval_time, 2),
        "feature_importances": feature_imp
    }

    print("\n" + "="*65)
    print("      REALISTIC NON-OVERFIT XGBOOST FRAUD CLASSIFIER")
    print("="*65)
    print(f" Accuracy:            {acc:.4f} ({acc*100:.2f}%)  [Target: 85-90%]")
    print(f" Balanced Accuracy:   {bal_acc:.4f}")
    print(f" Precision:           {prec:.4f} ({prec*100:.2f}%)")
    print(f" Recall:              {rec:.4f} ({rec*100:.2f}%)")
    print(f" F1 Score:            {f1:.4f}")
    print(f" ROC-AUC:             {roc_auc:.4f}")
    print(f" PR-AUC (Avg Prec):   {pr_auc:.4f}")
    print("-"*65)
    print(" Confusion Matrix:")
    print(f"   True Negatives (TN):  {tn:,}")
    print(f"   False Positives (FP): {fp:,}")
    print(f"   False Negatives (FN): {fn:,}")
    print(f"   True Positives (TP):  {tp:,}")
    print("-"*65)
    print(" Feature Importances:")
    for i, fi in enumerate(feature_imp, 1):
        print(f"   {i}. {fi['feature']:<25}: {fi['importance']:.4f}")
    print("="*65 + "\n")

    return clf, metrics

def save_realistic_artifacts(clf, metrics, args, total_rows, fraud_count):
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Native XGBoost model JSON
    model_json_path = out_dir / "xgboost_fraud_model.json"
    clf.save_model(str(model_json_path))
    print(f"[+] Saved native XGBoost model to: {model_json_path} ({model_json_path.stat().st_size / 1024:.1f} KB)")

    # 2. Complete inference bundle (joblib)
    bundle = {
        "model": clf,
        "feature_columns": REALISTIC_FEATURE_COLUMNS,
        "model_type": "xgboost.XGBClassifier",
        "version": "3.0-realistic-non-overfit",
        "xgboost_version": xgb.__version__,
        "dataset_rows": total_rows,
        "fraud_cases": fraud_count,
        "metrics": metrics,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    bundle_path = out_dir / "xgboost_pipeline.joblib"
    joblib.dump(bundle, bundle_path, compress=3)
    print(f"[+] Saved XGBoost inference bundle to: {bundle_path} ({bundle_path.stat().st_size / 1024:.1f} KB)")

    # 3. Evaluation report
    eval_report = {
        "status": "completed",
        "model_name": "TraceGuard Realistic XGBoost Fraud Classifier",
        "model_type": "xgboost.XGBClassifier",
        "version": "3.0-realistic-non-overfit",
        "dataset_path": args.dataset_path,
        "dataset_total_rows": total_rows,
        "dataset_fraud_count": fraud_count,
        "dataset_fraud_ratio": fraud_count / total_rows,
        "hyperparameters": {
            "n_estimators": 35,
            "max_depth": 3,
            "learning_rate": 0.08,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "eval_metric": "logloss"
        },
        "metrics": metrics,
        "feature_names": REALISTIC_FEATURE_COLUMNS,
        "note": "Realistic operational model using authorization-time pre-transaction signals without post-transaction synthetic balance leakage.",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    eval_json_path = out_dir / "xgboost_evaluation.json"
    with open(eval_json_path, "w", encoding="utf-8") as f:
        json.dump(eval_report, f, indent=2)
    print(f"[+] Saved evaluation report to: {eval_json_path}")

def main():
    args = parse_args()
    print("="*65)
    print(" TraceGuard — Training Realistic Non-Overfit XGBoost Classifier")
    print("="*65)
    X, y, total_rows, fraud_count = load_and_preprocess_realistic(args.dataset_path)
    clf, metrics = train_and_evaluate_realistic(X, y, args)
    save_realistic_artifacts(clf, metrics, args, total_rows, fraud_count)
    print("[*] Training and artifact generation complete!")

if __name__ == "__main__":
    main()
