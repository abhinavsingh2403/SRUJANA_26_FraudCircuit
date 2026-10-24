"""Tie-safe, point-in-time transaction features for the screening prototype.

No transaction at a timestamp is used as prior history for another transaction
at that same timestamp. Rolling histories are maintained incrementally to avoid
quadratic scans on dense accounts. Features are heuristics, not labels.
"""
from __future__ import annotations

import heapq
import math
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from itertools import islice
from statistics import median
from typing import Iterable, Iterator

from .config import DEFAULT_SETTINGS, Settings
from .domain import Transaction

_MICROSECONDS = 1_000_000


class _RunningMedian:
    def __init__(self) -> None:
        self._lower: list[float] = []
        self._upper: list[float] = []

    def add(self, value: float) -> None:
        if not self._lower or value <= -self._lower[0]:
            heapq.heappush(self._lower, -value)
        else:
            heapq.heappush(self._upper, value)
        if len(self._lower) > len(self._upper) + 1:
            heapq.heappush(self._upper, -heapq.heappop(self._lower))
        elif len(self._upper) > len(self._lower):
            heapq.heappush(self._lower, -heapq.heappop(self._upper))

    @property
    def count(self) -> int:
        return len(self._lower) + len(self._upper)

    def value(self) -> float | None:
        if not self.count:
            return None
        if len(self._lower) == len(self._upper):
            return (-self._lower[0] + self._upper[0]) / 2.0
        return -self._lower[0]


class _WindowHistory:
    """Incremental rolling metrics for one account and transaction direction."""
    def __init__(self, direction: str) -> None:
        if direction not in {"inbound", "outbound"}:
            raise ValueError("direction must be inbound or outbound")
        self.direction = direction
        self.events: deque[Transaction] = deque()
        self.total_amount = 0.0
        self.counterparties: Counter[str] = Counter()
        self.amount_counts: Counter[float] = Counter()
        self.amount_counterparties: dict[float, Counter[str]] = defaultdict(Counter)
        self.amount_ids: dict[float, deque[str]] = defaultdict(deque)

    def _counterparty(self, tx: Transaction) -> str:
        return tx.sender_id if self.direction == "inbound" else tx.recipient_id

    def prune_before(self, cutoff_us: int) -> None:
        while self.events and self.events[0].timestamp_us < cutoff_us:
            tx = self.events.popleft()
            self.total_amount -= tx.amount
            party = self._counterparty(tx)
            self.counterparties[party] -= 1
            if self.counterparties[party] <= 0:
                del self.counterparties[party]
            self.amount_counts[tx.amount] -= 1
            if self.amount_counts[tx.amount] <= 0:
                del self.amount_counts[tx.amount]
            amount_parties = self.amount_counterparties[tx.amount]
            amount_parties[party] -= 1
            if amount_parties[party] <= 0:
                del amount_parties[party]
            if not amount_parties:
                del self.amount_counterparties[tx.amount]
            ids = self.amount_ids[tx.amount]
            # Events are appended in deterministic chronological order; exact-amount
            # IDs are therefore also ordered by time.
            if ids and ids[0] == tx.transaction_id:
                ids.popleft()
            else:  # defensive guard; do not corrupt another amount's history
                try:
                    ids.remove(tx.transaction_id)
                except ValueError:
                    pass
            if not ids:
                self.amount_ids.pop(tx.amount, None)
        if abs(self.total_amount) < 1e-9:
            self.total_amount = 0.0

    def append(self, tx: Transaction) -> None:
        self.events.append(tx)
        self.total_amount += tx.amount
        party = self._counterparty(tx)
        self.counterparties[party] += 1
        self.amount_counts[tx.amount] += 1
        self.amount_counterparties[tx.amount][party] += 1
        self.amount_ids[tx.amount].append(tx.transaction_id)

    @property
    def count(self) -> int:
        return len(self.events)

    def recent_ids(self, limit: int) -> tuple[str, ...]:
        return tuple(tx.transaction_id for tx in list(islice(reversed(self.events), limit))[::-1])

    def exact_amount_ids(self, amount: float, limit: int) -> tuple[str, ...]:
        return tuple(list(self.amount_ids.get(amount, ()))[-limit:])


