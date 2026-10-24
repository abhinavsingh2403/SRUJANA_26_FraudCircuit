"""Small dependency-light evaluation helpers; no performance is assumed."""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Sequence


@dataclass(frozen=True, slots=True)
class ChronologicalSplit:
    train_indices: list[int]
    validation_indices: list[int]
    test_indices: list[int]
    train_end_step: int
    validation_end_step: int


def chronological_split(steps: Sequence[int], train_ratio: float = 0.70,
                        validation_ratio: float = 0.15) -> ChronologicalSplit:
    """Split at distinct time-step boundaries, never separating equal steps.

    `steps` must correspond to rows in their original order or be any sortable
    sequence; returned indices refer to positions in the supplied sequence.
    Ratios are a split policy, not an assertion about an appropriate evaluation
    window for every dataset.
    """
    if not 0 < train_ratio < 1 or not 0 < validation_ratio < 1 or train_ratio + validation_ratio >= 1:
        raise ValueError("train_ratio and validation_ratio must be positive and sum to less than 1")
    if len(steps) < 3:
        raise ValueError("at least three rows are required")
    normalized_steps: list[int] = []
    for step in steps:
        if isinstance(step, bool):
            raise ValueError("steps must be integer-valued time points, not booleans")
        try:
            numeric_step = float(step)
            integer_step = int(step)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("steps must be finite integer-valued time points") from exc
        if not math.isfinite(numeric_step) or numeric_step != integer_step:
            raise ValueError("steps must be finite integer-valued time points")
        normalized_steps.append(integer_step)
    unique_steps = sorted(set(normalized_steps))
    if len(unique_steps) < 3:
        raise ValueError("at least three distinct time steps are required for a chronological split")
    train_cut = max(1, min(len(unique_steps) - 2, int(len(unique_steps) * train_ratio)))
    val_cut = max(train_cut + 1, min(len(unique_steps) - 1, int(len(unique_steps) * (train_ratio + validation_ratio))))
    train_end = unique_steps[train_cut - 1]
    val_end = unique_steps[val_cut - 1]
    train = [i for i, step in enumerate(steps) if int(step) <= train_end]
    validation = [i for i, step in enumerate(steps) if train_end < int(step) <= val_end]
    test = [i for i, step in enumerate(steps) if int(step) > val_end]
    if not train or not validation or not test:
        raise ValueError("could not create non-empty chronological splits")
    return ChronologicalSplit(train, validation, test, train_end, val_end)


def binary_metrics(y_true: Sequence[int], y_score: Sequence[float], threshold: float = 0.5) -> dict[str, float | int]:
    if len(y_true) != len(y_score) or not y_true:
        raise ValueError("y_true and y_score must be non-empty and have equal length")
    if any(label not in (0, 1) for label in y_true):
        raise ValueError("y_true must contain only binary labels 0 and 1")
    if not 0 <= threshold <= 1:
        raise ValueError("threshold must be between 0 and 1")
    if any(not 0 <= float(score) <= 1 for score in y_score):
        raise ValueError("scores must be in [0, 1]")
    tp = sum(1 for y, s in zip(y_true, y_score) if y == 1 and s >= threshold)
    fp = sum(1 for y, s in zip(y_true, y_score) if y == 0 and s >= threshold)
    fn = sum(1 for y, s in zip(y_true, y_score) if y == 1 and s < threshold)
    tn = sum(1 for y, s in zip(y_true, y_score) if y == 0 and s < threshold)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "threshold": threshold, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": precision, "recall": recall, "f1": f1,
        "accuracy": (tp + tn) / len(y_true),
    }


def average_precision(y_true: Sequence[int], y_score: Sequence[float]) -> float:
    """Compute step-wise average precision without interpolating the PR curve.

    Equal scores are evaluated as one threshold group. At least one positive
    label is required; otherwise AP is undefined for this helper and an error
    is raised rather than silently reporting a meaningless metric.
    """
    if len(y_true) != len(y_score) or not y_true:
        raise ValueError("y_true and y_score must be non-empty and have equal length")
    if any(label not in (0, 1) for label in y_true):
        raise ValueError("y_true must contain only binary labels 0 and 1")
    if any(not 0 <= float(score) <= 1 for score in y_score):
        raise ValueError("scores must be finite values in [0, 1]")
    positives = sum(y_true)
    if positives == 0:
        raise ValueError("average precision is undefined when y_true has no positive labels")
    ranked = sorted(zip(y_score, y_true), key=lambda row: float(row[0]), reverse=True)
    tp = 0
    seen = 0
    ap = 0.0
    pos = 0
    while pos < len(ranked):
        end = pos + 1
        score = float(ranked[pos][0])
        while end < len(ranked) and float(ranked[end][0]) == score:
            end += 1
        group_positive = sum(label for _, label in ranked[pos:end])
        tp += group_positive
        seen += end - pos
        precision_at_threshold = tp / seen
        recall_increment = group_positive / positives
        ap += precision_at_threshold * recall_increment
        pos = end
    return ap


def precision_at_k(y_true: Sequence[int], y_score: Sequence[float], k: int) -> float:
    """Precision among the top k scored records; k is clipped to row count."""
    if len(y_true) != len(y_score) or not y_true:
        raise ValueError("y_true and y_score must be non-empty and have equal length")
    if any(label not in (0, 1) for label in y_true):
        raise ValueError("y_true must contain only binary labels 0 and 1")
    if any(not 0 <= float(score) <= 1 for score in y_score):
        raise ValueError("scores must be finite values in [0, 1]")
    if k < 1:
        raise ValueError("k must be at least 1")
    top_count = min(k, len(y_true))
    order = sorted(range(len(y_score)), key=lambda index: (float(y_score[index]), -index), reverse=True)[:top_count]
    return sum(y_true[index] for index in order) / top_count
