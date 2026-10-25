"""Additive local research endpoints. Simulators do not persist."""
from datetime import datetime
import csv
from typing import Annotated
from fastapi import APIRouter,HTTPException,Query,Body
from . import db,security,simulator,paysim_adapter,paysim_window,triage
from .extension_common import TextRequest
router=APIRouter()

def invalid(fn,*args):
    try:return fn(*args)
    except (ValueError,FileNotFoundError,OSError,csv.Error) as exc:raise HTTPException(422,detail=str(exc)) from exc

@router.post('/api/simulate/parse')
def parse(body:TextRequest):return simulator.parse(body.text)
@router.post('/api/simulate/run')
def run(body:simulator.RunRequest):return invalid(simulator.run,body.spec,body.overrides)
@router.post('/api/simulate/sweep')
def sweep(body:simulator.SweepRequest):return invalid(simulator.sweep,body)
@router.get('/api/simulate/patterns')
def patterns():return {'patterns':simulator.PATTERNS,'defaults':simulator.Spec().model_dump(),'schema':simulator.Spec.model_json_schema()}
@router.get('/api/paysim/status')
def paysim_status():return paysim_adapter.status()
@router.post('/api/paysim/window/run')
def paysim_run(body:paysim_window.WindowRequest):return invalid(paysim_window.window_run,body)
@router.post('/api/triage/text')
def text_triage(body:triage.TriageRequest):
    case=db.get_case(body.case_id) if body.case_id else None
    if body.case_id and case is None:raise HTTPException(404,detail='Case not found')
    return triage.triage(body.text,case)
@router.get('/api/triage/evaluation')
def triage_eval():return triage.evaluation()
@router.post('/api/security-events')
def events(body:security.Event|Annotated[list[security.Event],Body(min_length=1,max_length=200)]):
    return invalid(security.add,body if isinstance(body,list) else [body])
@router.get('/api/security-events')
def list_events(event_type:str|None=Query(None,pattern='^(AUTH_FAILURE_BURST|REQUEST_RATE_SPIKE|UNMATCHED_REFERENCE_PAYOUT|OTHER)$'),account_id:str|None=Query(None,max_length=128),since:datetime|None=None,limit:int=Query(100,ge=1,le=200),offset:int=Query(0,ge=0,le=100000)):
    if since is not None and since.tzinfo is None:raise HTTPException(422,detail='since requires timezone')
    return security.listing(event_type,account_id,since,limit,offset)