@dataclass(frozen=True, slots=True)
class Features:
    transaction_id: str
    prior_inbound_count: int
    prior_inbound_total: float
    prior_inbound_unique_senders: int
    prior_inbound_transaction_ids: tuple[str, ...]
    prior_inbound_ids_truncated: bool
    seconds_since_last_inbound: float | None
    last_inbound_amount: float | None
    pass_through_ratio: float | None
    prior_outbound_count: int
    prior_outbound_unique_recipients: int
    current_recipient_seen_before: bool
    prior_outbound_transaction_ids: tuple[str, ...]
    prior_outbound_ids_truncated: bool
    outbound_unique_recipients_including_current: int
    account_history_count: int
    account_history_span_seconds: float
    account_history_median: float | None
    account_history_mad: float | None
    account_baseline_transaction_ids: tuple[str, ...]
    account_baseline_ids_truncated: bool
    global_history_count: int
    global_history_median: float | None
    coverage: str
    inbound_window_stats: dict[str, dict[str, object]]
    outbound_short_window_count: int
    outbound_short_window_total: float
    outbound_short_window_unique_recipients_including_current: int
    prior_outbound_same_amount_count: int
    prior_outbound_same_amount_unique_recipients: int
    prior_outbound_same_amount_transaction_ids: tuple[str, ...]
    prior_outbound_same_amount_ids_truncated: bool
    recipient_prior_inbound_count: int
    recipient_prior_inbound_unique_senders: int
    recipient_prior_inbound_median_amount: float | None
    recipient_prior_inbound_transaction_ids: tuple[str, ...]
    seconds_since_last_outbound_lifetime: float | None
    lifetime_outbound_count: int
    lifetime_outbound_median: float | None
    lifetime_outbound_transaction_ids: tuple[str, ...]
    current_recipient_seen_for_same_amount: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "transaction_id": self.transaction_id,
            "prior_inbound_count": self.prior_inbound_count,
            "prior_inbound_total": round(self.prior_inbound_total, 6),
            "prior_inbound_unique_senders": self.prior_inbound_unique_senders,
            "prior_inbound_transaction_ids": list(self.prior_inbound_transaction_ids),
            "prior_inbound_ids_truncated": self.prior_inbound_ids_truncated,
            "seconds_since_last_inbound": self.seconds_since_last_inbound,
            "last_inbound_amount": self.last_inbound_amount,
            "pass_through_ratio": self.pass_through_ratio,
            "prior_outbound_count": self.prior_outbound_count,
            "prior_outbound_unique_recipients": self.prior_outbound_unique_recipients,
            "current_recipient_seen_before": self.current_recipient_seen_before,
            "prior_outbound_transaction_ids": list(self.prior_outbound_transaction_ids),
            "prior_outbound_ids_truncated": self.prior_outbound_ids_truncated,
            "outbound_unique_recipients_including_current": self.outbound_unique_recipients_including_current,
            "account_history_count": self.account_history_count,
            "account_history_span_seconds": self.account_history_span_seconds,
            "account_history_median": self.account_history_median,
            "account_history_mad": self.account_history_mad,
            "account_baseline_transaction_ids": list(self.account_baseline_transaction_ids),
            "account_baseline_ids_truncated": self.account_baseline_ids_truncated,
            "global_history_count": self.global_history_count,
            "global_history_median": self.global_history_median,
            "coverage": self.coverage,
            "inbound_window_stats": self.inbound_window_stats,
            "outbound_short_window_count": self.outbound_short_window_count,
            "outbound_short_window_total": round(self.outbound_short_window_total, 6),
            "outbound_short_window_unique_recipients_including_current": self.outbound_short_window_unique_recipients_including_current,
            "prior_outbound_same_amount_count": self.prior_outbound_same_amount_count,
            "prior_outbound_same_amount_unique_recipients": self.prior_outbound_same_amount_unique_recipients,
            "prior_outbound_same_amount_transaction_ids": list(self.prior_outbound_same_amount_transaction_ids),
            "prior_outbound_same_amount_ids_truncated": self.prior_outbound_same_amount_ids_truncated,
            "recipient_prior_inbound_count": self.recipient_prior_inbound_count,
            "recipient_prior_inbound_unique_senders": self.recipient_prior_inbound_unique_senders,
            "recipient_prior_inbound_median_amount": self.recipient_prior_inbound_median_amount,
            "recipient_prior_inbound_transaction_ids": list(self.recipient_prior_inbound_transaction_ids),
            "seconds_since_last_outbound_lifetime": self.seconds_since_last_outbound_lifetime,
            "lifetime_outbound_count": self.lifetime_outbound_count,
            "lifetime_outbound_median": self.lifetime_outbound_median,
            "lifetime_outbound_transaction_ids": list(self.lifetime_outbound_transaction_ids),
            "current_recipient_seen_for_same_amount": self.current_recipient_seen_for_same_amount,
        }


