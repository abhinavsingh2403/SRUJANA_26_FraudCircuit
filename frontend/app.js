/* TraceGuard investigation workbench.
   All user-facing text is written with textContent; no untrusted payload is injected as unescaped HTML. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    scenarios: [],
    cases: [],
    selectedId: null,
    selectedCaseData: null,
    queueRequest: 0,
    detailRequest: 0,
    total: 0,
    offset: 0,
    pageSize: 100,
    latestRunId: null,
    viewMode: 'all',
    filterPriority: 'All',
    filterStatus: 'All',
    searchQuery: '',
    hoverTimer: 0,
    hoverIndex: -1,
    hoverCaseData: null,
  };

  const PRIORITIES = ['All', 'HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_HISTORY'];
  const STATUSES = ['All', 'OPEN', 'INVESTIGATING', 'ESCALATED', 'CLOSED'];
  let toastTimer = null;

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function node(tag, className = '', text = null) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== null && text !== undefined) el.textContent = String(text);
    return el;
  }

  function inr(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n ?? '—');
    return '₹' + Math.round(num).toLocaleString('en-IN');
  }

  function fmtAmount(value, currency = null) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '—');
    return `${currency ? `${currency} ` : '₹'}${number.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  function lab(x) {
    if (!x) return 'UNKNOWN';
    return x === 'INSUFFICIENT_HISTORY' ? 'INSUFFICIENT HISTORY' : x;
  }

  function badge(text, extra = '') {
    const safe = String(text || 'UNKNOWN');
    const span = node('span', `b ${safe}${extra ? ` ${extra}` : ''}`, lab(safe));
    return span;
  }

  function showToast(message, error = false) {
    const box = $('toast');
    box.textContent = message;
    box.className = `toast${error ? ' error' : ''}`;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
  }

  const API_BASE = (window.location.protocol === 'file:' || (window.location.port !== '8000' && window.location.port !== '5173' && window.location.port !== ''))
    ? 'http://127.0.0.1:8000'
    : '';

  async function api(path, options = {}) {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(120000),
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const detail = typeof body === 'object' && body ? body.detail : body;
      const message = typeof detail === 'string' ? detail : JSON.stringify(detail || `HTTP ${response.status}`);
      throw new Error(`${response.status}: ${message}`);
    }
    return body;
  }

  function setConnection(ok, message) {
    const statusText = $('connection-status');
    statusText.textContent = message;
    const dot = statusText.previousElementSibling;
    if (dot) dot.classList.toggle('ok', ok);
  }

  function selectedQuery() {
    const params = new URLSearchParams();
    if (state.filterPriority && state.filterPriority !== 'All') {
      params.set('priority', state.filterPriority);
    }
    if (state.filterStatus && state.filterStatus !== 'All') {
      params.set('status', state.filterStatus);
    }
    if (state.viewMode === 'run' && state.latestRunId) {
      params.set('run_id', state.latestRunId);
    }
    params.set('limit', String(state.pageSize));
    params.set('offset', String(state.offset));
    return params.toString();
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '—';
    try {
      const time = new Date(dateStr).getTime();
      if (Number.isNaN(time)) return String(dateStr);
      const diffMs = Date.now() - time;
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins} min ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours} h ago`;
      const days = Math.floor(hours / 24);
      return `${days} d ago`;
    } catch {
      return String(dateStr);
    }
  }

  function calculateAmountSpan(caseItem) {
    const all = [...(caseItem.trigger_transactions || []), ...(caseItem.context_transactions || [])];
    if (!all.length) return '—';
    const amounts = all.map(t => Number(t.amount)).filter(Number.isFinite);
    if (!amounts.length) return '—';
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    if (min === max) return inr(min);
    return `${inr(min)} – ${inr(max)}`;
  }

  function allCaseTransactions(caseData) {
    const map = new Map();
    for (const tx of [...(caseData.context_transactions || []), ...(caseData.trigger_transactions || [])]) {
      if (tx && tx.transaction_id) map.set(tx.transaction_id, tx);
    }
    return [...map.values()].sort((a, b) =>
      String(a.timestamp).localeCompare(String(b.timestamp)) ||
      String(a.transaction_id).localeCompare(String(b.transaction_id))
    );
  }

  /* Dynamic Topological / Flow Layering for Any Case */
  function buildGraphLayout(caseData) {
    const transactions = allCaseTransactions(caseData);
    const accountIds = [...new Set(transactions.flatMap(tx => [tx.sender_id, tx.recipient_id]).filter(Boolean))];
    if (!accountIds.length) {
      return { L: [], E: [] };
    }

    const inDegree = {};
    const outDegree = {};
    const adj = {};
    accountIds.forEach(id => {
      inDegree[id] = 0;
      outDegree[id] = 0;
      adj[id] = new Set();
    });

    const displayTx = transactions.slice(0, 60);
    displayTx.forEach(tx => {
      if (inDegree[tx.recipient_id] !== undefined) inDegree[tx.recipient_id]++;
      if (outDegree[tx.sender_id] !== undefined) outDegree[tx.sender_id]++;
      if (adj[tx.sender_id]) adj[tx.sender_id].add(tx.recipient_id);
    });

    const layerMap = {};
    const visited = new Set();
    const queue = [];

    const sources = accountIds.filter(id => inDegree[id] === 0);
    if (sources.length > 0) {
      sources.forEach(id => {
        layerMap[id] = 0;
        queue.push(id);
        visited.add(id);
      });
    } else {
      layerMap[accountIds[0]] = 0;
      queue.push(accountIds[0]);
      visited.add(accountIds[0]);
    }

    while (queue.length > 0) {
      const curr = queue.shift();
      const currLayer = layerMap[curr] || 0;
      for (const nxt of (adj[curr] || [])) {
        if (layerMap[nxt] === undefined || layerMap[nxt] < currLayer + 1) {
          layerMap[nxt] = Math.min(currLayer + 1, 4);
          if (!visited.has(nxt)) {
            visited.add(nxt);
            queue.push(nxt);
          }
        }
      }
    }

    accountIds.forEach(id => {
      if (layerMap[id] === undefined) {
        layerMap[id] = outDegree[id] === 0 ? 2 : 1;
      }
    });

    const maxLayer = Math.max(0, ...Object.values(layerMap));
    const L = [];
    for (let l = 0; l <= maxLayer; l++) {
      const col = accountIds.filter(id => layerMap[id] === l);
      if (col.length > 0) L.push(col);
    }
    if (L.length === 0) L.push(accountIds);

    const triggerSet = new Set(caseData.transaction_ids || []);
    const E = displayTx.map(tx => [
      tx.sender_id,
      tx.recipient_id,
      Number(tx.amount) || 0,
      triggerSet.has(tx.transaction_id) ? 1 : 0,
      tx.transaction_id,
      tx.timestamp,
    ]);

    return { L, E };
  }

  function drawGraph(g, svg, sm = false, caseData = null) {
    if (!g || !g.L || !g.L.length) {
      svg.innerHTML = '<text x="500" y="260" text-anchor="middle" font-size="14" fill="#58584d">No connected graph data</text>';
      return;
    }
    const R = sm ? 22 : 30;
    const pos = {};
    const nl = g.L.length;

    g.L.forEach((col, ci) => {
      const x = nl === 1 ? 500 : 130 + ci * (740 / (nl - 1));
      const gap = Math.min(sm ? 70 : 110, (sm ? 280 : 380) / Math.max(1, col.length));
      col.forEach((n, i) => {
        pos[n] = { x: x, y: 260 + (i - (col.length - 1) / 2) * gap };
      });
    });

    const max = Math.max(1, ...g.E.map(e => e[2]));
    const grp = {};
    g.E.forEach(e => {
      const k = e[0] + '>' + e[1];
      (grp[k] = grp[k] || []).push(e);
    });

    let base = '', top = '', lab = '';
    Object.keys(grp).forEach(k => {
      const list = grp[k];
      list.forEach((e, i) => {
        const a = pos[e[0]], b = pos[e[1]];
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len, uy = dy / len;
        const nx = -uy, ny = ux;
        const off = (i - (list.length - 1) / 2) * (list.length > 2 ? (sm ? 16 : 24) : (sm ? 20 : 28));
        const w = Math.max(2, 2.5 + (sm ? 4 : 7) * (e[2] / max));
        const hl = sm ? 10 + w * 1.5 : 14 + w * 2.2;
        const hw = sm ? w * 1.2 + 3 : w * 1.5 + 4;
        const sx = a.x + ux * R + nx * off;
        const sy = a.y + uy * R + ny * off;
        const ex = b.x - ux * R + nx * off;
        const ey = b.y - uy * R + ny * off;
        const bx = ex - ux * hl;
        const by = ey - uy * hl;
        const isTrigger = e[3] === 1;
        const col = isTrigger ? '#111' : '#b8b8b0';
        const titleText = `${e[4] || 'tx'}: ${e[0]} → ${e[1]}, amount ${e[2]}, ${e[5] || ''}`;

        const el = `<line class="graph-edge" data-tx="${escapeHtml(e[4] || '')}" x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${col}" stroke-width="${w.toFixed(1)}"><title>${escapeHtml(titleText)}</title></line><polygon class="graph-edge" data-tx="${escapeHtml(e[4] || '')}" fill="${col}" points="${ex.toFixed(1)},${ey.toFixed(1)} ${(bx + nx * hw).toFixed(1)},${(by + ny * hw).toFixed(1)} ${(bx - nx * hw).toFixed(1)},${(by - ny * hw).toFixed(1)}"/>`;
        if (isTrigger) top += el; else base += el;

        const t = nl > 2 ? 0.5 : 0.55;
        const lx = sx + (bx - sx) * t;
        const ly = sy + (by - sy) * t - w / 2 - 6;
        if (!sm || isTrigger) {
          lab += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${sm ? 18 : 13}" font-weight="700" fill="#111" stroke="#fffdea" stroke-width="${sm ? 5 : 4}" paint-order="stroke">${inr(e[2])}</text>`;
        }
      });
    });

    let nodes = '';
    Object.keys(pos).forEach(n => {
      const p = pos[n];
      const displayLabel = n.length > 10 ? n.slice(0, 8) + '…' : n;
      nodes += `<circle class="graph-node" data-acct="${escapeHtml(n)}" cx="${p.x}" cy="${p.y}" r="${R}" fill="#fff" stroke="#111" stroke-width="2.5"><title>${escapeHtml(n)}</title></circle><text class="graph-node" data-acct="${escapeHtml(n)}" x="${p.x}" y="${p.y + (sm ? 4 : 5)}" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${sm ? 11 : 13}" font-weight="700" fill="#111">${escapeHtml(displayLabel)}</text>`;
    });

    svg.innerHTML = base + top + nodes + lab;
    svg.setAttribute('aria-label', `Transaction graph with ${g.E.length} transactions between ${Object.keys(pos).length} accounts`);

    if (!sm) {
      svg.onmouseover = (ev) => {
        const edge = ev.target.closest('.graph-edge');
        if (edge && edge.dataset.tx) {
          const txId = edge.dataset.tx;
          highlightTx(txId);
          const hud = $('graph-hud');
          if (hud && caseData) {
            const txs = allCaseTransactions(caseData);
            const tx = txs.find(t => t.transaction_id === txId);
            if (tx) {
              const isTrigger = (caseData.transaction_ids || []).includes(txId);
              hud.innerHTML = `
                <div class="hud-tag" style="color:${isTrigger ? 'var(--danger)' : 'var(--muted)'}">
                  ${isTrigger ? '? Trigger Transaction' : 'Supporting Context'}
                </div>
                <div class="hud-title">${escapeHtml(tx.transaction_id)}</div>
                <div class="hud-amount">${inr(tx.amount)}</div>
                <p class="hud-desc">${escapeHtml(tx.sender_id)} ? ${escapeHtml(tx.recipient_id)}<br>${escapeHtml(tx.timestamp || '')}</p>
              `;
            }
          }
          return;
        }
        const nodeEl = ev.target.closest('.graph-node');
        if (nodeEl && nodeEl.dataset.acct) {
          const acctId = nodeEl.dataset.acct;
          highlightAcct(acctId);
          const hud = $('graph-hud');
          if (hud) {
            hud.innerHTML = `
              <div class="hud-tag">Connected Account</div>
              <div class="hud-title">${escapeHtml(acctId)}</div>
              <p class="hud-desc">Account participating in case flow.<br>Hover link or timeline row for exact direction.</p>
            `;
          }
          return;
        }
      };
      svg.onmouseout = () => {
        clearHighlights();
        const hud = $('graph-hud');
        if (hud && caseData) {
          hud.innerHTML = `
            <div class="hud-tag">Topology Inspector</div>
            <div class="hud-title">${(caseData.account_ids || []).length} Accounts Connected</div>
            <p class="hud-desc">Hover a transaction link or account node to inspect details</p>
          `;
        }
      };
    }
  }

  function highlightTx(txId) {
    if (!txId) return;
    document.querySelectorAll('.graph-edge').forEach(el => {
      el.classList.toggle('highlighted-edge', el.dataset.tx === txId);
    });
    document.querySelectorAll('.tx-row').forEach(row => {
      const match = row.dataset.txId === txId;
      row.classList.toggle('highlighted-tx', match);
      if (match) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  function highlightGraphEdge(txId) {
    if (!txId) return;
    document.querySelectorAll('.graph-edge').forEach(el => {
      el.classList.toggle('highlighted-edge', el.dataset.tx === txId);
    });
  }

  function highlightAcct(acctId) {
    if (!acctId) return;
    document.querySelectorAll('.graph-node').forEach(el => {
      el.classList.toggle('highlighted-node', el.dataset.acct === acctId);
    });
    document.querySelectorAll('.tx-row').forEach(row => {
      const match = row.dataset.sender === acctId || row.dataset.recipient === acctId;
      row.classList.toggle('highlighted-tx', match);
    });
  }

  function clearHighlights() {
    document.querySelectorAll('.highlighted-edge').forEach(el => el.classList.remove('highlighted-edge'));
    document.querySelectorAll('.highlighted-node').forEach(el => el.classList.remove('highlighted-node'));
    document.querySelectorAll('.highlighted-tx').forEach(el => el.classList.remove('highlighted-tx'));
  }

  function animateCount(el, target) {
    if (!el) return;
    const start = parseInt(el.textContent.replace(/[^0-9]/g, '')) || 0;
    const end = Number(target) || 0;
    if (start === end) {
      el.textContent = String(end);
      return;
    }
    const duration = 400;
    const startTime = performance.now();
    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      el.textContent = String(Math.round(start + (end - start) * ease));
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function updateMetrics() {
    const all = state.cases;
    animateCount($('metric-all'), state.total);
    animateCount($('metric-high'), all.filter(c => c.priority === 'HIGH').length);
    animateCount($('metric-medium'), all.filter(c => c.priority === 'MEDIUM').length);
    animateCount($('metric-low'), all.filter(c => c.priority === 'LOW' || c.priority === 'INSUFFICIENT_HISTORY').length);
    $('count').textContent = state.total + (state.total === 1 ? ' case' : ' cases');
    $('queue-count').textContent = state.total;
  }

  function renderDistributionBars() {
    const all = state.cases;
    const totalCount = all.length || 1;

    // 1. Priority Bars
    const pCounts = [
      ['HIGH', all.filter(c => c.priority === 'HIGH').length],
      ['MEDIUM', all.filter(c => c.priority === 'MEDIUM').length],
      ['LOW', all.filter(c => c.priority === 'LOW').length],
      ['INSUFFICIENT', all.filter(c => c.priority === 'INSUFFICIENT_HISTORY').length],
    ];
    $('m1').innerHTML = pCounts.map(p =>
      `<div class="bar"><span style="width:96px;font-size:12px">${p[0]}</span><span class="t"><i style="--c:#111;width:${(p[1] / totalCount * 100).toFixed(1)}%"></i></span><span>${p[1]}</span></div>`
    ).join('');

    // 2. Status Bars
    const sCounts = STATUSES.slice(1).map(s => [s, all.filter(c => (c.status || 'OPEN') === s).length]);
    $('m2').innerHTML = sCounts.map(p =>
      `<div class="bar"><span style="width:96px;font-size:12px">${p[0]}</span><span class="t"><i style="--c:#111;width:${(p[1] / totalCount * 100).toFixed(1)}%"></i></span><span>${p[1]}</span></div>`
    ).join('');

    // 3. Rules Fired Bars
    const rc = {};
    all.forEach(c => {
      const rules = c.rule_codes || (c.evidence || []).map(e => e.rule_id);
      [...new Set(rules)].forEach(r => {
        if (r) rc[r] = (rc[r] || 0) + 1;
      });
    });
    const ruleKeys = Object.keys(rc);
    if (!ruleKeys.length) {
      $('m3').innerHTML = '<p class="d" style="margin:4px 0">No rules recorded in visible cases.</p>';
    } else {
      const maxRule = Math.max(1, ...Object.values(rc));
      $('m3').innerHTML = ruleKeys.map(r =>
        `<div class="bar"><span class="mono" style="flex:1;font-size:11px">${r}</span><span class="t" style="flex:0 0 70px"><i style="--c:#111;width:${(rc[r] / maxRule * 100).toFixed(1)}%"></i></span><span>${rc[r]}</span></div>`
      ).join('');
    }
  }

  function renderFilterButtons() {
    const fpBox = $('fp');
    fpBox.replaceChildren();
    PRIORITIES.forEach(v => {
      const b = node('button', '', lab(v));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.filterPriority === v));
      b.onclick = () => {
        state.filterPriority = v;
        $('priority-filter').value = v === 'All' ? '' : v;
        state.offset = 0;
        refreshCases(false);
      };
      fpBox.appendChild(b);
    });

    const fsBox = $('fs');
    fsBox.replaceChildren();
    STATUSES.forEach(v => {
      const b = node('button', '', v);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.filterStatus === v));
      b.onclick = () => {
        state.filterStatus = v;
        $('status-filter').value = v === 'All' ? '' : v;
        state.offset = 0;
        refreshCases(false);
      };
      fsBox.appendChild(b);
    });
  }

  function clearDetail(message = 'Select a case to investigate') {
    state.detailRequest += 1;
    state.selectedId = null;
    state.selectedCaseData = null;
    $('case-detail').replaceChildren();
    $('case-detail').hidden = true;
    $('detail-empty').hidden = false;
    $('detail-empty').querySelector('h2').textContent = message;

    // Reset Side Panel
    $('dt').textContent = '—';
    $('dp').textContent = '—';
    $('dp').className = 'b';
    $('dl').innerHTML = '<dt>Source</dt><dd>—</dd><dt>Txn / Acct</dt><dd>—</dd><dt>Amount span</dt><dd>—</dd><dt>Status</dt><dd>—</dd><dt>Opened</dt><dd>—</dd>';
    $('dr').innerHTML = '<span class="d">No case selected</span>';
  }

  function updateSidePanel(caseData) {
    $('dt').textContent = caseData.case_id;
    const copyBtn = $('copy-case-id');
    if (copyBtn) {
      copyBtn.style.display = 'inline-flex';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(caseData.case_id);
        showToast(`Copied ${caseData.case_id}`);
      };
    }
    const dp = $('dp');
    dp.textContent = lab(caseData.priority);
    dp.className = `b ${caseData.priority}`;

    const txCount = caseData.counts?.trigger_transactions_total ?? caseData.transaction_ids?.length ?? (caseData.trigger_transactions || []).length;
    const acctCount = caseData.counts?.account_ids_total ?? caseData.account_ids?.length ?? 0;
    const amtSpan = calculateAmountSpan(caseData);
    const source = caseData.source_scenario_id || 'CSV import';
    const status = caseData.status || 'OPEN';
    const opened = formatTimeAgo(caseData.created_at || caseData.updated_at);

    const dl = $('dl');
    dl.replaceChildren();
    const rows = [
      ['Source', source],
      ['Txn / Acct', `${txCount} / ${acctCount}`],
      ['Amount span', amtSpan],
      ['Status', status],
      ['Opened', opened],
    ];
    rows.forEach(([term, val]) => {
      dl.append(node('dt', '', term), node('dd', '', val));
    });

    const dr = $('dr');
    dr.replaceChildren();
    const rules = caseData.rule_codes || (caseData.evidence || []).map(e => e.rule_id);
    const uniqueRules = [...new Set(rules)].filter(Boolean);
    if (!uniqueRules.length) {
      dr.append(node('span', 'd', 'No rules recorded'));
    } else {
      uniqueRules.forEach(r => dr.append(node('span', 'rl', r)));
    }
  }

  function runResult(message, result = null) {
    const box = $('run-result');
    box.replaceChildren(node('p', '', message));
    box.hidden = false;
    if (!result) return;
    for (const warning of [...(result.warnings || []), ...(result.analysis_warnings || [])]) {
      box.append(node('p', 'caveat', warning));
    }
    if (result.run_id) box.append(node('p', '', `Run: ${result.run_id}`));
    if (result.cases_truncated) {
      box.append(node('p', 'caveat', `Import preview truncated: ${result.cases_returned} of ${result.case_count} cases returned.`));
    }
    if (result.notice) box.append(node('p', '', result.notice));
  }

  function renderPagination() {
    const container = $('queue-pagination');
    container.replaceChildren();
    const totalPages = Math.ceil(state.total / state.pageSize);
    const currentPage = Math.floor(state.offset / state.pageSize) + 1;
    if (totalPages <= 1) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    const prev = node('button', 'button', '← Prev');
    prev.type = 'button';
    prev.disabled = currentPage <= 1;
    prev.addEventListener('click', () => {
      state.offset = Math.max(0, state.offset - state.pageSize);
      refreshCases(false);
    });
    const info = node('span', 'pagination-info', `Page ${currentPage} of ${totalPages} (${state.total} total)`);
    const next = node('button', 'button', 'Next →');
    next.type = 'button';
    next.disabled = currentPage >= totalPages;
    next.addEventListener('click', () => {
      state.offset = state.offset + state.pageSize;
      refreshCases(false);
    });
    container.append(prev, info, next);
  }

  function renderViewToggle() {
    const container = $('view-toggle');
    container.replaceChildren();
    if (!state.latestRunId) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    const allBtn = node('button', state.viewMode === 'all' ? 'active-toggle' : '', 'All cases');
    allBtn.type = 'button';
    allBtn.addEventListener('click', () => {
      state.viewMode = 'all';
      state.offset = 0;
      refreshCases(false);
    });
    const runBtn = node('button', state.viewMode === 'run' ? 'active-toggle' : '', 'Latest run');
    runBtn.type = 'button';
    runBtn.addEventListener('click', () => {
      state.viewMode = 'run';
      state.offset = 0;
      refreshCases(false);
    });
    container.append(allBtn, runBtn);
  }

  function renderQueue() {
    const rows = $('queue-list');
    rows.replaceChildren();

    if (!state.cases.length) {
      const tr = node('tr');
      const td = node('td', 'd', 'No cases match these filters. Replay a scenario or import a CSV to begin.');
      td.colSpan = 7;
      tr.appendChild(td);
      rows.appendChild(tr);
      return;
    }

    state.cases.forEach((item, index) => {
      const isSelected = item.case_id === state.selectedId;
      const tr = node('tr', `case-row${isSelected ? ' sel active' : ''}`);
      tr.tabIndex = 0;
      tr.setAttribute('aria-pressed', String(isSelected));

      // 1. Case ID & Source
      const tdCase = node('td');
      const idDiv = node('div', 'id mono', item.case_id);
      const subDiv = node('div', 'd', item.source_scenario_id || 'CSV import');
      tdCase.append(idDiv, subDiv);

      // 2. Priority
      const tdPri = node('td');
      tdPri.append(badge(item.priority));

      // 3. Rules Fired
      const tdRules = node('td');
      const rulesWrap = node('div', 'rules');
      const ruleList = item.rule_codes || (item.evidence || []).map(e => e.rule_id);
      const uniqueRules = [...new Set(ruleList)].filter(Boolean);
      if (!uniqueRules.length) {
        rulesWrap.append(node('span', 'd', '—'));
      } else {
        uniqueRules.slice(0, 3).forEach(r => rulesWrap.append(node('span', 'rl', r)));
        if (uniqueRules.length > 3) {
          rulesWrap.append(node('span', 'rl', `+${uniqueRules.length - 3}`));
        }
      }
      tdRules.append(rulesWrap);

      // 4. Txn / Acct
      const txCount = item.counts?.trigger_transactions_total ?? item.transaction_ids?.length ?? (item.trigger_transactions || []).length;
      const acctCount = item.counts?.account_ids_total ?? item.account_ids?.length ?? 0;
      const tdCounts = node('td', 'mono', `${txCount} / ${acctCount}`);

      // 5. Amount Span
      const tdAmt = node('td', 'amt', calculateAmountSpan(item));

      // 6. Status
      const tdStatus = node('td');
      tdStatus.append(badge(item.status || 'OPEN'));

      // 7. Opened / Timestamp
      const tdOpened = node('td', 'd', formatTimeAgo(item.created_at || item.updated_at));

      tr.append(tdCase, tdPri, tdRules, tdCounts, tdAmt, tdStatus, tdOpened);

      // Click & Keyboard interactions
      tr.addEventListener('click', () => {
        hidePv();
        loadCase(item.case_id);
      });
      tr.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          hidePv();
          loadCase(item.case_id);
        }
      });

      // Hover preview interactions
      tr.addEventListener('mouseover', e => hoverMove(index, e));
      tr.addEventListener('mousemove', e => hoverMove(index, e));
      tr.addEventListener('mouseleave', hidePv);
      tr.addEventListener('focus', () => {
        if (!tr.matches(':focus-visible')) return;
        const b = tr.getBoundingClientRect();
        showPv(index, b.left + b.width / 2, b.top - 10);
      });
      tr.addEventListener('blur', hidePv);

      rows.appendChild(tr);
    });
  }

  /* Hover Preview Floating Card Functions */
  const pv = $('pv');
  const ov = $('ov');
  const canHover = window.matchMedia('(hover:hover)').matches;

  function showPv(index, x, y) {
    if (!ov.hidden) return;
    const item = state.cases[index];
    if (!item) return;

    if (pv.dataset.i !== String(index)) {
      $('pt').textContent = item.case_id;
      const p = $('pp');
      p.textContent = lab(item.priority);
      p.className = `b ${item.priority}`;
      const layout = buildGraphLayout(item);
      drawGraph(layout, $('ps'), true);
      pv.dataset.i = String(index);
    }

    pv.hidden = false;
    const w = pv.offsetWidth || 440;
    const h = pv.offsetHeight || 300;
    let px = x + 18;
    let py = y + 18;
    if (px + w > window.innerWidth - 12) px = x - w - 18;
    if (px < 12) px = 12;
    if (py + h > window.innerHeight - 12) py = window.innerHeight - h - 12;
    if (py < 12) py = 12;
    pv.style.left = px + 'px';
    pv.style.top = py + 'px';
  }

  function hoverMove(index, e) {
    if (!canHover) return;
    const hx = e.clientX, hy = e.clientY;
    if (!pv.hidden && pv.dataset.i === String(index)) {
      showPv(index, hx, hy);
      return;
    }
    if (state.hoverIndex !== index) {
      clearTimeout(state.hoverTimer);
      state.hoverIndex = index;
      state.hoverTimer = setTimeout(() => {
        showPv(index, hx, hy);
      }, 1000);
    }
  }

  function hidePv() {
    clearTimeout(state.hoverTimer);
    state.hoverTimer = 0;
    state.hoverIndex = -1;
    pv.hidden = true;
    pv.dataset.i = '';
  }
  window.addEventListener('scroll', hidePv, true);

  /* Modal Dialog Functions */
  function openModal(caseData) {
    if (!caseData) return;
    hidePv();
    $('mt').textContent = caseData.case_id;
    const p = $('mp');
    p.textContent = lab(caseData.priority);
    p.className = `b ${caseData.priority}`;
    const s = $('ms');
    s.textContent = caseData.status || 'OPEN';
    s.className = `b ${caseData.status || 'OPEN'}`;

    const layout = buildGraphLayout(caseData);
    drawGraph(layout, $('gs'), false);

    const txCount = caseData.counts?.trigger_transactions_total ?? caseData.transaction_ids?.length ?? (caseData.trigger_transactions || []).length;
    const acctCount = caseData.counts?.account_ids_total ?? caseData.account_ids?.length ?? 0;
    const rules = caseData.rule_codes || (caseData.evidence || []).map(e => e.rule_id);
    const uniqueRules = [...new Set(rules)].filter(Boolean);

    const gm = $('gm');
    gm.replaceChildren();

    const dSource = node('div');
    dSource.append(node('span', '', 'Source'), document.createTextNode(caseData.source_scenario_id || 'CSV import'));

    const dTxn = node('div');
    dTxn.append(node('span', '', 'Txn / Acct'), document.createTextNode(`${txCount} / ${acctCount}`));

    const dAmt = node('div');
    dAmt.append(node('span', '', 'Amount span'), document.createTextNode(calculateAmountSpan(caseData)));

    const dRules = node('div');
    dRules.append(node('span', '', 'Rules fired'));
    const rulesDiv = node('div', 'rules', '');
    rulesDiv.style.marginTop = '4px';
    uniqueRules.forEach(r => rulesDiv.append(node('span', 'rl', r)));
    dRules.append(rulesDiv);

    gm.append(dSource, dTxn, dAmt, dRules);

    ov.hidden = false;
    document.body.style.overflow = 'hidden';
    $('mx').focus();
  }

  function closeModal() {
    ov.hidden = true;
    document.body.style.overflow = '';
    const sel = document.querySelector('#queue-list tr.sel');
    if (sel) sel.focus();
  }

  $('mx').addEventListener('click', closeModal);
  ov.addEventListener('click', e => {
    if (e.target === ov) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hidePv();
      if (!ov.hidden) closeModal();
    }
  });

  /* Quick Actions in Side Panel */
  $('oc').addEventListener('click', () => {
    if (state.selectedCaseData) openModal(state.selectedCaseData);
    else if (state.cases.length) openModal(state.cases[0]);
  });

  $('quick-escalate').addEventListener('click', async () => {
    const cid = state.selectedId;
    if (!cid) return;
    const btn = $('quick-escalate');
    btn.disabled = true;
    try {
      await api(`/api/cases/${encodeURIComponent(cid)}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ESCALATED',
          reviewer: 'analyst',
          note: 'Escalated from quick review queue.',
        }),
      });
      showToast(`Case ${cid} marked as ESCALATED.`);
      await refreshCases(true);
    } catch (err) {
      showToast(`Escalation failed: ${err.message}`, true);
    } finally {
      btn.disabled = false;
    }
  });

  /* Deep Investigation Section Rendering */
  function stat(label, value) {
    const card = node('div', 'case-stat');
    card.append(node('span', '', label), node('strong', '', value ?? '—'));
    return card;
  }

  function sectionHeading(title, hint = '') {
    const s = node('div', 'section-heading');
    s.append(node('h3', '', title));
    if (hint) s.append(node('span', '', hint));
    return s;
  }

  function renderTransactions(container, caseData) {
    const transactions = allCaseTransactions(caseData);
    if (!transactions.length) {
      container.append(node('div', 'd', 'No transaction rows were included in the case response. Check counts and truncation.'));
      return;
    }
    const wrap = node('div', 'tw');
    const table = node('table', 'tx-table');
    const thead = node('thead');
    const header = node('tr');
    for (const text of ['Transaction / type', 'Time', 'Sender → recipient', 'Amount', 'Role']) {
      header.append(node('th', '', text));
    }
    thead.append(header);
    table.append(thead);

    const body = node('tbody');
    const triggerSet = new Set(caseData.transaction_ids || []);
    for (const tx of transactions) {
      const row = node('tr', 'tx-row');
      row.dataset.txId = tx.transaction_id;
      row.dataset.sender = tx.sender_id;
      row.dataset.recipient = tx.recipient_id;

      row.addEventListener('mouseenter', () => {
        highlightGraphEdge(tx.transaction_id);
      });
      row.addEventListener('mouseleave', () => {
        clearHighlights();
      });

      const typeLabel = tx.transaction_type ? `\n${tx.transaction_type}` : '';
      row.append(
        node('td', 'mono', `${tx.transaction_id}${typeLabel}`),
        node('td', '', tx.timestamp || '—'),
        node('td', '', `${tx.sender_id} → ${tx.recipient_id}`),
        node('td', 'amt', fmtAmount(tx.amount, tx.currency)),
        node('td', '', triggerSet.has(tx.transaction_id) ? 'Trigger' : 'Context')
      );
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    container.append(wrap);
  }

  function renderEvidence(container, caseData) {
    const evidence = caseData.evidence || [];
    if (!evidence.length) {
      container.append(node('div', 'd', 'No evidence items were included. This can happen for a coverage-only case.'));
      return;
    }
    for (const ev of evidence) {
      const card = node('article', 'evidence-card');
      const head = node('div', 'evidence-head');
      const titleWrap = node('div');
      titleWrap.append(node('h4', '', ev.title || ev.rule_id || 'Evidence'), node('div', 'rule-code', `${ev.rule_id || 'UNKNOWN'} · ${ev.kind || 'UNKNOWN'}`));
      head.append(titleWrap, badge(ev.kind || 'UNKNOWN'));
      card.append(head, node('p', '', ev.description || 'No description provided.'));

      const clipped = Object.entries(ev.observed || {}).filter(([k, v]) => k.includes('truncated') && v === true).map(([k]) => k);
      if (clipped.length) {
        card.append(node('p', 'notice', `Supporting evidence is incomplete: ${clipped.join(', ')}. Observed totals may exceed returned transaction IDs.`));
      }

      const details = node('details');
      details.append(node('summary', '', 'Observed values and supporting transactions'));
      const pre = node('pre', '', JSON.stringify({
        observed: ev.observed || {},
        transaction_ids: ev.transaction_ids || [],
        account_ids: ev.account_ids || [],
        trigger_transaction_id: ev.trigger_transaction_id || null,
      }, null, 2));
      details.append(pre);
      card.append(details);

      for (const caveat of ev.caveats || []) {
        card.append(node('p', 'caveat', caveat));
      }
      container.append(card);
    }
  }

  function renderReviewForm(container, caseData) {
    const form = node('form', 'review-form');

    // Status
    const statusWrap = node('div');
    statusWrap.append(node('label', '', 'Review status'));
    const status = node('select');
    status.name = 'status';
    status.id = 'review-status';
    for (const item of ['OPEN', 'INVESTIGATING', 'ESCALATED', 'CLOSED']) {
      const option = node('option', '', item);
      option.value = item;
      if (item === caseData.status) option.selected = true;
      status.append(option);
    }
    statusWrap.append(status);
    form.append(statusWrap);

    // Outcome
    const outcomeWrap = node('div');
    outcomeWrap.append(node('label', '', 'Outcome (required to close)'));
    const outcome = node('select');
    outcome.name = 'outcome';
    outcome.id = 'review-outcome';
    const outcomes = [
      ['', 'Choose only when closing'],
      ['CONFIRMED_SUSPICIOUS', 'Confirmed suspicious'],
      ['FALSE_POSITIVE', 'False positive'],
      ['INCONCLUSIVE', 'Inconclusive'],
    ];
    for (const [val, text] of outcomes) {
      const option = node('option', '', text);
      option.value = val;
      if (val === (caseData.review_outcome || '')) option.selected = true;
      outcome.append(option);
    }
    outcomeWrap.append(outcome);
    form.append(outcomeWrap);

    // Reviewer label
    const reviewerWrap = node('div');
    reviewerWrap.append(node('label', '', 'Reviewer label'));
    const reviewer = node('input');
    reviewer.name = 'reviewer';
    reviewer.maxLength = 100;
    reviewer.value = 'analyst';
    reviewer.required = true;
    reviewerWrap.append(reviewer);
    form.append(reviewerWrap);

    // Review note
    const noteWrap = node('div', 'full');
    noteWrap.append(node('label', '', 'Review note'));
    const note = node('textarea');
    note.name = 'note';
    note.maxLength = 1000;
    note.placeholder = 'Record your reasoning; do not include unnecessary personal data.';
    noteWrap.append(note);
    form.append(noteWrap);

    // Actions
    const actions = node('div', 'review-actions full');
    const save = node('button', 'pill btn', 'Save review');
    save.type = 'submit';
    save.style.background = 'var(--dark)';
    save.style.color = '#fff';

    const audit = node('button', 'pill btn', 'Verify audit chain');
    audit.type = 'button';
    actions.append(save, audit);
    form.append(actions);

    status.addEventListener('change', () => {
      outcome.disabled = status.value !== 'CLOSED';
      if (status.value !== 'CLOSED') outcome.value = '';
    });
    outcome.disabled = status.value !== 'CLOSED';

    reviewer.id = 'reviewer-label';
    note.id = 'review-note';
    for (const [wrapper, control] of [[statusWrap, status], [outcomeWrap, outcome], [reviewerWrap, reviewer], [noteWrap, note]]) {
      const lbl = wrapper.querySelector('label');
      if (lbl) lbl.htmlFor = control.id;
    }

    const auditResult = node('p', 'notice full');
    auditResult.id = 'audit-result';
    auditResult.hidden = true;
    auditResult.setAttribute('role', 'status');
    form.append(auditResult);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      save.disabled = true;
      try {
        const payload = {
          status: status.value,
          reviewer: reviewer.value,
          note: note.value,
        };
        if (status.value === 'CLOSED') {
          if (!outcome.value) throw new Error('Choose an outcome before closing the case.');
          payload.outcome = outcome.value;
        }
        await api(`/api/cases/${encodeURIComponent(caseData.case_id)}/review`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast('Review saved and appended to the case history.');
        await refreshCases(true);
      } catch (error) {
        showToast(error.message, true);
      } finally {
        save.disabled = false;
      }
    });

    audit.addEventListener('click', async () => {
      audit.disabled = true;
      try {
        const result = await api(`/api/cases/${encodeURIComponent(caseData.case_id)}/audit`);
        auditResult.hidden = false;
        auditResult.textContent = `Review chain ${result.valid ? 'chain valid' : 'INVALID'} · ${result.event_count ?? 'unknown'} event(s). ${result.warning || 'Without an external anchor a database owner can rewrite the whole chain or delete its tail.'}`;
      } catch (error) {
        auditResult.hidden = false;
        auditResult.textContent = `Audit verification failed: ${error.message}`;
        showToast(error.message, true);
      } finally {
        audit.disabled = false;
      }
    });

    container.append(form);
  }

  async function loadCase(caseId, updateQueue = true) {
    if (!caseId) return;
    clearDetail('Loading case…');
    const request = ++state.detailRequest;
    state.selectedId = caseId;
    if (updateQueue) renderQueue();

    try {
      const caseData = await api(`/api/cases/${encodeURIComponent(caseId)}`);
      if (request !== state.detailRequest) return;

      state.selectedCaseData = caseData;
      updateSidePanel(caseData);

      $('detail-empty').hidden = true;
      const detail = $('case-detail');
      detail.replaceChildren();
      detail.hidden = false;

      // Top title
      const top = node('div', 'case-title-row');
      const titleWrap = node('div');
      titleWrap.append(
        node('p', 'eyebrow mono', `CASE ${caseData.case_id}`),
        node('h2', '', caseData.source_scenario_id || 'CSV import'),
        node('p', '', caseData.summary || 'Review supporting evidence and context.')
      );
      const tags = node('div', 'case-tags');
      tags.append(badge(caseData.priority), badge(caseData.status));
      top.append(titleWrap, tags);
      detail.append(top);

      // Grid stats
      const grid = node('div', 'case-grid');
      grid.append(
        stat('Trigger transactions', caseData.counts?.trigger_transactions_total ?? caseData.transaction_ids?.length ?? 0),
        stat('Connected accounts', caseData.counts?.account_ids_total ?? caseData.account_ids?.length ?? 0),
        stat('Evidence items', caseData.counts?.evidence_total ?? caseData.evidence?.length ?? 0)
      );
      detail.append(grid);

      // Truncation check
      if (Object.values(caseData.truncation || {}).some(Boolean)) {
        detail.append(node('p', 'notice', `Incomplete case payload — fields are truncated. Counts: ${JSON.stringify(caseData.counts || {})}. Truncation: ${JSON.stringify(caseData.truncation)}.`));
      }

      // Summary
      const summary = node('div', 'summary-box', caseData.summary || 'No summary.');
      detail.append(summary);

      // Graph
      const graphBox = node('div', 'graph-wrap');
      detail.append(sectionHeading('Connected-account view', `${(caseData.account_ids || []).length} accounts in case`));

      const hud = node('div', 'graph-hud');
      hud.id = 'graph-hud';
      const hudTag = node('div', 'hud-tag', 'Topology Inspector');
      const hudTitle = node('div', 'hud-title', `${(caseData.account_ids || []).length} Accounts Connected`);
      const hudDesc = node('p', 'hud-desc', 'Hover a transaction link or account node to inspect details');
      hud.append(hudTag, hudTitle, hudDesc);
      graphBox.append(hud);

      const svgNS = 'http://www.w3.org/2000/svg';
      const graphSvg = document.createElementNS(svgNS, 'svg');
      graphSvg.setAttribute('viewBox', '0 0 1000 520');
      graphSvg.setAttribute('role', 'img');
      graphSvg.setAttribute('class', 'case-graph');
      graphSvg.setAttribute('aria-label', 'Connected transaction account graph');
      const layout = buildGraphLayout(caseData);
      drawGraph(layout, graphSvg, false, caseData);
      graphBox.append(graphSvg);

      const invSec = $('investigation-section');
      if (invSec) invSec.classList.add('border-beam-active');

      const legend = node('div', 'graph-legend');
      const item1 = node('span');
      const dot1 = node('i', 'legend-dot');
      dot1.style.background = '#111';
      item1.append(dot1, document.createTextNode(' Trigger transaction (highlighted)'));
      const item2 = node('span');
      const dot2 = node('i', 'legend-dot');
      dot2.style.background = '#b8b8b0';
      item2.append(dot2, document.createTextNode(' Context transaction'));
      legend.append(item1, item2);
      graphBox.append(legend);
      detail.append(graphBox);

      // Transactions Timeline
      const txBox = node('div');
      detail.append(sectionHeading('Transaction timeline', 'Trigger and supporting context'));
      renderTransactions(txBox, caseData);
      detail.append(txBox);

      // Evidence
      const evidenceBox = node('div');
      detail.append(sectionHeading('Why it was flagged', `${(caseData.evidence || []).length} evidence item(s)`));
      renderEvidence(evidenceBox, caseData);
      detail.append(evidenceBox);

      // Limitations
      if ((caseData.limitations || []).length) {
        const details = node('details', 'review-history');
        details.open = true;
        details.append(node('summary', '', 'Limitations and interpretation'));
        const list = node('ul');
        for (const limit of caseData.limitations) list.append(node('li', '', limit));
        details.append(list);
        detail.append(details);
      }

      // Human review form
      detail.append(sectionHeading('Human review', 'Closing requires an explicit outcome'));
      renderReviewForm(detail, caseData);

      // Review history
      if ((caseData.review_history || []).length) {
        const history = node('details', 'review-history');
        history.append(
          node('summary', '', `Review history · ${caseData.review_history.length} event(s)`),
          node('pre', '', JSON.stringify(caseData.review_history, null, 2))
        );
        detail.append(history);
      }

      if (updateQueue) renderQueue();
    } catch (error) {
      if (request !== state.detailRequest) return;
      clearDetail(`Could not load case: ${error.message}`);
      renderQueue();
      showToast(`Could not load case: ${error.message}`, true);
    }
  }

  async function refreshCases(keepSelection = true) {
    const request = ++state.queueRequest;
    const previousId = keepSelection ? state.selectedId : null;
    clearDetail('Loading cases…');

    try {
      const result = await api(`/api/cases?${selectedQuery()}`);
      if (request !== state.queueRequest) return;

      state.cases = Array.isArray(result.cases) ? result.cases : [];
      state.total = typeof result.total === 'number' ? result.total : state.cases.length;

      updateMetrics();
      renderQueue();
      renderDistributionBars();
      renderFilterButtons();
      renderPagination();
      renderViewToggle();

      $('queue-limit').hidden = state.total <= 100;
      setConnection(true, 'API connected');

      if (previousId && state.cases.some(c => c.case_id === previousId)) {
        await loadCase(previousId);
      } else if (state.cases.length) {
        await loadCase(state.cases[0].case_id);
      } else {
        clearDetail('No cases match these filters');
      }
    } catch (error) {
      if (request !== state.queueRequest) return;
      state.cases = [];
      state.total = 0;
      updateMetrics();
      clearDetail('Case queue unavailable — refresh to retry');
      for (const id of ['metric-all', 'metric-high', 'metric-medium', 'metric-low', 'queue-count']) {
        $(id).textContent = '—';
      }
      setConnection(false, 'API unavailable');
      const rows = $('queue-list');
      rows.replaceChildren();
      const tr = node('tr');
      const td = node('td', 'd', `Could not load cases. ${error.message}`);
      td.colSpan = 7;
      tr.appendChild(td);
      rows.appendChild(tr);
      showToast(`API request failed: ${error.message}`, true);
    }
  }

  async function loadScenarios() {
    try {
      const result = await api('/api/scenarios');
      state.scenarios = result.scenarios || [];
      const select = $('scenario-select');
      select.replaceChildren();
      for (const scenario of state.scenarios) {
        const opt = node('option', '', `${scenario.title || scenario.id} (${scenario.id})`);
        opt.value = scenario.id;
        select.append(opt);
      }
      if (!state.scenarios.length) {
        select.append(Object.assign(node('option', '', 'No scenarios available'), { value: '' }));
      }
    } catch (error) {
      $('scenario-select').replaceChildren(Object.assign(node('option', '', 'Could not load scenarios'), { value: '' }));
      showToast(`Could not load scenarios: ${error.message}`, true);
    }
  }

  async function replayScenario() {
    const scenarioId = $('scenario-select').value;
    if (!scenarioId) return;
    const button = $('replay-scenario');
    button.disabled = true;
    button.textContent = 'Replaying…';
    try {
      const result = await api(`/api/scenarios/${encodeURIComponent(scenarioId)}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      runResult(`Analysis complete: ${result.transaction_count} transactions; ${result.case_count} case(s).`, result);
      state.latestRunId = result.run_id || null;
      state.viewMode = result.case_count > 0 ? 'run' : 'all';
      state.offset = 0;
      state.filterPriority = 'All';
      state.filterStatus = 'All';
      $('priority-filter').value = '';
      $('status-filter').value = '';

      const graphWarning = result.analysis_warnings?.join(' ') || '';
      showToast(`Replayed ${result.transaction_count} synthetic transactions; generated ${result.case_count} case(s).${graphWarning ? ` WARNING: ${graphWarning}` : ''}`, Boolean(graphWarning));

      await refreshCases(false);
      if (result.cases?.length) {
        await loadCase(result.cases[0].case_id);
      } else {
        clearDetail('This scenario produced zero cases under the current rules.');
      }
    } catch (error) {
      runResult(`Scenario replay failed: ${error.message}`);
      showToast(`Scenario replay failed: ${error.message}`, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Replay scenario';
    }
  }

  async function replayAllScenarios() {
    const button = $('replay-all');
    button.disabled = true;
    button.textContent = 'Replaying all…';
    try {
      const result = await api('/api/scenarios/replay-all', { method: 'POST' });
      runResult(`Analysis complete: ${result.transaction_count} transactions; ${result.case_count} case(s).`, result);
      state.latestRunId = null;
      state.viewMode = 'all';
      state.offset = 0;
      state.filterPriority = 'All';
      state.filterStatus = 'All';
      $('priority-filter').value = '';
      $('status-filter').value = '';

      const graphWarning = result.analysis_warnings?.join(' ') || '';
      showToast(`Replayed ${result.scenario_count} synthetic scenarios; ${result.transaction_count} transactions; ${result.case_count} cases.${graphWarning ? ` WARNING: ${graphWarning}` : ''}`, Boolean(graphWarning));

      await refreshCases(false);
      if (result.cases?.length) {
        await loadCase(result.cases[0].case_id);
      }
    } catch (error) {
      runResult(`Replay-all failed: ${error.message}`);
      showToast(`Replay-all failed: ${error.message}`, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Run all scenarios';
    }
  }

  async function importCsv(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      showToast('Select a .csv file.', true);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('The file exceeds the 5 MiB upload limit.', true);
      return;
    }
    try {
      const result = await api('/api/transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: file,
      });
      runResult(`CSV imported: ${result.transaction_count} rows; ${result.case_count} case(s).`, result);
      state.latestRunId = result.run_id || null;
      state.viewMode = result.case_count > 0 ? 'run' : 'all';
      state.offset = 0;
      state.filterPriority = 'All';
      state.filterStatus = 'All';
      $('priority-filter').value = '';
      $('status-filter').value = '';

      const warnings = [...(result.warnings || []), ...(result.analysis_warnings || [])].join(' ');
      showToast(`Imported ${result.transaction_count} rows; generated ${result.case_count} case(s). ${warnings}`, Boolean(result.analysis_warnings?.length));

      await refreshCases(false);
      if (result.cases?.length) {
        await loadCase(result.cases[0].case_id);
      } else {
        clearDetail('This import produced zero cases under the current rules.');
      }
    } catch (error) {
      runResult(`CSV import failed: ${error.message}`);
      showToast(`CSV import failed: ${error.message}`, true);
    } finally {
      $('csv-file').value = '';
    }
  }

  async function loadEvaluation() {
    try {
      const result = await api('/api/evaluation/summary');
      $('evaluation-status').textContent = result.model_status === 'not_configured'
        ? 'Rules-only mode. No trained ML model or measured benchmark result is configured. Metrics are intentionally not shown.'
        : `Model status: ${result.model_status}; evaluation status: ${result.evaluation_status}.`;
    } catch (error) {
      $('evaluation-status').textContent = `Evaluation metadata unavailable: ${error.message}`;
    }
  }

  /* Multi-page Routing & View Management */
  const PAGES = ['queue', 'scenarios', 'import', 'evaluation'];

  function showPage(pageId) {
    if (!PAGES.includes(pageId)) pageId = 'queue';
    state.activePage = pageId;

    PAGES.forEach(p => {
      const el = $(`page-${p}`);
      if (el) el.hidden = (p !== pageId);
      const navLink = $(`nav-${p}`);
      if (navLink) {
        navLink.classList.toggle('on', p === pageId);
        if (p === pageId) navLink.setAttribute('aria-current', 'page');
        else navLink.removeAttribute('aria-current');
      }
    });

    if (pageId === 'scenarios') renderScenarioGrid();
  }

  function handleRoute() {
    const raw = window.location.hash.replace(/^#\/?/, '').toLowerCase();
    const page = PAGES.includes(raw) ? raw : 'queue';
    showPage(page);
  }

  window.addEventListener('hashchange', handleRoute);

  function renderScenarioGrid() {
    const grid = $('scenario-grid');
    if (!grid) return;
    grid.replaceChildren();

    if (!state.scenarios.length) {
      grid.append(node('div', 'd', 'No scenarios available to display.'));
      return;
    }

    state.scenarios.forEach(sc => {
      const item = node('article', 'scenario-item');

      const header = node('div', 'scenario-item-header');
      header.append(
        node('h3', '', sc.title || sc.id),
        node('span', 'chip mono', sc.id)
      );

      const purpose = node('p', 'scenario-purpose', sc.purpose || 'Synthetic scenario fixture.');
      const expected = node('div', 'scenario-expected', `Expected: ${sc.expected || 'Rule verification'}`);

      const btn = node('button', 'pill btn', 'Replay fixture');
      btn.type = 'button';
      btn.style.width = '100%';
      btn.style.background = 'var(--lemon-soft)';
      btn.style.border = '1px solid var(--lemon-mid)';

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Replaying…';
        try {
          const gap = parseFloat($('param-gap')?.value) || 1.0;
          const amt = parseFloat($('param-amount')?.value) || 1.0;
          const params = (gap !== 1.0 || amt !== 1.0) ? { gap_scale: gap, amount_scale: amt } : {};
          const result = await api(`/api/scenarios/${encodeURIComponent(sc.id)}/replay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ params }),
          });
          runResult(`Analysis complete: ${result.transaction_count} transactions; ${result.case_count} case(s).`, result);
          state.latestRunId = result.run_id || null;
          state.viewMode = result.case_count > 0 ? 'run' : 'all';
          state.offset = 0;
          showToast(`Replayed ${sc.id}: generated ${result.case_count} case(s).`);
          window.location.hash = '#/queue';
          await refreshCases(false);
          if (result.cases?.length) await loadCase(result.cases[0].case_id);
        } catch (err) {
          showToast(`Replay failed: ${err.message}`, true);
        } finally {
          btn.disabled = false;
          btn.textContent = 'Replay fixture';
        }
      });

      item.append(header, purpose, expected, btn);
      grid.append(item);
    });
  }

  // Multi-page specific event listeners
  const scenarioAllBtn = $('scenario-page-replay-all');
  if (scenarioAllBtn) {
    scenarioAllBtn.addEventListener('click', async () => {
      await replayAllScenarios();
      window.location.hash = '#/queue';
    });
  }

  // Import drag-and-drop
  const dropZone = $('drop-zone');
  const browseBtn = $('browse-csv-btn');
  if (browseBtn) browseBtn.addEventListener('click', () => $('csv-file').click());
  if (dropZone) {
    dropZone.addEventListener('click', e => {
      if (e.target !== browseBtn) $('csv-file').click();
    });
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        importCsv(file).then(() => {
          window.location.hash = '#/queue';
        });
      }
    });
  }

  const copySampleBtn = $('copy-sample-csv');
  if (copySampleBtn) {
    copySampleBtn.addEventListener('click', () => {
      const text = $('sample-csv-text')?.textContent || '';
      navigator.clipboard.writeText(text).then(() => {
        showToast('Sample CSV copied to clipboard.');
      }).catch(() => {
        showToast('Could not copy to clipboard.', true);
      });
    });
  }

  // Live Audit Inspector on Evaluation page
  const auditBtn = $('audit-inspector-btn');
  const auditInput = $('audit-inspector-input');
  const auditBox = $('audit-inspector-result');
  if (auditBtn && auditInput && auditBox) {
    auditBtn.addEventListener('click', async () => {
      const cid = auditInput.value.trim();
      if (!cid) {
        showToast('Enter a case_id to verify audit chain.', true);
        return;
      }
      auditBtn.disabled = true;
      try {
        const result = await api(`/api/cases/${encodeURIComponent(cid)}/audit`);
        auditBox.hidden = false;
        auditBox.innerHTML = `<strong>Case ${escapeHtml(cid)}:</strong> Review chain ${result.valid ? '<span style="color:#2ea043;font-weight:700">chain valid</span>' : '<span style="color:#962222;font-weight:700">INVALID</span>'}. Verified <strong>${result.event_count ?? 0}</strong> event(s).<br><small style="color:var(--muted)">${escapeHtml(result.warning || 'Without an external anchor a database owner can rewrite the whole chain or delete its tail.')}</small>`;
      } catch (err) {
        auditBox.hidden = false;
        auditBox.textContent = `Audit check failed: ${err.message}`;
        showToast(`Audit failed: ${err.message}`, true);
      } finally {
        auditBtn.disabled = false;
      }
    });
  }

  // Setup event listeners
  $('import-csv').addEventListener('click', () => $('csv-file').click());
  $('replay-scenario').addEventListener('click', replayScenario);
  $('replay-all').addEventListener('click', replayAllScenarios);
  $('refresh-cases').addEventListener('click', () => refreshCases(true));

  $('priority-filter').addEventListener('change', e => {
    state.filterPriority = e.target.value || 'All';
    state.offset = 0;
    refreshCases(false);
  });
  $('status-filter').addEventListener('change', e => {
    state.filterStatus = e.target.value || 'All';
    state.offset = 0;
    refreshCases(false);
  });
  $('csv-file').addEventListener('change', event => importCsv(event.target.files?.[0]));

  // Search input listener
  const searchInput = $('queue-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      state.searchQuery = e.target.value;
      renderQueue();
    });
  }

  // Keyboard Shortcuts
  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    if (e.key === 'Escape') {
      const ov = $('ov');
      if (ov && !ov.hidden) {
        ov.hidden = true;
        return;
      }
      hidePv();
      return;
    }

    if (e.key === 'g' || e.key === 'G') {
      if (state.selectedCaseData) {
        openModal(state.selectedCaseData);
      }
      return;
    }

    if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
      e.preventDefault();
      navigateCase(1);
      return;
    }

    if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
      e.preventDefault();
      navigateCase(-1);
      return;
    }
  });

  function navigateCase(direction) {
    if (!state.cases.length) return;
    let currentIndex = state.cases.findIndex(c => c.case_id === state.selectedId);
    if (currentIndex === -1) currentIndex = 0;
    else currentIndex = Math.max(0, Math.min(state.cases.length - 1, currentIndex + direction));
    const nextCase = state.cases[currentIndex];
    if (nextCase) {
      loadCase(nextCase.case_id);
    }
  }

  // Drag-and-drop dropzone setup
  const dropzone = $('dropzone');
  if (dropzone) {
    dropzone.addEventListener('click', () => $('csv-file').click());
    dropzone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        $('csv-file').click();
      }
    });
    ['dragenter', 'dragover'].forEach(name => {
      dropzone.addEventListener(name, e => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      dropzone.addEventListener(name, e => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', e => {
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        importCsv(files[0]);
      }
    });
  }

  function initCard3D() {
    const cards = document.querySelectorAll('.kpi, .scenario-card');
    cards.forEach(card => {
      card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -4;
        const rotateY = ((x - centerX) / centerX) * 4;
        card.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-2px)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
      });
    });
  }

  // Initialize
  renderFilterButtons();
  loadScenarios();
  loadEvaluation();
  handleRoute();
  initCard3D();
  refreshCases(false);
})();
