#!/usr/bin/env python3
import sys,json
from pathlib import Path
from collections import Counter
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from traceguard.extension_common import artifact
from make_triage_dataset import build

def main():
    import joblib
    from sklearn.pipeline import make_pipeline
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import classification_report,confusion_matrix,f1_score
    rows=build();families=sorted({r['scenario_family'] for r in rows});heldout=set(families[::3]);train=[r for r in rows if r['scenario_family'] not in heldout];test=[r for r in rows if r['scenario_family'] in heldout]
    assert {r['scenario_family'] for r in train}.isdisjoint(heldout)
    model=make_pipeline(TfidfVectorizer(ngram_range=(1,2),max_features=5000),LogisticRegression(max_iter=1000,random_state=17))
    model.fit([r['text'] for r in train],[r['label'] for r in train]);pred=model.predict([r['text'] for r in test]);truth=[r['label'] for r in test];labels=['HIGH','MEDIUM','LOW','INSUFFICIENT_INFORMATION'];per=classification_report(truth,pred,labels=labels,output_dict=True,zero_division=0)
    injections=[{'id':r['id'],'expected':r['label'],'predicted':str(p),'correct':str(p)==r['label']} for r,p in zip(test,pred) if r['injection']]
    report={'evaluation_status':'completed','metrics':{'macro_f1':float(f1_score(truth,pred,labels=labels,average='macro',zero_division=0)),'per_class':per,'high_recall':per['HIGH']['recall'] if 'HIGH' in truth else None,'confusion_matrix':confusion_matrix(truth,pred,labels=labels).tolist(),'labels':labels},'train_size':len(train),'test_size':len(test),'train_families':sorted(set(families)-heldout),'test_families':sorted(heldout),'label_counts':{'train':dict(Counter(r['label'] for r in train)),'test':dict(Counter(truth))},'injection_tests':injections,'llm_model':'not_evaluated','limitations':['Synthetic template recognition only; labels and text share scenario facts.','Rare classes can be absent in a family-held-out split; inspect label counts.','No real-world triage performance established.']}
    artifact('triage_eval.json').parent.mkdir(parents=True,exist_ok=True);artifact('triage_eval.json').write_text(json.dumps(report,indent=2));joblib.dump({'model':model,'train_families':sorted(set(families)-heldout)},artifact('triage_baseline.joblib'));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