def iter_features(transactions: Iterable[Transaction], settings: Settings = DEFAULT_SETTINGS) -> Iterator[tuple[str, Features]]:
    """Yield point-in-time features without retaining a feature for every row.

    All events with an equal timestamp are scored before any of them update the
    rolling history, so event order within coarse timestamp buckets is not guessed.
    """
    txs = sorted(transactions, key=lambda t: (t.timestamp_us, t.transaction_id))
    if not txs:
        return

    windows = sorted(set(settings.pass_through_windows_seconds) | {settings.rolling_window_seconds, settings.fanout_window_seconds, settings.structuring_window_seconds})
    inbound_by_window: dict[int, dict[str, _WindowHistory]] = {
        window: defaultdict(lambda: _WindowHistory("inbound")) for window in windows
    }
    outbound_by_window: dict[int, dict[str, _WindowHistory]] = {
        window: defaultdict(lambda: _WindowHistory("outbound")) for window in windows
    }
    outbound_baseline: dict[str, deque[Transaction]] = defaultdict(lambda: deque(maxlen=settings.max_account_baseline_observations))
    lifetime_outbound: dict[str, deque[Transaction]] = defaultdict(lambda: deque(maxlen=settings.max_account_baseline_observations))
    lifetime_outbound_count: Counter[str] = Counter()
    last_outbound_time: dict[str, int] = {}
    global_median = _RunningMedian()

    index = 0
    while index < len(txs):
        end = index + 1
        event_time = txs[index].timestamp_us
        while end < len(txs) and txs[end].timestamp_us == event_time:
            end += 1
        bucket = txs[index:end]
        for tx in bucket:
            for window in windows:
                inbound_by_window[window][tx.sender_id].prune_before(event_time - window * _MICROSECONDS)
                outbound_by_window[window][tx.sender_id].prune_before(event_time - window * _MICROSECONDS)
                # Recipient context uses the inbound history of the current recipient.
                inbound_by_window[window][tx.recipient_id].prune_before(event_time - window * _MICROSECONDS)
            inbound_24 = inbound_by_window[settings.rolling_window_seconds][tx.sender_id]
            out_24 = outbound_by_window[settings.rolling_window_seconds][tx.sender_id]
            out_short = outbound_by_window[settings.fanout_window_seconds][tx.sender_id]
            out_structuring = outbound_by_window[settings.structuring_window_seconds][tx.sender_id]
            recipient_in_24 = inbound_by_window[settings.rolling_window_seconds][tx.recipient_id]

            baseline_queue = outbound_baseline[tx.sender_id]
            baseline_cutoff = event_time - settings.baseline_window_seconds * _MICROSECONDS
            while baseline_queue and baseline_queue[0].timestamp_us < baseline_cutoff:
                baseline_queue.popleft()
            baseline_amounts = [event.amount for event in baseline_queue]
            baseline_span_seconds = ((baseline_queue[-1].timestamp_us - baseline_queue[0].timestamp_us) / _MICROSECONDS) if len(baseline_queue) >= 2 else 0.0
            hist_median = median(baseline_amounts) if baseline_amounts else None
            hist_mad = median([abs(amount - hist_median) for amount in baseline_amounts]) if hist_median is not None else None
            lifetime_records = list(lifetime_outbound[tx.sender_id])
            lifetime_amounts = [event.amount for event in lifetime_records]
            lifetime_median = median(lifetime_amounts) if lifetime_amounts else None
            seconds_since_last_out = ((event_time - last_outbound_time[tx.sender_id]) / _MICROSECONDS
                                      if tx.sender_id in last_outbound_time else None)

            window_stats: dict[str, dict[str, object]] = {}
            for window in sorted(set(settings.pass_through_windows_seconds)):
                hist = inbound_by_window[window][tx.sender_id]
                last_in = hist.events[-1] if hist.events else None
                window_stats[str(window)] = {
                    "count": hist.count,
                    "total_amount": round(hist.total_amount, 6),
                    "unique_senders": len(hist.counterparties),
                    "seconds_since_last": ((event_time - last_in.timestamp_us) / _MICROSECONDS) if last_in else None,
                    "transaction_ids": list(hist.recent_ids(settings.max_supporting_transaction_ids)),
                    "ids_truncated": hist.count > settings.max_supporting_transaction_ids,
                }

            last_in = inbound_24.events[-1] if inbound_24.events else None
            total = inbound_24.total_amount
            ratio = tx.amount / total if total > 0 else None
            if ratio is not None and not math.isfinite(ratio):
                ratio = None
            recipient_amounts = [event.amount for event in recipient_in_24.events]
            same_amount_count = out_structuring.amount_counts.get(tx.amount, 0)
            same_amount_unique = len(out_structuring.amount_counterparties.get(tx.amount, {}))
            same_amount_ids = out_structuring.exact_amount_ids(tx.amount, settings.max_supporting_transaction_ids)
            same_amount_parties = out_structuring.amount_counterparties.get(tx.amount, {})
            out_short_count = out_short.count
            out_short_unique = len(out_short.counterparties) + int(tx.recipient_id not in out_short.counterparties)
            features = Features(
                transaction_id=tx.transaction_id,
                prior_inbound_count=inbound_24.count,
                prior_inbound_total=total,
                prior_inbound_unique_senders=len(inbound_24.counterparties),
                prior_inbound_transaction_ids=inbound_24.recent_ids(settings.max_supporting_transaction_ids),
                prior_inbound_ids_truncated=inbound_24.count > settings.max_supporting_transaction_ids,
                seconds_since_last_inbound=((event_time - last_in.timestamp_us) / _MICROSECONDS) if last_in else None,
                last_inbound_amount=last_in.amount if last_in else None,
                pass_through_ratio=ratio,
                prior_outbound_count=out_24.count,
                prior_outbound_unique_recipients=len(out_24.counterparties),
                current_recipient_seen_before=tx.recipient_id in out_24.counterparties,
                prior_outbound_transaction_ids=out_24.recent_ids(settings.max_supporting_transaction_ids),
                prior_outbound_ids_truncated=out_24.count > settings.max_supporting_transaction_ids,
                outbound_unique_recipients_including_current=len(out_24.counterparties) + int(tx.recipient_id not in out_24.counterparties),
                account_history_count=len(baseline_amounts),
                account_history_span_seconds=baseline_span_seconds,
                account_history_median=hist_median,
                account_history_mad=hist_mad,
                account_baseline_transaction_ids=tuple(event.transaction_id for event in list(baseline_queue)[-settings.max_supporting_transaction_ids:]),
                account_baseline_ids_truncated=len(baseline_queue) > settings.max_supporting_transaction_ids,
                global_history_count=global_median.count,
                global_history_median=global_median.value(),
                coverage="adequate" if len(baseline_amounts) >= settings.min_account_history else "limited",
                inbound_window_stats=window_stats,
                outbound_short_window_count=out_short.count,
                outbound_short_window_total=out_short.total_amount,
                outbound_short_window_unique_recipients_including_current=out_short_unique,
                prior_outbound_same_amount_count=same_amount_count,
                prior_outbound_same_amount_unique_recipients=same_amount_unique,
                prior_outbound_same_amount_transaction_ids=out_structuring.exact_amount_ids(tx.amount, settings.max_supporting_transaction_ids),
                prior_outbound_same_amount_ids_truncated=same_amount_count > settings.max_supporting_transaction_ids,
                recipient_prior_inbound_count=recipient_in_24.count,
                recipient_prior_inbound_unique_senders=len(recipient_in_24.counterparties) + int(tx.sender_id not in recipient_in_24.counterparties),
                recipient_prior_inbound_median_amount=median(recipient_amounts) if recipient_amounts else None,
                recipient_prior_inbound_transaction_ids=recipient_in_24.recent_ids(settings.max_supporting_transaction_ids),
                seconds_since_last_outbound_lifetime=seconds_since_last_out,
                lifetime_outbound_count=lifetime_outbound_count[tx.sender_id],
                lifetime_outbound_median=lifetime_median,
                lifetime_outbound_transaction_ids=tuple(event.transaction_id for event in lifetime_records[-settings.max_supporting_transaction_ids:]),
                current_recipient_seen_for_same_amount=tx.recipient_id in same_amount_parties,
            )
            yield tx.transaction_id, features

        # Update state only after every same-timestamp transaction was yielded/scored.
        for tx in bucket:
            for window in windows:
                inbound_by_window[window][tx.recipient_id].append(tx)
                outbound_by_window[window][tx.sender_id].append(tx)
            outbound_baseline[tx.sender_id].append(tx)
            lifetime_outbound[tx.sender_id].append(tx)
            lifetime_outbound_count[tx.sender_id] += 1
            last_outbound_time[tx.sender_id] = tx.timestamp_us
            global_median.add(tx.amount)
        index = end



def build_features(transactions: Iterable[Transaction], settings: Settings = DEFAULT_SETTINGS) -> dict[str, Features]:
    """Convenience materializer for tests and small analysis batches."""
    return {transaction_id: features for transaction_id, features in iter_features(transactions, settings)}
