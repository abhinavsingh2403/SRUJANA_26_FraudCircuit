"""Deterministic case grouping and human-review priority policy."""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from typing import Iterable

from .config import DEFAULT_SETTINGS, Settings
from .domain import CaseRecord, Evidence, Transaction, TransactionAnalysis

_SIGNAL_RULES = {
    "R1_RAPID_PASS_THROUGH", "R2_FAN_IN_DISPERSAL", "R2A_FAN_IN_CLUSTER",
    "R2B_FAN_OUT_BURST", "R3_AMOUNT_DEVIATION", "R4_DIRECTED_CYCLE",
    "R5_LAYERED_CHAIN", "R6_REPEATED_VALUE_BURST", "R7_DORMANT_REACTIVATION",
}


def _short_hash(value: str) -> str:
    # 80 bits of digest makes accidental ID collisions much less likely than
    # a 48-bit display prefix while keeping identifiers compact.
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]


def make_run_id(source_id: str, transactions: Iterable[Transaction], settings: Settings = DEFAULT_SETTINGS) -> str:
    canonical = [
        [t.transaction_id, t.timestamp, t.sender_id, t.recipient_id, format(t.amount, ".17g"), t.transaction_type, t.currency]
        for t in sorted(transactions, key=lambda x: (x.timestamp_us, x.transaction_id))
    ]
    from .provenance import analysis_identity
    raw = json.dumps({"source_id": source_id, "transactions": canonical, "analysis": analysis_identity(settings)}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "run_" + _short_hash(raw)


PRIORITY_POLICY = {
    "high_min_rules": 3, "high_min_triggers": 4,
    "high_min_linked_transactions": 2, "high_min_linked_accounts": 2,
    "structural": {"R4_DIRECTED_CYCLE", "R5_LAYERED_CHAIN", "R6_REPEATED_VALUE_BURST"},
    "corroborating": {"R1_RAPID_PASS_THROUGH", "R2_FAN_IN_DISPERSAL", "R3_AMOUNT_DEVIATION", "R7_DORMANT_REACTIVATION"},
    "specific": {"R6_REPEATED_VALUE_BURST", "R7_DORMANT_REACTIVATION"},
    "routine_rules": {"R2_FAN_IN_DISPERSAL", "R2A_FAN_IN_CLUSTER", "R2B_FAN_OUT_BURST"},
    "routine_context": {"C1_STABLE_AMOUNT_CONTEXT", "C2_REPEATED_COUNTERPARTY_CONTEXT", "C3_STABLE_INBOUND_AMOUNT_CONTEXT"},
}


def priority_policy():
    p = PRIORITY_POLICY
    return [
        {"priority": "HIGH", "description": f"At least {p['high_min_rules']} distinct risk rules on {p['high_min_triggers']} trigger transactions, a structural and corroborating pair sharing at least {p['high_min_linked_transactions']} transactions and {p['high_min_linked_accounts']} accounts, plus repeated-value or dormant-reactivation evidence."},
        {"priority": "MEDIUM", "description": "Risk evidence exists and neither the HIGH nor LOW policy applies."},
        {"priority": "LOW", "description": "Pass-through is the only risk rule, or all risk rules are routine fan-in/fan-out signals with a stable-amount or repeated-counterparty context signal. Risk evidence stays visible; legitimacy is not established."},
        {"priority": "INSUFFICIENT_HISTORY", "description": "Case contains coverage limitations but no supported risk rule. Insufficient history is based on observation counts and the coverage rule's global-outlier gates, not simply account age."},
    ]


def _priority(evidence: list[Evidence]) -> str:
    risk_evidence = [item for item in evidence if item.kind == "RULE_SIGNAL" and item.rule_id in _SIGNAL_RULES]
    signal_rules = {item.rule_id for item in risk_evidence}
    trigger_transactions = {item.trigger_transaction_id for item in risk_evidence}
    context_codes = {item.rule_id for item in evidence if item.kind == "CONTEXT_SIGNAL"}

    # HIGH is a conservative *review-priority* heuristic, not a fraud probability.
    # Require a structural motif and corroborating behavior to overlap on multiple
    # transactions/accounts, not merely to appear somewhere in the same case.
    structural = PRIORITY_POLICY["structural"]
    corroborating = PRIORITY_POLICY["corroborating"]
    structural_items = [item for item in risk_evidence if item.rule_id in structural]
    corroborating_items = [item for item in risk_evidence if item.rule_id in corroborating]
    linked_corroboration = any(
        len(set(struct_item.transaction_ids).intersection(corroborating_item.transaction_ids)) >= PRIORITY_POLICY["high_min_linked_transactions"]
        and len(set(struct_item.account_ids).intersection(corroborating_item.account_ids)) >= PRIORITY_POLICY["high_min_linked_accounts"]
        for struct_item in structural_items
        for corroborating_item in corroborating_items
    )
    # High priority requires a distinctive pattern (repeated-value burst or
    # dormant reactivation) in addition to linked structural + corroborating
    # evidence. Routine graph connectivity alone is common in dense ledgers and
    # must not promote a case to HIGH. This remains a heuristic, not calibration.
    specific_pattern_present = bool(signal_rules.intersection(PRIORITY_POLICY["specific"]))
    if (len(signal_rules) >= PRIORITY_POLICY["high_min_rules"] and len(trigger_transactions) >= PRIORITY_POLICY["high_min_triggers"]
            and linked_corroboration and specific_pattern_present):
        return "HIGH"

    # A pass-through ratio alone is a weak, highly context-dependent signal.
    # Keep it visible for review, but do not make it actionable without another
    # distinct signal. The controlled benchmark includes ordinary P2P sequences
    # that otherwise produced many medium-priority cases. This policy reduces
    # queue pressure; it is not a claim that every single pass-through is benign.
    if signal_rules == {"R1_RAPID_PASS_THROUGH"}:
        return "LOW"

    # Recurrent routine-looking collection/dispersal patterns receive LOW review
    # priority only when context also exists and no stronger signal is present.
    routine_rules = PRIORITY_POLICY["routine_rules"]
    # C1 is emitted only when stable outgoing amounts have enough prior history
    # spread over a configured minimum duration; a short burst by itself cannot
    # suppress an alert. None of these context signals proves legitimacy.
    routine_context = PRIORITY_POLICY["routine_context"]
    if signal_rules and signal_rules.issubset(routine_rules) and context_codes.intersection(routine_context):
        return "LOW"
    if signal_rules:
        return "MEDIUM"
    return "INSUFFICIENT_HISTORY"


def _related_components(analyses: list[TransactionAnalysis], max_span_us: int) -> list[list[TransactionAnalysis]]:
    """Group candidate events only when their evidence explicitly overlaps.

    Sharing an account and being close in time is not enough: that caused noisy,
    high-degree synthetic ledgers to collapse into giant cases. Candidate rows
    are linked when one risk/coverage evidence item references the other row's
    transaction (or when two evidence sets cite the same transaction). Groups
    remain bounded by max_span_us. This is grouping logic, not graph truth.
    """
    parent = list(range(len(analyses)))
    min_time = [row.transaction.timestamp_us for row in analyses]
    max_time = min_time.copy()

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union_if_bounded(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        combined_min = min(min_time[ra], min_time[rb])
        combined_max = max(max_time[ra], max_time[rb])
        if combined_max - combined_min > max_span_us:
            return
        parent[rb] = ra
        min_time[ra] = combined_min
        max_time[ra] = combined_max

    # An index is associated with its own trigger transaction and the support
    # transactions explicitly cited by its risk/coverage evidence. Adjacent
    # candidates sharing a reference are considered in stable chronological order.
    by_reference: dict[str, list[int]] = defaultdict(list)
    for index, row in enumerate(analyses):
        references = {row.transaction.transaction_id}
        for item in row.evidence:
            if item.kind in {"RULE_SIGNAL", "COVERAGE_LIMITATION"}:
                references.update(item.transaction_ids)
        for reference in sorted(references):
            by_reference[reference].append(index)

    for _, indices in sorted(by_reference.items(), key=lambda item: item[0]):
        unique_indices = sorted(set(indices), key=lambda i: (analyses[i].transaction.timestamp_us,
                                                              analyses[i].transaction.transaction_id))
        for left, right in zip(unique_indices, unique_indices[1:]):
            union_if_bounded(left, right)

    groups: dict[int, list[TransactionAnalysis]] = defaultdict(list)
    for index, row in enumerate(analyses):
        groups[find(index)].append(row)
    return sorted(groups.values(), key=lambda group: min(x.transaction.timestamp_us for x in group))


def build_cases(
    analyses: list[TransactionAnalysis],
    all_transactions: list[Transaction],
    source_scenario_id: str,
    run_id: str,
    settings: Settings = DEFAULT_SETTINGS,
) -> list[CaseRecord]:
    # Context signals describe candidate behaviour but cannot create cases alone.
    candidates = [
        item for item in analyses
        if any(ev.kind in {"RULE_SIGNAL", "COVERAGE_LIMITATION"} for ev in item.evidence)
    ]
    candidates.sort(key=lambda item: (item.transaction.timestamp_us, item.transaction.transaction_id))
    if not candidates:
        return []

    transaction_by_id = {tx.transaction_id: tx for tx in all_transactions}
    groups = _related_components(candidates, settings.max_case_span_seconds * 1_000_000)
    cases: list[CaseRecord] = []

    for group in groups:
        trigger_id_set = {row.transaction.transaction_id for row in group}
        trigger_ids_all = sorted(trigger_id_set, key=lambda tx_id: (transaction_by_id[tx_id].timestamp_us, tx_id))
        evidence_all: list[Evidence] = []
        context_ids_all: set[str] = set()
        account_ids_all: set[str] = set()
        for row in group:
            for item in row.evidence:
                evidence_all.append(item)
                context_ids_all.update(item.transaction_ids)
                account_ids_all.update(item.account_ids)
            account_ids_all.update((row.transaction.sender_id, row.transaction.recipient_id))
        context_ids_all.difference_update(trigger_id_set)
        for tx_id in context_ids_all:
            tx = transaction_by_id.get(tx_id)
            if tx:
                account_ids_all.update((tx.sender_id, tx.recipient_id))

        # Preserve chronology, with risk/coverage evidence ahead of descriptive context
        # if a payload cap forces truncation.
        def evidence_order(item: Evidence) -> tuple[int, int, str, str]:
            trigger = transaction_by_id.get(item.trigger_transaction_id)
            event_time = trigger.timestamp_us if trigger is not None else 0
            kind_rank = {"RULE_SIGNAL": 0, "COVERAGE_LIMITATION": 1, "CONTEXT_SIGNAL": 2}.get(item.kind, 3)
            return (kind_rank, event_time, item.rule_id, item.evidence_id)

        evidence_all.sort(key=evidence_order)
        rule_codes = sorted({item.rule_id for item in evidence_all if item.kind == "RULE_SIGNAL"})
        context_codes = sorted({item.rule_id for item in evidence_all if item.kind == "CONTEXT_SIGNAL"})
        priority = _priority(evidence_all)
        case_material = run_id + "|" + "|".join(trigger_ids_all)
        case_id = "case_" + _short_hash(case_material)

        if priority == "HIGH":
            summary = "Multiple distinct risk rules occurred across multiple trigger transactions; investigate the linked sequence."
        elif priority == "MEDIUM":
            summary = "At least one configured risk signal was triggered; review its supporting evidence and context."
        elif priority == "LOW":
            summary = "Signals remain visible at LOW review priority under the configured policy; this is not evidence of benign activity."
        else:
            summary = "Available account-specific history is insufficient; the case is coverage-limited and is not a fraud signal."

        context_ids_ordered = sorted(
            context_ids_all, key=lambda tx_id: (transaction_by_id[tx_id].timestamp_us, tx_id)
        )
        account_ids_ordered = sorted(account_ids_all)
        trigger_ids = trigger_ids_all[:settings.max_case_trigger_transactions]
        context_ids = context_ids_ordered[:settings.max_case_context_transactions]
        account_ids = account_ids_ordered[:settings.max_case_account_ids]
        evidence = evidence_all[:settings.max_case_evidence_items]
        triggered = [transaction_by_id[tx_id].public_dict() for tx_id in trigger_ids if tx_id in transaction_by_id]
        context = [transaction_by_id[tx_id].public_dict() for tx_id in context_ids if tx_id in transaction_by_id]

        limitations = [
            "A rule match is not a finding of fraud.",
            "Priority is an investigator review order, not a calibrated probability.",
            "Signals can be correlated; multiple rules are not independent proof.",
            "Context signals do not prove legitimacy and never suppress risk signals automatically.",
            "The prototype uses synthetic or user-provided benchmark data and is not connected to a bank or payment network.",
        ]
        if priority == "INSUFFICIENT_HISTORY":
            limitations.append("Account-specific history is below the configured minimum; the case is coverage-limited.")
        if any((len(trigger_ids_all) > len(trigger_ids), len(context_ids_ordered) > len(context_ids),
                len(account_ids_ordered) > len(account_ids), len(evidence_all) > len(evidence))):
            limitations.append("This case payload is intentionally bounded; inspect counts and truncation fields before interpreting the full linked set.")
        limitations.append(
            "Case grouping has a configured maximum time span; a longer transitive chain may be represented as separate cases. "
            "Inspect run_id and evidence links before assuming two cases are unrelated."
        )

        cases.append(CaseRecord(
            case_id=case_id,
            run_id=run_id,
            source_scenario_id=source_scenario_id,
            priority=priority,  # type: ignore[arg-type]
            status="OPEN",
            transaction_ids=trigger_ids,
            context_transaction_ids=context_ids,
            account_ids=account_ids,
            rule_codes=rule_codes,
            context_codes=context_codes,
            evidence=[item.to_dict() for item in evidence],
            trigger_transactions=triggered,
            context_transactions=context,
            score_components={"rule_codes": rule_codes, "context_codes": context_codes, "model_score": None, "model_status": "not_configured"},
            summary=summary,
            limitations=limitations,
            counts={
                "trigger_transactions_total": len(trigger_ids_all),
                "context_transactions_total": len(context_ids_ordered),
                "account_ids_total": len(account_ids_ordered),
                "evidence_total": len(evidence_all),
                "rule_signals_total": sum(1 for item in evidence_all if item.kind == "RULE_SIGNAL"),
                "context_signals_total": sum(1 for item in evidence_all if item.kind == "CONTEXT_SIGNAL"),
            },
            truncation={
                "trigger_transactions": len(trigger_ids_all) > len(trigger_ids),
                "context_transactions": len(context_ids_ordered) > len(context_ids),
                "account_ids": len(account_ids_ordered) > len(account_ids),
                "evidence": len(evidence_all) > len(evidence),
            },
            review_outcome=None,
        ))
    return cases
