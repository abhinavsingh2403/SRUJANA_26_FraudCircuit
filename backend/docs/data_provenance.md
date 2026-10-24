# Data provenance and constraints

## Bundled data

`traceguard/fixtures.py` contains 14 hand-authored deterministic synthetic scenarios. They exercise selected rule paths. They are not real customer records, real incidents, a representative sample of Indian payment transactions, or evidence of model efficacy. The scenario's expected description is an acceptance goal, not ground truth about real fraud.

## Canonical CSV

Required: `transaction_id`, `timestamp`, `sender_id`, `recipient_id`, `amount`, `transaction_type`. Optional: `currency`.

- `transaction_id` is unique per import.
- `timestamp` must be ISO-8601 with an explicit timezone and is normalized to UTC.
- `sender_id` and `recipient_id` are non-empty, bounded, and cannot be equal in this prototype (self-transfers are unsupported).
- `amount` must be finite, positive and under a configurable numeric guardrail.
- A single import is one ledger and one currency. Optional currency is shape-checked as three letters, but is not checked against an external ISO registry. Mixed currency values are rejected. No FX conversion is performed.
- If no currency column is supplied, amounts are unit-unspecified.
- Unknown extra columns are ignored and reported. Recognized target/label, fraud-flag and common balance columns are excluded and reported. This is a deny-list, not comprehensive data-loss prevention; inspect the source file before importing it.
- Import errors reject the whole upload. The endpoint has byte/row limits and returns at most 100 case previews.

The service is not a general accounting engine. It uses floating-point transaction amounts for screening calculations, not regulated ledger accounting.

## PaySim

The canonical importer intentionally refuses PaySim-style schema files. PaySim is a simulated mobile-money dataset with a `step` field that represents simulation steps; transactions within the same step have no trustworthy within-step order supplied by that field alone. A reviewed adapter must group equal steps, keep them in the same chronological split, and ensure all input features are available at the chosen scoring time.

Never use `isFraud` as a predictor. Do not use `isFlaggedFraud` as an independent model feature: it is an existing flag. Do not use post-transaction balance fields as predictors without a careful point-in-time justification. For the simple benchmark adapter planned for this project, exclude all such fields. PaySim's simulation mechanics and label-generating rules differ from production Indian payment systems.

## External data

No external transaction dataset is bundled. Before using one, record the exact publisher, version/date, license, file hash, time semantics, label semantics, row/column counts, preprocessing, sampling and known limitations. Data access or license terms must be verified by the team. Do not claim Indian UPI representation without evidence.

## Human review outcomes

The database stores analyst-entered `CONFIRMED_SUSPICIOUS`, `FALSE_POSITIVE`, or `INCONCLUSIVE` outcomes for closed cases. The API does not prove those labels. Outcome counts describe only reviewed cases and cannot be reported as system-wide false-positive rate without a representative labelled evaluation design.
