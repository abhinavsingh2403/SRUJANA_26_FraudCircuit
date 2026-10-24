"""Strict canonical CSV ingestion.

Only canonical transaction fields enter the analysis pipeline. Label, target,
existing fraud-flag, and balance columns are discarded and reported; they are
never copied into features or case payloads.
"""
from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

from .config import DEFAULT_SETTINGS, Settings
from .domain import Transaction

REQUIRED_COLUMNS = (
    "transaction_id",
    "timestamp",
    "sender_id",
    "recipient_id",
    "amount",
    "transaction_type",
)

OPTIONAL_COLUMNS = {"currency"}
SENSITIVE_OR_LABEL_COLUMNS = {
    "isfraud", "is_fraud", "isflaggedfraud", "is_flagged_fraud",
    "fraud", "fraud_label", "fraudlabel", "fraud_status", "fraudstatus",
    "label", "target", "target_label",
    # PaySim-style post-transaction balance fields and common snake_case variants.
    "oldbalanceorg", "newbalanceorig", "oldbalancedest", "newbalancedest",
    "oldbalanceorig", "newbalanceorg", "old_balance_org", "new_balance_orig",
    "old_balance_dest", "new_balance_dest", "old_balance", "new_balance",
}


class CSVValidationError(ValueError):
    def __init__(self, message: str, details: list[dict[str, object]] | None = None):
        super().__init__(message)
        self.details = details or []


@dataclass(frozen=True, slots=True)
class IngestionResult:
    transactions: list[Transaction]
    row_count: int
    currency: str | None
    dropped_columns: list[str]
    warnings: list[str]


def _parse_timestamp(value: str, row_number: int) -> tuple[int, str]:
    raw = value.strip()
    if not raw:
        raise ValueError(f"row {row_number}: timestamp is required")
    candidate = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise ValueError(f"row {row_number}: timestamp must be ISO-8601 with a timezone") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"row {row_number}: timestamp must include a timezone (for example, Z or +05:30)")
    utc = parsed.astimezone(timezone.utc)
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    delta = utc - epoch
    timestamp_us = (delta.days * 86_400 + delta.seconds) * 1_000_000 + delta.microseconds
    normalized = utc.isoformat(timespec="microseconds").replace("+00:00", "Z")
    return timestamp_us, normalized


