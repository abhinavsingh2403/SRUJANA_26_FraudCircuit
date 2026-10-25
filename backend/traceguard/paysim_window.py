from datetime import timedelta
import time
from .explain import explain
from typing import Literal
from pydantic import Field,model_validator
from .extension_common import StrictModel
from .paysim_adapter import read_window,BASE,PAYSIM_HOURLY,BANNER
from .simulator import Spec,generate,Overrides,graph_view
from .pipeline import analyse_transactions_detailed
from .model_hook import advisory_scores

class Overlay(StrictModel):
    pattern:Literal['PASS_THROUGH_CHAIN']='PASS_THROUGH_CHAIN'
    at_step:int=Field(ge=0,le=1_000_000)
    params:dict=Field(default_factory=dict)
    @model_validator(mode='after')
    def check(self):
        Spec.model_validate({**self.params,'pattern':self.pattern})
        return self
class WindowRequest(StrictModel):
    start_step:int=Field(ge=0,le=1_000_000)
    end_step:int=Field(ge=0,le=1_000_000)
    lookback_steps:int=Field(default=48,ge=0,le=720)
    types:list[Literal['CASH_IN','CASH_OUT','DEBIT','PAYMENT','TRANSFER']]|None=Field(default=None,max_length=5)
    max_rows:int=Field(default=10000,ge=1,le=100000)
    reveal_labels:bool=False
    overlay:Overlay|None=None
    @model_validator(mode='after')
    def ordered(self):
        if self.end_step<self.start_step:raise ValueError('end_step must be >= start_step')
        if self.overlay and not self.start_step<=self.overlay.at_step<=self.end_step:raise ValueError('overlay must start inside review window')
        return self

def window_run(req):
    txs,labels,steps,zero=read_window(max(0,req.start_step-req.lookback_steps),req.end_step,req.max_rows,req.types)
    overlay_ids=set()
    if req.overlay:
        spec=Spec.model_validate({**req.overlay.params,'pattern':req.overlay.pattern})
        generated,_=generate(spec,base=BASE+timedelta(hours=req.overlay.at_step));end=(BASE+timedelta(hours=req.end_step+1)).timestamp()*1e6
        if any(t.timestamp_us>=end for t in generated):raise ValueError('Overlay extends past the review window; widen the window or reduce gap')
        if len(txs)+len(generated)>req.max_rows:raise ValueError('Overlay exceeds max_rows budget')
        overlay_ids={t.transaction_id for t in generated};txs+=generated
    start=int((BASE+timedelta(hours=req.start_step)).timestamp()*1e6)
    run_id,cases,stats=analyse_transactions_detailed(txs,'paysim-window',PAYSIM_HOURLY,review_start_us=start)
    review=[t for t in txs if t.timestamp_us>=start and t.transaction_id not in overlay_ids]
    scores=advisory_scores(txs,PAYSIM_HOURLY)
    for c in cases:
        vals=[scores[tid] for tid in c['transaction_ids'] if tid in scores]
        if vals:
            c['score_components'].update(
                model_score=round(float(max(vals)), 4),
                model_status='configured',
                model_notice='XGBoost calibrated fraud risk probability'
            )
    display=sorted(txs,key=lambda t:(t.timestamp_us<start,t.timestamp_us,t.transaction_id))[:200]
    graph=graph_view(display,cases)
    graph['truncated']=len(txs)>200
    result={'run_id':run_id,'cases':cases,'graph':graph,'timeline':graph['edges'],'graph_summary':stats,'rows_analyzed':len(txs),'review_rows':len(review),'zero_amount_rows_excluded':zero,'notice':BANNER+' Lookback provides history only. Graph/timeline display at most 200 rows. No persistence.'}
    trace_start=time.perf_counter()
    explanation=explain(txs,PAYSIM_HOURLY,selected_ids={t.transaction_id for t in display})
    result['trace']=[{'stage':'features/rule evaluation','status':'completed','duration_ms':round((time.perf_counter()-trace_start)*1000,3),'summary':'Complete-input history, at most 200 displayed transaction traces','details':explanation}]
    if overlay_ids:
        matches=[c for c in cases if overlay_ids.intersection(c['transaction_ids'])]
        result['overlay']={'synthetic':True,'detected':bool(matches),'rules':sorted({x for c in matches for x in c['rule_codes']}),'priorities':[c['priority'] for c in matches],'merged_with_background':any(set(c['transaction_ids'])-overlay_ids for c in matches),'notice':'Overlay excluded from label metrics.'}
    if req.reveal_labels:
        # Evaluate background independently; overlay cannot change background metrics.
        _,background,_=analyse_transactions_detailed([t for t in txs if t.transaction_id not in overlay_ids],'paysim-background',PAYSIM_HOURLY,review_start_us=start)
        rule_alerted={tid for c in background if c['priority'] in {'HIGH','MEDIUM'} for tid in c['transaction_ids']}
        ml_alerted={t.transaction_id for t in review if scores.get(t.transaction_id, 0) >= 0.70}
        alerted = rule_alerted | ml_alerted
        ranked=sorted(review,key=lambda t:(-scores.get(t.transaction_id,0), t.transaction_id not in rule_alerted, t.timestamp_us, t.transaction_id))
        k=min(20,len(ranked));positive=sum(labels[t.transaction_id] for t in review)
        tp=sum(labels[t.transaction_id] for t in review if t.transaction_id in alerted)
        fp=sum(1-labels[t.transaction_id] for t in review if t.transaction_id in alerted)
        precision = round(tp / (tp + fp), 4) if (tp + fp) else 0.0
        recall_val = round(tp / positive, 4) if positive else None
        p_at_k = round(sum(labels[t.transaction_id] for t in ranked[:k]) / k, 4) if k else None
        result['evaluation']={
            'positive_rows':positive,
            'prevalence':round(positive/len(review), 5) if review else None,
            'precision_at_k':p_at_k,
            'k':k,
            'ranking':'XGBoost model probability rank first, then rule priority',
            'precision': precision,
            'recall': recall_val,
            'false_positive_count':fp,
            'tp':tp,
            'fn':positive-tp,
            'cases':len(background),
            'alerted_transactions':tp+fp,
            'warning':'No positives in review window; recall undefined.' if not positive else 'Evaluated against ground-truth PaySim labels using hybrid XGBoost + rule alerts.'
        }
    return result
