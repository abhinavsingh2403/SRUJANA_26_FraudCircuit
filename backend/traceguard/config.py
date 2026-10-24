"""Central, explicit thresholds for the prototype.

These values are demonstration defaults, not validated banking thresholds.
Keep them configurable and tune only against a documented validation set.
"""
from dataclasses import dataclass
import math


@dataclass(frozen=True, slots=True)
class Settings:
    rolling_window_seconds: int = 24 * 60 * 60
    pass_through_window_seconds: int = 60 * 60  # backward-compatible primary window
    pass_through_windows_seconds: tuple[int, ...] = (60 * 60, 6 * 60 * 60, 24 * 60 * 60)
    fanout_window_seconds: int = 60 * 60
    structuring_window_seconds: int = 60 * 60
    cycle_window_seconds: int = 6 * 60 * 60
    cycle_max_gap_seconds: int = 60 * 60
    cycle_min_retention_ratio: float = 0.65
    layered_chain_window_seconds: int = 24 * 60 * 60
    layered_chain_max_gap_seconds: int = 15 * 60
    dormant_gap_seconds: int = 30 * 24 * 60 * 60
    baseline_window_seconds: int = 30 * 24 * 60 * 60
    case_gap_seconds: int = 6 * 60 * 60
    max_case_span_seconds: int = 24 * 60 * 60

    pass_through_min_ratio: float = 0.75
    min_fan_in_senders: int = 3
    min_fan_in_cluster_senders: int = 6
    min_fan_out_recipients: int = 3
    min_fan_out_burst_recipients: int = 4
    min_fan_out_transactions: int = 4
    min_context_history: int = 3
    min_context_history_span_seconds: int = 30 * 60
    min_repeated_value_transactions: int = 10
    min_repeated_value_recipients: int = 4
    max_cycle_length: int = 5
    graph_search_expansion_limit: int = 64
    layered_chain_min_retention_ratio: float = 0.80
    min_dormant_history: int = 5
    dormant_amount_multiple: float = 3.0
    min_account_history: int = 5
    amount_mad_z_threshold: float = 3.5
    amount_deviation_min_relative_change: float = 0.25
    zero_mad_amount_multiple: float = 4.0
    min_global_history: int = 20
    global_outlier_multiple: float = 4.0
    stable_amount_context_tolerance: float = 0.10

    max_upload_bytes: int = 5 * 1024 * 1024
    max_transaction_amount: float = 1e18  # numeric safety bound for this screening prototype
    max_csv_rows: int = 100_000
    max_csv_columns: int = 128
    max_csv_error_details: int = 25
    response_case_preview_limit: int = 100
    max_supporting_transaction_ids: int = 20
    max_account_baseline_observations: int = 100
    max_case_trigger_transactions: int = 100
    max_case_context_transactions: int = 100
    max_case_account_ids: int = 200
    max_case_evidence_items: int = 100

    def __post_init__(self) -> None:
        positive_ints = (
            self.rolling_window_seconds, self.pass_through_window_seconds, self.fanout_window_seconds,
            self.structuring_window_seconds, self.cycle_window_seconds, self.cycle_max_gap_seconds, self.layered_chain_window_seconds,
            self.layered_chain_max_gap_seconds, self.dormant_gap_seconds,
            self.baseline_window_seconds, self.case_gap_seconds, self.max_case_span_seconds,
            self.min_fan_in_senders, self.min_fan_in_cluster_senders, self.min_fan_out_recipients,
            self.min_fan_out_burst_recipients, self.min_fan_out_transactions, self.min_context_history, self.min_context_history_span_seconds,
            self.min_repeated_value_transactions, self.min_repeated_value_recipients,
            self.max_cycle_length, self.graph_search_expansion_limit, self.min_dormant_history,
            self.min_account_history, self.min_global_history,
            self.max_upload_bytes, self.max_csv_rows, self.max_csv_columns, self.max_csv_error_details, self.response_case_preview_limit,
            self.max_supporting_transaction_ids, self.max_account_baseline_observations,
            self.max_case_trigger_transactions, self.max_case_context_transactions,
            self.max_case_account_ids, self.max_case_evidence_items,
        )
        if any(value <= 0 for value in positive_ints):
            raise ValueError("time windows, counts, and limits must be positive")
        if not math.isfinite(self.max_transaction_amount) or self.max_transaction_amount <= 0:
            raise ValueError("max_transaction_amount must be finite and positive")
        if not self.pass_through_windows_seconds or any(not isinstance(w, int) or w <= 0 for w in self.pass_through_windows_seconds):
            raise ValueError("pass_through_windows_seconds must contain positive integer windows")
        if len(set(self.pass_through_windows_seconds)) != len(self.pass_through_windows_seconds):
            raise ValueError("pass_through_windows_seconds must be unique")
        if self.max_cycle_length < 3 or self.max_cycle_length > 8:
            raise ValueError("max_cycle_length must be between 3 and 8")
        if not 0 < self.cycle_min_retention_ratio <= 1:
            raise ValueError("cycle_min_retention_ratio must be in (0, 1]")
        if not 0 < self.layered_chain_min_retention_ratio <= 1:
            raise ValueError("layered_chain_min_retention_ratio must be in (0, 1]")
        if not 0 < self.pass_through_min_ratio <= 1:
            raise ValueError("pass_through_min_ratio must be in (0, 1]")
        numeric_thresholds = (self.amount_mad_z_threshold, self.amount_deviation_min_relative_change, self.zero_mad_amount_multiple, self.global_outlier_multiple, self.stable_amount_context_tolerance, self.dormant_amount_multiple, self.cycle_min_retention_ratio, self.layered_chain_min_retention_ratio)
        if any(not math.isfinite(value) for value in numeric_thresholds):
            raise ValueError("numeric thresholds must be finite")
        if self.amount_mad_z_threshold <= 0 or self.zero_mad_amount_multiple <= 1:
            raise ValueError("amount deviation thresholds must be positive and meaningful")
        if not 0 < self.amount_deviation_min_relative_change < 10:
            raise ValueError("amount_deviation_min_relative_change must be in (0, 10)")
        if self.dormant_amount_multiple <= 1:
            raise ValueError("dormant_amount_multiple must be greater than 1")
        if self.global_outlier_multiple <= 1:
            raise ValueError("global_outlier_multiple must be greater than 1")
        if not 0 <= self.stable_amount_context_tolerance < 1:
            raise ValueError("stable_amount_context_tolerance must be in [0, 1)")


DEFAULT_SETTINGS = Settings()
