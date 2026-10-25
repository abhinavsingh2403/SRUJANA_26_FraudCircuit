#!/usr/bin/env python3
"""
TraceGuard — XGBoost Fraud Classification Engine
Trained on PaySim Mobile Money Fraud Dataset
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
FEATURE_COLUMNS = [
    'step', 'amount', 'oldbalanceOrg', 'newbalanceOrig',
    'oldbalanceDest', 'newbalanceDest',
    'errorBalanceOrig', 'errorBalanceDest',
    'hour', 'day', 'orig_cleared', 'dest_zero_start',
    'type_CASH_IN', 'type_CASH_OUT', 'type_DEBIT', 'type_PAYMENT', 'type_TRANSFER'
]

def parse_args():
    parser = argparse.ArgumentParser(description="Train XGBoost model on PaySim dataset")
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
        default=0.20,
        help="Test split ratio (default: 0.20)"
    )
    parser.add_argument(
        "--n-estimators",
        type=int,
        default=100,
        help="Number of gradient boosted trees"
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=6,
        help="Maximum tree depth"
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed for reproducibility"
    )
    return parser.parse_args()

def load_and_preprocess(dataset_path: str):
    path = Path(dataset_path)
    if not path.is_file():
        raise FileNotFoundError(f"Dataset file not found at: {dataset_path}")

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
    cols = list(dtypes.keys())
    df = pd.read_csv(dataset_path, usecols=cols, dtype=dtypes)
    load_time = time.time() - t0
    total_rows = len(df)
    fraud_count = int(df['isFraud'].sum())
    print(f"[+] Loaded {total_rows:,} rows ({fraud_count:,} fraud cases, {fraud_count/total_rows*100:.3f}%) in {load_time:.2f}s")

    print("[*] Engineering domain features...")
    t1 = time.time()
    
    # Balance discrepancy features (crucial financial audit indicator)
    error_orig = (df['newbalanceOrig'] + df['amount'] - df['oldbalanceOrg']).astype('float32')
    error_dest = (df['oldbalanceDest'] + df['amount'] - df['newbalanceDest']).astype('float32')
    
    # Temporal features
    hour = (df['step'] % 24).astype('uint8')
    day = (df['step'] // 24).astype('uint16')
    
    # Behavioral markers
    orig_cleared = (df['newbalanceOrig'] == 0).astype('uint8')
    dest_zero_start = ((df['oldbalanceDest'] == 0) & (df['amount'] > 0)).astype('uint8')

    # One-hot encode type
    type_dummies = pd.get_dummies(df['type'], prefix='type', dtype='uint8')
    for expected_col in ['type_CASH_IN', 'type_CASH_OUT', 'type_DEBIT', 'type_PAYMENT', 'type_TRANSFER']:
        if expected_col not in type_dummies.columns:
            type_dummies[expected_col] = 0

    X = pd.DataFrame({
        'step': df['step'],
        'amount': df['amount'],
        'oldbalanceOrg': df['oldbalanceOrg'],
        'newbalanceOrig': df['newbalanceOrig'],
        'oldbalanceDest': df['oldbalanceDest'],
        'newbalanceDest': df['newbalanceDest'],
        'errorBalanceOrig': error_orig,
        'errorBalanceDest': error_dest,
        'hour': hour,
        'day': day,
        'orig_cleared': orig_cleared,
        'dest_zero_start': dest_zero_start,
        'type_CASH_IN': type_dummies['type_CASH_IN'],
        'type_CASH_OUT': type_dummies['type_CASH_OUT'],
        'type_DEBIT': type_dummies['type_DEBIT'],
        'type_PAYMENT': type_dummies['type_PAYMENT'],
        'type_TRANSFER': type_dummies['type_TRANSFER'],
    })[FEATURE_COLUMNS]

    y = df['isFraud'].values
    print(f"[+] Engineered {X.shape[1]} features in {time.time() - t1:.2f}s")
    return X, y, total_rows, fraud_count

def train_and_evaluate(X, y, args):
    print(f"[*] Splitting dataset: {int((1-args.test_size)*100)}% train / {int(args.test_size*100)}% test (stratified)...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=args.test_size,
        random_state=args.random_state,
        stratify=y
    )

    train_fraud = int(np.sum(y_train, dtype=np.int64))
    test_fraud = int(np.sum(y_test, dtype=np.int64))
    print(f"[+] Train set: {len(X_train):,} samples ({train_fraud:,} frauds)")
    print(f"[+] Test set:  {len(X_test):,} samples ({test_fraud:,} frauds)")

    print(f"[*] Initializing XGBoost Classifier (n_estimators={args.n_estimators}, max_depth={args.max_depth}, tree_method='hist')...")
    clf = xgb.XGBClassifier(
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        tree_method='hist',
        n_jobs=-1,
        random_state=args.random_state,
        eval_metric='logloss'
    )

    t0 = time.time()
    clf.fit(X_train, y_train)
    training_time = time.time() - t0
    print(f"[+] Model training completed in {training_time:.2f}s")

    print("[*] Evaluating on unseen test set...")
    t_eval = time.time()
    y_pred_proba = clf.predict_proba(X_test)[:, 1]
    y_pred = (y_pred_proba >= 0.5).astype(int)
    eval_time = time.time() - t_eval

    # Metrics computation
    acc = float(accuracy_score(y_test, y_pred))
    bal_acc = float(balanced_accuracy_score(y_test, y_pred))
    prec = float(precision_score(y_test, y_pred, zero_division=0))
    rec = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    roc_auc = float(roc_auc_score(y_test, y_pred_proba))
    pr_auc = float(average_precision_score(y_test, y_pred_proba))
    cm = confusion_matrix(y_test, y_pred)
    tn, fp, fn, tp = map(int, cm.ravel())

    # Feature importances
    importances = clf.feature_importances_
    feature_imp = [
        {"feature": name, "importance": float(imp)}
        for name, imp in sorted(zip(FEATURE_COLUMNS, importances), key=lambda x: x[1], reverse=True)
    ]

    metrics = {
        "accuracy": acc,
        "accuracy_pct": round(acc * 100, 4),
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

    print("\n" + "="*60)
    print("           XGBOOST EVALUATION METRICS REPORT")
    print("="*60)
    print(f" Accuracy:            {acc:.6f} ({acc*100:.4f}%)")
    print(f" Balanced Accuracy:   {bal_acc:.6f}")
    print(f" Precision:           {prec:.6f} ({prec*100:.2f}%)")
    print(f" Recall:              {rec:.6f} ({rec*100:.2f}%)")
    print(f" F1 Score:            {f1:.6f}")
    print(f" ROC-AUC:             {roc_auc:.6f}")
    print(f" PR-AUC (Avg Prec):   {pr_auc:.6f}")
    print("-"*60)
    print(" Confusion Matrix:")
    print(f"   True Negatives (TN):  {tn:,}")
    print(f"   False Positives (FP): {fp:,}")
    print(f"   False Negatives (FN): {fn:,}")
    print(f"   True Positives (TP):  {tp:,}")
    print("-"*60)
    print(" Top 5 Important Features:")
    for i, fi in enumerate(feature_imp[:5], 1):
        print(f"   {i}. {fi['feature']:<20}: {fi['importance']:.4f}")
    print("="*60 + "\n")

    return clf, metrics

def save_artifacts(clf, metrics, args, total_rows, fraud_count):
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Save native XGBoost model JSON (portable, lightweight)
    model_json_path = out_dir / "xgboost_fraud_model.json"
    clf.save_model(str(model_json_path))
    print(f"[+] Saved native XGBoost model to: {model_json_path} ({model_json_path.stat().st_size / 1024:.1f} KB)")

    # 2. Save complete inference bundle (joblib)
    bundle = {
        "model": clf,
        "feature_columns": FEATURE_COLUMNS,
        "model_type": "xgboost.XGBClassifier",
        "xgboost_version": xgb.__version__,
        "dataset_rows": total_rows,
        "fraud_cases": fraud_count,
        "metrics": metrics,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    bundle_path = out_dir / "xgboost_pipeline.joblib"
    joblib.dump(bundle, bundle_path, compress=3)
    print(f"[+] Saved XGBoost inference bundle to: {bundle_path} ({bundle_path.stat().st_size / 1024:.1f} KB)")

    # 3. Save evaluation metrics JSON
    eval_report = {
        "status": "completed",
        "model_name": "TraceGuard XGBoost Fraud Classifier",
        "model_type": "xgboost.XGBClassifier",
        "dataset_path": args.dataset_path,
        "dataset_total_rows": total_rows,
        "dataset_fraud_count": fraud_count,
        "dataset_fraud_ratio": fraud_count / total_rows,
        "hyperparameters": {
            "n_estimators": args.n_estimators,
            "max_depth": args.max_depth,
            "learning_rate": 0.1,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "tree_method": "hist",
            "eval_metric": "logloss"
        },
        "metrics": metrics,
        "feature_names": FEATURE_COLUMNS,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    eval_json_path = out_dir / "xgboost_evaluation.json"
    with open(eval_json_path, "w", encoding="utf-8") as f:
        json.dump(eval_report, f, indent=2)
    print(f"[+] Saved evaluation report to: {eval_json_path}")

    # 4. Update paysim_benchmark.json to reflect the configured XGBoost model
    benchmark_path = out_dir / "paysim_benchmark.json"
    benchmark_data = {}
    if benchmark_path.is_file():
        try:
            with open(benchmark_path, "r", encoding="utf-8") as f:
                benchmark_data = json.load(f)
        except Exception:
            pass
    
    benchmark_data.update({
        "evaluation_status": "completed",
        "boosted_status": "completed",
        "xgboost_metrics": {
            "accuracy": metrics["accuracy"],
            "accuracy_pct": metrics["accuracy_pct"],
            "precision": metrics["precision"],
            "recall": metrics["recall"],
            "f1_score": metrics["f1_score"],
            "roc_auc": metrics["roc_auc"],
            "pr_auc": metrics["pr_auc"],
            "confusion_matrix": metrics["confusion_matrix"]
        },
        "xgboost_model_path": str(model_json_path.name),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    })
    with open(benchmark_path, "w", encoding="utf-8") as f:
        json.dump(benchmark_data, f, indent=2)
    print(f"[+] Updated PaySim benchmark manifest at: {benchmark_path}")

def main():
    args = parse_args()
    print("="*60)
    print(" TraceGuard — XGBoost Fraud Classifier Training Pipeline")
    print("="*60)
    X, y, total_rows, fraud_count = load_and_preprocess(args.dataset_path)
    clf, metrics = train_and_evaluate(X, y, args)
    save_artifacts(clf, metrics, args, total_rows, fraud_count)
    print("[*] Pipeline complete!")

if __name__ == "__main__":
    main()
