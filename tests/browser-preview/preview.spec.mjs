import {test, expect} from '@playwright/test';

async function chooseRole(page, id) {
  if (await page.getByRole('button', {name: 'Account options'}).count()) {
    await page.getByRole('button', {name: 'Account options'}).click();
    await page.getByRole('button', {name: 'Switch demo workspace'}).click();
  } else {
    await page.getByRole('button', {name: 'Workspace', exact: true}).click();
  }
  await page.locator(`[data-action="sign-in:${id}"]`).click();
  await expect(page.getByRole('button', {name: 'Account options'})).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.voqroPreview.status().user_id)).toBe(id);
}

async function enquiry(page, company) {
  await page.getByRole('button', {name: 'Let’s work together', exact: true}).click();
  await page.getByLabel('Your name').fill('Preview Visitor');
  await page.getByLabel('Email address').fill('preview@example.com');
  await page.getByLabel('Brand / company').fill(company);
  await page.getByLabel('Indicative budget').fill('65000');
  await page.getByLabel('What are you imagining?').fill('A sample campaign created while exploring this interactive product preview.');
  await page.getByRole('button', {name: 'Send your brief'}).click();
  await expect(page.getByRole('heading', {name: 'A good beginning.'})).toBeVisible();
  await page.getByRole('button', {name: 'Back to the good stuff'}).click();
}

async function pipeline(page) {
  await page.getByRole('button', {name: 'Enquiry pipeline', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'From a hello to something good.'})).toBeVisible();
}

test('public preview renders and all seven sample roles work without backend API requests', async ({page}) => {
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('region', {name: 'Interactive product preview'})).toBeVisible();
  await expect(page.getByRole('heading', {name: /Good people/})).toBeVisible();
  await page.getByRole('button', {name: 'Workspace', exact: true}).click();
  await expect(page.locator('[data-action^="sign-in:"]')).toHaveCount(7);
  await page.getByRole('button', {name: 'Close dialog'}).click();
  for (const id of ['u_owner', 'u_manager', 'u_reviewer', 'u_finance', 'u_brand', 'u_other', 'u_creator']) {
    await chooseRole(page, id);
    await expect(page.getByRole('heading', {name: /Good to see you/})).toBeVisible();
  }
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('brand shortlist changes survive reload in the same browser', async ({page}) => {
  await page.goto('/');
  await chooseRole(page, 'u_brand');
  await page.getByRole('button', {name: 'Creators', exact: true}).click();
  await page.getByRole('button', {name: 'Design', exact: true}).click();
  await page.getByRole('button', {name: 'Add Meera Iyer to shortlist'}).click();
  await expect(page.getByRole('button', {name: 'Remove Meera Iyer from shortlist'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', {name: 'Account options'})).toBeVisible();
  await page.getByRole('button', {name: 'Creators', exact: true}).click();
  await page.getByRole('button', {name: 'View shortlist'}).click();
  await expect(page.getByRole('heading', {name: 'Meera Iyer', exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.voqroPreview.status().persistence)).toBe('browser');
});

test('a brand accepts the seeded proposal and its creator can see the resulting campaign', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await chooseRole(page, 'u_brand');
  await page.getByRole('button', {name: 'Proposals', exact: true}).click();
  const title = 'Everyday rituals · Creator partnership';
  await page.locator('.proposal-card').filter({hasText: title}).getByRole('button', {name: 'View proposal'}).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', {name: 'Accept version 1'}).click();
  await expect(page.getByRole('heading', {name: title, exact: true, level: 1})).toBeVisible();
  await expect(page.getByRole('heading', {name: /^Instagram Reel · Asha Mehta · [12]$/})).toHaveCount(2);
  await chooseRole(page, 'u_creator');
  await page.getByRole('navigation', {name: 'Workspace', exact: true}).getByRole('button', {name: /^Campaigns/}).click();
  await expect(page.getByRole('button', {name: 'Open ' + title, exact: true})).toBeVisible();
  await chooseRole(page, 'u_other');
  await page.getByRole('navigation', {name: 'Workspace', exact: true}).getByRole('button', {name: /^Campaigns/}).click();
  await expect(page.getByRole('button', {name: 'Open ' + title, exact: true})).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('enquiries persist in the owner pipeline and reset removes only this preview data', async ({page}) => {
  const company = 'Preview Reset Company';
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('preview-harness-unrelated', 'preserve'));
  await enquiry(page, company);
  await chooseRole(page, 'u_owner');
  await pipeline(page);
  await expect(page.getByRole('heading', {name: company, exact: true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', {name: 'Account options'})).toBeVisible();
  await pipeline(page);
  await expect(page.getByRole('heading', {name: company, exact: true})).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'Reset demo', exact: true}).click();
  await expect(page.getByRole('heading', {name: /Good people/})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('preview-harness-unrelated'))).toBe('preserve');
  await chooseRole(page, 'u_owner');
  await pipeline(page);
  await expect(page.getByRole('heading', {name: company, exact: true})).toHaveCount(0);
});

test('separate visitors have isolated records and resetting one browser leaves the other intact', async ({page, browser}) => {
  const company = 'Only This Browser Company';
  await page.goto('/');
  await enquiry(page, company);
  await chooseRole(page, 'u_owner');
  await pipeline(page);
  await expect(page.getByRole('heading', {name: company, exact: true})).toBeVisible();
  const otherContext = await browser.newContext({baseURL: 'http://127.0.0.1:3002'});
  try {
    const other = await otherContext.newPage();
    await other.goto('/');
    await chooseRole(other, 'u_owner');
    await pipeline(other);
    await expect(other.getByRole('heading', {name: company, exact: true})).toHaveCount(0);
    other.once('dialog', dialog => dialog.accept());
    await other.getByRole('button', {name: 'Reset demo', exact: true}).click();
    await expect(other.getByRole('heading', {name: /Good people/})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', {name: 'Account options'})).toBeVisible();
    await pipeline(page);
    await expect(page.getByRole('heading', {name: company, exact: true})).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test('external integrations stay disconnected and the mobile preview remains usable', async ({page}, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await chooseRole(page, 'u_owner');
  await page.getByRole('button', {name: 'Connections', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Good connections make good work.'})).toBeVisible();
  await expect(page.getByText('No authorised accounts', {exact: true})).toBeVisible();
  const connections = await page.evaluate(async () => (await window.voqroPreview.request('workspace')).connections);
  expect(connections.identity.available).toBe(false);
  expect(connections.instagram.connected_accounts).toBe(0);
  await page.getByRole('button', {name: 'Instagram', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'No account connected.', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Schedule approved Reel', exact: true})).toHaveCount(0);
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.getByRole('region', {name: 'Interactive product preview'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await page.screenshot({path: testInfo.outputPath('preview-mobile.png'), fullPage: true});
  expect(errors).toEqual([]);
});

test('the static preview never exposes a backend API or files above its output directory', async ({request}) => {
  const api = await request.get('/api/health');
  expect(api.status()).toBe(503);
  expect(api.headers()['cache-control']).toContain('no-store');
  expect(await api.json()).toHaveProperty('error');
  const escaped = await request.get('/%2e%2e%2fconfig.json');
  expect([400, 403, 404]).toContain(escaped.status());
  const environment = await request.get('/.env');
  expect(environment.status()).toBe(404);
  const page = await request.get('/');
  expect(page.headers()['content-security-policy']).toContain("connect-src 'self'");
  expect(page.headers()['x-content-type-options']).toBe('nosniff');
});
