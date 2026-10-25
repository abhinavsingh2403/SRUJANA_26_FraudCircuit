"""Deterministic synthetic transactions analyzed without persistence."""
from datetime import datetime,timedelta,timezone
from dataclasses import replace
import csv,hashlib,io,json,time
from typing import Literal
from pydantic import Field,model_validator
from .extension_common import StrictModel,extract,NOTICE
from .domain import Transaction
from .ingestion import parse_csv_bytes
from .pipeline import analyse_transactions_detailed
from .explain import explain
from .config import DEFAULT_SETTINGS

PATTERNS=['PASS_THROUGH_CHAIN','FAN_IN_DISPERSAL','SINGLE_LARGE_TRANSFER','LEGIT_BURST','NEW_ACCOUNT_HIGH_VALUE']
class Spec(StrictModel):
    pattern: Literal['PASS_THROUGH_CHAIN','FAN_IN_DISPERSAL','SINGLE_LARGE_TRANSFER','LEGIT_BURST','NEW_ACCOUNT_HIGH_VALUE']='PASS_THROUGH_CHAIN'
    n_senders:int=Field(default=3,ge=1,le=8)
    n_intermediaries:int=Field(default=2,ge=1,le=5)
    n_recipients:int=Field(default=4,ge=1,le=8)
    amount:float=Field(default=1000,gt=0,le=1e12)
    onward_share:float=Field(default=.9,ge=.1,le=1)
    gap_seconds:float=Field(default=300,ge=1,le=604800)
    history_transactions:int=Field(default=5,ge=0,le=100)
    history_days:int=Field(default=7,ge=1,le=365)
    repeated_counterparties:bool=False
    assumptions:list[str]=Field(default_factory=list,max_length=20)
    warnings:list[str]=Field(default_factory=list,max_length=20)
    @model_validator(mode='after')
    def bounded_notes(self):
        if any(len(s)>200 or any(ord(c)<32 for c in s) for s in self.assumptions+self.warnings):raise ValueError('Invalid spec note')
        return self
class Overrides(StrictModel):
    gap_scale:float=Field(default=1,ge=.05,le=100)
    amount_scale:float=Field(default=1,ge=.01,le=1000)
class RunRequest(StrictModel):
    spec:Spec
    overrides:Overrides=Field(default_factory=Overrides)
class SweepRequest(StrictModel):
    spec:Spec
    parameter:Literal['gap_scale','amount_scale','n_senders','onward_share']
    values:list[float]=Field(min_length=1,max_length=10)

def parse(text):
    facts=extract(text);values={};warnings=[]
    if facts['patterns']:values['pattern']=facts['patterns'][0]
    if len(facts['patterns'])>1:warnings.append('Multiple patterns mentioned; first supported match selected. Edit the spec.')
    if facts['amounts']:
        values['amount']=facts['amounts'][0]['value'] if facts['amounts'][0]['value'] is not None else 1e12
        if facts['amounts'][0]['value'] is None:warnings.append('Amount too large to represent; clipped to maximum')
    if facts['time_spans']:
        values['gap_seconds']=facts['time_spans'][0]['seconds'] if facts['time_spans'][0]['seconds'] is not None else 604800
        if facts['time_spans'][0]['seconds'] is None:warnings.append('Duration too large to represent; clipped to maximum')
    for row in facts['counts']:
        name={'senders':'n_senders','recipients':'n_recipients','intermediaries':'n_intermediaries','transactions':'history_transactions'}.get(row['kind'])
        if name:values[name]=row['value']
    bounds={'amount':(.01,1e12),'gap_seconds':(1,604800),'n_senders':(1,8),'n_intermediaries':(1,5),'n_recipients':(1,8),'history_transactions':(0,100)}
    for name,(lo,hi) in bounds.items():
        if name in values and not lo<=values[name]<=hi:
            values[name]=max(lo,min(hi,values[name]));warnings.append(f'{name} clipped to supported bounds')
    assumptions=[f'{name} defaults to {field.default}' for name,field in Spec.model_fields.items() if name not in values and name not in {'assumptions','warnings'}]
    spec=Spec(**values,assumptions=assumptions,warnings=warnings)
    return {'spec':spec.model_dump(),'method':'rules','assumptions':assumptions,'warnings':warnings,'extracted_spans':facts}

