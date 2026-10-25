"""Transparent transaction-risk and context rules.

Rules produce review signals, not fraud verdicts. All thresholds are prototype
heuristics. Rule matches are explainable; accuracy must be measured separately.
"""
from __future__ import annotations

import hashlib
import math
from statistics import median

from .config import DEFAULT_SETTINGS, Settings
from .domain import Evidence, Transaction
from .features import Features


def _evidence_id(rule_id: str, transaction_id: str) -> str:
    digest = hashlib.sha256(f"{rule_id}|{transaction_id}".encode()).hexdigest()[:12]
    return f"ev_{digest}"


def _signal(rule_id: str, title: str, description: str, tx: Transaction,
            transaction_ids: tuple[str, ...] | list[str], account_ids: tuple[str, ...] | list[str],
            observed: dict[str, object], caveat: str) -> Evidence:
    return Evidence(
        evidence_id=_evidence_id(rule_id, tx.transaction_id), rule_id=rule_id, title=title,
        kind="RULE_SIGNAL", description=description, trigger_transaction_id=tx.transaction_id,
        transaction_ids=tuple(dict.fromkeys(transaction_ids)), account_ids=tuple(sorted(set(account_ids))),
        observed=observed, caveats=(caveat,),
    )


def evaluate_rules(tx: Transaction, f: Features, settings: Settings = DEFAULT_SETTINGS) -> list[Evidence]:
    evidence: list[Evidence] = []
    related_inbound = list(f.prior_inbound_transaction_ids)
    related_outbound = list(f.prior_outbound_transaction_ids)
    endpoints = (tx.sender_id, tx.recipient_id)

    # R1: multi-window pass-through. One rule signal records every window that
    # independently met the time/amount ratio conditions; overlapping windows
    # are not treated as independent evidence.
    matched_windows: list[int] = []
    matched_ids: list[str] = []
    matched_stats: dict[str, dict[str, object]] = {}
    for window_text, stats in f.inbound_window_stats.items():
        window = int(window_text)
        gap = stats.get("seconds_since_last")
        total = stats.get("total_amount")
        count = stats.get("count")
        if isinstance(gap, (int, float)) and isinstance(total, (int, float)) and isinstance(count, int):
            ratio = tx.amount / total if total > 0 else None
            if gap <= window and ratio is not None and math.isfinite(ratio) and ratio >= settings.pass_through_min_ratio:
                matched_windows.append(window)
                ids = stats.get("transaction_ids")
                if isinstance(ids, list):
                    matched_ids.extend(str(item) for item in ids)
                matched_stats[window_text] = {
                    "prior_inbound_count": count,
                    "prior_inbound_total": round(float(total), 6),
                    "seconds_since_last_inbound": gap,
                    "amount_to_inflow_ratio": round(ratio, 6),
                }
    if matched_windows:
        evidence.append(_signal(
            "R1_RAPID_PASS_THROUGH", "Multi-window rapid pass-through candidate",
            "The outgoing amount is a large share of prior inflows in at least one configured time window.",
            tx, matched_ids + related_inbound + [tx.transaction_id], endpoints,
            {"current_amount": tx.amount, "matched_windows_seconds": sorted(matched_windows),
             "window_details": matched_stats, "configured_ratio_threshold": settings.pass_through_min_ratio,
             "supporting_ids_truncated": any(bool(f.inbound_window_stats[str(w)].get("ids_truncated")) for w in matched_windows)},
            "Rapid movement can be legitimate. Overlapping windows are correlated signals, not independent confirmations."))

    # R2: inbound fan-in followed by outbound dispersal, as seen from an outgoing
    # transfer from an account with prior multiple-source inflows.
    total_outflow_short = f.outbound_short_window_total + tx.amount
    combined_recipients_short = f.outbound_short_window_unique_recipients_including_current
    recent_outflow_ratio = total_outflow_short / f.prior_inbound_total if f.prior_inbound_total > 0 else None
    if (f.prior_inbound_unique_senders >= settings.min_fan_in_senders
            and combined_recipients_short >= settings.min_fan_out_recipients
            and f.outbound_short_window_count + 1 >= settings.min_fan_out_transactions
            and recent_outflow_ratio is not None and recent_outflow_ratio >= settings.fan_in_min_outflow_ratio):
        evidence.append(_signal(
            "R2_FAN_IN_DISPERSAL", "Fan-in and dispersal pattern",
            "The account received funds from multiple senders and has transferred to multiple recipients within the rolling window.",
            tx, related_inbound + related_outbound + [tx.transaction_id], endpoints,
            {"prior_inbound_unique_senders": f.prior_inbound_unique_senders,
             "outbound_unique_recipients_including_current": combined_recipients_short,
             "outbound_window_transactions_including_current": f.outbound_short_window_count + 1,
             "outbound_window_total_including_current": round(total_outflow_short, 6),
             "outflow_to_prior_inflow_ratio": round(recent_outflow_ratio, 6),
             "rolling_inflow_window_seconds": settings.rolling_window_seconds,
             "outflow_window_seconds": settings.fanout_window_seconds,
             "minimum_inbound_senders": settings.min_fan_in_senders,
             "minimum_outbound_recipients": settings.min_fan_out_recipients,
             "supporting_inbound_ids_truncated": f.prior_inbound_ids_truncated,
             "supporting_outbound_ids_truncated": f.prior_outbound_ids_truncated},
            "Marketplaces, payment processors and settlement accounts may legitimately exhibit fan-in/dispersal."))

    # R2A: fan-in to a collector is independently visible even before dispersal.
    if f.recipient_prior_inbound_unique_senders >= settings.min_fan_in_cluster_senders:
        ids = list(f.recipient_prior_inbound_transaction_ids) + [tx.transaction_id]
        evidence.append(_signal(
            "R2A_FAN_IN_CLUSTER", "Many-source collection pattern",
            "The recipient has received transfers from many distinct senders during the rolling window.",
            tx, ids, (tx.recipient_id, tx.sender_id),
            {"recipient_prior_inbound_count": f.recipient_prior_inbound_count,
             "distinct_inbound_senders_including_current": f.recipient_prior_inbound_unique_senders,
             "threshold_distinct_senders": settings.min_fan_in_cluster_senders,
             "rolling_window_seconds": settings.rolling_window_seconds},
            "High-volume collections can be legitimate; inspect the account's known business role and downstream flows."))

    # R2B: short-window fan-out; a 1-hour burst is used so ordinary payrolls
    # spaced over days do not trigger merely because total lifetime volume is high.
    if (f.outbound_short_window_count + 1 >= settings.min_fan_out_transactions and
            f.outbound_short_window_unique_recipients_including_current >= settings.min_fan_out_burst_recipients):
        evidence.append(_signal(
            "R2B_FAN_OUT_BURST", "Short-window multi-recipient burst",
            "The account sent several transfers to distinct recipients within a short configured window.",
            tx, related_outbound + [tx.transaction_id], endpoints,
            {"prior_outgoing_count_in_window": f.outbound_short_window_count,
             "distinct_recipients_including_current": f.outbound_short_window_unique_recipients_including_current,
             "window_seconds": settings.fanout_window_seconds,
             "minimum_transactions": settings.min_fan_out_transactions,
             "minimum_recipients": settings.min_fan_out_burst_recipients},
            "Bulk payouts and merchant settlements can create legitimate bursts; amount/time context matters."))

    # R3: account-specific outgoing amount outlier using only prior events.
    if f.account_history_count >= settings.min_account_history and f.account_history_median is not None:
        amount, hist_median, mad = tx.amount, f.account_history_median, f.account_history_mad or 0.0
        relative_increase = (amount - hist_median) / hist_median if hist_median > 0 else (float("inf") if amount > hist_median else 0.0)
        # A robust z-score alone becomes noisy on short, tightly clustered histories.
        # Require a material relative increase as well as the MAD/zero-MAD test.
        material_change = relative_increase >= settings.amount_deviation_min_relative_change
        if mad > 0:
            raw_z = 0.6745 * (amount - hist_median) / mad
            z_score = raw_z if math.isfinite(raw_z) else None
            outlier = material_change and (raw_z >= settings.amount_mad_z_threshold if math.isfinite(raw_z) else amount > hist_median)
        else:
            z_score = None
            outlier = amount >= hist_median * settings.zero_mad_amount_multiple
        if outlier:
            # Use the actual 30-day baseline transaction IDs, not the 24h rolling window.
            baseline_ids = list(f.account_baseline_transaction_ids)
            evidence.append(_signal(
                "R3_AMOUNT_DEVIATION", "Amount deviates from account history",
                "The amount is unusually high relative to this account's prior outgoing amounts.", tx,
                baseline_ids + [tx.transaction_id], endpoints,
                {"current_amount": amount, "historical_median": hist_median, "historical_mad": mad,
                 "modified_z_score": z_score, "relative_increase": round(relative_increase, 6),
                 "minimum_relative_increase": settings.amount_deviation_min_relative_change,
                 "history_count": f.account_history_count,
                 "baseline_window_seconds": settings.baseline_window_seconds,
                 "configured_mad_threshold": settings.amount_mad_z_threshold,
                 "zero_mad_multiple": settings.zero_mad_amount_multiple,
                 "supporting_ids_truncated": f.account_baseline_ids_truncated},
                "The threshold is a prototype heuristic and must be evaluated on held-out data."))
    elif (f.account_history_count < settings.min_account_history and f.global_history_count >= settings.min_global_history
          and f.global_history_median is not None and tx.amount >= f.global_history_median * settings.global_outlier_multiple):
        evidence.append(Evidence(
            evidence_id=_evidence_id("R3_BASELINE_UNAVAILABLE", tx.transaction_id), rule_id="R3_BASELINE_UNAVAILABLE",
            title="Account baseline unavailable", kind="COVERAGE_LIMITATION",
            description="The amount is high relative to the prior ledger-wide median, but the account lacks enough history for an account-specific comparison.",
            trigger_transaction_id=tx.transaction_id, transaction_ids=(tx.transaction_id,), account_ids=tuple(sorted(set(endpoints))),
            observed={"current_amount": tx.amount, "prior_ledger_median": f.global_history_median,
                      "prior_ledger_transaction_count": f.global_history_count,
                      "account_history_count": f.account_history_count, "minimum_account_history": settings.min_account_history,
                      "global_multiple_threshold": settings.global_outlier_multiple},
            caveats=("Coverage warning only, not a fraud signal. A ledger-wide median may be inappropriate for heterogeneous accounts.",)))

    # R6: repeated exact-amount burst. Exact equality is intentionally explicit;
    # this catches repeated-value patterns without pretending to detect every
    # form of regulatory structuring or choosing a universal legal threshold.
    same_count_including_current = f.prior_outbound_same_amount_count + 1
    same_recipients_including_current = f.prior_outbound_same_amount_unique_recipients + int(not f.current_recipient_seen_for_same_amount)
    if (same_count_including_current >= settings.min_repeated_value_transactions and
            same_recipients_including_current >= settings.min_repeated_value_recipients):
        evidence.append(_signal(
            "R6_REPEATED_VALUE_BURST", "Repeated-value multi-recipient burst",
            "The same exact amount was transferred repeatedly to multiple recipients during the rolling window.",
            tx, list(f.prior_outbound_same_amount_transaction_ids) + [tx.transaction_id], endpoints,
            {"exact_amount": tx.amount, "transactions_including_current": same_count_including_current,
             "distinct_recipients_including_current": same_recipients_including_current,
             "window_seconds": settings.structuring_window_seconds,
             "supporting_ids_truncated": f.prior_outbound_same_amount_ids_truncated},
            "Repeated values can occur in payroll and bulk payments. This is a generic pattern signal, not a legal structuring determination."))

    # R7: dormant-account reactivation requires prior lifetime history, a long gap,
    # and a current amount materially above the account's historical median.
    if (f.lifetime_outbound_count >= settings.min_dormant_history and
            f.seconds_since_last_outbound_lifetime is not None and
            f.seconds_since_last_outbound_lifetime >= settings.dormant_gap_seconds and
            f.lifetime_outbound_median is not None and f.lifetime_outbound_median > 0 and
            tx.amount >= f.lifetime_outbound_median * settings.dormant_amount_multiple):
        evidence.append(_signal(
            "R7_DORMANT_REACTIVATION", "Dormant-account reactivation candidate",
            "An account with prior outgoing history transacted after a long inactive interval with an amount above its historical median.",
            tx, list(f.lifetime_outbound_transaction_ids) + [tx.transaction_id], endpoints,
            {"seconds_since_last_outbound": f.seconds_since_last_outbound_lifetime,
             "dormancy_threshold_seconds": settings.dormant_gap_seconds,
             "prior_lifetime_outbound_count": f.lifetime_outbound_count,
             "recent_lifetime_median_amount": f.lifetime_outbound_median,
             "current_amount": tx.amount, "configured_amount_multiple": settings.dormant_amount_multiple},
            "Dormancy and amount change are contextual signals; seasonal businesses and legitimate account changes can match."))

    # C1: repeated outgoing amount is routine context, never proof of innocence.
    if (f.account_history_count >= settings.min_context_history
            and f.account_history_span_seconds >= settings.min_context_history_span_seconds
            and f.account_history_median is not None and f.account_history_median > 0):
        deviation = abs(tx.amount - f.account_history_median) / f.account_history_median
        if math.isfinite(deviation) and deviation <= settings.stable_amount_context_tolerance:
            evidence.append(Evidence(
                evidence_id=_evidence_id("C1_STABLE_AMOUNT_CONTEXT", tx.transaction_id),
                rule_id="C1_STABLE_AMOUNT_CONTEXT", title="Amount is consistent with recent outgoing history",
                kind="CONTEXT_SIGNAL", description="The amount is close to the account's prior outgoing median.",
                trigger_transaction_id=tx.transaction_id,
                transaction_ids=tuple(dict.fromkeys(related_outbound + [tx.transaction_id])), account_ids=tuple(sorted(set(endpoints))),
                observed={"current_amount": tx.amount, "historical_median": f.account_history_median,
                          "relative_deviation": round(deviation, 8), "context_tolerance": settings.stable_amount_context_tolerance,
                          "history_count": f.account_history_count,
                          "history_span_seconds": f.account_history_span_seconds,
                          "minimum_history_span_seconds": settings.min_context_history_span_seconds},
                caveats=("Routine-looking context may be legitimate or suspicious; it is not a whitelist or proof of innocence.",)))

    # C2: repeated recipient observed in prior outgoing history.
    if f.current_recipient_seen_before:
        evidence.append(Evidence(
            evidence_id=_evidence_id("C2_REPEATED_COUNTERPARTY_CONTEXT", tx.transaction_id),
            rule_id="C2_REPEATED_COUNTERPARTY_CONTEXT", title="Recipient appeared in prior outgoing activity",
            kind="CONTEXT_SIGNAL", description="The recipient was observed in the account's prior rolling-window outgoing history.",
            trigger_transaction_id=tx.transaction_id,
            transaction_ids=tuple(dict.fromkeys(related_outbound + [tx.transaction_id])), account_ids=tuple(sorted(set(endpoints))),
            observed={"current_recipient_seen_before": True, "prior_outbound_count": f.prior_outbound_count,
                      "rolling_window_seconds": settings.rolling_window_seconds},
            caveats=("A repeated counterparty can be legitimate or suspicious; this context does not prove innocence.",)))

    # C3: stable incoming amount pattern for an account receiving funds. This is
    # particularly useful for showing routine collection/settlement context.
    if (f.recipient_prior_inbound_count >= settings.min_context_history and
            f.recipient_prior_inbound_median_amount is not None and f.recipient_prior_inbound_median_amount > 0):
        deviation = abs(tx.amount - f.recipient_prior_inbound_median_amount) / f.recipient_prior_inbound_median_amount
        if math.isfinite(deviation) and deviation <= settings.stable_amount_context_tolerance:
            evidence.append(Evidence(
                evidence_id=_evidence_id("C3_STABLE_INBOUND_AMOUNT_CONTEXT", tx.transaction_id),
                rule_id="C3_STABLE_INBOUND_AMOUNT_CONTEXT", title="Amount matches prior incoming pattern",
                kind="CONTEXT_SIGNAL", description="The incoming amount is close to the recipient's prior inbound median.",
                trigger_transaction_id=tx.transaction_id,
                transaction_ids=tuple(dict.fromkeys(list(f.recipient_prior_inbound_transaction_ids) + [tx.transaction_id])),
                account_ids=tuple(sorted(set(endpoints))),
                observed={"current_amount": tx.amount, "recipient_prior_inbound_median": f.recipient_prior_inbound_median_amount,
                          "recipient_prior_inbound_count": f.recipient_prior_inbound_count, "relative_deviation": round(deviation, 8)},
                caveats=("A stable incoming pattern is context only; payment collection and account abuse can look similar.",)))

    return evidence
