"""Deterministic synthetic transactions analyzed without persistence."""
from datetime import datetime,timedelta,timezone
from dataclasses import replace
import csv,hashlib,io,json,time
from typing import Literal
from pydantic import ConfigDict,Field,model_validator
from .extension_common import StrictModel,extract,NOTICE
from .domain import Transaction
from .ingestion import parse_csv_bytes
from .pipeline import analyse_transactions_detailed
from .explain import explain
from .config import DEFAULT_SETTINGS

PATTERNS=['PASS_THROUGH_CHAIN','FAN_IN_DISPERSAL','SINGLE_LARGE_TRANSFER','LEGIT_BURST','NEW_ACCOUNT_HIGH_VALUE']
class Spec(StrictModel):
    model_config = ConfigDict(validate_default=True)
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
    scenario_id: str | None = Field(default=None, max_length=100)
    spec: Spec | None = None
    parameter: Literal['gap_scale','amount_scale','n_senders','onward_share'] = 'gap_scale'
    values: list[float] = Field(min_length=1, max_length=10)

    @model_validator(mode='after')
    def validate_target(self):
        if self.scenario_id is None and self.spec is None:
            raise ValueError('Must provide either scenario_id or spec')
        return self

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
    out = []; previous = None
    if req.scenario_id is not None:
        from .fixtures import SCENARIOS, scenario_transactions, apply_scenario_params
        if req.scenario_id not in SCENARIOS:
            raise ValueError(f"Unknown scenario '{req.scenario_id}'")
        base_txs = scenario_transactions(req.scenario_id)
        for value in req.values:
            params = {}
            if req.parameter in {'gap_scale', 'amount_scale'}:
                params[req.parameter] = value
            scaled_txs = apply_scenario_params(base_txs, params)
            run_id, cases, stats = analyse_transactions_detailed(scaled_txs, req.scenario_id)
            priorities = [c['priority'] for c in cases]
            priority = max(priorities, key=lambda p: {'HIGH':4, 'MEDIUM':3, 'LOW':2, 'INSUFFICIENT_HISTORY':1}.get(p, 0)) if priorities else 'no case'
            codes = sorted({code for c in cases for code in c['rule_codes']})
            key = (priority, tuple(codes), len(cases))
            out.append({
                'value': value,
                'priority': priority,
                'rule_codes': codes,
                'case_count': len(cases),
                'changed': previous is not None and key != previous,
                'scenario': SCENARIOS[req.scenario_id]['title']
            })
            previous = key
        return {'results': out, 'notice': f'Rule sensitivity analysis for scenario "{SCENARIOS[req.scenario_id]["title"]}" across varying {req.parameter}.'}

    for value in req.values:
        data = req.spec.model_dump(); o = {}
        if req.parameter in {'gap_scale', 'amount_scale'}:
            o[req.parameter] = value
        else:
            data[req.parameter] = value
        result = run(Spec.model_validate(data), Overrides(**o))
        priorities = [c['priority'] for c in result['cases']]
        priority = max(priorities, key=lambda p: {'HIGH':4, 'MEDIUM':3, 'LOW':2, 'INSUFFICIENT_HISTORY':1}.get(p, 0)) if priorities else 'no case'
        codes = sorted({code for c in result['cases'] for code in c['rule_codes']})
        key = (priority, tuple(codes), len(result['cases']))
        out.append({'value': value, 'priority': priority, 'rule_codes': codes, 'case_count': len(result['cases']), 'changed': previous is not None and key != previous})
        previous = key
    return {'results': out, 'notice': 'Rule sensitivity / blind-spot analysis of our own rules on synthetic inputs, not detection accuracy.'}


def save_to_queue(spec, overrides=None):
    from .service import _persist
    from .config import DEFAULT_SETTINGS
    started = time.perf_counter()
    spec = Spec.model_validate(spec)
    o = overrides or Overrides()
    txs, seed = generate(spec, o)
    source_name = f"research-{spec.pattern.lower()}-{seed[:6]}"
    run_id, cases, stats = analyse_transactions_detailed(txs, source_name, DEFAULT_SETTINGS)
    _persist(run_id, source_name, txs, cases, stats, DEFAULT_SETTINGS, started)
    return {
        'status': 'success',
        'run_id': run_id,
        'source': source_name,
        'case_count': len(cases),
        'cases': cases,
        'transaction_count': len(txs),
        'message': f'Generated and appended {len(cases)} case(s) ({len(txs)} transactions) to the live Case Queue.'
    }


class StepRequest(StrictModel):
    """Replay one prefix; future transactions never enter analysis."""
    scenario_id: str | None = Field(default=None, max_length=100)
    spec: Spec | None = None
    overrides: Overrides = Field(default_factory=Overrides)
    step: int = Field(default=0, ge=0, le=200, strict=True)

    @model_validator(mode='after')
    def one_source(self):
        if (self.scenario_id is None) == (self.spec is None):
            raise ValueError('Provide exactly one of scenario_id or spec')
        return self


def step(req):
    from .fixtures import SCENARIOS, scenario_transactions, apply_scenario_params
    if req.scenario_id is not None:
        if req.scenario_id not in SCENARIOS:
            raise ValueError('Unknown scenario')
        txs = apply_scenario_params(scenario_transactions(req.scenario_id), req.overrides.model_dump())
        source = req.scenario_id
    else:
        txs, _ = generate(req.spec, req.overrides)
        source = 'hypothetical'
    txs = sorted(txs, key=lambda t: (t.timestamp_us, t.transaction_id))
    if len(txs) > 200 or req.step > len(txs):
        raise ValueError('Step outside available transactions (maximum 200)')
    visible = txs[:req.step]
    run_id, cases, stats = analyse_transactions_detailed(visible, source)
    graph = graph_view(visible, cases)
    for edge in graph['edges']:
        edge['synthetic'] = True
    return {
        'step': req.step, 'total_steps': len(txs), 'complete': req.step == len(txs),
        'run_id': run_id, 'graph': graph, 'cases': cases,
        'graph_summary': stats,
        'current_transaction': visible[-1].public_dict() if visible else None,
        'notice': 'Synthetic replay. Only the visible transaction prefix is analyzed. Equal timestamps use transaction ID order, not an inferred causal order. Findings may regroup as evidence arrives. Nothing is saved to the case queue. No alert is not proof of safety.',
    }
