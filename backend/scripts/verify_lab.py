"""Run the owned mock's fixed traffic sequence in isolated loopback processes."""
import os,socket,subprocess,sys,tempfile,time,json
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[1]
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def main():
 with tempfile.TemporaryDirectory() as tmp:
  a,b=port(),port();base=f'http://127.0.0.1:{a}';target=f'http://127.0.0.1:{b}';env={**os.environ,'TRACEGUARD_DB':tmp+'/lab.db','LAB_MODE':'1','TRACEGUARD_TARGET':base};procs=[]
  with open(tmp+'/server.log','w') as log:
   try:
    for module,p in [('traceguard.main:app',a),('lab.mock_payments_api:app',b)]:procs.append(subprocess.Popen([sys.executable,'-m','uvicorn',module,'--host','127.0.0.1','--port',str(p)],cwd=ROOT,env=env,stdout=log,stderr=log))
    with httpx.Client(trust_env=False,timeout=10) as c:
     for address in [base+'/health',target+'/openapi.json']:
      for _ in range(100):
       try:
        if c.get(address).status_code==200:break
       except httpx.ConnectError:time.sleep(.1)
      else:raise RuntimeError('Lab startup failed')
     subprocess.run([sys.executable,'lab/lab_traffic_sim.py','--target',target,'--yes'],cwd=ROOT,env=env,check=True)
     cases=c.get(base+'/api/cases').json()['cases'];events=c.get(base+'/api/security-events').json()['events'];assert cases and len(events)==2
     detail=c.get(base+'/api/cases/'+cases[0]['case_id']).json();assert len(detail['related_security_events']['events'])==2
     subprocess.run([sys.executable,'scripts/self_test_limits.py','--target',base,'--yes'],cwd=ROOT,env=env,check=True)
     report={'passed':True,'scope':'owned loopback mock only','case_count':len(cases),'events':len(events),'related_events':len(detail['related_security_events']['events']),'notice':'Fixed synthetic calls; not an intrusion or security audit.'}
     (ROOT/'artifacts/lab_integration.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
   finally:
    for p in procs:p.terminate()
    for p in procs:
     try:p.wait(timeout=10)
     except subprocess.TimeoutExpired:p.kill();p.wait()
if __name__=='__main__':main()
