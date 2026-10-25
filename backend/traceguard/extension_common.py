"""Bounded shared input and artifact utilities. No optional ML imports at startup."""
from pathlib import Path
import json, os, re, math
from pydantic import BaseModel, ConfigDict, Field, field_validator

ARTIFACTS = Path(__file__).resolve().parents[1] / 'artifacts'
NOTICE = 'Synthetic investigation aid; rule priority is a review order, not a finding of fraud.'

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class TextRequest(StrictModel):
    text: str = Field(min_length=1,max_length=2000)
    @field_validator('text')
    @classmethod
    def valid_text(cls,v):
        if not v.strip() or any(ord(c)<32 or ord(c)==127 for c in v):
            raise ValueError('Text must be non-empty and contain no control characters')
        return v.strip()

def artifact(name):
    return Path(os.environ.get('TRACEGUARD_ARTIFACTS',str(ARTIFACTS))) / name

def read_artifact(name):
    try:
        result=json.loads(artifact(name).read_text())
        return result if isinstance(result,dict) else None
    except (OSError,ValueError):return None

def finite_number(value):
    n=float(value)
    return n if math.isfinite(n) else None

def extract(text):
    patterns=[]
    for name,regex in [('PASS_THROUGH_CHAIN',r'chain|pass.through|onward|intermediar'),('FAN_IN_DISPERSAL',r'fan.in|dispers|senders|collector'),('LEGIT_BURST',r'payroll|salary|regular payout'),('NEW_ACCOUNT_HIGH_VALUE',r'new account|no history'),('SINGLE_LARGE_TRANSFER',r'large transfer|single transfer')]:
        if re.search(regex,text,re.I):patterns.append(name)
    amounts=[{'value':finite_number(m.group(1).replace(',','')),'span':m.group(0),'start':m.start(),'end':m.end()} for m in re.finditer(r'(?:₹|Rs\.?\s*|INR\s*|amount\s+)(\d[\d,]*(?:\.\d+)?)',text,re.I)]
    counts=[{'value':int(m.group(1)),'kind':m.group(2).lower(),'span':m.group(0)} for m in re.finditer(r'\b(\d+)\s+(senders|recipients|intermediaries|transactions|accounts)\b',text,re.I)]
    spans=[{'seconds':finite_number(m.group(1)) * {'seconds':1,'minutes':60,'hours':3600,'days':86400}[m.group(2).lower()] if finite_number(m.group(1)) is not None and finite_number(m.group(1)) < 1e300 else None,'span':m.group(0)} for m in re.finditer(r'\b(\d+(?:\.\d+)?)\s+(seconds|minutes|hours|days)\b',text,re.I)]
    parties=list(dict.fromkeys(re.findall(r'\b(?:account|party)\s+([A-Za-z][A-Za-z0-9_-]{0,30})',text,re.I)))
    return {'amounts':amounts,'counts':counts,'time_spans':spans,'parties':parties,'patterns':patterns}
