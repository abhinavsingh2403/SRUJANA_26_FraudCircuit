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
    const labelText = safe === 'INSUFFICIENT_HISTORY' ? 'INSUFFICIENT' : lab(safe);
    const span = node('span', `b ${safe}${extra ? ` ${extra}` : ''}`, labelText);
    if (safe === 'INSUFFICIENT_HISTORY') span.title = 'INSUFFICIENT HISTORY';
    return span;
  }

  function animateCount(el, target) {
    if (!el) return;
    const targetNum = Number(target);
    if (!Number.isFinite(targetNum)) {
      el.textContent = String(target ?? '—');
      return;
    }
    const startNum = Number(el.getAttribute('data-val') || el.textContent) || 0;
    if (startNum === targetNum) {
      el.textContent = String(targetNum);
      return;
    }
    el.setAttribute('data-val', targetNum);
    const duration = 400;
    const startTime = performance.now();
    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startNum + (targetNum - startNum) * ease);
      el.textContent = String(current);
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = String(targetNum);
      }
    }
    requestAnimationFrame(tick);
  }

  function showToast(message, error = false) {
    const box = $('toast');
    box.textContent = message;
    box.className = `toast${error ? ' error' : ''}`;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
  }

  const API_BASE = ''; // All local demo requests stay on the page origin.

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
    if (statusText) statusText.textContent = message;
    const dot = statusText?.previousElementSibling || document.querySelector('.status-dot');
    if (dot) dot.classList.toggle('ok', !!ok);
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

  function formatExactTimestamp(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return String(dateStr);
      return `${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })} (${dateStr})`;
    } catch {
      return String(dateStr);
    }
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '—';
    try {
      const time = new Date(dateStr).getTime();
      if (Number.isNaN(time)) return String(dateStr);
      const diffMs = Date.now() - time;
      if (diffMs < 0) return 'just now';
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      if (days < 30) return `${days}d ago`;
      return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

  /* Cycle-Aware Dynamic Topological Layering */
  function buildGraphLayout(caseData) {
    const transactions = allCaseTransactions(caseData);
    const accountIds = [...new Set(transactions.flatMap(tx => [tx.sender_id, tx.recipient_id]).filter(Boolean))];
    if (!accountIds.length) {
      return { L: [], E: [] };
    }

    const inDegree = {};
    const adj = {};
    accountIds.forEach(id => {
      inDegree[id] = 0;
      adj[id] = [];
    });

    const displayTx = transactions.slice(0, 60);
    displayTx.forEach(tx => {
      if (inDegree[tx.recipient_id] !== undefined) inDegree[tx.recipient_id]++;
      if (adj[tx.sender_id]) adj[tx.sender_id].push(tx.recipient_id);
    });

    // Detect back-edges (cycles) using DFS so backward transactions don't collapse DAG layers
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = {};
    accountIds.forEach(id => { color[id] = WHITE; });
    const backEdges = new Set();

    function dfs(u) {
      color[u] = GRAY;
      for (const v of adj[u] || []) {
        if (color[v] === GRAY) {
          backEdges.add(u + '>' + v);
        } else if (color[v] === WHITE) {
          dfs(v);
        }
      }
      color[u] = BLACK;
    }

    const sources = accountIds.filter(id => inDegree[id] === 0);
    (sources.length ? sources : [accountIds[0]]).forEach(s => {
      if (color[s] === WHITE) dfs(s);
    });
    accountIds.forEach(a => {
      if (color[a] === WHITE) dfs(a);
    });

    // Layer assignment following forward DAG flow
    const layerMap = {};
    const startNodes = sources.length ? sources : [accountIds[0]];
    startNodes.forEach(s => { layerMap[s] = 0; });

    const queue = [...startNodes];
    while (queue.length > 0) {
      const curr = queue.shift();
      const currLayer = layerMap[curr];
      for (const nxt of adj[curr] || []) {
        if (backEdges.has(curr + '>' + nxt)) continue; // skip back-edge in layer advance
        if (layerMap[nxt] === undefined || layerMap[nxt] < currLayer + 1) {
          layerMap[nxt] = currLayer + 1;
          queue.push(nxt);
        }
      }
    }

    accountIds.forEach(id => {
      if (layerMap[id] === undefined) {
        layerMap[id] = 1;
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

  function drawGraph(g, svg, sm = false) {
    if (!g || !g.L || !g.L.length) {
      svg.innerHTML = '<text x="500" y="260" text-anchor="middle" font-size="14" fill="#58584d">No connected graph data</text>';
      return;
    }
    const baseR = sm ? 18 : 24;
    const pos = {};
    const nl = g.L.length;

    g.L.forEach((col, ci) => {
      const x = nl === 1 ? 500 : 100 + ci * (780 / Math.max(1, nl - 1));
      if (col.length > 4) {
        // Multi-node fanout: stagger across two sub-columns with generous horizontal and vertical separation
        const rSub = sm ? 14 : 17;
        const subColRows = Math.ceil(col.length / 2);
        const subGap = Math.max(48, Math.min(76, 440 / Math.max(1, subColRows)));
        const xSeparation = sm ? 38 : 55;
        col.forEach((n, i) => {
          const subColIdx = i % 2;
          const rowIdx = Math.floor(i / 2);
          const xOffset = subColIdx === 0 ? -xSeparation : xSeparation;
          const y = 260 + (rowIdx - (subColRows - 1) / 2) * subGap;
          const clampedX = Math.max(70, Math.min(935, x + xOffset));
          pos[n] = { x: clampedX, y: y, r: rSub };
        });
      } else {
        const gap = Math.min(sm ? 70 : 110, (sm ? 320 : 400) / Math.max(1, col.length));
        col.forEach((n, i) => {
          pos[n] = { x: x, y: 260 + (i - (col.length - 1) / 2) * gap, r: baseR };
        });
      }
    });

    const max = Math.max(1, ...g.E.map(e => e[2]));

    // Group edges by canonical pair key to decouple bidirectional and parallel paths
    const pairGroups = {};
    g.E.forEach(e => {
      const pairKey = [e[0], e[1]].sort().join('<->');
      (pairGroups[pairKey] = pairGroups[pairKey] || []).push(e);
    });

    // Count identical amounts per sender to prevent blob collisions in fanouts
    const senderAmountCounts = {};
    g.E.forEach(e => {
      const key = `${e[0]}_${e[2]}`;
      senderAmountCounts[key] = (senderAmountCounts[key] || 0) + 1;
    });
    const senderAmountPlaced = {};

    let base = '', top = '', lab = '';
    const placedLabels = []; // Proximity collision check for amount labels

    Object.keys(pairGroups).forEach(k => {
      const list = pairGroups[k];
      const hasReciprocal = list.some(e1 => list.some(e2 => e1[0] === e2[1] && e1[1] === e2[0]));

      list.forEach((e, i) => {
        const a = pos[e[0]], b = pos[e[1]];
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len, uy = dy / len;
        const nx = -uy, ny = ux;

        // Clean parallel offset: if reciprocal traffic exists, push forward and reverse to opposite sides
        let off = 0;
        if (hasReciprocal) {
          const isForward = e[0] < e[1];
          off = (isForward ? 1 : -1) * (sm ? 10 : 14);
        } else if (list.length > 1) {
          off = (i - (list.length - 1) / 2) * (sm ? 16 : 22);
        }

        const w = Math.max(2, 2.2 + (sm ? 3.5 : 5.5) * (e[2] / max));
        const hl = sm ? 9 + w * 1.3 : 12 + w * 1.8;
        const hw = sm ? w * 1.1 + 2.5 : w * 1.3 + 3.5;
        const ra = a.r || baseR;
        const rb = b.r || baseR;
        const sx = a.x + ux * ra + nx * off;
        const sy = a.y + uy * ra + ny * off;
        const ex = b.x - ux * rb + nx * off;
        const ey = b.y - uy * rb + ny * off;
        const bx = ex - ux * hl;
        const by = ey - uy * hl;
        const isTrigger = e[3] === 1;
        const col = isTrigger ? '#111' : '#b8b8b0';
        const titleText = `${e[4] || 'tx'}: ${e[0]} → ${e[1]}, amount ${e[2]}, ${e[5] || ''}`;

        const el = `<line class="graph-tx-line" data-tx-id="${escapeHtml(e[4] || '')}" x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${col}" stroke-width="${w.toFixed(1)}"><title>${escapeHtml(titleText)}</title></line><polygon fill="${col}" points="${ex.toFixed(1)},${ey.toFixed(1)} ${(bx + nx * hw).toFixed(1)},${(by + ny * hw).toFixed(1)} ${(bx - nx * hw).toFixed(1)},${(by - ny * hw).toFixed(1)}"/>`;
        if (isTrigger) top += el; else base += el;

        // Smart amount placement with collision avoidance and fanout deduplication
        const amountKey = `${e[0]}_${e[2]}`;
        const totalWithThisAmount = senderAmountCounts[amountKey] || 1;
        const countPlacedSoFar = senderAmountPlaced[amountKey] || 0;

        let shouldPlaceAmount = true;
        if (totalWithThisAmount > 3) {
          // On high fan-out trees with identical amounts, place labels on outer edges to avoid black blobs
          if (countPlacedSoFar >= 2 && i < list.length - 1) {
            shouldPlaceAmount = false;
          }
        }

        if (shouldPlaceAmount && (!sm || isTrigger)) {
          let bestLx = sx + (bx - sx) * 0.5;
          let bestLy = sy + (by - sy) * 0.5 - w / 2 - 5;

          // Check if best position hits any node circle or an existing label
          let collidesWithNodes = Object.values(pos).some(p => Math.hypot(p.x - bestLx, p.y - bestLy) < p.r + 14);
          let collidesWithLabels = placedLabels.some(p => Math.abs(p.x - bestLx) < 48 && Math.abs(p.y - bestLy) < 18);

          if (collidesWithNodes || collidesWithLabels) {
            for (const testT of [0.35, 0.65, 0.25, 0.75]) {
              const testX = sx + (bx - sx) * testT;
              const testY = sy + (by - sy) * testT - w / 2 - 5;
              const nodeHit = Object.values(pos).some(p => Math.hypot(p.x - testX, p.y - testY) < p.r + 14);
              const labelHit = placedLabels.some(p => Math.abs(p.x - testX) < 48 && Math.abs(p.y - testY) < 18);
              if (!nodeHit && !labelHit) {
                bestLx = testX;
                bestLy = testY;
                collidesWithNodes = false;
                collidesWithLabels = false;
                break;
              }
            }
          }

          if (!collidesWithNodes && !collidesWithLabels) {
            placedLabels.push({ x: bestLx, y: bestLy });
            senderAmountPlaced[amountKey] = countPlacedSoFar + 1;
            lab += `<text x="${bestLx.toFixed(1)}" y="${bestLy.toFixed(1)}" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${sm ? 10.5 : 11.5}" font-weight="700" fill="#111" stroke="#fffdea" stroke-width="${sm ? 4 : 3.5}" paint-order="stroke">${inr(e[2])}</text>`;
          }
        }
      });
    });

    function formatNodeLabel(id, r) {
      if (!id) return '';
      if (r <= 18) {
        const destMatch = id.match(/DEST[-_]?(\d+)/i);
        if (destMatch) return 'D-' + destMatch[1];
        const numMatch = id.match(/[-_](\d{1,3})$/);
        if (numMatch) return '#' + numMatch[1];
        if (id.length > 5) return id.slice(0, 4) + '…';
        return id;
      }
      if (id.length > 8) {
        const destMatch = id.match(/DEST[-_]?(\d+)/i);
        if (destMatch) return 'DST-' + destMatch[1];
        return id.slice(0, 6) + '…';
      }
      return id;
    }

    let nodes = '';
    Object.keys(pos).forEach(n => {
      const p = pos[n];
      const r = p.r || baseR;
      const displayLabel = formatNodeLabel(n, r);
      const labelY = p.y > 450 ? p.y - r - 6 : p.y + r + 13;
      nodes += `<circle class="graph-node" data-acct-id="${escapeHtml(n)}" cx="${p.x}" cy="${p.y}" r="${r}" fill="#fff" stroke="#111" stroke-width="2.2"><title>${escapeHtml(n)}</title></circle><circle cx="${p.x}" cy="${p.y}" r="${Math.max(3.5, r * 0.28)}" fill="#111" pointer-events="none"></circle><text x="${p.x}" y="${labelY}" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${sm ? 10 : 11}" font-weight="700" fill="#111" stroke="#fffdea" stroke-width="3.5" paint-order="stroke" pointer-events="none">${escapeHtml(displayLabel)}</text>`;
    });

    svg.innerHTML = base + top + nodes + lab;
    svg.setAttribute('aria-label', `Transaction graph with ${g.E.length} transactions between ${Object.keys(pos).length} accounts`);

    // Attach bidirectional hover handlers on SVG elements
    if (!sm) {
      svg.querySelectorAll('.graph-tx-line').forEach(line => {
        const txId = line.getAttribute('data-tx-id');
        if (!txId) return;
        line.addEventListener('mouseenter', () => {
          line.classList.add('graph-edge-hover');
          const row = document.querySelector(`.tx-table tr[data-tx-id="${txId}"]`);
          if (row) {
            row.classList.add('highlight-tx');
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });
        line.addEventListener('mouseleave', () => {
          line.classList.remove('graph-edge-hover');
          const row = document.querySelector(`.tx-table tr[data-tx-id="${txId}"]`);
          if (row) row.classList.remove('highlight-tx');
        });
      });

      svg.querySelectorAll('.graph-node').forEach(nodeEl => {
        const acctId = nodeEl.getAttribute('data-acct-id');
        if (!acctId) return;
        nodeEl.addEventListener('mouseenter', () => nodeEl.classList.add('graph-node-hover'));
        nodeEl.addEventListener('mouseleave', () => nodeEl.classList.remove('graph-node-hover'));
      });
    }
  }

  /* Natural Language Transaction Graph Description */
  function generateGraphNarrative(caseData) {
    if (!caseData) return null;

    const triggerTxs = caseData.trigger_transactions || [];
    const contextTxs = caseData.context_transactions || [];
    const allTxs = allCaseTransactions(caseData);

    const accounts = caseData.account_ids || [...new Set(allTxs.flatMap(tx => [tx.sender_id, tx.recipient_id]).filter(Boolean))];
    const acctCount = accounts.length || 0;

    const inDegree = {};
    const outDegree = {};
    const inVolume = {};
    const outVolume = {};
    let totalVolume = 0;
    const timestamps = [];

    for (const tx of allTxs) {
      const amt = Number(tx.amount) || 0;
      totalVolume += amt;
      if (tx.sender_id) {
        outDegree[tx.sender_id] = (outDegree[tx.sender_id] || 0) + 1;
        outVolume[tx.sender_id] = (outVolume[tx.sender_id] || 0) + amt;
      }
      if (tx.recipient_id) {
        inDegree[tx.recipient_id] = (inDegree[tx.recipient_id] || 0) + 1;
        inVolume[tx.recipient_id] = (inVolume[tx.recipient_id] || 0) + amt;
      }
      if (tx.timestamp) {
        const t = new Date(tx.timestamp).getTime();
        if (!isNaN(t)) timestamps.push(t);
      }
    }

    const sources = accounts.filter(a => (outDegree[a] || 0) > 0 && !(inDegree[a] || 0));
    const sinks = accounts.filter(a => (inDegree[a] || 0) > 0 && !(outDegree[a] || 0));
    const relays = accounts.filter(a => (inDegree[a] || 0) > 0 && (outDegree[a] || 0) > 0);

    const fmtAcctList = (list, max = 3) => {
      if (!list || !list.length) return 'None';
      if (list.length <= max) return list.join(', ');
      return `${list.slice(0, max).join(', ')} (+${list.length - max} more)`;
    };

    let timeSpanDesc = '';
    if (timestamps.length >= 2) {
      timestamps.sort((a, b) => a - b);
      const spanSec = Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 1000);
      if (spanSec < 60) timeSpanDesc = `${spanSec} seconds`;
      else if (spanSec < 3600) timeSpanDesc = `${Math.round(spanSec / 60)} minutes`;
      else if (spanSec < 86400) timeSpanDesc = `${(spanSec / 3600).toFixed(1)} hours`;
      else timeSpanDesc = `${(spanSec / 86400).toFixed(1)} days`;
    }

    const rules = caseData.rule_codes || (caseData.evidence || []).map(e => e.rule_id);
    const uniqueRules = [...new Set(rules)].filter(Boolean);
    const evidenceList = caseData.evidence || [];

    let typology = 'Direct Transaction Network';
    let patternTag = 'Standard Flow';
    let narrative = '';

    const hasChain = uniqueRules.includes('R5_LAYERED_CHAIN');
    const hasCycle = uniqueRules.includes('R4_DIRECTED_CYCLE');
    const hasFanOut = uniqueRules.includes('R2B_FAN_OUT_BURST');
    const hasFanIn = uniqueRules.includes('R2A_FAN_IN_BURST');
    const hasRapidPass = uniqueRules.includes('R1_RAPID_PASS_THROUGH');
    const hasSpike = uniqueRules.includes('R3_AMOUNT_DEVIATION');
    const hasRepeat = uniqueRules.includes('R6_REPEATED_VALUE_BURST');

    if (hasChain) {
      typology = 'Multi-Hop Layered Chain';
      patternTag = 'Layering / Mule Relay';
      const chainEv = evidenceList.find(e => e.rule_id === 'R5_LAYERED_CHAIN');
      const hops = chainEv?.observed?.chain_hops || allTxs.length || 0;
      const srcStr = fmtAcctList(sources, 2);
      const relayStr = fmtAcctList(relays, 3);
      const sinkStr = fmtAcctList(sinks, 2);
      narrative = `This graph illustrates a linear ${hops}-hop layering chain across ${acctCount} accounts. Funds originated from ${srcStr} and were routed sequentially through ${relayStr} before reaching terminal destination ${sinkStr}. The total flow transacted was ${fmtAmount(totalVolume)}${timeSpanDesc ? ` within ${timeSpanDesc}` : ''}. Rapid sequential relaying with high capital retention is a primary indicator of money laundering layering designed to break audit trails.`;
    } else if (hasCycle) {
      typology = 'Directed Cycle (Wash Trading)';
      patternTag = 'Circular Flow / Round-Tripping';
      const cycleEv = evidenceList.find(e => e.rule_id === 'R4_DIRECTED_CYCLE');
      const cLen = cycleEv?.observed?.cycle_length || acctCount;
      narrative = `A closed circular transaction cycle was detected connecting ${cLen} accounts (${accounts.slice(0, 4).join(' → ')} → back to start). Total flow volume reached ${fmtAmount(totalVolume)}${timeSpanDesc ? ` over ${timeSpanDesc}` : ''}. Circular fund flows with minimal net dissipation are characteristic of wash trading, round-trip invoicing, or artificial volume inflation.`;
    } else if (hasFanOut) {
      typology = 'Fan-Out Rapid Disbursement';
      patternTag = 'Dispersal / Smurfing';
      const fanEv = evidenceList.find(e => e.rule_id === 'R2B_FAN_OUT_BURST');
      const recCount = fanEv?.observed?.distinct_recipients_including_current || sinks.length;
      const hub = sources.length ? sources[0] : (allTxs[0]?.sender_id || 'Primary Account');
      narrative = `A fan-out burst pattern originating from central hub ${hub}, which dispersed funds rapidly across ${recCount} separate recipient accounts (${fmtAcctList(sinks, 3)}). Total transacted amount is ${fmtAmount(totalVolume)}${timeSpanDesc ? ` in ${timeSpanDesc}` : ''}. This structured disbursement behavior suggests smurfing or distribution across a money mule network.`;
    } else if (hasFanIn) {
      typology = 'Fan-In Fund Aggregation';
      patternTag = 'Aggregation / Funneling';
      const collector = sinks.length ? sinks[0] : (allTxs[allTxs.length - 1]?.recipient_id || 'Primary Collector');
      narrative = `A fan-in aggregation pattern funneling incoming capital from ${sources.length} feeder accounts into central collector ${collector}. Total transacted amount is ${fmtAmount(totalVolume)}${timeSpanDesc ? ` over ${timeSpanDesc}` : ''}. Concentrating funds from disparate sources into a central point often signals mule collection prior to large-scale withdrawal.`;
    } else if (hasRapidPass) {
      typology = 'Rapid Pass-Through Velocity';
      patternTag = 'Immediate Turnaround';
      const rpEv = evidenceList.find(e => e.rule_id === 'R1_RAPID_PASS_THROUGH');
      const wDetail = rpEv?.observed?.window_details;
      const ratio = wDetail ? Object.values(wDetail)[0]?.amount_to_inflow_ratio : null;
      const ratioPct = ratio ? `${Math.round(ratio * 100)}%` : 'nearly 100%';
      narrative = `Funds transferred into an intermediary account were immediately drained (${ratioPct} pass-through ratio) shortly after arrival. The graph shows ${acctCount} connected accounts moving ${fmtAmount(totalVolume)}${timeSpanDesc ? ` within ${timeSpanDesc}` : ''}. Transit accounts exhibiting near-zero balance holding time are strong indicators of unauthorized account takeover or mule transit.`;
    } else if (hasSpike) {
      typology = 'Anomalous Transaction Volume Spike';
      patternTag = 'Baseline Deviation';
      const spikeEv = evidenceList.find(e => e.rule_id === 'R3_AMOUNT_DEVIATION');
      const currAmt = spikeEv?.observed?.current_amount || totalVolume;
      const histMed = spikeEv?.observed?.historical_median;
      const mult = histMed ? `${(currAmt / histMed).toFixed(1)}x higher than baseline` : 'anomalous deviation';
      narrative = `An anomalous transaction volume deviation was observed involving accounts ${accounts.slice(0, 3).join(', ')}. The transacted amount of ${fmtAmount(currAmt)} represents a sudden spike (${mult}). This abrupt departure from established operational baseline indicates potential account takeover, payroll diversion, or urgent fraudulent extraction.`;
    } else if (hasRepeat) {
      typology = 'Repeated Fixed-Value Bursts';
      patternTag = 'Structuring / Micro-Bursts';
      narrative = `Repeated transactions of identical or near-identical denominations were executed in close sequence across ${acctCount} accounts, totaling ${fmtAmount(totalVolume)}${timeSpanDesc ? ` over ${timeSpanDesc}` : ''}. Rapid consecutive transfers with invariant amounts indicate automated scripting or deliberate threshold evasion.`;
    } else {
      typology = 'Connected Account Transaction Network';
      patternTag = 'Direct Activity';
      narrative = `The transaction graph covers ${allTxs.length} transaction(s) connecting ${acctCount} account(s) (${fmtAcctList(accounts, 4)}) with a total transaction volume of ${fmtAmount(totalVolume)}${timeSpanDesc ? ` over ${timeSpanDesc}` : ''}. ${triggerTxs.length} transaction(s) triggered compliance monitoring rules.`;
    }

    return {
      typology,
      patternTag,
      narrative,
      stats: {
        accountCount: acctCount,
        txCount: allTxs.length,
        triggerCount: triggerTxs.length,
        totalVolume: fmtAmount(totalVolume),
        timeSpan: timeSpanDesc || 'Single timestamp',
        sources: fmtAcctList(sources, 2),
        relays: fmtAcctList(relays, 2),
        sinks: fmtAcctList(sinks, 2)
      }
    };
  }

  function createNarrativeElement(caseData) {
    const data = generateGraphNarrative(caseData);
    if (!data) return null;

    const card = node('div', 'graph-narrative-card');

    const header = node('div', 'graph-narrative-header');
    const titleWrap = node('div', 'graph-narrative-title-wrap');
    titleWrap.append(
      node('span', 'graph-narrative-title', `Graph Narrative · ${data.typology}`)
    );
    const badgeEl = node('span', 'graph-narrative-badge', data.patternTag);
    header.append(titleWrap, badgeEl);

    const desc = node('p', 'graph-narrative-main', data.narrative);

    const meta = node('div', 'graph-narrative-meta');
    const items = [
      ['Total Flow', data.stats.totalVolume],
      ['Timespan', data.stats.timeSpan],
      ['Transactions', `${data.stats.txCount} (${data.stats.triggerCount} trigger)`],
      ['Sources', data.stats.sources],
      ['Relays', data.stats.relays],
      ['Sinks', data.stats.sinks]
    ];

    for (const [lbl, val] of items) {
      if (val && val !== 'None') {
        const item = node('div', 'graph-narrative-meta-item');
        item.append(
          node('span', 'graph-narrative-meta-label', lbl),
          node('span', 'graph-narrative-meta-value', val)
        );
        meta.append(item);
      }
    }

    card.append(header, desc, meta);
    return card;
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
    const emptyH2 = $('detail-empty')?.querySelector('h2');
    if (emptyH2) emptyH2.textContent = message;

    // Reset Side Panel
    $('dt').textContent = '—';
    $('dp').textContent = '—';
    $('dp').className = 'b';
    $('dl').innerHTML = '<dt>Source</dt><dd>—</dd><dt>Txn / Acct</dt><dd>—</dd><dt>Amount span</dt><dd>—</dd><dt>Status</dt><dd>—</dd><dt>Opened</dt><dd>—</dd>';
    $('dr').innerHTML = '<span class="d">No case selected</span>';
  }

  function updateSidePanel(caseData) {
    $('dt').textContent = caseData.case_id;
    const dp = $('dp');
    dp.textContent = lab(caseData.priority);
    dp.className = `b ${caseData.priority}`;

    const txCount = caseData.counts?.trigger_transactions_total ?? caseData.transaction_ids?.length ?? (caseData.trigger_transactions || []).length;
    const acctCount = caseData.counts?.account_ids_total ?? caseData.account_ids?.length ?? 0;
    const amtSpan = calculateAmountSpan(caseData);
    const source = caseData.source_scenario_id || 'CSV import';
    const status = caseData.status || 'OPEN';
    const rawOpened = caseData.created_at || caseData.updated_at;
    const opened = formatTimeAgo(rawOpened);
    const openedExact = formatExactTimestamp(rawOpened);

    const dl = $('dl');
    dl.replaceChildren();
    const rows = [
      ['Source', source],
      ['Txn / Acct', `${txCount} / ${acctCount}`],
      ['Amount span', amtSpan],
      ['Status', status],
      ['Opened', opened, openedExact],
    ];
    rows.forEach(([term, val, titleVal]) => {
      const dt = node('dt', '', term);
      const dd = node('dd', '', val);
      if (titleVal) dd.title = titleVal;
      dl.append(dt, dd);
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

  function getFilteredCases() {
    if (!state.searchQuery) return state.cases;
    const q = state.searchQuery.toLowerCase();
    return state.cases.filter(c => {
      if (c.case_id && c.case_id.toLowerCase().includes(q)) return true;
      if (c.source_scenario_id && c.source_scenario_id.toLowerCase().includes(q)) return true;
      if (c.priority && c.priority.toLowerCase().includes(q)) return true;
      if (c.status && c.status.toLowerCase().includes(q)) return true;
      if (c.account_ids && c.account_ids.some(a => a.toLowerCase().includes(q))) return true;
      const rules = c.rule_codes || (c.evidence || []).map(e => e.rule_id);
      if (rules.some(r => r && r.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  function renderQueue() {
    const rows = $('queue-list');
    rows.replaceChildren();

    const searchCountEl = $('search-count');
    const visibleCases = getFilteredCases();

    if (searchCountEl) {
      if (state.searchQuery) {
        searchCountEl.textContent = `${visibleCases.length} match${visibleCases.length === 1 ? '' : 'es'}`;
        searchCountEl.hidden = false;
      } else {
        searchCountEl.hidden = true;
      }
    }

    if (!visibleCases.length) {
      const tr = node('tr');
      const msg = state.searchQuery 
        ? `No cases match "${state.searchQuery}". Press Esc or clear search to reset.`
        : 'No cases match these filters. Replay a scenario or import a CSV to begin.';
      const td = node('td', 'd', msg);
      td.colSpan = 7;
      tr.appendChild(td);
      rows.appendChild(tr);
      return;
    }

    visibleCases.forEach((item, index) => {
      const isSelected = item.case_id === state.selectedId;
      const tr = node('tr', `case-row${isSelected ? ' sel active' : ''}`);
      tr.setAttribute('data-case-id', item.case_id);
      tr.tabIndex = 0;
      tr.setAttribute('aria-pressed', String(isSelected));

      // 1. Case ID & Source
      const tdCase = node('td');
      const idDiv = node('div', 'id mono', item.case_id);
      idDiv.title = item.case_id;
      const subDiv = node('div', 'd', item.source_scenario_id || 'CSV import');
      subDiv.title = item.source_scenario_id || 'CSV import';
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
        uniqueRules.slice(0, 2).forEach(r => rulesWrap.append(node('span', 'rl', r)));
        if (uniqueRules.length > 2) {
          rulesWrap.append(node('span', 'rl', `+${uniqueRules.length - 2}`));
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
      const rawOpened = item.created_at || item.updated_at;
      const tdOpened = node('td', 'opened-col', formatTimeAgo(rawOpened));
      tdOpened.title = formatExactTimestamp(rawOpened);

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
  const canHover = typeof window.matchMedia === 'function' ? window.matchMedia('(hover:hover)').matches : true;

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

    const narrativeContainer = $('modal-graph-narrative');
    if (narrativeContainer) {
      narrativeContainer.replaceChildren();
      const narrativeCard = createNarrativeElement(caseData);
      if (narrativeCard) narrativeContainer.append(narrativeCard);
    }

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
  $('oc').addEventListener('click', async () => {
    const targetCaseId = state.selectedCaseData?.case_id || state.cases[0]?.case_id;
    if (targetCaseId) {
      if (!state.selectedCaseData || state.selectedCaseData.case_id !== targetCaseId) {
        await loadCase(targetCaseId);
      }
      const invSection = $('investigation-section');
      if (invSection) {
        invSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
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
      const row = node('tr');
      row.setAttribute('data-tx-id', tx.transaction_id);
      row.addEventListener('mouseenter', () => {
        const line = document.querySelector(`.graph-tx-line[data-tx-id="${tx.transaction_id}"]`);
        if (line) line.classList.add('graph-edge-hover');
      });
      row.addEventListener('mouseleave', () => {
        const line = document.querySelector(`.graph-tx-line[data-tx-id="${tx.transaction_id}"]`);
        if (line) line.classList.remove('graph-edge-hover');
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
        auditResult.textContent = auditMessage(result);
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
      const eyebrowP = node('p', 'eyebrow mono', `CASE ${caseData.case_id}`);
      const copyBtn = node('button', 'btn-copy-id', 'Copy ID');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(caseData.case_id).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy ID'; }, 1500);
        }).catch(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy ID'; }, 1500);
        });
      });
      eyebrowP.append(copyBtn);

      titleWrap.append(
        eyebrowP,
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
      const svgNS = 'http://www.w3.org/2000/svg';
      const graphSvg = document.createElementNS(svgNS, 'svg');
      graphSvg.setAttribute('viewBox', '0 0 1000 520');
      graphSvg.setAttribute('role', 'img');
      graphSvg.setAttribute('class', 'case-graph');
      graphSvg.setAttribute('aria-label', 'Connected transaction account graph');
      const layout = buildGraphLayout(caseData);
      drawGraph(layout, graphSvg, false);
      graphBox.append(graphSvg);

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
      const narrativeBox = createNarrativeElement(caseData);
      if (narrativeBox) graphBox.append(narrativeBox);
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

      // Limitations and interpretation
      if ((caseData.limitations || []).length) {
        const details = node('details', 'limitations-box');
        details.open = true;
        const summary = node('summary', 'limitations-header', 'Limitations and interpretation');
        const list = node('ul', 'limitations-list');
        for (const limit of caseData.limitations) list.append(node('li', 'limitations-item', limit));
        details.append(summary, list);
        detail.append(details);
      }

      for (const [title, value] of [["Engine trace and near gates", caseData.trace], ["Related security events · correlation, not causation", caseData.related_security_events]]) {
        if (value) { const section = node("details", "review-history"); section.append(node("summary", "", title), node("pre", "", JSON.stringify(value, null, 2))); detail.append(section); }
      }

      // Human review form
      detail.append(sectionHeading('Human review', 'Closing requires an explicit outcome'));
      renderReviewForm(detail, caseData);

      // Review history card in case detail
      if ((caseData.review_history || []).length) {
        const historyCard = node('section', 'card review-history-card');
        historyCard.style.marginTop = '20px';
        historyCard.style.border = '1px solid var(--line)';
        historyCard.style.borderRadius = '12px';
        historyCard.style.padding = '16px 20px';
        
        const ch = node('div', 'ch');
        ch.append(
          node('h3', '', `Case Review History (${caseData.review_history.length} decision event${caseData.review_history.length > 1 ? 's' : ''})`),
          node('span', 'chip mono', 'Tamper-evident chain')
        );
        historyCard.append(ch);

        const tableWrap = node('div', 'tw');
        tableWrap.style.marginTop = '10px';
        const tbl = node('table');
        tbl.innerHTML = '<thead><tr><th>Timestamp</th><th>Workflow Transition</th><th>Outcome</th><th>Reviewer</th><th>Reasoning / Notes</th><th>Audit Hash</th></tr></thead>';
        const tbody = node('tbody');
        caseData.review_history.forEach(ev => {
          const r = node('tr');
          const tdTime = node('td', 'mono', formatTimeAgo(ev.created_at));
          tdTime.title = formatExactTimestamp(ev.created_at);
          const tdTrans = node('td', '', `${ev.previous_status || 'OPEN'} → ${ev.new_status}`);
          const tdOut = node('td');
          if (ev.new_outcome) tdOut.append(badge(ev.new_outcome));
          else tdOut.append(node('span', 'd', '—'));
          const tdRev = node('td', 'mono', ev.reviewer || 'analyst');
          const tdNote = node('td', '', ev.note || '—');
          const tdHash = node('td', 'chip mono', (ev.event_hash || '').slice(0, 10) + '…');
          tdHash.title = ev.event_hash || '';
          r.append(tdTime, tdTrans, tdOut, tdRev, tdNote, tdHash);
          tbody.append(r);
        });
        tbl.append(tbody);
        tableWrap.append(tbl);
        historyCard.append(tableWrap);
        detail.append(historyCard);
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
      state.viewMode = result.run_id ? 'run' : 'all';
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
    if (file.size > 100 * 1024 * 1024) {
      showToast('The file exceeds the 100 MiB upload limit.', true);
      return;
    }
    clearDetail('Importing CSV…');
    try {
      const result = await api('/api/transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: file,
      });
      runResult(`CSV imported: ${result.transaction_count} rows; ${result.case_count} case(s).`, result);
      state.latestRunId = result.run_id || null;
      state.viewMode = result.run_id ? 'run' : 'all';
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

  let evaluationSnapshot = null;
  let auditSnapshot = null;
  let evaluationRequest = 0;

  function downloadEvidence(data, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function auditMessage(result) {
    const status = !result.valid ? `INVALID: ${result.reason || 'integrity check failed'}`
      : result.event_count === 0 ? 'No review events — no recorded decision history to verify'
      : 'Review chain valid; current review state matches';
    return `${status}. ${result.event_count} event(s). Checked ${result.checked_at || 'at request time'}. ${result.warning || ''}`;
  }

  let evalPollingTimer = null;
  async function loadEvaluation(silent = false) {
    const request = ++evaluationRequest;
    if (!silent) {
      evaluationSnapshot = null;
      $('evaluation-export').disabled = true;
      $('evaluation-content').hidden = true;
      $('evaluation-status').textContent = 'Loading current evidence…';
    }
    const source = $('evaluation-source').value;
    try {
      const result = await api('/api/evaluation/summary' + (source ? `?source_kind=${encodeURIComponent(source)}` : ''));
      if (request !== evaluationRequest) return;
      evaluationSnapshot = result;
      $('evaluation-status').textContent = `Snapshot: ${result.generated_at} · Source: ${$('evaluation-source').selectedOptions[0].textContent}`;
      const c = result.cases;
      const metrics = $('evaluation-metrics'); metrics.replaceChildren();
      const values = [['Stored cases', c.total], ['Closed cases', c.closed], ['Review completion', c.review_completion_rate === null ? 'Not available' : `${(c.review_completion_rate*100).toFixed(1)}%`], ['Recorded runs', result.runs.total]];
      for (const [label, value] of values) {
        const card = node('article', 'card eval-metric');
        card.append(node('p', 'eyebrow', label), node('strong', '', String(value))); metrics.append(card);
      }
      const outcomes = $('evaluation-outcomes'); outcomes.replaceChildren();
      for (const [key, label] of [['CONFIRMED_SUSPICIOUS', 'Confirmed suspicious'], ['FALSE_POSITIVE', 'False positive'], ['INCONCLUSIVE', 'Inconclusive']]) {
        outcomes.append(node('p', '', `${label}: ${c.outcome_counts[key] || 0}`));
      }
      outcomes.append(node('p', 'd', `Open / investigating / escalated: ${c.total-c.closed}. ${c.closed ? 'Closed includes inconclusive reviews.' : 'No outcomes yet is not a zero-error result.'}`));
      $('evaluation-model').textContent = `Optional model artifact status: ${result.model_status}. Evaluation artifact status: ${result.evaluation_status}. ${result.metrics === null ? 'No measured model metrics are available from that artifact.' : 'An optional model report exists; these operational counts do not validate it.'}`;
      $('evaluation-legacy').textContent = `${result.legacy_cases_without_run_metadata} older case(s) lack run metadata. They appear only in the all-data view.`;
      $('evaluation-run-count').textContent = result.runs.total ? `Showing ${result.runs.returned} of ${result.runs.total} recorded runs, newest first.${result.runs.truncated ? ' Older runs are omitted from this bounded snapshot.' : ''}` : 'No recorded runs in this source. Replay a scenario or import a CSV to create one; older records are not reconstructed.';
      
      const runsKey = (result.runs.items || []).map(r => `${r.run_id}:${r.completed_at}`).join('|');
      const rows = $('evaluation-runs');

      // Preserve any open raw provenance details across background polling
      const openRunIds = new Set(
        Array.from(rows.querySelectorAll('details[open]')).map(d => d.dataset.runId).filter(Boolean)
      );

      // Only rebuild table if manual/initial load, or if runs data has actually changed
      if (!silent || state._lastRunsKey !== runsKey) {
        state._lastRunsKey = runsKey;
        rows.replaceChildren();
        for (const run of result.runs.items) {
          const row = node('tr');
          const graph = run.graph_summary;
          const cells = [ `${run.source} (${run.source_kind})\n${run.run_id}`, run.completed_at,
            `${run.transaction_count} transactions / ${run.case_count} cases`,
            `${graph.graph_analysis_incomplete ? 'Graph search incomplete' : 'Graph search budget not exhausted'}; ${run.cases_with_truncation} case(s) with truncated payloads`,
            `${run.analysis_duration_ms} ms`];
          for (const text of cells) row.append(node('td', '', text));
          const td = node('td');
          const inspectBtn = node('button', 'pill btn', 'Inspect in Simulator');
          inspectBtn.style.padding = '5px 12px';
          inspectBtn.style.fontSize = '12px';
          inspectBtn.style.cursor = 'pointer';
          inspectBtn.style.display = 'block';
          inspectBtn.style.marginBottom = '6px';
          inspectBtn.style.background = 'var(--dark)';
          inspectBtn.style.color = '#fff';
          inspectBtn.addEventListener('click', () => {
            window.location.href = `/simulation.html?scenario=${encodeURIComponent(run.source)}`;
          });
          const details = node('details');
          details.dataset.runId = run.run_id;
          if (openRunIds.has(run.run_id)) {
            details.open = true;
          }
          details.addEventListener('toggle', () => {
            if (details.open) openRunIds.add(run.run_id);
            else openRunIds.delete(run.run_id);
          });
          details.append(node('summary', '', 'Raw provenance payload'), node('pre', '', JSON.stringify(run, null, 2)));
          td.append(inspectBtn, details);
          row.append(td);
          rows.append(row);
        }
      }
      $('evaluation-settings').textContent = JSON.stringify(result.active_policy, null, 2);
      const policy = $('evaluation-policy'); policy.replaceChildren();
      for (const entry of result.priority_policy) policy.append(node('p', '', `${entry.priority}: ${entry.description}`));
      const limits = $('evaluation-limitations'); limits.replaceChildren();
      for (const text of result.limitations) limits.append(node('li', '', text));
      $('evaluation-content').hidden = false; $('evaluation-export').disabled = false;
    } catch (error) {
      if (request !== evaluationRequest) return;
      if (!silent) $('evaluation-status').textContent = `Evidence unavailable: ${error.message}. Refresh to retry; no cached figures are shown.`;
    }
    try {
      const result = await api('/api/cases?limit=20');
      if (request !== evaluationRequest) return;
      const options = $('audit-case-options'); options.replaceChildren();
      for (const item of result.cases) {
        const option = node('option'); option.value = item.case_id;
        option.label = `${item.source_scenario_id} · ${item.status}`; options.append(option);
      }
    } catch (_) { $('audit-case-options').replaceChildren(); }
  }

  /* Multi-page Routing & View Management */
  const PAGES = ['queue', 'reviews', 'scenarios', 'import', 'evaluation'];

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
    if (pageId === 'reviews') loadReviewHistoryPage();
    if (pageId === 'evaluation') {
      loadEvaluation(false);
      if (!evalPollingTimer) {
        evalPollingTimer = setInterval(() => {
          if (state.activePage === 'evaluation' && !document.hidden) {
            loadEvaluation(true);
          }
        }, 3000);
      }
    } else {
      if (evalPollingTimer) {
        clearInterval(evalPollingTimer);
        evalPollingTimer = null;
      }
    }
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
          state.viewMode = result.run_id ? 'run' : 'all';
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

  $('evaluation-refresh').addEventListener('click', loadEvaluation);
  $('evaluation-source').addEventListener('change', loadEvaluation);
  $('evaluation-export').addEventListener('click', () => {
    if (evaluationSnapshot) downloadEvidence(evaluationSnapshot, 'traceguard-evaluation.json');
  });
  const auditBtn = $('audit-inspector-btn');
  const auditInput = $('audit-inspector-input');
  const auditBox = $('audit-inspector-result');
  auditInput.addEventListener('input', () => {
    auditSnapshot = null; $('audit-export').disabled = true; auditBox.hidden = true;
  });
  auditInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !auditBtn.disabled) auditBtn.click(); });
  $('audit-export').addEventListener('click', () => {
    if (auditSnapshot) downloadEvidence(auditSnapshot, 'traceguard-audit-verification.json');
  });
  auditBtn.addEventListener('click', async () => {
    const cid = auditInput.value.trim();
    if (!cid) { showToast('Select or paste a case ID.', true); return; }
    auditSnapshot = null; $('audit-export').disabled = true;
    auditBtn.disabled = true; auditBox.hidden = false; auditBox.textContent = 'Verifying stored review history…';
    try {
      const result = await api(`/api/cases/${encodeURIComponent(cid)}/audit`);
      if (auditInput.value.trim() !== cid) return;
      auditSnapshot = result;
      auditBox.textContent = `Case ${cid}: ${auditMessage(result)}${result.head_hash ? ` Head: ${result.head_hash}` : ''}`;
      $('audit-export').disabled = false;
    } catch (err) {
      if (auditInput.value.trim() === cid) auditBox.textContent = `Audit check unavailable: ${err.message}`;
    } finally { auditBtn.disabled = false; }
  });

  // Setup event listeners
  const seedBtn = $('seed-sample-btn');
  if (seedBtn) {
    seedBtn.addEventListener('click', async () => {
      try {
        seedBtn.disabled = true;
        seedBtn.textContent = 'Loading sample data…';
        const res = await api('/api/realtime/seed', { method: 'POST' });
        showToast(res.message || 'Sample data loaded.', res.status !== 'ok');
        await refreshCases(true);
      } catch (err) {
        showToast(err.message || 'Failed to load sample data', true);
      } finally {
        seedBtn.disabled = false;
        seedBtn.textContent = 'Load sample graph data';
      }
    });
  }
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

  // Live search bar wireup
  const searchInput = $('queue-search');
  const searchClear = $('search-clear-btn');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value.trim().toLowerCase();
      if (searchClear) searchClear.hidden = !state.searchQuery;
      renderQueue();
    });
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        state.searchQuery = '';
        searchClear.hidden = true;
        searchInput.focus();
        renderQueue();
      });
    }
  }

  // Keyboard Navigation: J/K to navigate, / to search, G for graph modal, Esc to close
  window.addEventListener('keydown', (e) => {
    const isEditing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';
    if (e.key === 'Escape') {
      if ($('ov') && !$('ov').hidden) {
        closeModal();
      } else if (searchInput && document.activeElement === searchInput) {
        searchInput.value = '';
        state.searchQuery = '';
        if (searchClear) searchClear.hidden = true;
        searchInput.blur();
        renderQueue();
      }
      return;
    }

    if (isEditing) return;

    if (e.key === '/') {
      e.preventDefault();
      if (searchInput) searchInput.focus();
      return;
    }

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      stepCaseSelection(1);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      stepCaseSelection(-1);
    } else if (e.key === 'g' || e.key === 'G') {
      if (state.selectedCaseData) {
        e.preventDefault();
        openModal(state.selectedCaseData);
      }
    }
  });

  function stepCaseSelection(delta) {
    const visibleCases = getFilteredCases();
    if (!visibleCases.length) return;
    const currentIdx = visibleCases.findIndex(c => c.case_id === state.selectedId);
    let nextIdx = currentIdx + delta;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= visibleCases.length) nextIdx = visibleCases.length - 1;
    const targetCase = visibleCases[nextIdx];
    if (targetCase && targetCase.case_id !== state.selectedId) {
      loadCase(targetCase.case_id);
      const row = document.querySelector(`.case-row[data-case-id="${targetCase.case_id}"]`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /* ========================================== */
  /* REVIEW HISTORY & AUDIT LEDGER PAGE         */
  /* ========================================== */
  let cachedReviews = [];
  let reviewOutcomeFilter = 'ALL';
  let reviewSearchQuery = '';

  function filterAndRenderReviews() {
    const tableBody = $('reviews-table-body');
    if (!tableBody) return;

    let filtered = cachedReviews;
    if (reviewOutcomeFilter !== 'ALL') {
      filtered = filtered.filter(r => r.new_outcome === reviewOutcomeFilter);
    }
    if (reviewSearchQuery) {
      const q = reviewSearchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        (r.case_id || '').toLowerCase().includes(q) ||
        (r.reviewer || '').toLowerCase().includes(q) ||
        (r.note || '').toLowerCase().includes(q) ||
        (r.event_hash || '').toLowerCase().includes(q) ||
        (r.new_status || '').toLowerCase().includes(q) ||
        (r.new_outcome || '').toLowerCase().includes(q)
      );
    }

    const sub = $('rev-ledger-subtitle');
    if (sub) {
      sub.textContent = `Showing ${filtered.length} of ${cachedReviews.length} recorded decision event${cachedReviews.length === 1 ? '' : 's'} in tamper-evident order`;
    }

    tableBody.replaceChildren();

    if (!filtered.length) {
      const tr = node('tr');
      const td = node('td');
      td.colSpan = 7;
      td.style.textAlign = 'center';
      td.style.padding = '40px 20px';

      if (!cachedReviews.length) {
        td.innerHTML = `
          <div style="max-width:440px;margin:0 auto;text-align:center;">
            <div class="eyebrow" style="margin-bottom:8px;letter-spacing:0.06em;">AUDIT LEDGER EMPTY</div>
            <h3 style="font-size:16px;font-weight:700;margin-bottom:6px;color:var(--ink);">No Human Review Decisions Logged Yet</h3>
            <p class="d" style="margin-bottom:16px;line-height:1.5;">Review events are generated when compliance analysts inspect a case in the queue, select an outcome (Confirmed Suspicious, False Positive, or Inconclusive), and record a decision.</p>
            <a href="#/queue" class="pill btn" style="display:inline-flex;align-items:center;gap:6px;background:var(--dark);color:#fff;text-decoration:none;">Open Case Queue</a>
          </div>
        `;
      } else {
        td.innerHTML = `
          <div style="text-align:center;padding:24px;">
            <p class="d">No review events match the active search or outcome filter.</p>
          </div>
        `;
      }
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }

    filtered.forEach(rev => {
      const tr = node('tr');

      // 1. Timestamp
      const tdTime = node('td', 'mono', formatExactTimestamp(rev.created_at) || rev.created_at || '—');
      tdTime.style.fontSize = '11px';
      tdTime.style.whiteSpace = 'nowrap';

      // 2. Case ID (clickable to jump into Case Queue)
      const tdCase = node('td');
      const caseLink = node('a', 'mono', rev.case_id);
      caseLink.href = '#/queue';
      caseLink.style.fontWeight = '700';
      caseLink.style.color = 'var(--ink)';
      caseLink.style.textDecoration = 'underline';
      caseLink.style.cursor = 'pointer';
      caseLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = '#/queue';
        loadCase(rev.case_id);
      });
      tdCase.append(caseLink);

      // 3. Workflow Transition
      const tdTransition = node('td');
      const prevB = badge(rev.previous_status || 'OPEN');
      const arrow = document.createTextNode(' → ');
      const nextB = badge(rev.new_status || 'CLOSED');
      tdTransition.append(prevB, arrow, nextB);

      // 4. Outcome Verdict
      const tdOutcome = node('td');
      if (rev.new_outcome) {
        tdOutcome.append(badge(rev.new_outcome));
      } else {
        tdOutcome.append(node('span', 'd', '—'));
      }

      // 5. Reviewer
      const tdReviewer = node('td', 'mono');
      const revTag = node('span', 'chip', `Reviewer: ${rev.reviewer || 'analyst'}`);
      revTag.style.fontSize = '11px';
      tdReviewer.append(revTag);

      // 6. Reasoning / Note
      const tdNote = node('td', '', rev.note || '—');
      tdNote.style.maxWidth = '260px';
      tdNote.style.fontSize = '12px';
      tdNote.style.lineHeight = '1.45';

      // 7. Cryptographic Integrity
      const tdIntegrity = node('td');
      const hashBadge = node('span', 'chip mono', rev.event_hash ? rev.event_hash.slice(0, 10) + '…' : 'Verified');
      hashBadge.title = `Event Hash: ${rev.event_hash || ''}\nPrev Hash: ${rev.prev_hash || 'GENESIS'}\nAlgorithm: SHA-256 tamper-evident chain`;
      hashBadge.style.background = 'var(--lemon-soft)';
      hashBadge.style.fontSize = '10px';
      hashBadge.style.cursor = 'help';
      tdIntegrity.append(hashBadge);

      tr.append(tdTime, tdCase, tdTransition, tdOutcome, tdReviewer, tdNote, tdIntegrity);
      tableBody.append(tr);
    });
  }

  async function loadReviewHistoryPage() {
    const tableBody = $('reviews-table-body');
    if (!tableBody) return;

    try {
      const [reviews, outcomes] = await Promise.all([
        api('/api/reviews?limit=100').catch(() => []),
        api('/api/analytics/review-outcomes').catch(() => ({}))
      ]);

      cachedReviews = Array.isArray(reviews) ? reviews : [];

      if ($('rev-total-count')) $('rev-total-count').textContent = outcomes.reviewed_cases_with_outcome ?? cachedReviews.length ?? 0;
      if ($('rev-suspicious-count')) $('rev-suspicious-count').textContent = outcomes.outcome_counts?.CONFIRMED_SUSPICIOUS ?? 0;
      if ($('rev-fp-count')) $('rev-fp-count').textContent = outcomes.outcome_counts?.FALSE_POSITIVE ?? 0;
      if ($('rev-inconclusive-count')) $('rev-inconclusive-count').textContent = outcomes.outcome_counts?.INCONCLUSIVE ?? 0;

      if ($('rev-integrity-status')) {
        const allHashed = cachedReviews.length > 0 && cachedReviews.every(r => typeof r.event_hash === 'string' && r.event_hash.length >= 10);
        $('rev-integrity-status').textContent = cachedReviews.length === 0 ? 'Verified' : allHashed ? '100% Valid' : 'Discrepancy';
      }

      filterAndRenderReviews();
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="7" class="d" style="text-align:center;padding:24px;color:#c00;">Failed to load reviews: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  const refRevBtn = $('refresh-reviews-btn');
  if (refRevBtn) refRevBtn.addEventListener('click', loadReviewHistoryPage);

  const revSearchInput = $('reviews-search');
  const revSearchClear = $('reviews-search-clear');
  if (revSearchInput) {
    revSearchInput.addEventListener('input', () => {
      reviewSearchQuery = revSearchInput.value.trim();
      if (revSearchClear) revSearchClear.hidden = !reviewSearchQuery;
      filterAndRenderReviews();
    });
    if (revSearchClear) {
      revSearchClear.addEventListener('click', () => {
        revSearchInput.value = '';
        reviewSearchQuery = '';
        revSearchClear.hidden = true;
        filterAndRenderReviews();
        revSearchInput.focus();
      });
    }
  }

  const outcomeButtons = document.querySelectorAll('#reviews-outcome-filters button');
  outcomeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      outcomeButtons.forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      reviewOutcomeFilter = btn.dataset.outcome || 'ALL';
      filterAndRenderReviews();
    });
  });

    // Initialize
  renderFilterButtons();
  loadScenarios();
  handleRoute();
  refreshCases(false);
})();
