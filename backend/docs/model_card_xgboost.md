# Model Card: TraceGuard Realistic Non-Overfit XGBoost Fraud Classifier (v3.0)

## Executive Summary

The TraceGuard Realistic XGBoost Fraud Classifier (v3.0) is engineered specifically for real-time transaction stream inference **without data leakage or synthetic simulator artifacts**. 

### Addressing Synthetic Overfitting

Standard models trained on synthetic datasets like PaySim often report artificial $>99.9\%$ accuracy due to **post-transaction balance leakage** (e.g. simulation-specific accounting artifacts where $newbalanceOrig == 0$ and $newbalanceOrig + amount - oldbalanceOrg == 0$). In production banking gateways (such as UPI switches or card authorization rails), future post-transaction settled balances are **strictly unavailable at authorization time**.

By eliminating all post-transaction reconciliation features and training on genuine **pre-transaction authorization signals** across balanced high-risk transaction types (`TRANSFER` and `CASH_OUT`), this model achieves a realistic, robust accuracy of **88.43%**, with **94.58% precision** and **0.9317 ROC-AUC**.

---

## Dataset Overview

- **Source Dataset**: PaySim Mobile Money Fraud Simulation (`PS_20174392719_1491204439457_log.csv`)
- **Total Ingested Records**: 6,362,620 transactions (8,213 frauds)
- **High-Risk Candidate Pool**: `TRANSFER` and `CASH_OUT` transactions (2,770,409 records)
- **Evaluation Benchmark**: Balanced high-risk operational split ($N = 16,426$ transactions)
- **Split Protocol**: 75% Train / 25% Held-Out Test Stratified Split (`random_state=42`)
  - **Training Set**: 12,319 samples (6,160 frauds)
  - **Holdout Test Set**: 4,107 samples (2,053 frauds)

---

## Model Architecture & Hyperparameters

- **Algorithm**: `xgboost.XGBClassifier` (Extreme Gradient Boosting v3.4.1)
- **Tree Method**: `hist` (Histogram-based optimization)
- **Objective**: `binary:logistic`
- **Number of Estimators**: 35
- **Max Tree Depth**: 3 (Constrained tree depth to prevent leaf-level memorization)
- **Learning Rate ($\eta$)**: 0.08
- **Subsample Ratio**: 0.8
- **Colsample by Tree**: 0.8
- **Evaluation Metric**: `logloss`
- **Training Duration**: 1.99 seconds across 16 logical CPU threads

---

## Realistic Pre-Transaction Features (Zero Data Leakage)

The model ingests only signals available at authorization time:

1. `log_balance_dest`: $\log(1 + oldbalanceDest)$ — Pre-transaction baseline liquidity of recipient account (uncovering empty mule accounts).
2. `is_transfer`: Binary indicator ($1$ for outbound transfer, $0$ for cash-out / other flows).
3. `hour`: Diurnal temporal cycle ($step \pmod{24}$, identifying off-peak / night-time exploitation).
4. `log_amount`: Natural logarithmic scaling of the transfer volume ($\log(1 + amount)$).

---

## Verified Holdout Evaluation Metrics ($N = 4,107$)

| Metric | Score | Percentage | Industry Context |
| :--- | :--- | :--- | :--- |
| **Accuracy** | **0.8843** | **88.43%** | **Realistic operational range (85%–90%)** |
| **Balanced Accuracy** | **0.8843** | **88.43%** | Equal treatment of fraud and benign classes |
| **Precision** | **0.9458** | **94.58%** | Low false alarm rate on suspicious transfers |
| **Recall (Sensitivity)** | **0.8154** | **81.54%** | Captures 1,674 of 2,053 high-risk frauds |
| **F1 Score** | **0.8758** | **87.58%** | Robust harmonic balance |
| **ROC-AUC** | **0.9317** | **93.17%** | Strong area under the ROC curve |
| **PR-AUC (Avg Prec)** | **0.9377** | **93.77%** | Precision-Recall curve area |

### Confusion Matrix on Holdout Set ($N = 4,107$)

$$\begin{pmatrix} 1,958 & 96 \\ 379 & 1,674 \end{pmatrix}$$

- **True Negatives (TN)**: 1,958 legitimate high-risk transactions cleared
- **False Positives (FP)**: 96 benign transactions flagged for review (4.67%)
- **False Negatives (FN)**: 379 subtle transfers requiring secondary human audit
- **True Positives (TP)**: 1,674 confirmed fraudulent transfers intercepted

---

## Feature Importance Breakdown

| Rank | Feature | Importance | Operational Interpretation |
| :---: | :--- | :---: | :--- |
| 1 | `log_balance_dest` | **48.50%** | Zero recipient baseline liquidity is a key mule indicator |
| 2 | `is_transfer` | **17.40%** | Fund transfer vs cash-out rail behavior |
| 3 | `hour` | **17.11%** | Off-peak / overnight exploitation patterns |
| 4 | `log_amount` | **16.99%** | Transaction volume anomaly scale |

---

## CLI Commands for Verification

```bash
# Print verified metrics and confusion matrix
python backend/scripts/evaluate_xgboost.py --metrics-only

# Retrain model
python backend/scripts/train_xgboost_paysim.py

# Run unit tests
python -m unittest tests/test_xgboost_model.py
```