def parse_csv_bytes(raw: bytes, settings: Settings = DEFAULT_SETTINGS) -> IngestionResult:
    if not raw:
        raise CSVValidationError("CSV body is empty")
    if len(raw) > settings.max_upload_bytes:
        raise CSVValidationError(f"CSV exceeds the {settings.max_upload_bytes}-byte upload limit")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise CSVValidationError("CSV must be UTF-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(text, newline=""))
    try:
        fieldnames = reader.fieldnames
    except csv.Error as exc:
        raise CSVValidationError("CSV header could not be parsed; check quoting and field lengths") from exc
    if not fieldnames:
        raise CSVValidationError("CSV must contain a header row")
    if len(fieldnames) > settings.max_csv_columns:
        raise CSVValidationError(f"CSV exceeds the {settings.max_csv_columns}-column limit")
    normalized_headers = [str(h or "").strip().lower() for h in fieldnames]
    if any(not h for h in normalized_headers):
        raise CSVValidationError("CSV contains an empty column name")
    if len(set(normalized_headers)) != len(normalized_headers):
        raise CSVValidationError("CSV contains duplicate column names after normalization")

    original_by_normalized = {str(h).strip().lower(): str(h).strip() for h in fieldnames}
    missing = sorted(set(REQUIRED_COLUMNS) - set(normalized_headers))
    if missing:
        if {"step", "nameorig", "namedest", "isfraud"}.issubset(normalized_headers):
            message = ("This looks like a PaySim-style file, not the canonical TraceGuard CSV. "
                       "Use a documented adapter that preserves its relative hourly steps; do not upload it directly.")
        else:
            message = "Missing required columns: " + ", ".join(missing)
        raise CSVValidationError(message)

    ignored = [original_by_normalized[h] for h in normalized_headers
               if h not in REQUIRED_COLUMNS and h not in OPTIONAL_COLUMNS]
    dropped_sensitive = [c for c in ignored if c.lower() in SENSITIVE_OR_LABEL_COLUMNS]
    unknown_ignored = [c for c in ignored if c.lower() not in SENSITIVE_OR_LABEL_COLUMNS]

    transactions: list[Transaction] = []
    errors: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    seen_currencies: set[str] = set()
    has_currency_column = "currency" in normalized_headers

    try:
        for row_number, row in enumerate(reader, start=2):
            if row_number - 1 > settings.max_csv_rows:
                raise CSVValidationError(f"CSV exceeds the {settings.max_csv_rows}-row limit")
            if None in row:
                if len(errors) < settings.max_csv_error_details:
                    errors.append({"row": row_number, "error": "row has more values than the header columns"})
                continue
            normalized_row = {str(k or "").strip().lower(): (v if v is not None else "")
                              for k, v in row.items() if k is not None}
            try:
                required_values = {key: str(normalized_row.get(key, "")).strip() for key in REQUIRED_COLUMNS}
                for key in ("transaction_id", "sender_id", "recipient_id", "transaction_type"):
                    if not required_values[key]:
                        raise ValueError(f"{key} is required")
                    if len(required_values[key]) > 200:
                        raise ValueError(f"{key} exceeds 200 characters")
                    if any(ord(char) < 32 or ord(char) == 127 for char in required_values[key]):
                        raise ValueError(f"{key} contains a control character")
                tx_id = required_values["transaction_id"]
                if required_values["sender_id"] == required_values["recipient_id"]:
                    raise ValueError("sender_id and recipient_id must differ; self-transfers are unsupported by this prototype")
                if tx_id in seen_ids:
                    raise ValueError(f"duplicate transaction_id: {tx_id}")
                amount_raw = required_values["amount"]
                try:
                    amount = float(amount_raw)
                except (ValueError, TypeError) as exc:
                    raise ValueError("amount must be a numeric value") from exc
                if not math.isfinite(amount) or amount <= 0:
                    raise ValueError("amount must be finite and greater than zero")
                if amount > settings.max_transaction_amount:
                    raise ValueError(f"amount exceeds the configured numeric safety limit ({settings.max_transaction_amount:g})")
                timestamp_us, timestamp = _parse_timestamp(required_values["timestamp"], row_number)
                currency = None
                if has_currency_column:
                    currency = str(normalized_row.get("currency", "")).strip().upper()
                    if not currency:
                        raise ValueError("currency must be populated when the currency column is present")
                    if re.fullmatch(r"[A-Z]{3}", currency) is None:
                        raise ValueError("currency must be a three-letter code when provided")
                    seen_currencies.add(currency)
                transactions.append(Transaction(
                    transaction_id=tx_id,
                    timestamp_us=timestamp_us,
                    timestamp=timestamp,
                    sender_id=required_values["sender_id"],
                    recipient_id=required_values["recipient_id"],
                    amount=amount,
                    transaction_type=required_values["transaction_type"],
                    currency=currency,
                ))
                seen_ids.add(tx_id)
            except ValueError as exc:
                if len(errors) < settings.max_csv_error_details:
                    errors.append({"row": row_number, "error": str(exc)})
    except csv.Error as exc:
        raise CSVValidationError("CSV parsing failed; check quoting and field lengths") from exc

    if errors:
        raise CSVValidationError("CSV validation failed; no rows were imported", errors)
    if not transactions:
        raise CSVValidationError("CSV contains no transaction rows")
    if len(seen_currencies) > 1:
        raise CSVValidationError("Multiple currencies in one CSV are not supported; convert or split ledgers before import")

    # A stable order is useful for output, but feature calculation deliberately
    # groups equal timestamps so ID sorting never implies within-timestamp order.
    transactions.sort(key=lambda t: (t.timestamp_us, t.transaction_id))
    warnings: list[str] = []
    if dropped_sensitive:
        warnings.append("Excluded label, fraud-flag, or balance columns from analysis: " + ", ".join(dropped_sensitive))
    if unknown_ignored:
        warnings.append("Ignored unsupported columns: " + ", ".join(unknown_ignored))
    currency = next(iter(seen_currencies)) if seen_currencies else None
    warnings.append("All transactions are treated as one ledger. Convert currencies before analysis if applicable.")
    if currency is None:
        warnings.append("No currency code was supplied; amounts are unit-unspecified numeric values.")
    return IngestionResult(
        transactions=transactions,
        row_count=len(transactions),
        currency=currency,
        dropped_columns=ignored,
        warnings=warnings,
    )
