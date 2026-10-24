"""Typed domain objects shared by ingestion, analysis, persistence and API."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Priority = Literal["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_HISTORY"]
CaseStatus = Literal["OPEN", "INVESTIGATING", "ESCALATED", "CLOSED"]
ReviewOutcome = Literal["CONFIRMED_SUSPICIOUS", "FALSE_POSITIVE", "INCONCLUSIVE"]
EvidenceKind = Literal["RULE_SIGNAL", "CONTEXT_SIGNAL", "COVERAGE_LIMITATION"]


@dataclass(frozen=True, slots=True)
class Transaction:
    transaction_id: str
    timestamp_us: int
    timestamp: str
    sender_id: str
    recipient_id: str
    amount: float
    transaction_type: str
    currency: str | None = None

    def public_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "transaction_id": self.transaction_id,
            "timestamp": self.timestamp,
            "sender_id": self.sender_id,
            "recipient_id": self.recipient_id,
            "amount": self.amount,
            "transaction_type": self.transaction_type,
        }
        if self.currency is not None:
            result["currency"] = self.currency
        return result


@dataclass(frozen=True, slots=True)
class Evidence:
    evidence_id: str
    rule_id: str
    title: str
    kind: EvidenceKind
    description: str
    trigger_transaction_id: str
    transaction_ids: tuple[str, ...]
    account_ids: tuple[str, ...]
    observed: dict[str, Any] = field(default_factory=dict)
    caveats: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["transaction_ids"] = list(self.transaction_ids)
        result["account_ids"] = list(self.account_ids)
        result["caveats"] = list(self.caveats)
        return result


@dataclass(frozen=True, slots=True)
class TransactionAnalysis:
    transaction: Transaction
    evidence: tuple[Evidence, ...]
    feature_summary: dict[str, Any]


@dataclass(slots=True)
class CaseRecord:
    case_id: str
    run_id: str
    source_scenario_id: str
    priority: Priority
    status: CaseStatus
    transaction_ids: list[str]
    context_transaction_ids: list[str]
    account_ids: list[str]
    rule_codes: list[str]
    context_codes: list[str]
    evidence: list[dict[str, Any]]
    trigger_transactions: list[dict[str, Any]]
    context_transactions: list[dict[str, Any]]
    score_components: dict[str, Any]
    summary: str
    limitations: list[str]
    counts: dict[str, int]
    truncation: dict[str, bool]
    review_outcome: ReviewOutcome | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
