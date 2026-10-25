# Model Card: TraceGuard Refined XGBoost Fraud Classifier (v2.0)

## Executive Summary

The TraceGuard Refined XGBoost Fraud Classifier (v2.0) is a state-of-the-art gradient-boosted decision tree architecture specifically optimized for extreme-precision fraud detection on tabular mobile-money transaction streams. Evaluated on **1,272,524 held-out test transactions** from the PaySim benchmark, the model achieves **100.00% precision with zero false positives** ($FP=0$), while capturing **99.70% of all fraudulent incidents** ($FN=5, TP=1,638$).

---

## Dataset Overview

- **Dataset**: PaySim Mobile Money Fraud Simulation (`PS_20174392719_1491204439457_log.csv`)
- **Total Ingested Records**: 6,362,620 transactions
- **Ground Truth Positive Cases**: 8,213 frauds (~0.129% class prevalence)
- **Ground Truth Negative Cases**: 6,354,407 benign transactions (~99.871%)
- **Split Protocol**: 80% Train / 20% Held-Out Test Stratified Split (`random_state=42`)
  - **Training Set**: 5,090,096 samples (6,570 fraud cases)
  - **Holdout Test Set**: 1,272,524 samples (1,643 fraud cases)

---

## Model Architecture & Hyperparameters

- **Algorithm**: `xgboost.XGBClassifier` (Extreme Gradient Boosting v3.4.1)
- **Tree Method**: `hist` (Histogram-based optimization)
- **Objective**: `binary:logistic`
- **Number of Estimators**: 150
- **Max Tree Depth**: 7
- **Learning Rate ($\eta$)**: 0.08
- **Subsample Ratio**: 0.85
- **Colsample by Tree**: 0.85
- **Minimum Child Weight**: 2
- **Gamma ($\gamma$)**: 0.1
- **Evaluation Metric**: `logloss`
- **Training Duration**: 35.07 seconds across 16 logical CPU threads

---

## Refined Feature Engineering Pipeline (26 Engineered Features)

The refined architecture ingests 26 financial audit signals:

1. `newbalanceOrig`: Post-transaction sender account balance.
2. `newbalanceDest`: Post-transaction recipient account balance.
3. `orig_balance_change`: Directed sender delta ($newbalanceOrig - oldbalanceOrg$).
4. `dest_balance_change`: Directed recipient delta ($newbalanceDest - oldbalanceDest$).
5. `amount`: Nominal transaction volume.
6. `log_amount`: Natural logarithmic scaling ($\log(1 + amount)$).
7. `oldbalanceOrg`: Pre-transaction sender balance.
8. `oldbalanceDest`: Pre-transaction recipient balance.
9. `abs_errorBalanceOrig`: Absolute accounting error on sender side ($|newbalanceOrig + amount - oldbalanceOrg|$).
10. `abs_errorBalanceDest`: Absolute accounting error on recipient side ($|oldbalanceDest + amount - newbalanceDest|$).
11. `errorBalanceOrig`: Signed sender reconciliation error.
12. `errorBalanceDest`: Signed recipient reconciliation error.
13. `amount_to_oldbalanceOrg_ratio`: Account liquidation ratio ($\min(100, \frac{amount}{oldbalanceOrg + 1})$).
14. `orig_exact_drain`: Boolean indicator for exact balance clearance ($oldbalanceOrg == amount \land newbalanceOrig == 0$).
15. `dest_exact_receive`: Boolean indicator for exact credit to previously zero-balance accounts ($oldbalanceDest == 0 \land newbalanceDest == amount$).
16. `hour`: Diurnal hourly cycle ($step \pmod{24}$).
17. `day`: Operational simulation day ($step \mathbin{//} 24$).
18. `orig_cleared`: Flag for zero ending balance on sender.
19. `dest_zero_start`: Flag for zero opening balance on recipient with positive transfer.
20. `is_merchant_dest`: Recipient entity classification ($nameDest \text{ starts with 'M'}$).
21-25. One-hot encoded transaction types: `type_TRANSFER`, `type_CASH_OUT`, `type_DEBIT`, `type_PAYMENT`, `type_CASH_IN`.

---

## Verified Holdout Performance ($N = 1,272,524$)

| Metric | Score | Percentage | Notes |
| :--- | :--- | :--- | :--- |
| **Accuracy** | **0.9999961** | **99.99961%** | Only 5 errors across 1.27M test transactions |
| **Precision** | **1.000000** | **100.00%** | **Zero False Positives ($FP=0$)** |
| **Recall** | **0.996957** | **99.70%** | Intercepts 1,638 out of 1,643 true frauds |
| **F1 Score** | **0.998476** | **99.85%** | Harmonic mean of precision and recall |
| **Balanced Accuracy** | **0.998478** | **99.85%** | Unweighted mean of per-class sensitivity |
| **ROC-AUC** | **0.999186** | **99.92%** | Area under Receiver Operating Characteristic |
| **PR-AUC (Avg Prec)** | **0.997878** | **99.79%** | Precision-Recall curve area |

### Confusion Matrix on Test Set ($N = 1,272,524$)

$$\begin{pmatrix} 1,270,881 & 0 \\ 5 & 1,638 \end{pmatrix}$$

- **True Negatives (TN)**: 1,270,881 correctly cleared legitimate transactions
- **False Positives (FP)**: **0 (Zero)** — no customer friction or false alarms
- **False Negatives (FN)**: 5 subtle cases missed
- **True Positives (TP)**: 1,638 confirmed fraudulent attacks intercepted

---

## Feature Importance (Top Gini Gains)

| Rank | Feature | Importance | Interpretation |
| :---: | :--- | :---: | :--- |
| 1 | `newbalanceOrig` | **36.53%** | Immediate post-transfer drainage signature |
| 2 | `newbalanceDest` | **24.00%** | Sudden recipient balance elevation |
| 3 | `orig_balance_change` | **12.36%** | Magnitude and direction of origin outflow |
| 4 | `amount` | **11.25%** | Nominal transaction scale |
| 5 | `oldbalanceOrg` | **6.57%** | Account baseline prior to exploitation |
| 6 | `abs_errorBalanceOrig` | **2.91%** | Mechanical bookkeeping discrepancies |
| 7 | `orig_exact_drain` | **2.55%** | Complete balance wipeout indicator |
| 8 | `errorBalanceDest` | **1.10%** | Destination ledger variance |

---

## Local Verification Commands

```bash
# Print verified metrics and confusion matrix
python backend/scripts/evaluate_xgboost.py --metrics-only

# Run unit tests
python -m unittest tests/test_xgboost_model.py
```
