"""Bounded, time-aware directed multigraph analysis for investigation signals.

Each transaction is a distinct directed edge. Analysis of a timestamp bucket
uses only strictly earlier timestamp buckets; simultaneous events are never
ordered arbitrarily. Searches are bounded to prevent adversarial/high-degree
inputs from causing unbounded runtime. A budget-exhaustion count is returned.
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
import hashlib
from typing import Callable

from .config import DEFAULT_SETTINGS, Settings
from .domain import Evidence, Transaction

_MICROSECONDS = 1_000_000


def _evidence_id(rule_id: str, transaction_id: str) -> str:
    return "ev_" + hashlib.sha256(f"{rule_id}|{transaction_id}".encode()).hexdigest()[:12]


@dataclass(frozen=True, slots=True)
class GraphAnalysisResult:
    evidence_by_transaction: dict[str, list[Evidence]]
    stats: dict[str, int]


def detect_graph_patterns(transactions: list[Transaction], settings: Settings = DEFAULT_SETTINGS) -> GraphAnalysisResult:
    txs = sorted(transactions, key=lambda tx: (tx.timestamp_us, tx.transaction_id))
    out_adj: dict[str, deque[Transaction]] = defaultdict(deque)
    in_adj: dict[str, deque[Transaction]] = defaultdict(deque)
    active: deque[Transaction] = deque()
    evidence: dict[str, list[Evidence]] = defaultdict(list)
    stats = {
        "transactions_analyzed": len(txs),
        "directed_cycles_detected": 0,
        "layered_chains_detected": 0,
        "cycle_search_budget_exhausted": 0,
        "chain_search_budget_exhausted": 0,
        "graph_search_expansion_limit": settings.graph_search_expansion_limit,
        "graph_analysis_incomplete": 0,
    }
    max_window_us = max(settings.cycle_window_seconds, settings.layered_chain_window_seconds) * _MICROSECONDS

    def prune(now_us: int) -> None:
        cutoff = now_us - max_window_us
        while active and active[0].timestamp_us < cutoff:
            old = active.popleft()
            if out_adj[old.sender_id] and out_adj[old.sender_id][0].transaction_id == old.transaction_id:
                out_adj[old.sender_id].popleft()
            if in_adj[old.recipient_id] and in_adj[old.recipient_id][0].transaction_id == old.transaction_id:
                in_adj[old.recipient_id].popleft()

    def find_cycle(tx: Transaction) -> tuple[list[Transaction] | None, int, bool]:
        cutoff = tx.timestamp_us - settings.cycle_window_seconds * _MICROSECONDS
        budget = settings.graph_search_expansion_limit
        expansions = 0
        start, target = tx.recipient_id, tx.sender_id
        max_prior_edges = settings.max_cycle_length - 1
        min_retention = settings.cycle_min_retention_ratio
        max_gap_us = settings.cycle_max_gap_seconds * _MICROSECONDS

        def valid_cycle(path_to_sender: list[Transaction]) -> bool:
            # path_to_sender is the directed path recipient -> ... -> sender;
            # the current tx closes the cycle back to its recipient.
            edges = [*path_to_sender, tx]
            if len(edges) < 3 or len(edges) > settings.max_cycle_length:
                return False
            # A graph cycle is only evidence for a transaction sequence when its
            # edges occurred in path order. A topological cycle whose edge times
            # run backwards is not a temporally possible flow of funds. Same-time
            # events are not ordered by this analyzer.
            if any(right.timestamp_us <= left.timestamp_us for left, right in zip(edges, edges[1:])):
                return False
            # In a random dense graph, cycles are common. Require both a short
            # temporal envelope and material value retention around the loop.
            if any(right.timestamp_us - left.timestamp_us > max_gap_us for left, right in zip(edges, edges[1:])):
                return False
            for current, following in zip(edges, edges[1:] + edges[:1]):
                if following.amount < current.amount * min_retention:
                    return False
            return True

        def dfs(
            node: str, path: list[Transaction], visited: set[str],
            last_time_us: int | None, last_amount: float | None,
        ) -> list[Transaction] | None:
            nonlocal expansions
            if node == target and len(path) >= 2 and valid_cycle(path):
                return path.copy()
            if len(path) >= max_prior_edges:
                return None
            # Recent transactions first gives deterministic and useful short cycles.
            # Prune impossible temporal order *before* consuming the expansion
            # budget; otherwise random dense graphs waste the whole budget on
            # topological paths that cannot represent a chronological flow.
            candidates = out_adj.get(node, ())
            for edge in reversed(candidates):
                if edge.timestamp_us < cutoff or edge.timestamp_us >= tx.timestamp_us:
                    continue
                if last_time_us is not None:
                    if edge.timestamp_us <= last_time_us:
                        continue
                    if edge.timestamp_us - last_time_us > max_gap_us:
                        continue
                    if last_amount is not None and edge.amount < last_amount * min_retention:
                        continue
                expansions += 1
                if expansions > budget:
                    return None
                next_node = edge.recipient_id
                if next_node == target:
                    candidate_path = path + [edge]
                    if len(candidate_path) >= 2 and valid_cycle(candidate_path):
                        return candidate_path
                    continue
                if next_node in visited:
                    continue
                path.append(edge)
                found = dfs(next_node, path, visited | {next_node}, edge.timestamp_us, edge.amount)
                path.pop()
                if found:
                    return found
                if expansions > budget:
                    return None
            return None

        # Start seen avoids a non-simple cycle through an already visited node.
        found = dfs(start, [], {start}, None, None)
        return found, expansions, expansions > budget

    # Prototype heuristic: require configured amount retention at each chosen hop.
    # This intentionally favors fewer, tighter candidates over generic paths.
    # The value is configurable and is not a validated banking threshold.
    min_retention = settings.layered_chain_min_retention_ratio

    def find_layered_chain(tx: Transaction) -> tuple[list[Transaction] | None, int, bool]:
        cutoff = tx.timestamp_us - settings.layered_chain_window_seconds * _MICROSECONDS
        budget = settings.graph_search_expansion_limit
        expansions = 0
        # Require three prior edges plus the current edge: a four-edge chain.
        # Shorter two- and three-edge paths are too common in dense transaction
        # networks to be a useful standalone signal for this prototype.
        max_prior_edges = 3

        def dfs(node: str, next_amount: float, next_time: int, rev_path: list[Transaction], visited: set[str]) -> list[Transaction] | None:
            nonlocal expansions
            if len(rev_path) >= max_prior_edges:
                return None
            for edge in reversed(in_adj.get(node, ())):
                if edge.timestamp_us < cutoff or edge.timestamp_us >= next_time:
                    continue
                if next_time - edge.timestamp_us > settings.layered_chain_max_gap_seconds * _MICROSECONDS:
                    continue
                expansions += 1
                if expansions > budget:
                    return None
                if next_amount < edge.amount * min_retention:
                    continue
                predecessor = edge.sender_id
                if predecessor in visited:
                    continue
                rev_path.append(edge)
                if len(rev_path) >= 3:
                    # Every chosen edge is within gap, amount-retention and time-window bounds.
                    return list(reversed(rev_path))
                found = dfs(predecessor, edge.amount, edge.timestamp_us, rev_path, visited | {predecessor})
                if found:
                    return found
                rev_path.pop()
                if expansions > budget:
                    return None
            return None

        found = dfs(tx.sender_id, tx.amount, tx.timestamp_us, [], {tx.sender_id, tx.recipient_id})
        return found, expansions, expansions > budget

    index = 0
    while index < len(txs):
        end = index + 1
        stamp = txs[index].timestamp_us
        while end < len(txs) and txs[end].timestamp_us == stamp:
            end += 1
        bucket = txs[index:end]
        prune(stamp)
        for tx in bucket:
            cycle_path, _, cycle_budget_hit = find_cycle(tx)
            if cycle_budget_hit:
                stats["cycle_search_budget_exhausted"] += 1
            if cycle_path:
                path_edges = cycle_path + [tx]
                path_edges = sorted(path_edges, key=lambda event: (event.timestamp_us, event.transaction_id))
                path_ids = tuple(dict.fromkeys(event.transaction_id for event in path_edges))
                account_ids = tuple(sorted({account for event in path_edges for account in (event.sender_id, event.recipient_id)}))
                evidence[tx.transaction_id].append(Evidence(
                    evidence_id=_evidence_id("R4_DIRECTED_CYCLE", tx.transaction_id),
                    rule_id="R4_DIRECTED_CYCLE",
                    title="Directed transaction cycle candidate",
                    kind="RULE_SIGNAL",
                    description="A directed path through prior transactions closes a cycle with the current transfer within the configured time window.",
                    trigger_transaction_id=tx.transaction_id,
                    transaction_ids=path_ids,
                    account_ids=account_ids,
                    observed={
                        "cycle_length": len(path_edges),
                        "cycle_window_seconds": settings.cycle_window_seconds,
                        "maximum_inter_event_gap_seconds": settings.cycle_max_gap_seconds,
                        "minimum_amount_retention_ratio": settings.cycle_min_retention_ratio,
                        "transaction_sequence": list(path_ids),
                    },
                    caveats=("Cycles can occur in legitimate activity; this pattern is a review signal, not proof of fraud.",),
                ))
                stats["directed_cycles_detected"] += 1

            chain_path, _, chain_budget_hit = find_layered_chain(tx)
            if chain_budget_hit:
                stats["chain_search_budget_exhausted"] += 1
            if chain_path:
                path_edges = chain_path + [tx]
                path_ids = tuple(dict.fromkeys(event.transaction_id for event in path_edges))
                account_ids = tuple(sorted({account for event in path_edges for account in (event.sender_id, event.recipient_id)}))
                evidence[tx.transaction_id].append(Evidence(
                    evidence_id=_evidence_id("R5_LAYERED_CHAIN", tx.transaction_id),
                    rule_id="R5_LAYERED_CHAIN",
                    title="Multi-hop transaction chain candidate",
                    kind="RULE_SIGNAL",
                    description="The current transfer extends a multi-hop path across distinct accounts within configured time-gap and amount-retention bounds.",
                    trigger_transaction_id=tx.transaction_id,
                    transaction_ids=path_ids,
                    account_ids=account_ids,
                    observed={
                        "chain_hops": len(path_edges),
                        "chain_window_seconds": settings.layered_chain_window_seconds,
                        "max_gap_seconds": settings.layered_chain_max_gap_seconds,
                        "minimum_amount_retention_ratio": min_retention,
                        "transaction_sequence": list(path_ids),
                    },
                    caveats=("Legitimate payment processors and transfer chains can produce multi-hop paths; review source, business purpose and other evidence.",),
                ))
                stats["layered_chains_detected"] += 1
        # Strict timestamp-bucket semantics: all peers at this timestamp are added after scoring.
        for tx in bucket:
            out_adj[tx.sender_id].append(tx)
            in_adj[tx.recipient_id].append(tx)
            active.append(tx)
        index = end

    # A bounded search that exhausts its per-event budget is an incomplete search,
    # not a clean result. Surface that fact to callers/UI instead of hiding it.
    stats["graph_analysis_incomplete"] = int(
        stats["cycle_search_budget_exhausted"] > 0
        or stats["chain_search_budget_exhausted"] > 0
    )
    return GraphAnalysisResult(dict(evidence), stats)
