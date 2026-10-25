"""Trusted local advisory artifacts only; no uploaded pickle/model is accepted."""
import pickle
import math
from .extension_common import artifact,read_artifact
from .features import iter_features
from .config import DEFAULT_SETTINGS

def feature_rows(txs,settings=DEFAULT_SETTINGS):
    by_id={t.transaction_id:t for t in txs};out=[];ids=[]
    for tid,f in iter_features(txs,settings):
        t=by_id[tid];ids.append(tid)
        out.append({'log_amount':math.log1p(t.amount),'type':t.transaction_type,'prior_outbound_count':f.prior_outbound_count,'prior_inbound_count':f.prior_inbound_count,'window_outbound_count':f.outbound_short_window_count,'recipient_new':int(not f.current_recipient_seen_before),'history_limited':int(f.coverage=='limited')})
    return ids,out

def model_status():
    report=read_artifact('paysim_benchmark.json')
    configured=bool(report and report.get('evaluation_status')=='completed' and artifact('paysim_model.joblib').is_file())
    return {'model_status':'configured' if configured else 'not_configured','evaluation_status':report.get('evaluation_status','not_run') if report else 'not_run','metrics':report.get('metrics') if report else None,'dataset':report.get('dataset') if report else None}

def advisory_scores(txs,settings=DEFAULT_SETTINGS):
    if model_status()['model_status']!='configured':return {}
    try:
        import joblib
        bundle=joblib.load(artifact('paysim_model.joblib'))
        ids,rows=feature_rows(txs,settings);scores=bundle['model'].predict_proba(rows)[:,1]
        return dict(zip(ids,map(float,scores)))
    except (ImportError,OSError,ValueError,KeyError,AttributeError,EOFError,TypeError,pickle.UnpicklingError):return {}
