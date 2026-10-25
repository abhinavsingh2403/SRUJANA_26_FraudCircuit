# Model Card: TraceGuard XGBoost Fraud Classifier

## Executive Summary

The TraceGuard XGBoost Fraud Classifier is a high-performance gradient-boosted decision tree model trained on the PaySim synthetic financial mobile-money transaction dataset (`PS_20174392719_1491204439457_log.csv`). It provides high-precision, low-latency advisory fraud likelihood scores to complement deterministic rule-based graph signals and transaction timeline audits.

---

## Dataset Overview

- **Source Dataset**: PaySim Mobile Money Fraud Simulation
- **Total Records Analyzed**: 6,362,620 transactions
- **Ground Truth Positive Cases**: 8,213 frauds (~0.129% class prevalence)
- **Ground Truth Negative Cases**: 6,354,407 benign transactions (~99.871%)
- **Split Strategy**: 80% Train / 20% Test Stratified Split (`random_state=42`)
  - **Training Set**: 5,090,096 transactions (6,570 frauds)
  - **Unseen Test Set**: 1,272,524 transactions (1,643 frauds)

---

## Model Architecture & Hyperparameters

- **Algorithm**: `xgboost.XGBClassifier` (Extreme Gradient Boosting)
- **Tree Method**: `hist` (Histogram-based optimization for ultra-fast large-scale tabular learning)
- **Objective**: `binary:logistic`
- **Number of Estimators**: 100
- **Max Tree Depth**: 6
- **Learning Rate ($\eta$)**: 0.1
- **Subsample Ratio**: 0.8
- **Column Subsample (Colsample by Tree)**: 0.8
- **Evaluation Metric**: `logloss`
- **Training Duration**: 22.20 seconds on 16 logical CPU threads

---

## Feature Engineering Pipeline (17 Features)

The model ingests 17 engineered financial audit signals:

1. `errorBalanceOrig`: Discrepancy in sender balance ($newbalanceOrig + amount - oldbalanceOrg$).
2. `errorBalanceDest`: Discrepancy in recipient balance ($oldbalanceDest + amount - newbalanceDest$).
3. `orig_cleared`: Binary flag indicating if the sender account was completely emptied to zero ($newbalanceOrig == 0$).
4. `dest_zero_start`: Binary flag indicating money mule creation or initial zero recipient balance ($oldbalanceDest == 0 \land amount > 0$).
5. `hour`: Diurnal hour cycle ($step \pmod{24}$).
6. `day`: Operational simulation day ($step \mathbin{//} 24$).
7. `amount`: Nominal transaction value.
8. `oldbalanceOrg`: Initial sender account balance.
9. `newbalanceOrig`: Post-transaction sender account balance.
10. `oldbalanceDest`: Initial recipient account balance.
11. `newbalanceDest`: Post-transaction recipient account balance.
12. One-hot encoded transaction types: `type_TRANSFER`, `type_CASH_OUT`, `type_PAYMENT`, `type_CASH_IN`, `type_DEBIT`.

---

## Evaluation Metrics (Evaluated on 1,272,524 Unseen Test Samples)

| Metric | Score | Percentage |
| :--- | :--- | :--- |
| **Accuracy** | **0.999994** | **99.9994%** |
| **Balanced Accuracy** | **0.998781** | **99.88%** |
| **Precision** | **0.997565** | **99.76%** |
| **Recall (Sensitivity)** | **0.997565** | **99.76%** |
| **F1 Score** | **0.997565** | **99.76%** |
| **ROC-AUC** | **0.999816** | **99.98%** |
| **PR-AUC (Average Precision)** | **0.998271** | **99.83%** |
| **False Positive Rate (FPR)** | **0.000003** (3.15 per million) | **0.0003%** |
| **False Negative Rate (FNR)** | **0.002435** | **0.24%** |

### Confusion Matrix on Test Set ($N = 1,272,524$)

$$\begin{pmatrix} 1,270,877 & 4 \\ 4 & 1,639 \end{pmatrix}$$

- **True Negatives (TN)**: 1,270,877 correctly identified benign transactions
- **False Positives (FP)**: 4 benign transactions flagged as fraud (0.0003%)
- **False Negatives (FN)**: 4 fraudulent transactions missed (0.24%)
- **True Positives (TP)**: 1,639 fraudulent transactions correctly intercepted

---

## Feature Importance Breakdown

The top predictive features ranked by Gini split gain:

| Rank | Feature Name | Importance Weight | Domain Interpretation |
| :---: | :--- | :---: | :--- |
| 1 | `orig_cleared` | **0.9567** | Complete account drainage is the primary signifier of mule/takeover behavior |
| 2 | `oldbalanceOrg` | **0.0285** | Initial liquidity baseline before outbound execution |
| 3 | `errorBalanceOrig` | **0.0077** | Mechanical accounting anomalies between recorded delta and debit |
| 4 | `amount` | **0.0039** | Transaction size anomaly |
| 5 | `hour` | **0.0014** | Off-peak temporal burst behavior |

---

## Artifacts & Reproducibility

The trained artifacts are preserved under [`backend/artifacts/`](file:///D:/hack/TraceGuard/backend/artifacts):
- **Native XGBoost JSON**: `backend/artifacts/xgboost_fraud_model.json` (198.6 KB)
- **Joblib Inference Pipeline**: `backend/artifacts/xgboost_pipeline.joblib` (55.5 KB)
- **Structured Evaluation JSON**: `backend/artifacts/xgboost_evaluation.json`

### Retrain / Re-evaluate Commands

```bash
# Retrain from scratch
python backend/scripts/train_xgboost_paysim.py --dataset-path "D:\hack\archive (1)\PS_20174392719_1491204439457_log.csv"

# Print metrics and run test inference
python backend/scripts/evaluate_xgboost.py --metrics-only

# Run unit tests
python -m unittest tests/test_xgboost_model.py
```
