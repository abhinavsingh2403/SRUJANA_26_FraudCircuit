"""Local lab telemetry; account/time correlation is not causation."""
from datetime import datetime,timedelta,timezone
import json
from typing import Literal
from pydantic import Field,field_validator
from .extension_common import StrictModel
from . import db

class Event(StrictModel):
    event_id:str=Field(min_length=1,max_length=100)
    timestamp:datetime
    source:str=Field(default='lab-sandbox',min_length=1,max_length=100)
    event_type:Literal['AUTH_FAILURE_BURST','REQUEST_RATE_SPIKE','UNMATCHED_REFERENCE_PAYOUT','OTHER']
    account_id:str|None=Field(default=None,max_length=128)
    count:int=Field(default=1,ge=1,le=1000000)
    details:str=Field(default='',max_length=2000)
    @field_validator('event_id','source','account_id','details')
    @classmethod
    def clean(cls,v):
        if v is not None and (any(ord(c)<32 or ord(c)==127 for c in v) or not v.strip() and v!=''):raise ValueError('Invalid text')
        return v
    @field_validator('timestamp')
    @classmethod
    def aware(cls,v):
        if v.tzinfo is None:raise ValueError('Timezone required')
        return v.astimezone(timezone.utc)

def initialize():
    with db._connection() as c:
        c.execute('CREATE TABLE IF NOT EXISTS security_events(event_id TEXT PRIMARY KEY,timestamp TEXT NOT NULL,event_type TEXT NOT NULL,account_id TEXT,payload TEXT NOT NULL)')
        c.execute('CREATE INDEX IF NOT EXISTS security_account_time ON security_events(account_id,timestamp)')
        c.execute('CREATE TABLE IF NOT EXISTS case_traces(case_id TEXT PRIMARY KEY, payload TEXT NOT NULL, FOREIGN KEY(case_id) REFERENCES cases(case_id))')

def add(events):
    inserted=0
    with db._connection() as c:
        for event in events:
            data=event.model_dump(mode='json');data['timestamp']=event.timestamp.isoformat(timespec='microseconds')
            existing=c.execute('SELECT payload FROM security_events WHERE event_id=?',(event.event_id,)).fetchone()
            payload=json.dumps(data,sort_keys=True)
            if existing:
                if existing['payload']!=payload:raise ValueError('event_id already exists with different content')
                continue
            c.execute('INSERT INTO security_events VALUES(?,?,?,?,?)',(event.event_id,data['timestamp'],event.event_type,event.account_id,payload));inserted+=1
    return {'inserted':inserted,'duplicates':len(events)-inserted,'notice':'Lab telemetry only; correlation is not causation.'}

def listing(event_type=None,account_id=None,since=None,limit=100,offset=0):
    sql=' FROM security_events WHERE 1=1';args=[]
    for col,v in [('event_type',event_type),('account_id',account_id)]:
        if v is not None:sql+=f' AND {col}=?';args.append(v)
    if since is not None:sql+=' AND timestamp>=?';args.append(since.astimezone(timezone.utc).isoformat(timespec='microseconds'))
    with db._connection() as c:
        total=c.execute('SELECT COUNT(*)'+sql,args).fetchone()[0]
        rows=c.execute('SELECT payload'+sql+' ORDER BY timestamp,event_id LIMIT ? OFFSET ?',args+[limit,offset]).fetchall()
    return {'events':[json.loads(r['payload']) for r in rows],'total':total,'limit':limit,'offset':offset}

def related(case):
    times=[datetime.fromisoformat(t['timestamp'].replace('Z','+00:00')) for t in case.get('trigger_transactions',[]) if t['transaction_id'] in case['transaction_ids']]
    accounts=case.get('account_ids',[])
    notice='Same account within one hour around retained trigger transactions; correlation is not causation. Case payload truncation can omit correlations.'
    if not times or not accounts:return {'events':[],'truncated':False,'notice':notice}
    lo=(min(times)-timedelta(hours=1)).isoformat(timespec='microseconds');hi=(max(times)+timedelta(hours=1)).isoformat(timespec='microseconds')
    with db._connection() as c:
        rows=c.execute('SELECT payload FROM security_events WHERE account_id IN ('+','.join('?' for _ in accounts)+') AND timestamp BETWEEN ? AND ? ORDER BY timestamp,event_id LIMIT 201',accounts+[lo,hi]).fetchall()
    return {'events':[json.loads(r['payload']) for r in rows[:200]],'truncated':len(rows)>200,'notice':notice}

def prepare_traces(cases, txs, settings):
    """Compute expensive diagnostics before acquiring the database write lock."""
    from .explain import explain
    if not cases:
        return []
    selected = {tid for case in cases for tid in case['transaction_ids'][:20]}
    trace = explain(txs, settings, selected_ids=selected)
    by_id = {r['transaction_id']: r for r in trace['transactions']}
    prepared = []
    for case in cases:
        rows = [by_id[t] for t in case['transaction_ids'][:20] if t in by_id]
        total = case['counts']['trigger_transactions_total']
        payload = {**trace, 'transactions': rows, 'transactions_total': total,
                   'truncated': total > len(rows),
                   'notice': trace['notice'] + ' At most 20 retained trigger transactions per case. History was computed from the complete input.'}
        prepared.append((case['case_id'], json.dumps(payload, allow_nan=False)))
    return prepared


def save_traces(cases, txs, settings, connection=None, prepared=None):
    from contextlib import nullcontext
    rows = prepare_traces(cases, txs, settings) if prepared is None else prepared
    with (nullcontext(connection) if connection is not None else db._connection()) as conn:
        conn.executemany('INSERT INTO case_traces VALUES(?,?) ON CONFLICT(case_id) DO UPDATE SET payload=excluded.payload', rows)

def trace_for(case):
    from .explain import stored_trace
    with db._connection() as c:row=c.execute('SELECT payload FROM case_traces WHERE case_id=?',(case['case_id'],)).fetchone()
    return json.loads(row['payload']) if row else stored_trace(case)
