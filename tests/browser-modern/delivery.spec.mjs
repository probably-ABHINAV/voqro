import {test, expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';

const origin = 'http://127.0.0.1:3210';
const password = 'Browser-only test passphrase 42!';
const ownerEmail = 'owner@browser-test.example';
const setupKey = 'browser-test-only-bootstrap-key-0123456789';
const videoPath = fileURLToPath(new URL('../fixtures/draft.mp4', import.meta.url));
const coverPath = fileURLToPath(new URL('../fixtures/cover.png', import.meta.url));

async function call(page, path, body, status) {
  const response = await page.request.fetch(origin + '/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : {headers: {Origin: origin, 'Content-Type': 'application/json'}, data: body})
  });
  const data = await response.json();
  if (status !== undefined) expect(response.status(), JSON.stringify(data)).toBe(status);
  else expect(response.ok(), JSON.stringify(data)).toBe(true);
  return data;
}

async function member(browser, owner, suffix, role, scope, contexts) {
  const context = await browser.newContext({baseURL: origin});
  contexts.push(context);
  const page = await context.newPage();
  const email = `delivery-${role}-${suffix}@browser-test.example`;
  const invitation = await call(owner, 'identity/invitations', {email, role, ...scope}, 201);
  await call(page, 'identity/password/register', {name: `Delivery ${role}`, email, password, token: invitation.invitation_token}, 201);
  return page;
}

async function studio(page, deliverable) { return call(page, 'delivery/deliverable/' + deliverable); }

