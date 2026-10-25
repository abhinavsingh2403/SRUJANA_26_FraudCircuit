const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
let source = null, result = null, playing = false, timer = null, controller = null, generation = 0, busy = false;
const money = t => `${t.currency ? t.currency + ' ' : ''}${Number(t.amount).toLocaleString(undefined, {maximumFractionDigits: 2})}`;
function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
async function api(url, body, signal) {
  const r = await fetch(url, {method: body ? 'POST' : 'GET', headers: {'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}), signal});
  const data = await r.json();
  if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || data));
  return data;
}
function controls() {
  const ready = !!result && !busy;
  for (const id of ['reset','back']) $(id).disabled = !ready || result.step === 0;
  for (const id of ['next','finish']) $(id).disabled = !ready || result.complete;
  $('play').disabled = !playing && (!ready || result.complete);
  $('play').textContent = playing ? 'Pause' : 'Play';
  $('seek').disabled = !ready; $('download').disabled = !ready || !result.complete;
}
function pause() { playing = false; clearTimeout(timer); controls(); }
function svg(tag, attrs, text) {
  const n = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [k,v] of Object.entries(attrs || {})) n.setAttribute(k,v);
  if (text !== undefined) n.textContent = text;
  return n;
}
function drawGraph(data) {
  const g = $('graph'); g.replaceChildren();
  const defs = svg('defs');
  for (const [id,color] of [['normal','#398e83'],['latest','#c66b16']]) {
    const marker=svg('marker',{id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});
    marker.append(svg('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:color}));defs.append(marker);
  }
  g.append(defs);
  const nodes=data.graph.nodes, edges=data.graph.edges;
  if (!nodes.length) { g.append(svg('text',{x:450,y:270,'text-anchor':'middle'},'Press Next transaction or Play to reveal the first transfer.')); return; }
  const positions = new Map(nodes.map((n,i) => {const a=2*Math.PI*i/nodes.length-Math.PI/2;return [n.id,{x:450+330*Math.cos(a),y:270+195*Math.sin(a),label:`A${i+1}`}];}));
  const groups = new Map();
  for (const t of edges) { const key=[t.sender_id,t.recipient_id].sort().join('|'); if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t); }
  for (const t of edges) {
    const a=positions.get(t.sender_id),b=positions.get(t.recipient_id),rows=groups.get([t.sender_id,t.recipient_id].sort().join('|'));
    const offset=(rows.indexOf(t)-(rows.length-1)/2)*22;
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
    const cx=(a.x+b.x)/2-dy/len*offset,cy=(a.y+b.y)/2+dx/len*offset;
    const latest=t.transaction_id===data.current_transaction?.transaction_id;
    const highlighted = latest || t.supporting_rules.length > 0;
    const path=svg('path',{d:`M ${a.x+dx/len*25} ${a.y+dy/len*25} Q ${cx} ${cy} ${b.x-dx/len*29} ${b.y-dy/len*29}`,fill:'none',stroke:highlighted?'#c66b16':'#398e83','stroke-width':latest?3:1.8,'stroke-dasharray':t.supporting_rules.length?'6 4':'none','marker-end':`url(#${highlighted?'latest':'normal'})`});
    path.append(svg('title',{},`${t.transaction_id}: ${t.sender_id} → ${t.recipient_id}; ${money(t)}; ${t.supporting_rules.join(', ') || 'no supporting rules'}`));g.append(path);
    if (edges.length<=24) g.append(svg('text',{x:(a.x+2*cx+b.x)/4,y:(a.y+2*cy+b.y)/4-5,'text-anchor':'middle',class:'edge-label'},money(t)));
  }
  for (const n of nodes) {
    const p=positions.get(n.id),group=svg('g',{tabindex:0,role:'button','aria-label':`Inspect ${n.id}`});
    group.append(svg('circle',{cx:p.x,cy:p.y,r:24,fill:'#fff',stroke:'#245d51','stroke-width':2}),svg('text',{x:p.x,y:p.y+4,'text-anchor':'middle'},p.label),svg('text',{x:p.x,y:p.y+42,'text-anchor':'middle'},n.id.length>20?n.id.slice(-18):n.id),svg('title',{},n.id));
    const inspect=()=>{const incoming=edges.filter(t=>t.recipient_id===n.id),outgoing=edges.filter(t=>t.sender_id===n.id);$('account').textContent=`${n.id} · ${incoming.length} incoming / ${outgoing.length} outgoing transfers · received ${incoming.reduce((s,t)=>s+t.amount,0).toLocaleString()} / sent ${outgoing.reduce((s,t)=>s+t.amount,0).toLocaleString()} fixture units. These are observed flows, not balances.`;};
    group.addEventListener('click',inspect);group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect();}});g.append(group);
  }
}
function explainStep(data) {
  const box = $('step-explanation');
  if (!box) return;
  if (!data.current_transaction || data.step === 0) {
    box.innerHTML = '<h4><span>ℹ️</span> Step Initialization</h4><p>Simulation ready. Advance step or press Play to reveal the opening transaction.</p>';
    return;
  }
  const tx = data.current_transaction;
  const edges = data.graph.edges;
  const senderOut = edges.filter(t => t.sender_id === tx.sender_id).length;
  const senderIn = edges.filter(t => t.recipient_id === tx.sender_id).length;
  const recipIn = edges.filter(t => t.recipient_id === tx.recipient_id).length;
  const isConduit = senderIn > 0;
  
  const matchingEvidence = data.cases.flatMap(c => c.evidence || []).filter(e => (e.transaction_ids || []).includes(tx.transaction_id));
  const hasAlert = matchingEvidence.length > 0;

  let flowNote = '';
  if (isConduit) {
    flowNote = `<strong>Conduit behavior:</strong> Account <code>${tx.sender_id}</code> previously received funds and is now forwarding money downstream.`;
  } else if (senderOut === 1 && recipIn === 1) {
    flowNote = `<strong>New flow opened:</strong> Originator <code>${tx.sender_id}</code> initiated transfer to <code>${tx.recipient_id}</code>.`;
  } else {
    flowNote = `<strong>Aggregated activity:</strong> Account <code>${tx.recipient_id}</code> has received ${recipIn} transfer(s) across the sequence.`;
  }

  let alertNote = '';
  if (hasAlert) {
    const rules = [...new Set(matchingEvidence.map(e => e.rule_id))].join(', ');
    alertNote = `<div class="step-highlight-tag alert">Threshold Alert: Rule ${rules} triggered on this step</div>`;
  } else {
    alertNote = `<div class="step-highlight-tag neutral">Within nominal baseline thresholds</div>`;
  }

  box.innerHTML = `
    <h4>Step ${data.step} of ${data.total_steps} · ${tx.transaction_id}</h4>
    <p><strong>${tx.sender_id}</strong> transferred <strong>${money(tx)}</strong> to <strong>${tx.recipient_id}</strong> at ${tx.timestamp.replace('T', ' ').replace('Z', ' UTC')}.</p>
    <p>${flowNote}</p>
    ${alertNote}
  `;
}

