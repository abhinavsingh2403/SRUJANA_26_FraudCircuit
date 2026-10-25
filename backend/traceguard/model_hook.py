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
    configured=bool(report and report.get('evaluation_status')=='completed' and (artifact('paysim_model.joblib').is_file() or artifact('xgboost_pipeline.joblib').is_file()))
    return {'model_status':'configured' if configured else 'not_configured','evaluation_status':report.get('evaluation_status','not_run') if report else 'not_run','metrics':report.get('metrics') if report else None,'dataset':report.get('dataset') if report else None}

def advisory_scores(txs,settings=DEFAULT_SETTINGS):
    if model_status()['model_status']!='configured':return {}
    try:
        import joblib
        import numpy as np
        from datetime import datetime, timezone

        # 1. Direct XGBoost model evaluation
        xgb_path = artifact('xgboost_pipeline.joblib')
        if xgb_path.is_file():
            bundle = joblib.load(xgb_path)
            model = bundle.get('model')
            if model is not None and hasattr(model, 'predict_proba'):
                ids = [t.transaction_id for t in txs]
                X = []
                for t in txs:
                    is_trans = 1.0 if t.transaction_type == 'TRANSFER' else 0.0
                    dt = datetime.fromtimestamp(t.timestamp_us / 1e6, tz=timezone.utc)
                    hour = float(dt.hour)
                    log_amt = math.log1p(t.amount)
                    log_bal = 0.0
                    X.append([log_amt, hour, is_trans, log_bal])
                scores = model.predict_proba(np.array(X))[:, 1]
                return dict(zip(ids, map(float, scores)))

        # 2. Fallback to paysim_model.joblib
        model_path = artifact('paysim_model.joblib')
        if model_path.is_file():
            bundle = joblib.load(model_path)
            model = bundle.get('model')
            ids, rows = feature_rows(txs, settings)
            if hasattr(model, 'predict_proba'):
                scores = model.predict_proba(rows)[:, 1]
                return dict(zip(ids, map(float, scores)))
        return {}
    except (ImportError,OSError,ValueError,KeyError,AttributeError,EOFError,TypeError,pickle.UnpicklingError):return {}
