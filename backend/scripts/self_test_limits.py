"""Bounded negative-input checks against an owned loopback API; no scanner."""
import argparse,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lab.lab_traffic_sim import guard
from traceguard.config import DEFAULT_SETTINGS
from traceguard.extension_common import artifact
HEADER='transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\n'
def checks(client):
    row='DUP,2026-01-01T00:00:00Z,A,B,10,TRANSFER\n'
    samples=[('oversized',b'x'*(DEFAULT_SETTINGS.max_upload_bytes+1),413),('malformed',b'wrong,header\nx,y\n',422),('duplicate ID',(HEADER+row+row).encode(),422),('PaySim-shaped',b'step,type,amount,nameOrig,oldbalanceOrg,newbalanceOrig,nameDest,oldbalanceDest,newbalanceDest,isFraud,isFlaggedFraud\n',422)]
    results=[]
    for name,data,expected in samples:
        actual=client.post('/api/transactions/import',content=data,headers={'Content-Type':'text/csv'}).status_code
        results.append({'test':name,'expected':expected,'actual':actual,'passed':actual==expected})
    return results

def main():
    p=argparse.ArgumentParser();p.add_argument('--target',default='http://127.0.0.1:8000');p.add_argument('--yes',action='store_true');a=p.parse_args();target=guard(a.target,a.yes,loopback_only=True)
    import httpx
    with httpx.Client(base_url=target,timeout=30,trust_env=False,follow_redirects=False) as c:results=checks(c)
    report='# Observed local input-limit checks\n\nAPI is unauthenticated by design. These checks are not a security audit.\n\n'+ '\n'.join(f"- {r['test']}: expected {r['expected']}, observed {r['actual']}, passed={r['passed']}" for r in results)+'\n'
    artifact('self_test_report.md').write_text(report);print(report)
    if not all(r['passed'] for r in results):raise SystemExit(1)
if __name__=='__main__':main()
