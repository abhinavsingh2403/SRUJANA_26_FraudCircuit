"""Regression coverage for provenance, state integrity and honest empty states."""
import os
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch
from fastapi.testclient import TestClient
from traceguard import db, service
from traceguard.main import app
from traceguard.config import Settings
from traceguard.fixtures import scenario_transactions
from traceguard.pipeline import analyse_transactions_detailed
from traceguard.provenance import run_record


class LiveEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'TRACEGUARD_DB': self.tmp.name+'/test.db', 'TRACEGUARD_ARTIFACTS': self.tmp.name})
        self.env.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop(); self.tmp.cleanup()

    def replay(self):
        return self.client.post('/api/scenarios/rapid-pass-through/replay', json={}).json()

    def review(self, cid):
        return self.client.patch(f'/api/cases/{cid}/review', json={'status':'CLOSED','outcome':'INCONCLUSIVE','reviewer':'Test'})

    def audit(self, cid):
        return self.client.get(f'/api/cases/{cid}/audit').json()

    def test_empty_no_fabricated_metrics(self):
        r = self.client.get('/api/evaluation/summary').json()
        self.assertEqual(r['cases']['total'], 0)
        self.assertIsNone(r['cases']['review_completion_rate'])
        self.assertIsNone(r['metrics'])
        self.assertEqual(r['runs']['items'], [])
        self.assertEqual(self.client.get('/api/evaluation/summary?source_kind=invalid').status_code, 422)

    def test_source_scope_and_zero_case_run_and_deduplication(self):
        self.client.post('/api/scenarios/legitimate-high-volume/replay', json={})
        self.replay(); self.replay()
        csv='transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\nU1,2026-01-01T00:00:00Z,A,B,5,TRANSFER\n'
        self.assertEqual(self.client.post('/api/transactions/import', content=csv).status_code, 200)
        synth=self.client.get('/api/evaluation/summary?source_kind=synthetic_fixture').json()
        upload=self.client.get('/api/evaluation/summary?source_kind=uploaded_csv').json()
        self.assertEqual(synth['runs']['total'],2)
        self.assertEqual(upload['runs']['total'],1)
        self.assertEqual(synth['cases']['total'],1)
        self.assertEqual(upload['cases']['total'],0)
        self.assertIn(0,[r['case_count'] for r in synth['runs']['items']])

    def test_no_events_and_review_completion_and_replay_current_state(self):
        r=self.replay(); cid=r['cases'][0]['case_id']
        self.assertEqual(self.audit(cid)['status'],'no_events')
        self.assertEqual(self.review(cid).status_code,200)
        self.assertEqual(self.audit(cid)['status'],'verified')
        self.assertEqual(self.replay()['cases'][0]['status'],'CLOSED')
        s=self.client.get('/api/evaluation/summary').json()
        self.assertEqual(s['cases']['review_completion_rate'],1)
        self.assertEqual(s['cases']['outcome_counts']['INCONCLUSIVE'],1)
        self.client.patch(f'/api/cases/{cid}/review',json={'status':'OPEN'})
        self.assertEqual(self.client.get('/api/evaluation/summary').json()['cases']['outcome_counts'],{})

    def test_tampered_current_state_fails_and_blocks_append(self):
        cid=self.replay()['cases'][0]['case_id']; self.review(cid)
        with db._connection() as c: c.execute("UPDATE cases SET status='OPEN', review_outcome=NULL WHERE case_id=?",(cid,))
        self.assertEqual(self.audit(cid)['reason'],'current_state_mismatch')
        self.assertEqual(self.review(cid).status_code,422)

    def test_restart_does_not_heal_null_hash_or_changed_event(self):
        cid=self.replay()['cases'][0]['case_id']; self.review(cid)
        with db._connection() as c: c.execute("UPDATE review_log SET event_hash=NULL, note='tampered' WHERE case_id=?",(cid,))
        db.initialize()
        self.assertFalse(self.audit(cid)['valid'])

    def test_tail_deletion_with_state_mismatch_detected(self):
        cid=self.replay()['cases'][0]['case_id']; self.review(cid)
        with db._connection() as c: c.execute('DELETE FROM review_log WHERE case_id=?',(cid,))
        self.assertEqual(self.audit(cid)['reason'],'missing_review_history')

    def test_transition_mismatch_even_if_hash_recomputed(self):
        cid=self.replay()['cases'][0]['case_id']; self.review(cid)
        with db._connection() as c:
            event=dict(c.execute('SELECT * FROM review_log WHERE case_id=?',(cid,)).fetchone())
            event['previous_status']='INVESTIGATING'
            c.execute('UPDATE review_log SET previous_status=?,event_hash=? WHERE id=?',('INVESTIGATING',db._event_hash(event),event['id']))
        self.assertEqual(self.audit(cid)['reason'],'review_transition_mismatch')

    def test_settings_and_input_identity(self):
        txs=scenario_transactions('rapid-pass-through'); s=Settings(); changed=replace(s,pass_through_min_ratio=.99)
        a=analyse_transactions_detailed(txs,'x',s)
        b=analyse_transactions_detailed(txs,'x',changed)
        self.assertNotEqual(a[0],b[0])
        self.assertEqual(a[0],analyse_transactions_detailed(reversed(txs),'x',s)[0])
        ra=run_record(a[0],'x',txs,a[1],a[2],s,1)
        rb=run_record(b[0],'x',txs,b[1],b[2],changed,1)
        self.assertEqual(ra['input_sha256'],rb['input_sha256'])
        self.assertNotEqual(ra['settings_sha256'],rb['settings_sha256'])

    def test_trace_failure_rolls_back_case_and_run(self):
        with patch('traceguard.security.save_traces',side_effect=ValueError('trace failed')):
            with self.assertRaises(ValueError): service.replay_scenario('rapid-pass-through')
        self.assertEqual(db.count_cases(),0)
        self.assertEqual(self.client.get('/api/evaluation/summary').json()['runs']['total'],0)

    def test_boolean_and_fractional_limits_rejected(self):
        for v in (True,1.5,float('nan')):
            with self.assertRaises(ValueError): Settings(max_csv_rows=v)

    def test_old_cases_not_misattributed_to_uploads(self):
        r=self.replay()
        with db._connection() as c:c.execute('DELETE FROM analysis_runs')
        all_data=self.client.get('/api/evaluation/summary').json()
        self.assertEqual(all_data['legacy_cases_without_run_metadata'],1)
        self.assertEqual(all_data['cases']['total'],1)
        self.assertEqual(self.client.get('/api/evaluation/summary?source_kind=uploaded_csv').json()['cases']['total'],0)

    def test_run_list_explicitly_bounds_and_counts_omitted_rows(self):
        for i in range(26):
            service.replay_scenario('rapid-pass-through', {'amount_scale': 1+i/10})
        r=self.client.get('/api/evaluation/summary').json()['runs']
        self.assertEqual(r['total'],26)
        self.assertEqual(r['returned'],25)
        self.assertTrue(r['truncated'])
        self.assertEqual(len(r['items']),25)

    def test_trace_counts_include_omitted_triggers(self):
        from traceguard.security import save_traces,trace_for
        r=self.replay(); case=r['cases'][0]
        case['counts']['trigger_transactions_total']=200
        save_traces([case],scenario_transactions('rapid-pass-through'),Settings())
        trace=trace_for(case)
        self.assertEqual(trace['transactions_total'],200)
        self.assertTrue(trace['truncated'])

if __name__=='__main__':unittest.main()
