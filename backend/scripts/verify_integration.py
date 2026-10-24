#!/usr/bin/env python3
"""Start an isolated loopback FastAPI instance and verify the actual HTTP contract.
Optional --browser runs browser_journey.cjs against the same fresh database first.
"""
import argparse,json,os,socket,subprocess,sys,tempfile,time
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--browser',action='store_true')
    args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='traceguard-acceptance-') as tmp:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        env={**os.environ,'TRACEGUARD_DB':str(Path(tmp)/'cases.db')}
        base=f'http://127.0.0.1:{port}'
        with open(Path(tmp)/'server.log','w+') as log:
            proc=subprocess.Popen([sys.executable,'-m','uvicorn','traceguard.main:app','--host','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
            try:
                with httpx.Client(base_url=base,trust_env=False,timeout=30) as client:
                    for _ in range(100):
                        try:
                            if client.get('/health').status_code==200:break
                        except httpx.ConnectError:time.sleep(.1)
                    else:raise RuntimeError('Local server did not become healthy')
                    assert client.get('/api/cases').json()['count']==0
                    if args.browser:
                        from traceguard.config import Settings
                        from traceguard.fixtures import scenario_transactions
                        from traceguard.pipeline import analyse_transactions_detailed
                        from traceguard.service import _analysis_warnings
                        run_id,cases,stats=analyse_transactions_detailed(scenario_transactions('directed-cycle'),'budget-ui-test',Settings(graph_search_expansion_limit=1))
                        fixture=Path(tmp)/'bounded.json'
                        fixture.write_text(json.dumps({'run_id':run_id,'transaction_count':3,'case_count':len(cases),'cases':[], 'analysis_warnings':_analysis_warnings(stats),'graph_summary':stats}))
                        result=subprocess.run(['node','scripts/browser_journey.cjs'],cwd=ROOT,env={**env,'TRACEGUARD_TEST_URL':base,'TRACEGUARD_BOUNDED_FIXTURE':str(fixture)},text=True,capture_output=True)
                        print(result.stdout,end='');print(result.stderr,end='',file=sys.stderr)
                        if result.returncode:raise RuntimeError('Browser journey failed')
                        (ROOT/'reports/browser_integration.json').write_text(result.stdout)
                    checks={}
                    for route in ['/','/static/app.js','/health','/api/scenarios','/api/cases','/api/evaluation/summary']:
                        response=client.get(route);assert response.status_code==200;checks[route]=response.status_code
                    result=client.post('/api/scenarios/replay-all').json()
                    assert (result['scenario_count'],result['transaction_count'],result['case_count'])==(14,130,13)
                    checks['replay_all']={k:result[k] for k in ['scenario_count','transaction_count','case_count']}
                    count=client.get('/api/cases').json()['count']
                    bad=client.post('/api/transactions/import',content=b'bad,csv\n1,2',headers={'Content-Type':'text/csv'})
                    assert bad.status_code==422 and client.get('/api/cases').json()['count']==count
                    checks['malformed_csv_atomic']=True
                    cid=result['cases'][0]['case_id'];route=f'/api/cases/{cid}'
                    assert client.patch(route+'/review',json={'status':'CLOSED'}).status_code==422
                    assert client.patch(route+'/review',json={'status':'CLOSED','outcome':'INCONCLUSIVE','note':'Synthetic smoke test'}).status_code==200
                    audit=client.get(route+'/audit').json();assert audit['valid'] and audit['event_count']>=1
                    checks['review_and_audit']=True
                    evaluation=client.get('/api/evaluation/summary').json()
                    assert evaluation['model_status']=='not_configured' and evaluation['metrics'] is None
                    checks['model_not_configured']=True
                    (ROOT/'reports/http_integration.json').write_text(json.dumps(checks,indent=2)+'\n')
                    print(json.dumps(checks,indent=2))
            finally:
                proc.terminate()
                try:proc.wait(timeout=10)
                except subprocess.TimeoutExpired:proc.kill();proc.wait()
if __name__=='__main__':main()