function explainExecutiveVerdict(data) {
  const box = $('executive-verdict');
  const badge = $('verdict-badge');
  if (!box) return;
  if (!data.complete) {
    box.style.display = 'none';
    if (badge) badge.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  const totalVol = data.graph.edges.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const accountsCount = data.graph.nodes.length;
  const txCount = data.graph.edges.length;
  const priorities = data.cases.map(c => c.priority);
  const highestPriority = priorities.includes('HIGH') ? 'HIGH' : priorities.includes('MEDIUM') ? 'MEDIUM' : priorities.includes('LOW') ? 'LOW' : priorities.includes('INSUFFICIENT_HISTORY') ? 'INSUFFICIENT_HISTORY' : 'CLEAN';
  const allRules = [...new Set(data.cases.flatMap(c => c.rule_codes || []))];

  if (badge) {
    badge.style.display = 'inline-block';
    badge.textContent = highestPriority === 'HIGH' ? 'HIGH RISK CASE' : highestPriority === 'MEDIUM' ? '⚠️ MEDIUM RISK' : highestPriority === 'CLEAN' ? '✅ NO ANOMALIES' : 'ℹ️ ' + highestPriority;
    badge.className = `pill verdict-tag-${highestPriority.toLowerCase()}`;
  }

  let typologyNarrative = '';
  if (allRules.includes('R1_RAPID_PASS_THROUGH')) {
    typologyNarrative = 'The sequence demonstrates a classic high-velocity pass-through / conduit typology. Funds received into intermediate accounts were rapidly remitted onward within minutes, leaving nominal account balance and avoiding normal commercial holding delays.';
  } else if (allRules.includes('R2A_FAN_IN_CLUSTER') || allRules.includes('R2B_FAN_OUT_DISPERSAL')) {
    typologyNarrative = 'The sequence demonstrates structured fan-in dispersal (mule collection and onward smurfing). Multiple independent counterparty streams converge into central nodes before dispersing to downstream recipients in tight temporal proximity.';
  } else if (allRules.includes('R3_ROUND_AMOUNT_STRUCTURING')) {
    typologyNarrative = 'Transactions exhibit repetitive structuring near regulatory reporting ceilings, suggesting deliberate evasion of single-transaction compliance thresholds.';
  } else if (allRules.includes('R4_DIRECTED_CYCLE')) {
    typologyNarrative = 'A closed circular loop topology was detected. Capital traversed multiple hops and returned to affiliated source entities without demonstrable underlying commercial utility.';
  } else if (data.cases.length === 0) {
    typologyNarrative = 'All transactions traversed normal behavioral distributions. Counterparty velocity, amounts, and onward transmission ratios stayed within benign thresholds with zero rule alerts triggered.';
  } else {
    typologyNarrative = 'Recorded flow patterns produced advisory alerts based on heuristic deviations from expected counterparty baselines.';
  }

  let actionNarrative = '';
  let actionClass = '';
  if (highestPriority === 'HIGH') {
    actionClass = 'high';
    actionNarrative = `
      <h6>Mandatory AML Compliance Directives:</h6>
      <ul>
        <li>Escalate file for immediate Senior Compliance Officer review.</li>
        <li>Draft and file Suspicious Transaction Report (STR/SAR) with FIU authorities within 24 hours.</li>
        <li>Place temporary precautionary hold on primary intermediary accounts pending source-of-wealth documentation.</li>
      </ul>`;
  } else if (highestPriority === 'MEDIUM') {
    actionNarrative = `
      <h6>Recommended Investigative Actions:</h6>
      <ul>
        <li>Route case to Tier-2 investigative queue for enhanced counterparty due diligence.</li>
        <li>Request commercial invoicing and business purpose rationale for intermediate transfers.</li>
      </ul>`;
  } else {
    actionNarrative = `
      <h6>Surveillance Status:</h6>
      <p>Log run in surveillance audit register. Maintain routine continuous monitoring; no immediate account intervention required.</p>`;
  }

  box.innerHTML = `
    <h3>
      <span>Executive Synthesis &amp; Natural Language Verdict</span>
      <span class="verdict-tag-${highestPriority.toLowerCase()}">${highestPriority}</span>
    </h3>
    <div class="verdict-section">
      <h5>Network Flow Summary</h5>
      <p>Across the complete simulation sequence, <strong>${accountsCount} accounts</strong> executed <strong>${txCount} transfers</strong> representing a cumulative money flow of <strong>${money({amount: totalVol})}</strong>. The engine grouped these events into <strong>${data.cases.length} authoritative case file(s)</strong>.</p>
    </div>
    <div class="verdict-section">
      <h5>Typology &amp; Behavioral Assessment</h5>
      <p>${typologyNarrative}</p>
      ${allRules.length ? `<p style="margin-top:6px;font-size:11px;color:#52655f;"><strong>Triggered Engine Rules:</strong> ${allRules.join(' · ')}</p>` : ''}
    </div>
    <div class="verdict-section">
      <h5>Compliance Recommendation</h5>
      <div class="verdict-action-box ${actionClass}">
        ${actionNarrative}
      </div>
    </div>
  `;
}

function render(data) {
  $('position').textContent=`${data.step} / ${data.total_steps}`; $('seek').max=data.total_steps; $('seek').value=data.step;
  $('counts').textContent=`${data.graph.nodes.length} accounts · ${data.graph.edges.length} transfers`;
  $('account').textContent='Click an account for its visible totals. Graph layout may change as accounts appear.';
  $('current').textContent=data.current_transaction ? `${data.current_transaction.timestamp} · ${data.current_transaction.sender_id} → ${data.current_transaction.recipient_id} · ${money(data.current_transaction)}` : 'No transactions revealed yet.';
  $('notice').textContent=data.notice;
  $('findings-title').textContent=data.complete?'Final output':'Findings at this step';
  $('summary').textContent=`${data.cases.length} case group(s) from ${data.step} transactions. ${data.graph_summary.graph_analysis_incomplete?'Graph search is incomplete; some patterns may be missed.':'Bounded graph search completed.'} ${data.cases.length?'Review the evidence below.':'No rules produced a case; this does not establish safety.'}`;
  
  explainStep(data);
  explainExecutiveVerdict(data);

  $('findings').replaceChildren();
  for (const c of data.cases) {
    const card=el('article',undefined,'finding');card.append(el('h3',`${c.priority} · ${(c.rule_codes || []).join(', ')}`),el('p',c.summary));
    const details=el('details');details.append(el('summary',`${c.evidence.length} evidence item(s)`));
    for(const e of c.evidence){details.append(el('h3',`${e.rule_id} · ${e.kind}`),el('p',e.description),el('pre',JSON.stringify({observed:e.observed,transaction_ids:e.transaction_ids,caveats:e.caveats},null,2)));}
    card.append(details);
    const coverage=el('details');coverage.append(el('summary','Coverage and limitations'));
    for(const limitation of c.limitations || [])coverage.append(el('p',limitation));
    coverage.append(el('pre',JSON.stringify({counts:c.counts,truncation:c.truncation},null,2)));
    if(Object.values(c.truncation || {}).some(Boolean))card.append(el('p','Case evidence is truncated. Inspect coverage counts before interpreting this result.'));
    card.append(coverage);$('findings').append(card);
  }
  $('ledger').replaceChildren();data.graph.edges.forEach((t,i)=>{const row=el('tr');for(const value of [i+1,t.timestamp,t.sender_id,t.recipient_id,money(t)])row.append(el('td',value));$('ledger').append(row);});drawGraph(data);
}
async function go(step) {
  if (!source) return;
  controller?.abort(); controller=new AbortController();const version=++generation;
  busy=true;controls();status('Analyzing the visible transactions…');
  const requestController=controller;
  const timeout=setTimeout(()=>requestController.abort(new Error('Analysis timed out after 30 seconds')),30000);
  try {
    const data=await api('/api/simulate/step',{...source,step},controller.signal);
    if(version!==generation)return;
    result=data;render(data);busy=false;
    if(data.complete)pause();
    status(data.complete?'Replay complete. Final findings are ready to inspect or download.':`Step ${data.step}: analysis updated.`);
    if(playing)timer=setTimeout(()=>go(result.step+1),Number($('speed').value));
  } catch(e) { if(version!==generation)return;busy=false;pause();if(e.name!=='AbortError')status(`Simulation failed: ${e.message}. Retry the step or load a scenario.`,true); }
  finally { clearTimeout(timeout); if(version===generation){busy=false;controls();} }
}
$('setup').addEventListener('submit',e=>{
  e.preventDefault();pause();
  try {
    const chosen=$('scenario').value;
    const candidate={overrides:{amount_scale:Number($('amount').value),gap_scale:Number($('gap').value)},...(chosen==='custom'?{spec:JSON.parse($('spec').value)}:{scenario_id:chosen})};
    source=candidate;result=null;$('position').textContent='0 / 0';$('seek').max=0;$('seek').value=0;$('counts').textContent='Loading';$('current').textContent='Waiting for analysis';$('findings').replaceChildren();$('summary').textContent='Loading a new simulation…';$('graph').replaceChildren();$('ledger').replaceChildren();go(0);
  }catch(error){status(`Invalid custom JSON: ${error.message}`,true);}
});
for(const [id,target] of [['reset',()=>0],['back',()=>result.step-1],['next',()=>result.step+1],['finish',()=>result.total_steps]])$(id).addEventListener('click',()=>{pause();go(target());});
$('seek').addEventListener('change',()=>{pause();go(Number($('seek').value));});
$('play').addEventListener('click',()=>{if(playing){pause();return;}playing=true;go(result.step+1);});
$('speed').addEventListener('change',()=>{if(playing){clearTimeout(timer);if(!busy)timer=setTimeout(()=>go(result.step+1),Number($('speed').value));}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
window.addEventListener('pagehide',()=>{pause();controller?.abort();});
$('download').addEventListener('click',()=>{if(!result?.complete)return;const blob=new Blob([JSON.stringify({source,result},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='traceguard-simulation-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
try {
  const data=await api('/api/scenarios');
  $('scenario').replaceChildren();
  for(const s of data.scenarios){const o=el('option',s.title||s.id);o.value=s.id;$('scenario').append(o);}
  const custom=el('option','Custom pattern');custom.value='custom';$('scenario').append(custom);
  status('Choose a scenario, then load the simulation.');

  const urlParams = new URLSearchParams(window.location.search);
  const targetScenario = urlParams.get('scenario');
  if (targetScenario) {
    let matched = false;
    for (const opt of $('scenario').options) {
      if (opt.value === targetScenario || opt.value.toLowerCase() === targetScenario.toLowerCase()) {
        $('scenario').value = opt.value;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Check if it's a known scenario prefix
      const found = data.scenarios.find(s => targetScenario.startsWith(s.id) || s.id.startsWith(targetScenario));
      if (found) {
        $('scenario').value = found.id;
        matched = true;
      } else {
        const opt = el('option', `Audit run: ${targetScenario}`);
        opt.value = targetScenario;
        $('scenario').prepend(opt);
        $('scenario').value = targetScenario;
      }
    }
    status(`Loaded scenario '${$('scenario').value}' directly from provenance audit.`);
    if (typeof $('setup').requestSubmit === 'function') {
      $('setup').requestSubmit();
    } else {
      $('setup').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  }
}catch(e){status(`Could not load scenarios: ${e.message}. Reload this page to retry.`,true);$('load').disabled=true;}
