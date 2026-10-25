import {test,expect} from '@playwright/test';

test('playback, rewind, final evidence, report and custom validation', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/simulation.html');
  await expect(page.locator('#status')).toContainText('Choose a scenario');
  await page.selectOption('#scenario','layered-chain');
  await page.click('#load');await expect(page.locator('#position')).toHaveText('0 / 4');
  await page.click('#next');await expect(page.locator('#position')).toHaveText('1 / 4');
  await expect(page.locator('#ledger tr')).toHaveCount(1);
  await page.click('#play');await expect(page.locator('#position')).toHaveText('4 / 4',{timeout:15000});
  await expect(page.locator('#findings-title')).toHaveText('Final output');
  await expect(page.locator('#findings')).toContainText('R5_LAYERED_CHAIN');
  const download=page.waitForEvent('download');await page.click('#download');
  expect((await download).suggestedFilename()).toBe('traceguard-simulation-report.json');
  await page.click('#back');await expect(page.locator('#position')).toHaveText('3 / 4');
  await expect(page.locator('#download')).toBeDisabled();
  await page.click('#reset');await expect(page.locator('#ledger tr')).toHaveCount(0);
  await page.selectOption('#scenario','custom');await page.click('summary');
  await page.fill('#spec','{"pattern":"FAN_IN_DISPERSAL","n_senders":3,"n_recipients":4}');
  await page.click('#load');await expect(page.locator('#position')).toHaveText('0 / 7');
  await page.click('#finish');await expect(page.locator('#position')).toHaveText('7 / 7');
  await page.fill('#spec','{"amount":-1}');await page.click('#load');
  await expect(page.locator('#status')).toContainText('Simulation failed');
  await expect(page.locator('#download')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('pause, seek, failed request and retry',async({page})=>{
  await page.goto('/simulation.html');await expect(page.locator('#status')).toContainText('Choose a scenario');
  await page.selectOption('#scenario','layered-chain');await page.click('#load');await expect(page.locator('#position')).toHaveText('0 / 4');
  await page.click('#play');await expect(page.locator('#position')).toHaveText('1 / 4');await page.click('#play');
  await page.waitForTimeout(1700);await expect(page.locator('#position')).toHaveText('1 / 4');
  await page.locator('#seek').fill('3');await page.locator('#seek').dispatchEvent('change');await expect(page.locator('#position')).toHaveText('3 / 4');
  await page.route('**/api/simulate/step',route=>route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Test outage"}'}));
  await page.click('#next');await expect(page.locator('#status')).toContainText('Test outage');await expect(page.locator('#play')).toHaveText('Play');
  await page.unroute('**/api/simulate/step');
  await page.click('#next');await expect(page.locator('#position')).toHaveText('4 / 4');
});

test('navigation, sample button and narrow screen', async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.click('#seed-sample-btn');
  await expect(page.locator('#seed-sample-btn')).toHaveText('Load sample graph data');
  await page.getByRole('link',{name:'Simulation',exact:true}).click();
  await expect(page.locator('#status')).toContainText('Choose a scenario');
  await page.setViewportSize({width:390,height:844});
  await page.click('#load');await expect(page.locator('#status')).toContainText('Step 0');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('research and main modules load without script errors',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/research.html');await expect(page.locator('[data-field="pattern"]')).toBeVisible();
  await page.click('#run');await expect(page.locator('#simulation-state')).toHaveText('Completed');
  await expect(page.locator('#simulation-result')).toContainText('HYPOTHETICAL');
  for(const module of ['queue','scenarios','import','evaluation']){
    await page.goto('/#/'+module);await expect(page.locator('#nav-'+module)).toHaveAttribute('aria-current','page');
  }
  expect(errors).toEqual([]);
});

test('simulation visual review',async({page})=>{
  await page.goto('/simulation.html');await expect(page.locator('#status')).toContainText('Choose a scenario');
  await page.selectOption('#scenario','directed-cycle');await page.click('#load');await expect(page.locator('#position')).toHaveText('0 / 3');
  await page.click('#finish');await expect(page.locator('#position')).toHaveText('3 / 3');
  await page.screenshot({path:'test-results/simulation-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('#graph').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/simulation-mobile.png',fullPage:true});
});
