"""Trace uses engine features and actual evidence. Gate bars are not a second detector."""
from dataclasses import asdict
import math

def finite_json(value):
    if isinstance(value,float) and not math.isfinite(value):return None
    if isinstance(value,dict):return {k:finite_json(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)):return [finite_json(v) for v in value]
    return value
from .config import DEFAULT_SETTINGS
from .features import iter_features
from .rules import evaluate_rules
from .graph_analysis import detect_graph_patterns
RULES=['R1_RAPID_PASS_THROUGH','R2_FAN_IN_DISPERSAL','R2A_FAN_IN_CLUSTER','R2B_FAN_OUT_BURST','R3_AMOUNT_DEVIATION','R3_BASELINE_UNAVAILABLE','R4_DIRECTED_CYCLE','R5_LAYERED_CHAIN','R6_REPEATED_VALUE_BURST','R7_DORMANT_REACTIVATION','C1_STABLE_AMOUNT_CONTEXT','C2_REPEATED_COUNTERPARTY_CONTEXT','C3_STABLE_INBOUND_AMOUNT_CONTEXT']

def explain(txs,settings=DEFAULT_SETTINGS,selected_ids=None):
    graph=detect_graph_patterns(txs,settings);by_id={t.transaction_id:t for t in txs};rows=[]
    for tid,f in iter_features(txs,settings):
        if selected_ids is not None and tid not in selected_ids:continue
        t=by_id[tid];actual=evaluate_rules(t,f,settings)+graph.evidence_by_transaction.get(tid,[])
        fired={e.rule_id:e for e in actual}
        ratios=[t.amount/v['total_amount'] for v in f.inbound_window_stats.values() if v['total_amount']>0]
        gates={
            RULES[0]:(max(ratios,default=0),settings.pass_through_min_ratio,'inflow share, maximum available window'),
            RULES[1]:(f.prior_inbound_unique_senders,settings.min_fan_in_senders,'prior distinct inbound senders'),
            RULES[2]:(f.recipient_prior_inbound_unique_senders,settings.min_fan_in_cluster_senders,'recipient distinct senders including current'),
            RULES[3]:(f.outbound_short_window_unique_recipients_including_current,settings.min_fan_out_burst_recipients,'short-window recipients'),
            RULES[4]:(t.amount/f.account_history_median if f.account_history_median else None,settings.zero_mad_amount_multiple,'amount / baseline median; zero-MAD branch only'),
            RULES[5]:(f.account_history_count,settings.min_account_history,'history observations; coverage fires below minimum plus global outlier gate'),
            RULES[8]:(f.prior_outbound_same_amount_count+1,settings.min_repeated_value_transactions,'same-amount transactions'),
            RULES[9]:(f.seconds_since_last_outbound_lifetime,settings.dormant_gap_seconds,'seconds since previous outgoing'),
            RULES[10]:(abs(t.amount-f.account_history_median)/f.account_history_median if f.account_history_median else None,settings.stable_amount_context_tolerance,'relative deviation; context needs <= tolerance plus history gates'),
            RULES[11]:(int(f.current_recipient_seen_before),1,'previous recipient observed'),
            RULES[12]:(abs(t.amount-f.recipient_prior_inbound_median_amount)/f.recipient_prior_inbound_median_amount if f.recipient_prior_inbound_median_amount else None,settings.stable_amount_context_tolerance,'inbound deviation; context needs <= tolerance plus history gates')}
        # Diagnostic gate values only. Fired flags always come from evaluate_rules.
        def gate(name,value,threshold,operator='>='):
            return {'name':name,'observed':value,'threshold':threshold,'operator':operator}
        full={
          RULES[0]:[gate('amount/inflow '+w+'s',t.amount/v['total_amount'] if v['total_amount'] else None,settings.pass_through_min_ratio) for w,v in f.inbound_window_stats.items()],
          RULES[1]:[gate('inbound senders',f.prior_inbound_unique_senders,settings.min_fan_in_senders),gate('outbound recipients',f.outbound_short_window_unique_recipients_including_current,settings.min_fan_out_recipients),gate('outbound count',f.outbound_short_window_count+1,settings.min_fan_out_transactions),gate('outflow/inflow',(f.outbound_short_window_total+t.amount)/f.prior_inbound_total if f.prior_inbound_total else None,settings.fan_in_min_outflow_ratio)],
          RULES[3]:[gate('outbound count',f.outbound_short_window_count+1,settings.min_fan_out_transactions),gate('recipients',f.outbound_short_window_unique_recipients_including_current,settings.min_fan_out_burst_recipients)],
          RULES[4]:[gate('history count',f.account_history_count,settings.min_account_history),gate('MAD',f.account_history_mad,0,'branch: >0 uses z, otherwise multiple'),gate('modified z',.6745*(t.amount-f.account_history_median)/f.account_history_mad if f.account_history_median is not None and f.account_history_mad else None,settings.amount_mad_z_threshold),gate('relative increase',(t.amount-f.account_history_median)/f.account_history_median if f.account_history_median else None,settings.amount_deviation_min_relative_change),gate('zero MAD multiple',t.amount/f.account_history_median if f.account_history_median else None,settings.zero_mad_amount_multiple)],
          RULES[5]:[gate('account history',f.account_history_count,settings.min_account_history,'<'),gate('global history',f.global_history_count,settings.min_global_history),gate('amount/global median',t.amount/f.global_history_median if f.global_history_median else None,settings.global_outlier_multiple)],
          RULES[8]:[gate('same amount count',f.prior_outbound_same_amount_count+1,settings.min_repeated_value_transactions),gate('same amount recipients',f.prior_outbound_same_amount_unique_recipients+int(not f.current_recipient_seen_for_same_amount),settings.min_repeated_value_recipients)],
          RULES[9]:[gate('lifetime count',f.lifetime_outbound_count,settings.min_dormant_history),gate('dormant seconds',f.seconds_since_last_outbound_lifetime,settings.dormant_gap_seconds),gate('amount/lifetime median',t.amount/f.lifetime_outbound_median if f.lifetime_outbound_median else None,settings.dormant_amount_multiple)],
          RULES[10]:[gate('history count',f.account_history_count,settings.min_context_history),gate('history span',f.account_history_span_seconds,settings.min_context_history_span_seconds),gate('relative deviation',gates[RULES[10]][0],settings.stable_amount_context_tolerance,'<=')],
          RULES[12]:[gate('inbound count',f.recipient_prior_inbound_count,settings.min_context_history),gate('relative deviation',gates[RULES[12]][0],settings.stable_amount_context_tolerance,'<=')],
        }
        for code,window,gap,ratio in [(RULES[6],settings.cycle_window_seconds,settings.cycle_max_gap_seconds,settings.cycle_min_retention_ratio),(RULES[7],settings.layered_chain_window_seconds,settings.layered_chain_max_gap_seconds,settings.layered_chain_min_retention_ratio)]:
            full[code]=[gate('complete time-ordered path window; unmatched candidate not retained',None,window,'<='),gate('per-hop gap',None,gap,'<='),gate('per-hop retention',None,ratio),gate('expansion budget per event',None,settings.graph_search_expansion_limit,'<=')]
        checks=[]
        for code in RULES:
            value,threshold,label=gates.get(code,(None,None,'bounded graph search; no scalar threshold summarizes path constraints'))
            near=code not in fired and value is not None and threshold is not None and abs(value-threshold)<=abs(threshold)*.2
            checks.append({'rule_id':code,'fired':code in fired,'gate_value':value,'gate_threshold':threshold,'gate_label':label,'near_gate':near,'gates':full.get(code,[gate(label,value,threshold)]),'evidence':fired[code].to_dict() if code in fired else None})
        rows.append({'transaction_id':tid,'features':asdict(f),'rules':checks})
    return finite_json({'status':'completed','transactions':rows,'settings':asdict(settings),'graph_summary':graph.stats,'notice':'Fired flags come from the real engine. Bars show one named gate, not the full rule predicate. Near-gate is within 20% of that gate, not a fraud score. Graph paths have no single near-miss scalar. Non-finite diagnostic ratios are null.'})

def stored_trace(case):
    # Exact prior feature state is not retained in the existing database schema.
    # Never reconstruct history from a truncated case and pretend it is complete.
    return {'status':'unavailable','transactions':[], 'stored_evidence':case.get('evidence',[]),
            'notice':'Exact near-miss feature state was not persisted for this case. Stored fired evidence remains authoritative; use the isolated simulator for a full-input trace.'}
