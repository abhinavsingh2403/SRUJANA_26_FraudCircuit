"""Live operational evaluation. No dataset metrics or historic report assumptions."""
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path
from collections import Counter
import hashlib
import json
from . import db
from .config import DEFAULT_SETTINGS


@lru_cache(maxsize=1)
def engine_digest():
    root = Path(__file__).parent
    digest = hashlib.sha256()
    for name in ('cases.py', 'config.py', 'domain.py', 'features.py', 'rules.py', 'graph_analysis.py', 'pipeline.py', 'model_hook.py', 'provenance.py'):
        digest.update(name.encode())
        digest.update((root / name).read_bytes())
    return digest.hexdigest()


def analysis_identity(settings=DEFAULT_SETTINGS):
    policy = asdict(settings)
    raw = json.dumps(policy, sort_keys=True, separators=(',', ':'))
    return {'engine_sha256': engine_digest(), 'settings_sha256': hashlib.sha256(raw.encode()).hexdigest()}


def run_record(run_id, source, txs, cases, graph, settings, elapsed_ms):
    canonical = [[t.transaction_id, t.timestamp, t.sender_id, t.recipient_id,
                  format(t.amount, '.17g'), t.transaction_type, t.currency]
                 for t in sorted(txs, key=lambda t: (t.timestamp_us, t.transaction_id))]
    input_id = hashlib.sha256(json.dumps(canonical, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    return {
        'run_id': run_id, 'source': source,
        'source_kind': 'uploaded_csv' if source == 'csv-import' else 'synthetic_fixture',
        **analysis_identity(settings), 'input_sha256': input_id,
        'settings': asdict(settings), 'transaction_count': len(txs),
        'case_count': len(cases), 'priority_counts': dict(Counter(c['priority'] for c in cases)),
        'cases_with_truncation': sum(any(c['truncation'].values()) for c in cases),
        'graph_summary': graph, 'analysis_duration_ms': round(elapsed_ms, 3),
        'time_start': min((t.timestamp for t in txs), default=None),
        'time_end': max((t.timestamp for t in txs), default=None),
        'completed_at': db._now(),
    }


def summary(source_kind=None):
    """Aggregates indexed metadata; never pulls full case payloads into the page."""
    with db._connection() as conn:
        conn.execute('BEGIN')
        where = ''
        args = []
        if source_kind:
            where = ' WHERE source_kind=?'
            args = [source_kind]
        run_total = conn.execute('SELECT COUNT(*) FROM analysis_runs' + where, args).fetchone()[0]
        records = conn.execute('SELECT payload FROM analysis_runs' + where + ' ORDER BY completed_at DESC, run_id LIMIT 25', args).fetchall()
        scope = '' if not source_kind else ' WHERE run_id IN (SELECT run_id FROM analysis_runs WHERE source_kind=?)'
        counts = conn.execute('SELECT priority, status, review_outcome, COUNT(*) AS n FROM cases' + scope + ' GROUP BY priority, status, review_outcome', args).fetchall()
        unknown = conn.execute('SELECT COUNT(*) FROM cases WHERE run_id NOT IN (SELECT run_id FROM analysis_runs)').fetchone()[0]
        priorities = Counter(); statuses = Counter(); outcomes = Counter()
        for row in counts:
            priorities[row['priority']] += row['n']; statuses[row['status']] += row['n']
            if row['review_outcome']:
                outcomes[row['review_outcome']] += row['n']
        total = sum(priorities.values()); closed = statuses.get('CLOSED', 0)
        latest = conn.execute('SELECT MAX(updated_at) FROM cases' + scope, args).fetchone()[0]
    from .model_hook import model_status
    from .cases import priority_policy
    return {
        **model_status(), 'generated_at': db._now(), 'scope': source_kind or 'all',
        'message': 'Operational counts describe stored cases, not detection accuracy. The controlled synthetic episode benchmark is rule-coverage evidence only, not evidence of real-world fraud-detection performance.',
        'required_reporting': ['chronological split', 'precision-recall metric', 'precision', 'recall', 'false positives', 'precision at top K'],
        'cases': {'total': total, 'priority_counts': dict(priorities), 'status_counts': dict(statuses),
                  'outcome_counts': dict(outcomes), 'closed': closed,
                  'review_completion_rate': closed / total if total else None,
                  'last_updated_at': latest},
        'runs': {'total': run_total, 'returned': len(records), 'limit': 25,
                 'truncated': run_total > len(records), 'items': [json.loads(r['payload']) for r in records]},
        'legacy_cases_without_run_metadata': unknown,
        'priority_policy': priority_policy(),
        'active_policy': {**analysis_identity(), 'settings': asdict(DEFAULT_SETTINGS)},
        'limitations': [
            'Counts are unique stored cases and analysis identities; repeating identical input and settings does not add a new run. Different runs may overlap in transactions.',
            'The all-data view mixes synthetic fixtures and uploaded CSVs. Use the source filter before interpreting counts. Older cases have unknown run provenance.',
            'Closed outcomes are analyst opinions on a selected queue. They cannot measure recall, population false-positive rate or fraud prevalence.',
            'No labelled evaluation is run by this page. Unavailable metrics remain null; an empty queue does not prove clean activity.',
            'Run records and case evidence are local database records, not signed attestations. The review hash chain covers review events only.',
            'Run fingerprints cover engine source and settings, not optional ML artifact bytes. Restart after changing engine source.',
        ],
    }
