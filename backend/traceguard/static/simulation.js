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
  for (const [id, color] of [['normal', '#398e83'], ['latest', '#c66b16']]) {
    const marker = svg('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(svg('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: color }));
    defs.append(marker);
  }
  g.append(defs);

  const nodes = data.graph.nodes, edges = data.graph.edges;
  if (!nodes.length) {
    g.append(svg('text', { x: 450, y: 270, 'text-anchor': 'middle', 'font-family': 'ui-sans-serif, system-ui, sans-serif', 'font-size': '13px', fill: '#64748b' }, 'Select a scenario and click Next or Play to reveal the transaction graph.'));
    return;
  }

  const currentTx = data.current_transaction;
  const nodeCount = nodes.length;
  // Compute adaptive layout radius for optimal spacing and zero edge clipping
  const rx = nodeCount <= 3 ? 270 : nodeCount <= 6 ? 310 : 340;
  const ry = nodeCount <= 3 ? 150 : nodeCount <= 6 ? 175 : 195;
  const r = 24;

  const positions = new Map(nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodeCount - Math.PI / 2;
    return [n.id, {
      x: 450 + rx * Math.cos(angle),
      y: 270 + ry * Math.sin(angle),
      angle,
      label: `A${i + 1}`,
      id: n.id
    }];
  }));

  const groups = new Map();
  for (const t of edges) {
    const key = [t.sender_id, t.recipient_id].sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  // Draw Edges with mathematically exact perimeter bounds
  for (const t of edges) {
    const a = positions.get(t.sender_id);
    const b = positions.get(t.recipient_id);
    if (!a || !b) continue;

    const rows = groups.get([t.sender_id, t.recipient_id].sort().join('|')) || [t];
    const offset = (rows.indexOf(t) - (rows.length - 1) / 2) * 22;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const cx = (a.x + b.x) / 2 - (dy / len) * offset;
    const cy = (a.y + b.y) / 2 + (dx / len) * offset;

    const isLatest = currentTx && t.transaction_id === currentTx.transaction_id;
    const isSupporting = t.supporting_rules && t.supporting_rules.length > 0;
    const isHighlighted = isLatest || isSupporting;

    const startX = a.x + (dx / len) * (r + 2);
    const startY = a.y + (dy / len) * (r + 2);
    const endX = b.x - (dx / len) * (r + 8);
    const endY = b.y - (dy / len) * (r + 8);

    const path = svg('path', {
      d: `M ${startX} ${startY} Q ${cx} ${cy} ${endX} ${endY}`,
      fill: 'none',
      stroke: isHighlighted ? '#c66b16' : '#398e83',
      'stroke-width': isLatest ? 3 : 1.8,
      'stroke-dasharray': isSupporting ? '6 4' : 'none',
      'marker-end': `url(#${isHighlighted ? 'latest' : 'normal'})`
    });

    const ruleInfo = isSupporting ? t.supporting_rules.join(', ') : 'nominal transfer';
    path.append(svg('title', {}, `${t.transaction_id}: ${t.sender_id} -> ${t.recipient_id}; Amount: ${money(t)}; Status: ${ruleInfo}`));
    g.append(path);

    if (edges.length <= 24) {
      const labelX = (a.x + 2 * cx + b.x) / 4;
      const labelY = (a.y + 2 * cy + b.y) / 4 - 5;
      const edgeTxt = svg('text', {
        x: labelX,
        y: labelY,
        'text-anchor': 'middle',
        class: 'edge-label',
        'font-family': 'ui-monospace, Menlo, Consolas, monospace',
        'font-size': '11px',
        'font-weight': '600',
        fill: isLatest ? '#9a3412' : '#1e293b'
      }, money(t));
      g.append(edgeTxt);
    }
  }

  // Draw Nodes with exterior radial labels that NEVER overlap arrows
  for (const n of nodes) {
    const p = positions.get(n.id);
    const isSender = currentTx && n.id === currentTx.sender_id;
    const isRecipient = currentTx && n.id === currentTx.recipient_id;
    const isActive = isSender || isRecipient;

    const group = svg('g', {
      tabindex: 0,
      role: 'button',
      'aria-label': `Inspect account ${n.id}`
    });

    // Outer glow ring for active transaction participants
    if (isActive) {
      group.append(svg('circle', {
        cx: p.x,
        cy: p.y,
        r: r + 5,
        fill: 'none',
        stroke: isSender ? '#c66b16' : '#087f72',
        'stroke-width': 2.5,
        'stroke-dasharray': isSender ? '4 3' : 'none',
        opacity: 0.9
      }));
    }

    // Main Node Circle
    group.append(svg('circle', {
      cx: p.x,
      cy: p.y,
      r,
      fill: '#ffffff',
      stroke: isActive ? (isSender ? '#c66b16' : '#087f72') : '#1e293b',
      'stroke-width': isActive ? 2.5 : 2
    }));

    // Center Node Abbreviation (A1, A2...)
    group.append(svg('text', {
      x: p.x,
      y: p.y + 4.5,
      'text-anchor': 'middle',
      'font-family': 'ui-monospace, Menlo, Consolas, monospace',
      'font-size': '12px',
      'font-weight': '700',
      fill: '#0f172a'
    }, p.label));

    // Calculate exterior label position radially away from graph center
    const cosA = Math.cos(p.angle);
    const sinA = Math.sin(p.angle);
    let lx = p.x;
    let ly = p.y;
    let anchor = 'middle';

    if (sinA < -0.3) {
      // Top hemisphere: place label cleanly above circle
      ly = p.y - r - 8;
      anchor = 'middle';
    } else if (sinA > 0.3) {
      // Bottom hemisphere: place label cleanly below circle
      ly = p.y + r + 16;
      anchor = 'middle';
    } else if (cosA < 0) {
      // Left side: place label to the left
      lx = p.x - r - 10;
      ly = p.y + 4;
      anchor = 'end';
    } else {
      // Right side: place label to the right
      lx = p.x + r + 10;
      ly = p.y + 4;
      anchor = 'start';
    }

    const displayId = n.id.length > 20 ? `${n.id.slice(0, 10)}...${n.id.slice(-6)}` : n.id;
    const labelText = svg('text', {
      x: lx,
      y: ly,
      'text-anchor': anchor,
      'font-family': 'ui-monospace, Menlo, Consolas, monospace',
      'font-size': '11px',
      'font-weight': '600',
      fill: isActive ? '#0f172a' : '#475569',
      'paint-order': 'stroke fill',
      stroke: '#f7faf8',
      'stroke-width': '4px',
      'stroke-linejoin': 'round',
      'pointer-events': 'none'
    }, displayId);

    group.append(labelText);
    group.append(svg('title', {}, n.id));

    const inspect = () => {
      const incoming = edges.filter(t => t.recipient_id === n.id);
      const outgoing = edges.filter(t => t.sender_id === n.id);
      $('account').textContent = `${n.id} · ${incoming.length} incoming / ${outgoing.length} outgoing transfers · received ${incoming.reduce((s, t) => s + t.amount, 0).toLocaleString()} / sent ${outgoing.reduce((s, t) => s + t.amount, 0).toLocaleString()} units. Observed network flows only, not ledger balances.`;
    };

    group.addEventListener('click', inspect);
    group.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        inspect();
      }
    });

    g.append(group);
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function explainStep(data) {
  const box = $('step-explanation');
  if (!box) return;

  if (!data.current_transaction || data.step === 0) {
    box.innerHTML = `
      <div class="step-card-idle">
        <div class="step-idle-text">
          <h4 class="step-idle-title">SIMULATION INITIALIZED</h4>
          <p class="step-idle-sub">Advance the transaction step or click Play to inspect the opening transfer vector.</p>
        </div>
      </div>
    `;
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

  let flowBadge = '';
  let flowText = '';
  if (isConduit) {
    flowBadge = '<span class="flow-pill conduit">CONDUIT PASS-THROUGH</span>';
    flowText = `Account <code class="mono-tag">${escapeHtml(tx.sender_id)}</code> previously received upstream deposits and is now actively channeling capital downstream.`;
  } else if (senderOut === 1 && recipIn === 1) {
    flowBadge = '<span class="flow-pill origin">PRIMARY OUTBOUND HOP</span>';
    flowText = `Originator <code class="mono-tag">${escapeHtml(tx.sender_id)}</code> opened a new outbound transfer to counterparty <code class="mono-tag">${escapeHtml(tx.recipient_id)}</code>.`;
  } else {
    flowBadge = '<span class="flow-pill aggregate">AGGREGATION COUNTERPARTY</span>';
    flowText = `Recipient <code class="mono-tag">${escapeHtml(tx.recipient_id)}</code> has accumulated <strong>${recipIn}</strong> incoming transfer(s) across this sequence.`;
  }

  let alertBlock = '';
  if (hasAlert) {
    const rules = [...new Set(matchingEvidence.map(e => e.rule_id))].join(', ');
    alertBlock = `
      <div class="step-alert-card alert-triggered">
        <div class="step-alert-top">
          <span class="step-alert-badge">THRESHOLD ALERT</span>
          <span class="alert-rule-tag">${escapeHtml(rules)}</span>
        </div>
        <p class="step-alert-msg">Behavioral signature triggered screening rule <code>${escapeHtml(rules)}</code> on this transfer.</p>
      </div>`;
  } else {
    alertBlock = `
      <div class="step-alert-card alert-nominal">
        <div class="step-alert-top">
          <span class="step-alert-badge">NOMINAL BASELINE</span>
          <span class="nominal-tag">Baseline Compliant</span>
        </div>
        <p class="step-alert-msg">Transfer velocity and transaction volume remain within expected screening boundaries.</p>
      </div>`;
  }

  const formattedTime = tx.timestamp ? tx.timestamp.replace('T', ' ').replace('Z', ' UTC') : '—';

  box.innerHTML = `
    <div class="step-card-header">
      <div class="step-badge-wrap">
        <span class="step-counter-chip">Step ${data.step} of ${data.total_steps}</span>
        <span class="tx-id-badge mono" title="Observed Transaction ID">ID: ${escapeHtml(tx.transaction_id)}</span>
      </div>
      <span class="step-time-mono">${escapeHtml(formattedTime)}</span>
    </div>

    <div class="tx-metric-strip">
      <div class="tx-metric-cell">
        <span class="cell-label">TRANSFER AMOUNT</span>
        <span class="cell-val amount-val">${money(tx)}</span>
      </div>
      <div class="tx-metric-cell">
        <span class="cell-label">ORIGIN (SENDER)</span>
        <span class="cell-val mono">${escapeHtml(tx.sender_id)}</span>
      </div>
      <div class="tx-metric-cell">
        <span class="cell-label">TARGET (RECIPIENT)</span>
        <span class="cell-val mono">${escapeHtml(tx.recipient_id)}</span>
      </div>
    </div>

    <div class="step-behavior-card">
      <div class="behavior-header">${flowBadge}</div>
      <p class="behavior-desc">${flowText}</p>
    </div>

    ${alertBlock}
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
    badge.textContent = highestPriority === 'HIGH' ? 'HIGH RISK CASE' : highestPriority === 'MEDIUM' ? 'MEDIUM RISK' : highestPriority === 'CLEAN' ? 'NOMINAL' : highestPriority;
    badge.className = `pill verdict-tag-${highestPriority.toLowerCase()}`;
  }

  // Structured Forensic Theory according to financial criminology standards
  let theoryTitle = '';
  let theoryMechanism = '';
  let theoryBehavior = '';
  let theorySignatures = '';

  if (allRules.includes('R1_RAPID_PASS_THROUGH')) {
    theoryTitle = 'Conduit Mule Account Layering (Rapid Pass-Through)';
    theoryMechanism = 'Pass-through laundering relies on velocity to defeat account freezing. Illicit proceeds are funneled through intermediary retail accounts that immediately disburse the capital onward to downstream destinations within minutes.';
    theoryBehavior = 'By maintaining near-zero residual balance, the mule account evades standing balance thresholds and minimizes exposure to post-transaction clawbacks before inter-bank fraud alerts propagate across the payment clearing network.';
    theorySignatures = 'Inflow-to-outflow ratio exceeding 75%, transit dwell time under 1 hour, near-zero retained balance, and lack of reciprocal commercial interaction.';
  } else if (allRules.includes('R2A_FAN_IN_CLUSTER') || allRules.includes('R2B_FAN_OUT_DISPERSAL')) {
    theoryTitle = 'Dispersal & Smurfing Network (Fan-In Aggregation / Fan-Out Smurfing)';
    theoryMechanism = 'Smurfing networks fragment high-value capital into multiple smaller sub-threshold transfers across independent counterparty nodes to circumvent mandatory currency transaction reporting triggers.';
    theoryBehavior = 'Disparate mule senders funnel micro-deposits into a central collection node (fan-in), which subsequently splinters the accumulated liquidity across multiple downstream recipients (fan-out) in rapid succession.';
    theorySignatures = 'High counterparty breadth with multiple independent senders converging on one target within a compressed temporal window, followed by outbound dispersal.';
  } else if (allRules.includes('R3_ROUND_AMOUNT_STRUCTURING')) {
    theoryTitle = 'Regulatory Structuring & Threshold Evasion';
    theoryMechanism = 'Financial institutions enforce automated filing ceilings for high-value transactions. Structuring represents the deliberate fragmentation of capital into repetitive round figures just below regulatory reporting boundaries.';
    theoryBehavior = 'Transactions are paced to mimic ordinary retail transfers while systematically evading anti-money laundering monitoring thresholds.';
    theorySignatures = 'Clusters of rounded transaction values positioned just below compliance filing limits occurring in close temporal proximity.';
  } else if (allRules.includes('R4_DIRECTED_CYCLE')) {
    theoryTitle = 'Circular Capital Routing (Round-Tripping)';
    theoryMechanism = 'Round-tripping creates fabricated commercial turnover to legitimize capital or artificially inflate business volume without genuine economic substance.';
    theoryBehavior = 'Capital traverses multiple hops across affiliated intermediary shell entities and returns to the originating entity, generating fictitious invoices and audit documentation while preserving total originator control.';
    theorySignatures = 'Closed directed loop where capital leaves entity A, traverses intermediate nodes B and C, and returns to A with minimal capital retention.';
  } else if (data.cases.length === 0) {
    theoryTitle = 'Nominal Commercial Transaction Distribution';
    theoryMechanism = 'Legitimate commercial and peer-to-peer payments display organic dwell times, reciprocal bilateral relationships, and normal variance corresponding to commercial business hours.';
    theoryBehavior = 'Accounts maintain proportional retained balances reflecting real economic substance rather than serving as pass-through transit conduits.';
    theorySignatures = 'Transfer velocity, transaction amounts, and counterparty ratios align with standard operational baselines without triggering risk heuristics.';
  } else {
    theoryTitle = 'Heuristic Baseline Deviation';
    theoryMechanism = 'Observed flows deviate from baseline transactional velocities established for the peer group.';
    theoryBehavior = 'Heuristic indicators suggest irregular transaction timing or unusual counterparty clustering requiring enhanced context verification.';
    theorySignatures = 'Statistical outliers in transaction frequency or volume relative to observed historical baselines.';
  }

  let actionItems = [];
  let actionHeader = '';
  let actionClass = '';

  if (highestPriority === 'HIGH') {
    actionClass = 'high';
    actionHeader = 'Mandatory Compliance Directives (FIU / SAR Protocol)';
    actionItems = [
      '<strong>Expedited Disposition:</strong> Escalate case file immediately to Senior Compliance Officer for formal sign-off.',
      '<strong>Regulatory Filing:</strong> Prepare and submit Suspicious Transaction Report (STR/SAR) to statutory FIU within 24 hours.',
      '<strong>Risk Containment:</strong> Institute immediate provisional debit freeze on primary intermediary account nodes.',
      '<strong>Source of Funds Validation:</strong> Demand documentary verification of underlying contracts, invoices, and commercial purpose.'
    ];
  } else if (highestPriority === 'MEDIUM') {
    actionClass = 'medium';
    actionHeader = 'Investigative Surveillance Protocol';
    actionItems = [
      '<strong>Enhanced Due Diligence (EDD):</strong> Route case to Tier-2 investigative queue for corporate registry and KYC verification.',
      '<strong>Transaction Invoicing:</strong> Request commercial contracts and justification for short-interval intermediate remittances.',
      '<strong>Watchlist Surveillance:</strong> Add participating counterparty entities to 30-day accelerated velocity monitoring.'
    ];
  } else {
    actionClass = 'low';
    actionHeader = 'Surveillance & Audit Protocol';
    actionItems = [
      '<strong>Audit Ledger Logging:</strong> Record simulation execution in the compliance audit register.',
      '<strong>Continuous Baseline Monitoring:</strong> Maintain standard real-time heuristic monitoring; no immediate account intervention required.'
    ];
  }

  const priorityBadgeHtml = highestPriority === 'HIGH' ? '<span class="verdict-tag-high">HIGH PRIORITY</span>'
    : highestPriority === 'MEDIUM' ? '<span class="verdict-tag-medium">MEDIUM PRIORITY</span>'
    : highestPriority === 'LOW' ? '<span class="verdict-tag-low">LOW PRIORITY</span>'
    : highestPriority === 'CLEAN' ? '<span class="verdict-tag-clean">NOMINAL</span>'
    : `<span class="verdict-tag-low">${escapeHtml(highestPriority)}</span>`;

  box.innerHTML = `
    <div class="verdict-top-banner">
      <div class="verdict-title-box">
        <div>
          <h3 class="verdict-heading">Executive Forensic Synthesis &amp; Disposition</h3>
          <p class="verdict-sub">Multi-hop graph network synthesis and regulatory analysis</p>
        </div>
      </div>
      <div>${priorityBadgeHtml}</div>
    </div>

    <!-- 4-Stat Bento Matrix -->
    <div class="verdict-bento-grid">
      <div class="bento-stat-card">
        <span class="bento-label">ACCOUNTS</span>
        <span class="bento-num">${accountsCount}</span>
        <span class="bento-desc">Inspected nodes</span>
      </div>
      <div class="bento-stat-card">
        <span class="bento-label">TRANSFERS</span>
        <span class="bento-num">${txCount}</span>
        <span class="bento-desc">Observed hops</span>
      </div>
      <div class="bento-stat-card">
        <span class="bento-label">TOTAL FLOW</span>
        <span class="bento-num">${money({ amount: totalVol })}</span>
        <span class="bento-desc">Cumulative volume</span>
      </div>
      <div class="bento-stat-card">
        <span class="bento-label">CASE FILES</span>
        <span class="bento-num">${data.cases.length}</span>
        <span class="bento-desc">Grouped dossiers</span>
      </div>
    </div>

    <!-- Forensic Mechanism Theory Card -->
    <div class="verdict-theory-card">
      <div class="theory-card-header">
        <span class="theory-tag">FORENSIC MECHANISM THEORY</span>
        <h4 class="theory-title">${escapeHtml(theoryTitle)}</h4>
      </div>
      
      <div class="theory-body">
        <div class="theory-block">
          <span class="theory-label">Mechanism Theory</span>
          <p class="theory-p">${theoryMechanism}</p>
        </div>
        <div class="theory-block">
          <span class="theory-label">Behavioral Pathology</span>
          <p class="theory-p">${theoryBehavior}</p>
        </div>
        <div class="theory-block">
          <span class="theory-label">Diagnostic Signatures</span>
          <p class="theory-p">${theorySignatures}</p>
        </div>
      </div>

      ${allRules.length ? `
        <div class="rules-chips-row">
          <span class="rules-chips-label">Triggered Rules:</span>
          ${allRules.map(r => `<span class="rule-chip-pill">${escapeHtml(r)}</span>`).join('')}
        </div>` : ''}
    </div>

    <!-- Compliance Directives Card -->
    <div class="verdict-action-card ${actionClass}">
      <div class="action-card-header">${actionHeader}</div>
      <ul class="action-card-list">
        ${actionItems.map(item => `<li>${item}</li>`).join('')}
      </ul>
    </div>

    <div class="verdict-disclaimer-pill">
      <strong>Decision-Support Disclosure:</strong> Heuristic groupings establish investigative leads for qualified compliance personnel; they do not constitute autonomous legal determinations.
    </div>
  `;
}

function render(data) {
  $('position').textContent = `${data.step} / ${data.total_steps}`;
  $('seek').max = data.total_steps;
  $('seek').value = data.step;
  $('counts').textContent = `${data.graph.nodes.length} accounts · ${data.graph.edges.length} transfers`;
  $('account').textContent = 'Click an account node for visible flow totals. Graph layout adapts dynamically as transfers develop.';
  $('current').textContent = data.current_transaction ? `${data.current_transaction.timestamp} · ${data.current_transaction.sender_id} -> ${data.current_transaction.recipient_id} · ${money(data.current_transaction)}` : 'No transactions revealed yet.';
  $('notice').textContent = data.notice;
  $('findings-title').textContent = data.complete ? 'Final Synthesis' : 'Findings at this step';
  $('summary').textContent = `${data.cases.length} case group(s) from ${data.step} transactions. ${data.graph_summary.graph_analysis_incomplete ? 'Graph search is incomplete; bounded expansion limit reached.' : 'Bounded graph analysis completed.'} ${data.cases.length ? 'Review the structured evidence below.' : 'No rules produced a case; absence of evidence does not establish safety.'}`;
  
  explainStep(data);
  explainExecutiveVerdict(data);

  $('findings').replaceChildren();
  for (const c of data.cases) {
    const card = el('article', undefined, 'finding');
    card.append(el('h3', `${c.priority} · ${(c.rule_codes || []).join(', ')}`), el('p', c.summary));
    const details = el('details');
    details.append(el('summary', `${c.evidence.length} evidence item(s)`));
    for (const e of c.evidence) {
      details.append(el('h3', `${e.rule_id} · ${e.kind}`), el('p', e.description), el('pre', JSON.stringify({ observed: e.observed, transaction_ids: e.transaction_ids, caveats: e.caveats }, null, 2)));
    }
    card.append(details);
    const coverage = el('details');
    coverage.append(el('summary', 'Coverage and limitations'));
    for (const limitation of c.limitations || []) coverage.append(el('p', limitation));
    coverage.append(el('pre', JSON.stringify({ counts: c.counts, truncation: c.truncation }, null, 2)));
    if (Object.values(c.truncation || {}).some(Boolean)) card.append(el('p', 'Case evidence is truncated. Inspect coverage counts before interpreting this result.'));
    card.append(coverage);
    $('findings').append(card);
  }

  $('ledger').replaceChildren();
  data.graph.edges.forEach((t, i) => {
    const row = el('tr');
    for (const value of [i + 1, t.timestamp, t.sender_id, t.recipient_id, money(t)]) row.append(el('td', value));
    $('ledger').append(row);
  });

  drawGraph(data);
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
