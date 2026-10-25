"""Our own mock payments service. No actual authentication or payments."""
import os,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI,HTTPException
from traceguard.simulator import Spec,generate
from lab.lab_traffic_sim import guard
app=FastAPI(title='TraceGuard owned mock payments lab')
counts={'AUTH_FAILURE_BURST':0,'UNMATCHED_REFERENCE_PAYOUT':0}
@app.post('/lab/login-failure')
def failed():
    if os.environ.get('LAB_MODE')!='1':raise HTTPException(403,'Lab disabled')
    counts['AUTH_FAILURE_BURST']+=1;return {'synthetic':True,'simulated_outcome':'login_failed','count':counts['AUTH_FAILURE_BURST']}
@app.post('/lab/unmatched-payout')
def payout():
    if os.environ.get('LAB_MODE')!='1':raise HTTPException(403,'Lab disabled')
    counts['UNMATCHED_REFERENCE_PAYOUT']+=1;return {'synthetic':True,'reference_matched':False,'count':counts['UNMATCHED_REFERENCE_PAYOUT']}
@app.post('/lab/chain')
def chain():
    import csv,io,httpx
    target=guard(os.environ.get('TRACEGUARD_TARGET','http://127.0.0.1:8000'),True)
    txs,seed=generate(Spec());out=io.StringIO();w=csv.DictWriter(out,fieldnames=list(txs[0].public_dict()));w.writeheader();w.writerows(t.public_dict() for t in txs)
    events=[{'event_id':f'lab-{seed}-{kind}-{count}','event_type':kind,'timestamp':txs[1].timestamp,'account_id':txs[1].sender_id,'count':count,'details':'Synthetic scripted telemetry from our owned mock service'} for kind,count in counts.items() if count]
    with httpx.Client(base_url=target,timeout=20,trust_env=False,follow_redirects=False) as c:
        r=c.post('/api/transactions/import',content=out.getvalue(),headers={'Content-Type':'text/csv'});r.raise_for_status()
        if events:c.post('/api/security-events',json=events).raise_for_status()
    return {'synthetic':True,'cases':r.json()['case_count'],'events':len(events),'notice':'Explicit lab ingestion persists demo cases; hypothetical simulators remain isolated.'}
