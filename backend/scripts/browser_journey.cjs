/* Optional acceptance journey: npm install --no-save playwright; npx playwright install chromium.
   Run via python scripts/verify_integration.py --browser. Primary workflow uses the real API.
   Route interception below is restricted to failure/race/incomplete-result UI tests. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.TRACEGUARD_TEST_URL;
if (!base) throw new Error('Use scripts/verify_integration.py --browser (isolated test database).');
(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.TRACEGUARD_CHROMIUM ? {executablePath: process.env.TRACEGUARD_CHROMIUM, args:['--no-sandbox','--no-zygote','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']} : {})});
  const page = await browser.newPage({viewport:{width:1366,height:768}});
  const errors=[]; page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR:',e.message);});
  page.on('requestfailed',r=>console.error('REQUEST FAILED',r.url(),r.failure()));
  page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());});
  const checks=[];
  const wait = async (fn,arg) => page.waitForFunction(fn,arg,{timeout:15000});
  const api = async path => (await page.request.get(base+path)).json();
  try {
    await page.goto(base); try { await wait(()=>document.querySelector('#connection-status').textContent==='API connected'); } catch(e) { console.error((await page.locator('body').innerText()).slice(0,1500)); throw e; }
    assert.match(await page.locator('#queue-list').innerText(),/No cases/); checks.push('fresh empty queue');
    await page.selectOption('#scenario-select','compound-layered-cycle'); await page.click('#replay-scenario');
    await wait(()=>document.querySelector('#case-detail h2')?.textContent==='compound-layered-cycle');
    assert.ok(await page.locator('.tx-table tbody tr').count()>0);
    assert.ok(await page.locator('.evidence-card').count()>0);
    const cid=(await api('/api/cases')).cases[0].case_id;
    const detail=await api('/api/cases/'+cid);
    const actualIDs=new Set([...detail.trigger_transactions,...detail.context_transactions].map(t=>t.transaction_id));
    for(const title of await page.locator('.case-graph line title').allTextContents())assert.ok(actualIDs.has(title.split(':')[0]));
    checks.push('real replay → queue → evidence/timeline/graph');
    await page.selectOption('#review-status','CLOSED'); await page.getByRole('button',{name:'Save review',exact:true}).click();
    await wait(()=>document.querySelector('#toast').textContent.includes('Choose an outcome'));
    assert.equal((await api('/api/cases/'+cid)).status,'OPEN');
    await page.selectOption('#review-outcome','INCONCLUSIVE'); await page.getByLabel('Review note',{exact:true}).fill('Synthetic browser acceptance');
    await page.getByRole('button',{name:'Save review',exact:true}).click();
    await wait(()=>document.querySelector('#review-status')?.value==='CLOSED');
    await page.getByRole('button',{name:'Verify audit chain',exact:true}).click();
    await wait(()=>document.querySelector('#audit-result')?.textContent.includes('chain valid'));
    assert.match(await page.locator('#audit-result').innerText(),/rewrite the whole chain or delete its tail/);
    assert.equal((await api('/api/cases/'+cid+'/audit')).event_count,1);
    await page.selectOption('#review-status','INVESTIGATING'); await page.getByRole('button',{name:'Save review',exact:true}).click();
    await wait(()=>document.querySelector('#review-status')?.value==='INVESTIGATING');
    assert.equal((await api('/api/cases/'+cid)).review_outcome,null); checks.push('closure validation, saved outcome, reopen, real audit verification');

    // Zero-case replay scopes view so unrelated cases are not left on screen
    await page.selectOption('#scenario-select','legitimate-high-volume'); await page.click('#replay-scenario');
    await wait(()=>document.querySelector('#run-result')?.textContent.includes('0 case(s)'));
    await wait(()=>/zero cases/i.test(document.querySelector('#detail-empty h2').textContent));
    assert.match(await page.locator('#detail-empty h2').innerText(),/zero cases/i);
    assert.match(await page.locator('#queue-list').innerText(),/No cases match/i);
    checks.push('zero-case replay scopes queue without leaving stale cases');

    // 105-case CSV import to test pagination beyond 100 cases
    let pCsv = 'transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\n';
    for (let i = 0; i < 105; i++) {
      const tIn = new Date(Date.UTC(2026, 9, 24, 7, 0, i * 2)).toISOString();
      const tOut = new Date(Date.UTC(2026, 9, 24, 7, 0, i * 2 + 1)).toISOString();
      pCsv += `PAGE-IN-${i},${tIn},SND-${i},MID-${i},1000,TRANSFER\n`;
      pCsv += `PAGE-OUT-${i},${tOut},MID-${i},RCV-${i},900,TRANSFER\n`;
    }
    await page.setInputFiles('#csv-file', {name: 'pages105.csv', mimeType: 'text/csv', buffer: Buffer.from(pCsv)});
    await wait(() => document.querySelector('#case-detail h2')?.textContent === 'csv-import');
    await wait(() => document.querySelector('#queue-pagination')?.textContent.includes('Page 1 of 2'));
    assert.ok(await page.locator('#queue-pagination').isVisible());
    assert.match(await page.locator('#queue-pagination .pagination-info').innerText(), /Page 1 of 2/);
    await page.locator('#queue-pagination button', {hasText: 'Next →'}).click();
    await wait(() => document.querySelector('#queue-pagination .pagination-info')?.textContent.includes('Page 2 of 2'));
    assert.match(await page.locator('#queue-pagination .pagination-info').innerText(), /Page 2 of 2/);
    await page.locator('#queue-pagination button', {hasText: '← Prev'}).click();
    await wait(() => document.querySelector('#queue-pagination .pagination-info')?.textContent.includes('Page 1 of 2'));
    checks.push('105-case import, pagination controls and multi-page queue navigation');
    const before=(await api('/api/cases')).count;
    await page.setInputFiles('#csv-file',{name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('bad,csv\n1,2')});
    await wait(()=>document.querySelector('#run-result').textContent.includes('CSV import failed: 422'));
    assert.equal((await api('/api/cases')).count,before); checks.push('malformed CSV rejected atomically');
    await page.setInputFiles('#csv-file',{name:'utf8.csv',mimeType:'text/csv',buffer:Buffer.from([0xff,0xfe,0xff])});
    await wait(()=>document.querySelector('#run-result').textContent.includes('UTF-8')); checks.push('invalid UTF-8 bytes reach server unchanged');
    // Actual imported fields must remain text in SVG, table, evidence, and history.
    const hostile='<img src=x onerror=window.TG_XSS=1>';
    let csv='transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\n';
    for(let i=0;i<135;i++)csv+=`XSS-${i},${new Date(Date.UTC(2026,9,24,12,0,i)).toISOString()},${hostile},DEST-${i%5},100,TRANSFER\n`;
    await page.setInputFiles('#csv-file',{name:'bounded.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await wait(()=>document.querySelector('#case-detail h2')?.textContent==='csv-import');
    await wait(()=>document.querySelector('#case-detail').textContent.includes('Incomplete case payload'));
    assert.match(await page.locator('#case-detail').innerText(),/Incomplete case payload/);
    assert.match(await page.locator('.tx-table').innerText(),/<img src=x/);
    assert.equal(await page.locator('#case-detail img').count(),0); assert.equal(await page.evaluate(()=>window.TG_XSS),undefined);
    const ids=await page.locator('.tx-table tbody tr td:first-child').allTextContents(); assert.equal(ids.length,new Set(ids).size);
    checks.push('real bounded import, visible truncation, repeated transfers retained, imported markup rendered as text');
    // Failure injection is separate from the real API journey.
    await page.route('**/api/cases?*',r=>r.abort()); await page.click('#refresh-cases');
    await wait(()=>document.querySelector('#connection-status').textContent==='API unavailable');
    assert.equal(await page.locator('#case-detail').isVisible(),false); assert.equal(await page.locator('#metric-all').innerText(),'—');
    await page.unroute('**/api/cases?*'); await page.click('#refresh-cases'); await page.waitForSelector('#review-status');
    checks.push('API-unavailable state clears stale details and metrics; recovery');
    await page.route('**/api/cases/case_*',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Unavailable for test'})}));
    await page.locator('.case-row').first().click(); await wait(()=>document.querySelector('#detail-empty h2').textContent.includes('Could not load case'));
    assert.equal(await page.locator('#case-detail').isVisible(),false);await page.unroute('**/api/cases/case_*');
    checks.push('case-detail failure does not retain a previous review form');
    // A late detail response must not overwrite the analyst's newer selection.
    await page.getByRole('button',{name:'All cases',exact:true}).click();
    await wait(()=>document.querySelectorAll('.case-row').length>1);
    const queued=(await api('/api/cases')).cases;
    const older=queued[0].case_id, newer=queued[1].case_id;
    let release;const gate=new Promise(resolve=>{release=resolve;});
    let arrived;const entered=new Promise(resolve=>{arrived=resolve;});
    await page.route('**/api/cases/'+older,async r=>{const response=await r.fetch();arrived();await gate;await r.fulfill({response});});
    await page.locator('.case-row').filter({hasText:older}).click();await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error("Delayed request did not arrive")),15000))]);
    await page.locator('.case-row').filter({hasText:newer}).click();
    await wait(id=>document.querySelector('#case-detail .eyebrow')?.textContent.includes(id),newer);
    release();await page.waitForTimeout(200);
    assert.match(await page.locator('#case-detail .eyebrow').innerText(),new RegExp(newer));
    await page.unroute('**/api/cases/'+older);checks.push('out-of-order detail response ignored');
    const clipped={...detail,trigger_transactions:[],context_transactions:[],evidence:[],truncation:{evidence:true},counts:{evidence_total:120}};
    await page.route('**/api/cases/'+older,r=>r.fulfill({json:clipped}));
    await page.locator('.case-row').filter({hasText:older}).click();
    await wait(()=>document.querySelector('#case-detail').textContent.includes('Incomplete case payload'));
    assert.match(await page.locator('#case-detail').innerText(),/120/);
    await page.unroute('**/api/cases/'+older);checks.push('truncation disclosed even when transaction arrays are empty (injected response)');
    // Actual low-budget pipeline response prepared by the Python harness; transport is injected.
    const bounded=JSON.parse(fs.readFileSync(process.env.TRACEGUARD_BOUNDED_FIXTURE,'utf8'));
    await page.route('**/api/scenarios/rapid-pass-through/replay',r=>r.fulfill({json:bounded}));
    await page.selectOption('#scenario-select','rapid-pass-through');await page.click('#replay-scenario');
    await wait(()=>document.querySelector('#run-result').textContent.includes('expansion limit'));
    // Toast expiry must not erase the run warning.
    await page.waitForTimeout(5100);assert.match(await page.locator('#run-result').innerText(),/motifs may have been missed/);
    await page.unroute('**/api/scenarios/rapid-pass-through/replay');checks.push('incomplete-analysis warning persists beyond toast (injected low-budget response)');
    await page.click('#replay-all');await wait(()=>document.querySelector('#run-result').textContent.includes('130 transactions'));
    await page.waitForSelector('#review-status');assert.equal((await api('/api/scenarios')).scenarios.length,14);
    assert.equal((await api('/api/evaluation/summary')).model_status,'not_configured');checks.push('real replay-all and honest evaluation status');
    for(const width of [1366,390]){
      await page.setViewportSize({width,height:768});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`page overflow at ${width}`);
      assert.ok(await page.getByRole('button',{name:'Import CSV',exact:true}).isEnabled());
    }
    checks.push('1366px and 390px viewport overflow checks; named review controls');
    if (process.env.TRACEGUARD_SCREENSHOT) await page.screenshot({path:process.env.TRACEGUARD_SCREENSHOT,fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,browser:browser.version(),checks,page_errors:errors},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