// Setup uses only production APIs. Uploads and all review decisions below go
// through the actual React interface, without demo identities or DB mutation.
test('private media completes creator revision and exact-version agency and brand approvals', async ({page, browser, request}) => {
  test.setTimeout(180000);
  const contexts = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const config = await call(page, 'identity/config');
    await call(page, config.bootstrap_required ? 'identity/password/bootstrap' : 'identity/password/login', {
      email: ownerEmail, password,
      ...(config.bootstrap_required ? {name: 'Agency Owner', bootstrap_secret: setupKey} : {})
    }, config.bootstrap_required ? 201 : 200);
    const suffix = Date.now().toString(36);
    const brand = await call(page, 'catalog/brands', {name: 'Delivery Brand ' + suffix, industry: 'Design'}, 201);
    const creator = await call(page, 'catalog/creators', {
      name: 'Delivery Creator ' + suffix, handle: 'delivery_' + suffix,
      niche: 'Design', location: 'Mumbai', language: 'English', bio: 'A creator record for private media workflow verification.',
      fee: 250000, available: true, visibility: 'Approved', portfolio: [], collaborations: '',
      followers: null, engagement: null, metric_source: 'Not supplied', observed_on: null,
      sample_size: null, sample_kind: 'Mixed / unknown', evidence_url: ''
    }, 201);
    const brandPage = await member(browser, page, suffix, 'brand', {brand_id: brand.id}, contexts);
    const creatorPage = await member(browser, page, suffix, 'creator', {creator_id: creator.id}, contexts);
    brandPage.on('pageerror', error => errors.push(error.message));
    creatorPage.on('pageerror', error => errors.push(error.message));
    const proposal = await call(page, 'proposals', {
      brand_id: brand.id, title: 'Private media campaign ' + suffix,
      items: [{label: 'Review cycle Reel', quantity: 1, unit_price: 250000, creator_id: creator.id}],
      terms: 'One revision included. Settlement is tracked separately.',
      rights: 'Instagram organic in India for 30 days.',
      expires: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    }, 201);
    const brandWorkspace = await call(brandPage, 'workspace');
    const version = brandWorkspace.proposals.find(item => item.id === proposal.id).versions[0];
    const campaign = await call(brandPage, 'proposals/accept', {id: proposal.id, version_id: version.id}, 200);
    await call(page, 'delivery/campaign', {
      campaign_id: campaign.campaign_id, goals: 'Complete a real private draft and review cycle.',
      requirements: 'One short video, a cover image, and a specific caption.',
      tone: 'Warm and clear.', claims: 'No product efficacy claims.', prohibited: 'Unlicensed assets.', disclosure: '#ad'
    }, 201);
    await call(page, 'delivery/rights', {
      campaign_id: campaign.campaign_id, channels: 'Instagram organic', territory: 'India',
      start: new Date().toISOString().slice(0, 10), end: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      agreement: 'Browser workflow test agreement', paid_usage: false
    }, 200);
    const campaignData = await call(page, 'delivery/campaign/' + campaign.campaign_id);
    const deliverable = campaignData.deliverables[0].id;
    const route = '/workspace/delivery:' + deliverable;

    await creatorPage.goto(route);
    await creatorPage.getByRole('button', {name: 'Upload first draft', exact: true}).click();
    await creatorPage.locator('input[name="video"]').setInputFiles(videoPath);
    await creatorPage.locator('input[name="cover"]').setInputFiles(coverPath);
    await creatorPage.getByRole('textbox', {name: 'Caption', exact: true}).fill('First draft caption for the private review.');
    await creatorPage.getByLabel('Publishing account', {exact: true}).fill('@deliverybrand');
    await creatorPage.getByRole('button', {name: 'Submit for agency review', exact: true}).click();
    await expect(creatorPage.getByRole('button', {name: 'Submit new version', exact: true})).toBeVisible();
    const first = (await studio(creatorPage, deliverable)).versions[0];
    expect(first.version).toBe(1);
    expect(first.approvals).toEqual([]);
    expect(first.package.video_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.package.cover_sha256).toMatch(/^[a-f0-9]{64}$/);
    const privateVideo = '/api/media/' + first.package.video_id;
    expect((await request.get(privateVideo)).status()).toBe(401);
    expect((await brandPage.request.get(privateVideo)).status()).toBe(403);
    const range = await creatorPage.request.get(privateVideo, {headers: {Range: 'bytes=0-31'}});
    expect(range.status()).toBe(206);
    expect(range.headers()['cache-control']).toBe('private, no-store');
    expect((await range.body()).length).toBe(32);
    await brandPage.goto(route);
    await expect(brandPage.getByRole('heading', {name: 'No draft shared yet', exact: true})).toBeVisible();

    await page.goto(route);
    await page.getByLabel('Your feedback', {exact: true}).fill('Internal agency review note ' + suffix);
    await page.getByLabel('Time mark (seconds, optional)', {exact: true}).fill('1');
    await page.getByRole('combobox', {name: 'Visibility', exact: true}).selectOption('internal');
    await page.getByRole('button', {name: 'Add feedback', exact: true}).click();
    await expect(page.getByText('Internal agency review note ' + suffix, {exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Request revision', exact: true}).click();
    await page.getByLabel('Consolidated revision request', {exact: true}).fill('Make the product label clear in the caption.');
    await page.locator('form').filter({has: page.getByLabel('Consolidated revision request', {exact: true})}).getByRole('button', {name: 'Request revision', exact: true}).click();
    await expect.poll(async () => (await studio(creatorPage, deliverable)).deliverable.status).toBe('Changes requested');
    await creatorPage.reload();
    await expect(creatorPage.getByText('Make the product label clear in the caption.', {exact: true})).toBeVisible();
    await expect(creatorPage.getByText('Internal agency review note ' + suffix, {exact: true})).toHaveCount(0);

    await creatorPage.getByRole('button', {name: 'Submit new version', exact: true}).click();
    await creatorPage.getByRole('textbox', {name: 'Caption', exact: true}).fill('Revised caption with a clear product label.');
    await creatorPage.getByRole('button', {name: 'Submit for agency review', exact: true}).click();
    await expect(creatorPage.getByRole('heading', {name: 'Submit a new content version', exact: true})).toHaveCount(0);
    const second = (await studio(creatorPage, deliverable)).versions[0];
    expect(second.version).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(second.package.video_id).toBe(first.package.video_id);
    expect(second.package.cover_id).toBe(first.package.cover_id);
    expect(second.approvals).toEqual([]);
    await call(page, 'delivery/review', {version_id: first.id, action: 'approve'}, 409);
    await page.reload();
    await page.getByRole('button', {name: 'Approve for brand review', exact: true}).click();
    await expect.poll(async () => (await studio(page, deliverable)).deliverable.status).toBe('Brand review');
    await page.getByLabel('Your feedback', {exact: true}).fill('Internal margin discussion ' + suffix);
    await page.getByRole('combobox', {name: 'Visibility', exact: true}).selectOption('internal');
    await page.getByRole('button', {name: 'Add feedback', exact: true}).click();
    await expect(page.getByText('Internal margin discussion ' + suffix, {exact: true})).toBeVisible();

    await brandPage.reload();
    await expect(brandPage.getByText('Revised caption with a clear product label.', {exact: true})).toBeVisible();
    await expect(brandPage.getByText('Internal margin discussion ' + suffix, {exact: true})).toHaveCount(0);
    await expect.poll(() => brandPage.locator('video').evaluate(video => video.readyState)).toBeGreaterThan(0);
    expect((await brandPage.request.get(privateVideo, {headers: {Range: 'bytes=0-31'}})).status()).toBe(206);
    await brandPage.getByRole('button', {name: 'Approve post package', exact: true}).click();
    await expect.poll(async () => (await studio(brandPage, deliverable)).deliverable.status).toBe('Brand approved');
    const approved = await studio(brandPage, deliverable);
    expect(approved.versions[0].approvals.map(approval => approval.stage).sort()).toEqual(['agency', 'brand']);
    expect(approved.handoff.ready).toBe(true);
    expect(JSON.stringify(approved)).not.toContain('Internal margin discussion');
    await brandPage.reload();
    await expect(brandPage.getByRole('heading', {name: 'Human approvals complete', exact: true})).toBeVisible();

    // Even a caption-only change must invalidate the previously approved package.
    await creatorPage.reload();
    await creatorPage.getByRole('button', {name: 'Submit new version', exact: true}).click();
    await creatorPage.getByRole('textbox', {name: 'Caption', exact: true}).fill('A changed caption requires a fresh review.');
    await creatorPage.getByRole('button', {name: 'Submit for agency review', exact: true}).click();
    await expect(creatorPage.getByRole('heading', {name: 'Submit a new content version', exact: true})).toHaveCount(0);
    const changed = await studio(creatorPage, deliverable);
    expect(changed.versions[0].version).toBe(3);
    expect(changed.deliverable.status).toBe('Agency review');
    expect(changed.versions[0].approvals).toEqual([]);
    expect(changed.handoff.ready).toBe(false);
    expect(changed.versions.find(item => item.id === second.id).approvals).toHaveLength(2);
    expect(changed.versions.find(item => item.id === second.id).package.caption).toBe('Revised caption with a clear product label.');
    await call(brandPage, 'delivery/review', {version_id: second.id, action: 'approve'}, 409);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
