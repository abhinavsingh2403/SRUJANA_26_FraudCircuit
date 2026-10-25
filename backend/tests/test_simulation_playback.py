"""Prefix isolation, final equivalence, validation and non-persistence."""
import os
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from traceguard.main import app
from traceguard import db, simulator
from traceguard.fixtures import SCENARIOS, scenario_transactions
from traceguard.pipeline import analyse_transactions_detailed

class PlaybackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'TRACEGUARD_DB': self.tmp.name+'/test.sqlite', 'TRACEGUARD_ARTIFACTS': self.tmp.name})
        self.env.start()
        self.client = TestClient(app)
        self.client.__enter__()
    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.tmp.cleanup()
    def test_all_fixture_prefixes_and_final_output(self):
        for name in SCENARIOS:
            txs = sorted(scenario_transactions(name), key=lambda t:(t.timestamp_us,t.transaction_id))
            for step in range(len(txs)+1):
                response = self.client.post('/api/simulate/step', json={'scenario_id':name,'step':step})
                self.assertEqual(response.status_code, 200, response.text)
                data = response.json()
                expected_id, expected_cases, expected_stats = analyse_transactions_detailed(txs[:step], name)
                self.assertEqual(data['run_id'], expected_id)
                self.assertEqual(data['cases'], expected_cases)
                self.assertEqual(data['graph_summary'], expected_stats)
                seen = {t.transaction_id for t in txs[:step]}
                self.assertEqual({t['transaction_id'] for t in data['graph']['edges']}, seen)
                for c in data['cases']:
                    for e in c['evidence']:
                        self.assertTrue(set(e['transaction_ids']) <= seen)
                self.assertEqual(data['complete'], step == len(txs))
        self.assertEqual(db.count_cases(), 0)
        with db._connection() as conn:
            for table in ['analysis_runs','review_log','case_traces']:
                self.assertEqual(conn.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)
    def test_custom_final_equals_existing_engine(self):
        for pattern in simulator.PATTERNS:
            spec = simulator.Spec(pattern=pattern)
            expected = simulator.run(spec)
            data = self.client.post('/api/simulate/step', json={'spec':spec.model_dump(),'step':len(expected['transactions'])}).json()
            self.assertEqual(data['cases'], expected['cases'])
            self.assertEqual(data['graph'], expected['graph'])
    def test_invalid_inputs(self):
        for body in [{}, {'spec':{},'scenario_id':'rapid-pass-through'}, {'scenario_id':'missing'},
                     {'spec':{},'step':-1}, {'spec':{},'step':201}, {'spec':{},'step':100},
                     {'spec':{},'step':1.5}, {'spec':{},'step':True}, {'spec':{},'extra':1},
                     {'spec':{'amount':-1}}, {'spec':{},'overrides':{'gap_scale':0}}]:
            self.assertEqual(self.client.post('/api/simulate/step',json=body).status_code,422,body)
    def test_simulation_page_and_assets(self):
        for path in ['/simulation.html','/static/simulation.js','/static/simulation.css']:
            self.assertEqual(self.client.get(path).status_code,200)
    def test_missing_samples_report_failure(self):
        with patch('pathlib.Path.is_file',return_value=False):
            data=self.client.post('/api/realtime/seed').json()
        self.assertEqual(data['status'],'error')
        self.assertTrue(all('error' in batch for batch in data['seeded_batches']))

    def test_cross_origin_mutations_blocked(self):
        response=self.client.post('/api/simulate/step',json={'spec':{}},headers={'Origin':'https://attacker.example'})
        self.assertEqual(response.status_code,403)
        for origin in ['http://testserver','http://localhost:5173']:
            self.assertEqual(self.client.post('/api/simulate/step',json={'spec':{}},headers={'Origin':origin}).status_code,200)

    def test_json_body_limit(self):
        response=self.client.post('/api/simulate/step',content=b' '*(256*1024+1),headers={'content-type':'application/json'})
        self.assertEqual(response.status_code,413)
