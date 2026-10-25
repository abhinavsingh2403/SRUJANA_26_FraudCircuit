#!/usr/bin/env python3
"""Optional chronological PaySim baselines. No data acquisition or network access."""
import sys,json,math,argparse,os
from pathlib import Path
from collections import Counter
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from traceguard.extension_common import artifact
from traceguard.paysim_adapter import status,iter_rows,path_from_env,read_window,PAYSIM_HOURLY,BANNER
from traceguard.model_hook import feature_rows

def main():
    p=argparse.ArgumentParser();p.add_argument('--max-rows',type=int,default=100000);p.add_argument('--alert-budget',type=float,default=.01);a=p.parse_args()
    if not 1<=a.max_rows<=100000 or not 0<a.alert_budget<=1:p.error('Invalid row limit or alert budget')
    info=status();report={'evaluation_status':'not_run','metrics':None,'dataset':info,'notice':BANNER}
    output=artifact('paysim_benchmark.json');output.parent.mkdir(parents=True,exist_ok=True)
    if info['status']!='available':output.write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));return
    report['provenance']=os.environ.get('PAYSIM_PROVENANCE')
    report['license']=os.environ.get('PAYSIM_LICENSE')
    report['dataset_name']=path_from_env().name
    if not report['provenance'] or not report['license']:
        report['warning']='Set PAYSIM_PROVENANCE and PAYSIM_LICENSE to your verified source and licence before training.'
        output.write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));return
    try:
        import numpy as np,joblib
        from sklearn.feature_extraction import DictVectorizer
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler,FunctionTransformer
        from sklearn.linear_model import LogisticRegression
        from sklearn.metrics import average_precision_score,precision_recall_fscore_support,confusion_matrix
    except ImportError:
        report['warning']='Install requirements-ml.txt to run benchmark';output.write_text(json.dumps(report,indent=2));print(report);return
    counts=Counter(step for _,step,_,amount,_ in iter_rows(path_from_env()) if amount>0)
    # Select complete steps evenly across actual range; never split a timestamp bucket.
    selected=[];total=0
    candidates=sorted(counts)
    for index in sorted(set(np.linspace(0,max(0,len(candidates)-1),min(100,len(candidates)),dtype=int))):
        step=candidates[index]
        if total+counts[step]<=a.max_rows:selected.append(step);total+=counts[step]
    if len(selected)<3:report['warning']='At least three complete sampled steps are required';output.write_text(json.dumps(report,indent=2));print(report);return
    txs,labels,_,_=read_window(selected[0],selected[-1],a.max_rows,selected_steps=set(selected))
    ids,features=feature_rows(txs,PAYSIM_HOURLY);step_by_id={t.transaction_id:int((t.timestamp_us/1e6-1577836800)/3600) for t in txs}
    b1=info['step_min']+int((info['step_max']-info['step_min'])*.6);b2=info['step_min']+int((info['step_max']-info['step_min'])*.8)
    splits=[[i for i,tid in enumerate(ids) if predicate(step_by_id[tid])] for predicate in [lambda s:s<=b1,lambda s:b1<s<=b2,lambda s:s>b2]]
    y=np.array([labels[i] for i in ids]);report.update(selected_steps=selected,split_boundaries={'train_end_step':b1,'validation_end_step':b2,'test_end_step':selected[-1]},splits={name:{'rows':len(ix),'positives':int(sum(y[ix]))} for name,ix in zip(['train','validation','test'],splits)},feature_names=list(features[0]),sampling_limitations='Only selected complete steps are analyzed; omitted steps reduce available history.',dataset_hash=info['sha256'])
    if any(not ix or len(set(y[ix]))<2 for ix in splits):
        report['warning']='A split has no positives or no negatives; model fitting/metrics skipped.';output.write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));return
    train,val,test=splits;metrics={};chosen=None
    for name,history in [('type_log_amount_baseline',False),('logistic_with_history',True)]:
        x=features if history else [{k:r[k] for k in ('type','log_amount')} for r in features]
        model=make_pipeline(DictVectorizer(sparse=False),StandardScaler(),LogisticRegression(max_iter=1000,random_state=17))
        model.fit([x[i] for i in train],y[train]);vs=model.predict_proba([x[i] for i in val])[:,1]
        budget=max(1,int(len(val)*a.alert_budget));threshold=float(sorted(vs,reverse=True)[budget-1]);score=model.predict_proba([x[i] for i in test])[:,1];pred=score>=threshold
        tn,fp,fn,tp=map(int,confusion_matrix(y[test],pred,labels=[0,1]).ravel());k=min(100,len(test));rank=np.argsort(-score,kind='stable')[:k]
        metrics[name]={'average_precision':float(average_precision_score(y[test],score)),'precision':tp/(tp+fp) if tp+fp else 0,'recall':tp/(tp+fn),'false_positive_count':fp,'precision_at_k':float(np.mean(y[test][rank])),'k':k,'tp':tp,'tn':tn,'fp':fp,'fn':fn,'threshold':threshold,'threshold_selection':'Validation top alert-budget quantile; ties may exceed budget','validation_alert_budget':a.alert_budget}
        if history:chosen=model
    report.update(evaluation_status='completed',metrics=metrics,ablation='type_log_amount_baseline excludes all history features',boosted_status='not_run',notice=BANNER+' Rank scores are not calibrated probabilities.')
    output.write_text(json.dumps(report,indent=2));joblib.dump({'model':chosen,'feature_names':list(features[0]),'dataset_hash':info['sha256']},artifact('paysim_model.joblib'));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
