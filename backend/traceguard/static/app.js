/* TraceGuard local workbench. All user-facing text is written with textContent; no imported value is injected as HTML. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { scenarios: [], cases: [], selectedId: null, queueRequest: 0, detailRequest: 0, total: 0, offset: 0, pageSize: 100, latestRunId: null, viewMode: 'all' };
  const priorityValue = { HIGH: 3, MEDIUM: 2, LOW: 1, INSUFFICIENT_HISTORY: 0 };
  let toastTimer = null;

  function node(tag, className = '', text = null) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== null && text !== undefined) element.textContent = String(text);
    return element;
  }
  function badge(text, extra = '') {
    const safe = String(text || 'UNKNOWN').toLowerCase();
    return node('span', `badge badge-${safe}${extra ? ` ${extra}` : ''}`, text || 'UNKNOWN');
  }
  function showToast(message, error = false) {
    const box = $('toast');
    box.textContent = message;
    box.className = `toast${error ? ' error' : ''}`;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, signal: AbortSignal.timeout(120000), headers: { Accept: 'application/json', ...(options.headers || {}) } });
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
    $('connection-status').textContent = message;
    $('connection-status').previousElementSibling.classList.toggle('ok', ok);
  }
  function selectedQuery() {
    const params = new URLSearchParams();
    if ($('priority-filter').value) params.set('priority', $('priority-filter').value);
    if ($('status-filter').value) params.set('status', $('status-filter').value);
    if (state.viewMode === 'run' && state.latestRunId) params.set('run_id', state.latestRunId);
    params.set('limit', String(state.pageSize));
    params.set('offset', String(state.offset));
    return params.toString();
  }
  function updateMetrics() {
    const all = state.cases;
    $('metric-all').textContent = state.total;
    $('metric-high').textContent = all.filter(c => c.priority === 'HIGH').length;
    $('metric-medium').textContent = all.filter(c => c.priority === 'MEDIUM').length;
    $('metric-low').textContent = all.filter(c => c.priority === 'LOW' || c.priority === 'INSUFFICIENT_HISTORY').length;
    $('queue-count').textContent = state.total;
  }
  function clearDetail(message = 'Select a case to investigate') {
    state.detailRequest += 1;
    state.selectedId = null;
    $('case-detail').replaceChildren(); $('case-detail').hidden = true;
    $('detail-empty').hidden = false;
    $('detail-empty').querySelector('h2').textContent = message;
  }
  function runResult(message, result = null) {
    const box = $('run-result'); box.replaceChildren(node('p', '', message)); box.hidden = false;
    if (!result) return;
    for (const warning of [...(result.warnings || []), ...(result.analysis_warnings || [])]) box.append(node('p', 'caveat', warning));
    if (result.run_id) box.append(node('p', '', `Run: ${result.run_id}`));
    if (result.cases_truncated) box.append(node('p', 'caveat', `Import preview truncated: ${result.cases_returned} of ${result.case_count} cases returned.`));
    if (result.notice) box.append(node('p', '', result.notice));
  }
  function renderPagination() {
    const container = $('queue-pagination');
    container.replaceChildren();
    const totalPages = Math.ceil(state.total / state.pageSize);
    const currentPage = Math.floor(state.offset / state.pageSize) + 1;
    if (totalPages <= 1) { container.hidden = true; return; }
    container.hidden = false;
    const prev = node('button', 'button button-secondary', '← Prev');
    prev.type = 'button'; prev.disabled = currentPage <= 1;
    prev.addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.pageSize); refreshCases(false); });
    const info = node('span', 'pagination-info', `Page ${currentPage} of ${totalPages} (${state.total} total)`);
    const next = node('button', 'button button-secondary', 'Next →');
    next.type = 'button'; next.disabled = currentPage >= totalPages;
    next.addEventListener('click', () => { state.offset = state.offset + state.pageSize; refreshCases(false); });
    container.append(prev, info, next);
  }
  function renderViewToggle() {
    const container = $('view-toggle');
    container.replaceChildren();
    if (!state.latestRunId) { container.hidden = true; return; }
    container.hidden = false;
    const allBtn = node('button', `button ${state.viewMode === 'all' ? 'button-primary' : 'button-secondary'}`, 'All cases');
    allBtn.type = 'button';
    allBtn.addEventListener('click', () => { state.viewMode = 'all'; state.offset = 0; refreshCases(false); });
    const runBtn = node('button', `button ${state.viewMode === 'run' ? 'button-primary' : 'button-secondary'}`, 'Latest run');
    runBtn.type = 'button';
    runBtn.addEventListener('click', () => { state.viewMode = 'run'; state.offset = 0; refreshCases(false); });
    container.append(allBtn, runBtn);
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
      updateMetrics(); renderQueue(); renderPagination(); renderViewToggle();
      $('queue-limit').hidden = true;
      setConnection(true, 'API connected');
      if (previousId && state.cases.some(c => c.case_id === previousId)) await loadCase(previousId);
      else if (state.cases.length) await loadCase(state.cases[0].case_id);
      else clearDetail('No cases match these filters');
    } catch (error) {
      if (request !== state.queueRequest) return;
      state.cases = []; state.total = 0; updateMetrics();
      clearDetail('Case queue unavailable — refresh to retry');
      for (const id of ['metric-all', 'metric-high', 'metric-medium', 'metric-low', 'queue-count']) $(id).textContent = '—';
      setConnection(false, 'API unavailable');
      $('queue-list').replaceChildren(node('div', 'empty-state', `Could not load cases. ${error.message}`));
      showToast(`API request failed: ${error.message}`, true);
    }
  }
  function renderQueue() {
    const list = $('queue-list'); list.replaceChildren();
    if (!state.cases.length) { list.append(node('div', 'empty-state', 'No cases match these filters. Replay a scenario or import a CSV to begin.')); return; }
    for (const item of state.cases) {
      const button = node('button', `case-row${item.case_id === state.selectedId ? ' active' : ''}`);
      button.type = 'button'; button.setAttribute('aria-pressed', String(item.case_id === state.selectedId));
      const head = node('div', 'case-row-head');
      head.append(node('strong', '', item.case_id), badge(item.priority));
      button.append(head, node('p', '', item.summary || 'Review supporting evidence.'), node('div', 'case-row-meta', `${item.source_scenario_id || 'CSV import'} · ${item.status || 'OPEN'}`));
      button.addEventListener('click', () => loadCase(item.case_id)); list.append(button);
    }
  }
  function stat(label, value) {
    const card = node('div', 'case-stat'); card.append(node('span', '', label), node('strong', '', value ?? '—')); return card;
  }
  function sectionHeading(title, hint = '') {
    const section = node('div', 'section-heading'); section.append(node('h3', '', title));
    if (hint) section.append(node('span', '', hint)); return section;
  }
  function fmtAmount(value, currency = null) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '—');
    return `${currency ? `${currency} ` : ''}${number.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
  function allCaseTransactions(caseData) {
    const map = new Map();
    for (const tx of [...(caseData.context_transactions || []), ...(caseData.trigger_transactions || [])]) {
      if (tx && tx.transaction_id) map.set(tx.transaction_id, tx);
    }
    return [...map.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.transaction_id).localeCompare(String(b.transaction_id)));
  }
  function renderGraph(container, caseData) {
    const transactions = allCaseTransactions(caseData);
    const accountIds = [...new Set(transactions.flatMap(tx => [tx.sender_id, tx.recipient_id]).filter(Boolean))].sort().slice(0, 22);
    if (!accountIds.length) { container.append(node('div', 'empty-state', 'No connected-account edges were returned for this case.')); return; }
    const displayTx = transactions.filter(tx => accountIds.includes(tx.sender_id) && accountIds.includes(tx.recipient_id)).slice(0, 60);
    const width = 700, height = 300, cx = width / 2, cy = height / 2, radiusX = Math.min(270, width * 0.40), radiusY = 104;
    const points = new Map();
    accountIds.forEach((account, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index / Math.max(1, accountIds.length));
      points.set(account, { x: cx + radiusX * Math.cos(angle), y: cy + radiusY * Math.sin(angle) });
    });
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Connected transaction account graph'); svg.classList.add('case-graph');
    const defs = document.createElementNS(svgNS, 'defs'); const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', 'tg-arrow'); marker.setAttribute('markerWidth', '7'); marker.setAttribute('markerHeight', '7'); marker.setAttribute('refX', '5'); marker.setAttribute('refY', '3'); marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS(svgNS, 'path'); arrow.setAttribute('d', 'M0,0 L6,3 L0,6 z'); arrow.setAttribute('fill', '#8394ac'); marker.append(arrow); defs.append(marker); svg.append(defs);
    const triggerSet = new Set(caseData.transaction_ids || []);
    for (const tx of displayTx) {
      const a = points.get(tx.sender_id), b = points.get(tx.recipient_id); if (!a || !b) continue;
      const line = document.createElementNS(svgNS, 'line'); line.setAttribute('x1', String(a.x)); line.setAttribute('y1', String(a.y)); line.setAttribute('x2', String(b.x)); line.setAttribute('y2', String(b.y));
      line.setAttribute('stroke', triggerSet.has(tx.transaction_id) ? '#d94b51' : '#9aa9bd'); line.setAttribute('stroke-width', triggerSet.has(tx.transaction_id) ? '2.2' : '1.3'); line.setAttribute('opacity', triggerSet.has(tx.transaction_id) ? '0.95' : '0.65'); line.setAttribute('marker-end', 'url(#tg-arrow)');
      const title = document.createElementNS(svgNS, 'title'); title.textContent = `${tx.transaction_id}: ${tx.sender_id} → ${tx.recipient_id}, amount ${tx.amount}, ${tx.timestamp}`; line.append(title); svg.append(line);
    }
    accountIds.forEach(account => {
      const point = points.get(account); const group = document.createElementNS(svgNS, 'g');
      const circle = document.createElementNS(svgNS, 'circle'); circle.setAttribute('cx', String(point.x)); circle.setAttribute('cy', String(point.y)); circle.setAttribute('r', '7.5'); circle.setAttribute('fill', '#315cbd'); circle.setAttribute('stroke', '#ffffff'); circle.setAttribute('stroke-width', '2');
      const title = document.createElementNS(svgNS, 'title'); title.textContent = account; circle.append(title); group.append(circle);
      const label = document.createElementNS(svgNS, 'text'); label.setAttribute('x', String(point.x)); label.setAttribute('y', String(point.y + 20)); label.setAttribute('text-anchor', 'middle'); label.setAttribute('font-size', '10'); label.setAttribute('fill', '#34455e'); label.textContent = account.length > 16 ? `${account.slice(0, 13)}…` : account; group.append(label); svg.append(group);
    });
    container.append(svg);
    const legend = node('div', 'graph-legend');
    const item1 = node('span'); item1.append(node('i', 'legend-dot', ''), document.createTextNode(' Trigger transaction')); item1.firstChild.style.background = '#d94b51';
    const item2 = node('span'); item2.append(node('i', 'legend-dot', ''), document.createTextNode(' Context transaction')); item2.firstChild.style.background = '#9aa9bd';
    legend.append(item1, item2); container.append(legend);
    if (transactions.length > displayTx.length || accountIds.length >= 22) container.append(node('p', 'micro-copy', `Graph is bounded to ${displayTx.length} displayed transactions and ${accountIds.length} accounts. This is a visualization limit, not the full network.`));
  }
  function renderTransactions(container, caseData) {
    const transactions = allCaseTransactions(caseData);
    if (!transactions.length) { container.append(node('div', 'empty-state', 'No transaction rows were included in the case response. Check the counts and truncation fields.')); return; }
    const wrap = node('div', 'table-wrap'); const table = node('table', 'tx-table');
    const thead = node('thead'); const header = node('tr');
    for (const text of ['Transaction / type', 'Time', 'Sender → recipient', 'Amount', 'Role']) header.append(node('th', '', text));
    thead.append(header); table.append(thead); const body = node('tbody'); const triggerSet = new Set(caseData.transaction_ids || []);
    for (const tx of transactions) {
      const row = node('tr'); row.append(node('td', '', `${tx.transaction_id}\n${tx.transaction_type || 'TRANSFER'}`), node('td', '', tx.timestamp || '—'), node('td', '', `${tx.sender_id} → ${tx.recipient_id}`), node('td', '', fmtAmount(tx.amount, tx.currency)), node('td', '', triggerSet.has(tx.transaction_id) ? 'Trigger' : 'Context')); body.append(row);
    }
    table.append(body); wrap.append(table); container.append(wrap);

  }
  function renderEvidence(container, caseData) {
    const evidence = caseData.evidence || [];
    if (!evidence.length) { container.append(node('div', 'empty-state', 'No evidence items were included. This can happen for a coverage-only case.')); return; }
    for (const ev of evidence) {
      const card = node('article', 'evidence-card'); const head = node('div', 'evidence-head'); const titleWrap = node('div');
      titleWrap.append(node('h4', '', ev.title || ev.rule_id || 'Evidence'), node('div', 'rule-code', `${ev.rule_id || 'UNKNOWN'} · ${ev.kind || 'UNKNOWN'}`));
      head.append(titleWrap, badge(ev.kind || 'UNKNOWN')); card.append(head, node('p', '', ev.description || 'No description provided.'));
      const clipped = Object.entries(ev.observed || {}).filter(([key, value]) => key.includes('truncated') && value === true).map(([key]) => key);
      if (clipped.length) card.append(node('p', 'notice', `Supporting evidence is incomplete: ${clipped.join(', ')}. Observed totals may exceed the returned transaction IDs.`));
      const details = node('details'); details.append(node('summary', '', 'Observed values and supporting transactions'));
      const pre = node('pre', '', JSON.stringify({ observed: ev.observed || {}, transaction_ids: ev.transaction_ids || [], account_ids: ev.account_ids || [], trigger_transaction_id: ev.trigger_transaction_id || null }, null, 2)); details.append(pre); card.append(details);
      for (const caveat of ev.caveats || []) card.append(node('p', 'caveat', caveat));
      container.append(card);
    }
  }
  function renderReviewForm(container, caseData) {
    const form = node('form', 'review-form');
    const statusWrap = node('div'); statusWrap.append(node('label', '', 'Review status'));
    const status = node('select'); status.name = 'status'; status.id = 'review-status';
    for (const item of ['OPEN', 'INVESTIGATING', 'ESCALATED', 'CLOSED']) { const option = node('option', '', item); option.value = item; if (item === caseData.status) option.selected = true; status.append(option); }
    statusWrap.append(status); form.append(statusWrap);
    const outcomeWrap = node('div'); outcomeWrap.append(node('label', '', 'Outcome (required to close)'));
    const outcome = node('select'); outcome.name = 'outcome'; outcome.id = 'review-outcome';
    const outcomes = [['', 'Choose only when closing'], ['CONFIRMED_SUSPICIOUS', 'Confirmed suspicious'], ['FALSE_POSITIVE', 'False positive'], ['INCONCLUSIVE', 'Inconclusive']];
    for (const [value, label] of outcomes) { const option = node('option', '', label); option.value = value; if (value === (caseData.review_outcome || '')) option.selected = true; outcome.append(option); }
    outcomeWrap.append(outcome); form.append(outcomeWrap);
    const reviewerWrap = node('div'); reviewerWrap.append(node('label', '', 'Reviewer label')); const reviewer = node('input'); reviewer.name = 'reviewer'; reviewer.maxLength = 100; reviewer.value = 'analyst'; reviewer.required = true; reviewerWrap.append(reviewer); form.append(reviewerWrap);
    const noteWrap = node('div'); noteWrap.append(node('label', '', 'Review note')); const note = node('textarea'); note.name = 'note'; note.maxLength = 1000; note.placeholder = 'Record the reasoning; do not include unnecessary personal data.'; noteWrap.append(note); form.append(noteWrap);
    const actions = node('div', 'review-actions full'); const save = node('button', 'button button-primary', 'Save review'); save.type = 'submit'; const audit = node('button', 'button button-secondary', 'Verify audit chain'); audit.type = 'button'; actions.append(save, audit); form.append(actions);
    status.addEventListener('change', () => { outcome.disabled = status.value !== 'CLOSED'; if (status.value !== 'CLOSED') outcome.value = ''; });
    outcome.disabled = status.value !== 'CLOSED';
    reviewer.id = 'reviewer-label'; note.id = 'review-note';
    for (const [wrapper, control] of [[statusWrap, status], [outcomeWrap, outcome], [reviewerWrap, reviewer], [noteWrap, note]]) wrapper.querySelector('label').htmlFor = control.id;
    const auditResult = node('p', 'notice'); auditResult.id = 'audit-result'; auditResult.hidden = true; auditResult.setAttribute('role', 'status');
    form.append(auditResult);
    form.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true;
      try {
        const payload = { status: status.value, reviewer: reviewer.value, note: note.value };
        if (status.value === 'CLOSED') { if (!outcome.value) throw new Error('Choose an outcome before closing the case.'); payload.outcome = outcome.value; }
        await api(`/api/cases/${encodeURIComponent(caseData.case_id)}/review`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Review saved and appended to the case history.'); await refreshCases(true);
      } catch (error) { showToast(error.message, true); } finally { save.disabled = false; }
    });
    audit.addEventListener('click', async () => {
      audit.disabled = true;
      try { const result = await api(`/api/cases/${encodeURIComponent(caseData.case_id)}/audit`); auditResult.hidden = false; auditResult.textContent = `Review chain ${result.valid ? 'valid' : 'INVALID'} · ${result.event_count ?? 'unknown'} event(s). ${result.warning || 'Without an external anchor a database owner can rewrite the whole chain or delete its tail.'}`; }
      catch (error) { auditResult.hidden = false; auditResult.textContent = `Audit verification failed: ${error.message}`; showToast(error.message, true); } finally { audit.disabled = false; }
    });
    container.append(form);
  }
  async function loadCase(caseId, updateQueue = true) {
    if (!caseId) return;
    clearDetail('Loading case…');
    const request = state.detailRequest;
    state.selectedId = caseId;
    if (updateQueue) renderQueue();
    try {
      const caseData = await api(`/api/cases/${encodeURIComponent(caseId)}`);
      if (request !== state.detailRequest) return;
      $('detail-empty').hidden = true; const detail = $('case-detail'); detail.replaceChildren(); detail.hidden = false;
      const top = node('div', 'case-title-row'); const titleWrap = node('div');
      titleWrap.append(node('p', 'eyebrow', `CASE ${caseData.case_id}`), node('h2', '', caseData.source_scenario_id || 'CSV import'), node('p', '', caseData.summary || 'Review the evidence and context.'));
      const tags = node('div', 'case-tags'); tags.append(badge(caseData.priority), badge(caseData.status)); top.append(titleWrap, tags); detail.append(top);
      const grid = node('div', 'case-grid'); grid.append(stat('Trigger transactions', caseData.counts?.trigger_transactions_total ?? caseData.transaction_ids?.length ?? 0), stat('Connected accounts', caseData.counts?.account_ids_total ?? caseData.account_ids?.length ?? 0), stat('Evidence items', caseData.counts?.evidence_total ?? caseData.evidence?.length ?? 0)); detail.append(grid);
      if (Object.values(caseData.truncation || {}).some(Boolean)) detail.append(node('p', 'notice', `Incomplete case payload — fields are truncated. Counts: ${JSON.stringify(caseData.counts || {})}. Truncation: ${JSON.stringify(caseData.truncation)}.`));
      const summary = node('div', 'summary-box', caseData.summary || 'No summary.'); detail.append(summary);
      const graphBox = node('div', 'graph-wrap'); detail.append(sectionHeading('Connected-account view', `${(caseData.account_ids || []).length} accounts in case`)); renderGraph(graphBox, caseData); detail.append(graphBox);
      const txBox = node('div'); detail.append(sectionHeading('Transaction timeline', 'Trigger and supporting context')); renderTransactions(txBox, caseData); detail.append(txBox);
      const evidenceBox = node('div'); detail.append(sectionHeading('Why it was flagged', `${(caseData.evidence || []).length} evidence item(s)`)); renderEvidence(evidenceBox, caseData); detail.append(evidenceBox);
      if ((caseData.limitations || []).length) {
        const details = node('details'); details.className = 'review-history'; details.open = true; details.append(node('summary', '', 'Limitations and interpretation')); const list = node('ul');
        for (const limit of caseData.limitations) list.append(node('li', '', limit)); details.append(list); detail.append(details);
      }
      detail.append(sectionHeading('Human review', 'Closing requires an explicit outcome'));
      renderReviewForm(detail, caseData);
      if ((caseData.review_history || []).length) { const history = node('details', 'review-history'); history.append(node('summary', '', `Review history · ${caseData.review_history.length} event(s)`), node('pre', '', JSON.stringify(caseData.review_history, null, 2))); detail.append(history); }
      if (updateQueue) renderQueue();
    } catch (error) { if (request !== state.detailRequest) return; clearDetail(`Could not load case: ${error.message}`); renderQueue(); showToast(`Could not load case: ${error.message}`, true); }
  }
  async function loadScenarios() {
    try {
      const result = await api('/api/scenarios'); state.scenarios = result.scenarios || [];
      const select = $('scenario-select'); select.replaceChildren();
      for (const scenario of state.scenarios) { const opt = node('option', '', `${scenario.title || scenario.id} (${scenario.id})`); opt.value = scenario.id; select.append(opt); }
      if (!state.scenarios.length) select.append(Object.assign(node('option', '', 'No scenarios available'), {value: ''}));
    } catch (error) { $('scenario-select').replaceChildren(Object.assign(node('option', '', 'Could not load scenarios'), {value: ''})); showToast(`Could not load scenarios: ${error.message}`, true); }
  }
  async function replayScenario() {
    const scenarioId = $('scenario-select').value; if (!scenarioId) return;
    const button = $('replay-scenario'); button.disabled = true; button.textContent = 'Replaying…';
    try {
      const result = await api(`/api/scenarios/${encodeURIComponent(scenarioId)}/replay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      runResult(`Analysis complete: ${result.transaction_count} transactions; ${result.case_count} case(s).`, result);
      state.latestRunId = result.run_id || null;
      state.viewMode = result.case_count > 0 ? 'run' : 'all';
      state.offset = 0;
      $('priority-filter').value = ''; $('status-filter').value = '';
      const graphWarning = result.analysis_warnings?.join(' ') || '';
      showToast(`Replayed ${result.transaction_count} synthetic transactions; generated ${result.case_count} case(s).${graphWarning ? ` WARNING: ${graphWarning}` : ''}`, Boolean(graphWarning));
      await refreshCases(false);
      if (result.cases?.length) await loadCase(result.cases[0].case_id);
      else clearDetail('This scenario produced zero cases under the current rules.');
    } catch (error) { runResult(`Scenario replay failed: ${error.message}`); showToast(`Scenario replay failed: ${error.message}`, true); }
    finally { button.disabled = false; button.textContent = 'Replay scenario'; }
  }
  async function replayAllScenarios() {
    const button = $('replay-all'); button.disabled = true; button.textContent = 'Replaying all…';
    try {
      const result = await api('/api/scenarios/replay-all', { method: 'POST' });
      runResult(`Analysis complete: ${result.transaction_count} transactions; ${result.case_count} case(s).`, result);
      state.latestRunId = null;
      state.viewMode = 'all';
      state.offset = 0;
      $('priority-filter').value = ''; $('status-filter').value = '';
      const graphWarning = result.analysis_warnings?.join(' ') || '';
      showToast(`Replayed ${result.scenario_count} synthetic scenarios; ${result.transaction_count} transactions; ${result.case_count} cases.${graphWarning ? ` WARNING: ${graphWarning}` : ''}`, Boolean(graphWarning));
      await refreshCases(false);
      if (result.cases?.length) await loadCase(result.cases[0].case_id);
    } catch (error) { runResult(`Replay-all failed: ${error.message}`); showToast(`Replay-all failed: ${error.message}`, true); }
    finally { button.disabled = false; button.textContent = 'Run all scenarios'; }
  }
  async function importCsv(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) { showToast('Select a .csv file.', true); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('The file exceeds the 5 MiB upload limit.', true); return; }
    try {
      const result = await api('/api/transactions/import', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: file });
      runResult(`CSV imported: ${result.transaction_count} rows; ${result.case_count} case(s).`, result);
      state.latestRunId = result.run_id || null;
      state.viewMode = result.case_count > 0 ? 'run' : 'all';
      state.offset = 0;
      $('priority-filter').value = ''; $('status-filter').value = '';
      const warnings = [...(result.warnings || []), ...(result.analysis_warnings || [])].join(' ');
      showToast(`Imported ${result.transaction_count} rows; generated ${result.case_count} case(s). ${warnings}`, Boolean(result.analysis_warnings?.length));
      await refreshCases(false);
      if (result.cases?.length) await loadCase(result.cases[0].case_id);
      else clearDetail('This import produced zero cases under the current rules.');
    } catch (error) { runResult(`CSV import failed: ${error.message}`); showToast(`CSV import failed: ${error.message}`, true); }
    finally { $('csv-file').value = ''; }
  }
  async function loadEvaluation() {
    try {
      const result = await api('/api/evaluation/summary');
      $('evaluation-status').textContent = result.model_status === 'not_configured'
        ? 'Rules-only mode. No trained ML model or measured benchmark result is configured. Metrics are intentionally not shown.'
        : `Model status: ${result.model_status}; evaluation status: ${result.evaluation_status}.`;
    } catch (error) { $('evaluation-status').textContent = `Evaluation metadata unavailable: ${error.message}`; }
  }
  $('import-csv').addEventListener('click', () => $('csv-file').click());
  $('replay-scenario').addEventListener('click', replayScenario);
  $('replay-all').addEventListener('click', replayAllScenarios);
  $('refresh-cases').addEventListener('click', () => refreshCases(true));
  $('priority-filter').addEventListener('change', () => { state.offset = 0; refreshCases(false); });
  $('status-filter').addEventListener('change', () => { state.offset = 0; refreshCases(false); });
  $('csv-file').addEventListener('change', event => importCsv(event.target.files?.[0]));
  loadScenarios(); loadEvaluation(); refreshCases(false);
})();
