"""Optional ML smoke test on an explicitly invented tiny file, never PaySim performance."""
import csv,importlib.util,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
from traceguard.paysim_adapter import HEADER
ROOT=Path(__file__).resolve().parents[1]
@unittest.skipUnless(importlib.util.find_spec('sklearn'),'optional ML dependencies not installed')
class ToyBenchmark(unittest.TestCase):
 def test_chronological_artifact_and_advisory_hook(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'toy.csv'
   with path.open('w',newline='') as f:
    w=csv.writer(f);w.writerow(HEADER)
    for step in range(30):
     for label in (0,1):w.writerow([step,'TRANSFER' if label else 'PAYMENT',1000 if label else 10,'A'+str(label),'ignored','ignored','B'+str(label),'ignored','ignored',label,1])
   env={**os.environ,'PAYSIM_PATH':str(path),'PAYSIM_PROVENANCE':'invented unit-test rows, not PaySim','PAYSIM_LICENSE':'authored for this test','TRACEGUARD_ARTIFACTS':tmp}
   result=subprocess.run([sys.executable,'scripts/run_paysim_benchmark.py','--max-rows','60'],cwd=ROOT,env=env,capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr);report=json.loads((Path(tmp)/'paysim_benchmark.json').read_text());self.assertEqual(report['evaluation_status'],'completed');self.assertEqual(sum(s['rows'] for s in report['splits'].values()),60)
   self.assertTrue(all(s['positives'] for s in report['splits'].values()));self.assertFalse(any('fraud' in name.lower() or 'balance' in name.lower() for name in report['feature_names']))
   from unittest.mock import patch
   from traceguard.simulator import Spec,generate
   from traceguard.pipeline import analyse_transactions_detailed
   txs,_=generate(Spec());before=analyse_transactions_detailed(txs)[1]
   with patch.dict(os.environ,env):after=analyse_transactions_detailed(txs)[1]
   self.assertEqual([c['priority'] for c in before],[c['priority'] for c in after]);self.assertTrue(all(c['score_components']['model_score'] is not None for c in after))
