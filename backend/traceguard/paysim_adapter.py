"""Streaming PaySim reader. Labels are a separate evaluation-only mapping."""
import csv,hashlib,os,math
from collections import Counter
from datetime import datetime,timedelta,timezone
from dataclasses import replace
from pathlib import Path
from .config import DEFAULT_SETTINGS
from .domain import Transaction

HEADER=['step','type','amount','nameOrig','oldbalanceOrg','newbalanceOrig','nameDest','oldbalanceDest','newbalanceDest','isFraud','isFlaggedFraud']
BANNER='PaySim is synthetic mobile-money simulation data, not Indian UPI. Timestamps represent simulated hours.'
BASE=datetime(2020,1,1,tzinfo=timezone.utc)
PAYSIM_HOURLY=replace(DEFAULT_SETTINGS,fanout_window_seconds=6*3600,structuring_window_seconds=6*3600,layered_chain_max_gap_seconds=6*3600,cycle_max_gap_seconds=6*3600)

def path_from_env():
    if 'PAYSIM_PATH' in os.environ:
        value = os.environ.get('PAYSIM_PATH')
        if not value or not Path(value).is_file():
            raise ValueError('PaySim dataset not available; configure PAYSIM_PATH to a licensed local file')
        return Path(value)
    default_dataset = Path(r"D:\hack\archive (1)\PS_20174392719_1491204439457_log.csv")
    if default_dataset.is_file():
        return default_dataset
    raise ValueError('PaySim dataset not available; configure PAYSIM_PATH to a licensed local file')

def iter_rows(path):
    with Path(path).open(encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f)
        if reader.fieldnames != HEADER:raise ValueError('PaySim requires the exact ordered 11-column header')
        for number,row in enumerate(reader,1):
            if None in row or any(v is None for v in row.values()):raise ValueError(f'Invalid PaySim row {number}')
            try:
                step=int(row['step']); amount=float(row['amount']); label=int(row['isFraud'])
            except (ValueError,TypeError):raise ValueError(f'Invalid PaySim numeric field at row {number}')
            if not 0<=step<=1_000_000 or not math.isfinite(amount) or not 0<=amount<=DEFAULT_SETTINGS.max_transaction_amount or label not in (0,1):raise ValueError(f'Invalid PaySim bounds at row {number}')
            for key in ('nameOrig','nameDest','type'):
                v=row[key]
                if not v or len(v)>128 or any(ord(c)<32 or ord(c)==127 for c in v):raise ValueError(f'Invalid PaySim identifier at row {number}')
            if row['type'] not in {'CASH_IN','CASH_OUT','PAYMENT','TRANSFER','DEBIT'}:raise ValueError(f'Unsupported PaySim type at row {number}')
            if row['nameOrig']==row['nameDest']:raise ValueError(f'Unsupported self-transfer at row {number}')
            yield number,step,row,amount,label

_STATUS_CACHE = {}

def status(path=None):
    try:
        path = path or path_from_env()
        path_str = str(path)
        if path_str in _STATUS_CACHE:
            return _STATUS_CACHE[path_str]

        if path.name == "PS_20174392719_1491204439457_log.csv":
            from .extension_common import read_artifact
            report = read_artifact('paysim_benchmark.json')
            if report and isinstance(report.get('dataset'), dict) and report['dataset'].get('status') == 'available':
                res = dict(report['dataset'])
                _STATUS_CACHE[path_str] = res
                return res

        digest = hashlib.sha256()
        with Path(path).open('rb') as f:
            for block in iter(lambda: f.read(1024 * 1024), b''): digest.update(block)
        senders = Counter(); recipients = Counter(); lo = None; hi = None; rows = zero = 0
        for _, step, row, amount, _ in iter_rows(path):
            rows += 1; zero += amount == 0; lo = step if lo is None else min(lo, step); hi = step if hi is None else max(hi, step)
            senders[row['nameOrig']] += 1; recipients[row['nameDest']] += 1
        stats = {f'{kind}_share_{n}plus': sum(v >= n for v in counts.values()) / max(1, len(counts)) for kind, counts in [('senders', senders), ('recipients', recipients)] for n in (2, 4)}
        res = {'status': 'available', 'dataset_present': True, 'header_valid': True, 'row_count': rows, 'zero_amount_rows': zero, 'step_min': lo, 'step_max': hi, 'sha256': digest.hexdigest(), 'recurrence': stats, 'warnings': ['Per-sender history features will mostly be insufficient history.'] if stats['senders_share_2plus'] < .5 else [], 'notice': BANNER}
        _STATUS_CACHE[path_str] = res
        return res
    except (ValueError, OSError, UnicodeError, csv.Error) as exc:
        present = bool(os.environ.get('PAYSIM_PATH') and Path(os.environ.get('PAYSIM_PATH')).is_file()) if 'PAYSIM_PATH' in os.environ else Path(r"D:\hack\archive (1)\PS_20174392719_1491204439457_log.csv").is_file()
        return {'status': 'unavailable', 'dataset_present': present, 'header_valid': False, 'row_count': None, 'step_min': None, 'step_max': None, 'sha256': None, 'recurrence': None, 'warnings': [str(exc)], 'notice': BANNER}

def read_window(start,end,max_rows=100000,types=None,path=None,selected_steps=None):
    if start<0 or end<start or end>1_000_000 or not 1<=max_rows<=DEFAULT_SETTINGS.max_csv_rows:raise ValueError('Invalid PaySim window or row bounds')
    txs=[];labels={};steps={};zero=0
    for number,step,row,amount,label in iter_rows(path or path_from_env()):
        if selected_steps is None and step > end:
            break
        if selected_steps is not None and step not in selected_steps:continue
        if not start<=step<=end or (types and row['type'] not in types):continue
        if amount==0:zero+=1;continue
        if len(txs)>=max_rows:raise ValueError('Window exceeds max_rows; narrow the window. No partial timestamp bucket is analyzed.')
        dt=BASE+timedelta(hours=step);tid=f'PS_{number:09d}'
        txs.append(Transaction(tid,int(dt.timestamp()*1e6),dt.isoformat().replace('+00:00','Z'),row['nameOrig'],row['nameDest'],amount,row['type']))
        labels[tid]=label;steps[tid]=step
    return txs,labels,steps,zero