def generate(spec,overrides=None,prefix='SIM_',base=None):
    o=overrides or Overrides();data=spec.model_dump(exclude={'assumptions','warnings'});seed=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()[:12]
    base=base or datetime(2026,1,1,tzinfo=timezone.utc);txs=[];account=lambda v:f'{prefix}{seed}_{v}'
    def add(sender,recipient,amount,seconds):
        dt=base+timedelta(seconds=seconds*o.gap_scale);amount=amount*o.amount_scale
        if amount<=0 or amount>DEFAULT_SETTINGS.max_transaction_amount:raise ValueError('Generated amount outside canonical limits')
        txs.append(Transaction(f'{prefix}{seed}_{len(txs):04d}',int(dt.timestamp()*1e6),dt.isoformat().replace('+00:00','Z'),account(sender),account(recipient),amount,'TRANSFER'))
    n=spec.history_transactions
    if spec.pattern in {'SINGLE_LARGE_TRANSFER','LEGIT_BURST'}:
        for i in range(n):add('MAIN','KNOWN',spec.amount/10,-spec.history_days*86400+(i*spec.history_days*86400/max(n,1)))
    if spec.pattern=='PASS_THROUGH_CHAIN':
        for i in range(spec.n_intermediaries+1):add(f'CHAIN{i}',f'CHAIN{i+1}',spec.amount*spec.onward_share**i,i*spec.gap_seconds)
    elif spec.pattern=='FAN_IN_DISPERSAL':
        for i in range(spec.n_senders):add(f'SOURCE{i}','MAIN',spec.amount,i*spec.gap_seconds)
        for i in range(spec.n_recipients):add('MAIN',f'DEST{i}',spec.amount*spec.n_senders*spec.onward_share/spec.n_recipients,(spec.n_senders+i)*spec.gap_seconds)
    elif spec.pattern=='LEGIT_BURST':
        for i in range(spec.n_recipients):add('MAIN','KNOWN' if spec.repeated_counterparties else f'DEST{i}',spec.amount/10,i*spec.gap_seconds)
    else:add('MAIN','DEST',spec.amount,0)
    if len(txs)>200 or len({a for t in txs for a in (t.sender_id,t.recipient_id)})>25:raise ValueError('Simulation exceeds 200 transactions or 25 accounts')
    # Validate through the same canonical ingestion path, without writing anything.
    out=io.StringIO();w=csv.DictWriter(out,fieldnames=['transaction_id','timestamp','sender_id','recipient_id','amount','transaction_type']);w.writeheader();w.writerows(t.public_dict() for t in txs)
    return parse_csv_bytes(out.getvalue().encode()).transactions,seed

def graph_view(txs,cases):
    accounts=sorted({a for t in txs for a in (t.sender_id,t.recipient_id)});nodes=[];neighbors={a:set() for a in accounts}
    support={}
    for c in cases:
        for e in c['evidence']:
            for tid in e['transaction_ids']:support.setdefault(tid,[]).append(e['rule_id'])
    for a in accounts:
        incoming=[t for t in txs if t.recipient_id==a];outgoing=[t for t in txs if t.sender_id==a]
        nodes.append({'id':a,'in_degree':len(incoming),'out_degree':len(outgoing),'role':'intermediary' if incoming and outgoing else 'source' if outgoing else 'destination','onward_share':sum(t.amount for t in outgoing)/sum(t.amount for t in incoming) if incoming else None})
    for t in txs:neighbors[t.sender_id].add(t.recipient_id);neighbors[t.recipient_id].add(t.sender_id)
    unseen=set(accounts);components=[]
    while unseen:
        pending=[min(unseen)];group=[]
        while pending:
            a=pending.pop()
            if a not in unseen:continue
            unseen.remove(a);group.append(a);pending.extend(neighbors[a]&unseen)
        components.append(sorted(group))
    return {'nodes':nodes,'edges':[{**t.public_dict(),'supporting_rules':sorted(set(support.get(t.transaction_id,[]))),'synthetic':t.transaction_id.startswith('SIM_')} for t in txs],'components':components,'truncated':False}

def run(spec,overrides=None):
    stages=[]
    def stage(name,start,summary,details):stages.append({'stage':name,'status':'completed','duration_ms':round((time.perf_counter()-start)*1000,3),'summary':summary,'details':details})
    start=time.perf_counter();spec=Spec.model_validate(spec);o=overrides or Overrides()
    stage('input/spec validation',start,'Bounded editable hypothetical spec',spec.model_dump())
    start=time.perf_counter();txs,seed=generate(spec,o);stage('generation/ingestion validation',start,'Synthetic rows validated by canonical importer',{'seed':seed,'count':len(txs)})
    start=time.perf_counter();run_id,cases,stats=analyse_transactions_detailed(txs,'hypothetical');trace=explain(txs)
    stage('features/rule evaluation',start,'Actual engine fired flags and feature values',trace)
    start=time.perf_counter();graph=graph_view(txs,cases);stage('graph analysis',start,'Bounded directed multigraph',{'graph_summary':stats,'components':graph['components'],'warning':'Missing graph alerts do not establish clean activity, especially if analysis is incomplete.'})
    stage('case grouping and priority',time.perf_counter(),'Existing rule_policy.md; advisory tools cannot override it',[{'case_id':c['case_id'],'priority':c['priority'],'summary':c['summary']} for c in cases])
    stage('advisory comparison',time.perf_counter(),'Not requested; no narrative classifier controls cases',{'status':'not_run'})
    return {'run_id':run_id,'transactions':[dict(t.public_dict(),synthetic=True) for t in txs],'trace':stages,'graph':graph,'timeline':graph['edges'],'cases':cases,'graph_summary':stats,'context_items':[e for c in cases for e in c['evidence'] if e['kind']=='CONTEXT_SIGNAL'],'notice':'HYPOTHETICAL: generated from your description. No case means rules did not fire, not that activity is safe. '+NOTICE}

def sweep(req):
    out=[];previous=None
    for value in req.values:
        data=req.spec.model_dump();o={}
        if req.parameter in {'gap_scale','amount_scale'}:o[req.parameter]=value
        else:data[req.parameter]=value
        result=run(Spec.model_validate(data),Overrides(**o));priorities=[c['priority'] for c in result['cases']]
        priority=max(priorities,key=lambda p:{'HIGH':4,'MEDIUM':3,'LOW':2,'INSUFFICIENT_HISTORY':1}[p]) if priorities else 'no case'
        codes=sorted({code for c in result['cases'] for code in c['rule_codes']});key=(priority,tuple(codes),len(result['cases']))
        out.append({'value':value,'priority':priority,'rule_codes':codes,'case_count':len(result['cases']),'changed':previous is not None and key!=previous});previous=key
    return {'results':out,'notice':'Rule sensitivity / blind-spot analysis of our own rules on synthetic inputs, not detection accuracy.'}
