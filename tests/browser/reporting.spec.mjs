import {test,expect} from '@playwright/test';

async function enterOwner(page) {
 await page.goto('/');
 await page.getByRole('button',{name:'Workspace',exact:true}).click();
 await page.getByRole('button',{name:/Agency owner/}).click();
 await expect(page.getByRole('heading',{name:/Good to see you/})).toBeVisible();
}
async function switchTo(page,name) {
 await page.getByRole('button',{name:'Account options'}).click();
 await page.getByRole('button',{name:'Switch demo workspace'}).click();
 await page.getByRole('button',{name}).click();
 await page.locator('[data-action="nav:reporting"]').click();
 await expect(page.getByRole('heading',{name:'The story behind the work.'})).toBeVisible();
}
async function downloadText(download) {
 const stream=await download.createReadStream(),chunks=[];
 for await(const chunk of stream)chunks.push(chunk);
 return Buffer.concat(chunks).toString('utf8');
}

test('report snapshots share the exact evidence and export only the current role’s records',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await enterOwner(page);
 const invoice=await page.request.post('/api/commerce/invoices',{data:{campaign_id:'cam_1',title:'Reporting browser invoice',due_on:'2099-12-31',request_key:'reporting-browser-invoice',items:[{label:'Recorded campaign service',quantity:1,unit_price:100000,tax_bps:1800}]}}).then(r=>r.json());
 expect(invoice.id).toBeTruthy();
 expect((await page.request.post('/api/commerce/issue',{data:{id:invoice.id}})).status()).toBe(200);
 expect((await page.request.post('/api/commerce/costs',{data:{campaign_id:'cam_1',creator_id:'c_asha',category:'Creator fee',description:'Private report cost',amount:30000,due_on:'2099-12-31',evidence:'Internal negotiated evidence',request_key:'reporting-browser-cost'}})).status()).toBe(201);
 await page.locator('[data-action="nav:reporting"]').click();
 await page.getByRole('button',{name:'Create report',exact:true}).click();
 await page.getByLabel('Campaign',{exact:true}).selectOption('cam_1');
 await page.getByLabel('Report title',{exact:true}).fill('Browser evidence snapshot');
 await page.getByLabel('Shared lessons',{exact:true}).fill('The next report will compare the approved product demonstration.');
 await page.getByLabel('Shared next steps',{exact:true}).fill('Collect dated post observations before drawing conclusions.');
 await page.getByRole('button',{name:'Create snapshot',exact:true}).click();
 await expect(page.locator('.modal').getByRole('heading',{name:'Internal reconciliation'})).toBeVisible();
 const report=(await page.request.get('/api/reporting').then(r=>r.json())).reports.find(r=>r.title==='Browser evidence snapshot');
 expect(report.shared_at).toBeNull();
 await page.getByRole('button',{name:'Share snapshot',exact:true}).click();
 await expect(page.locator('.modal').getByText('Shared snapshot',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close',exact:true}).click();

 await switchTo(page,/Brand · Olive & Earth/);
 await page.locator('.operation-row').filter({has:page.getByRole('heading',{name:'Browser evidence snapshot',exact:true})}).getByRole('button',{name:'Read report'}).click();
 await expect(page.locator('.modal').getByRole('heading',{name:'Internal reconciliation'})).toHaveCount(0);
 await expect(page.locator('.modal').getByText('Private report cost')).toHaveCount(0);
 let pending=page.waitForEvent('download');
 await page.locator('.modal').getByRole('link',{name:/Download report/}).click();
 const html=await downloadText(await pending);
 expect(html).toContain('Browser evidence snapshot');
 expect(html).toContain('Brand invoices');
 expect(html).not.toContain('Internal negotiated evidence');
 expect(html).not.toContain('Private report cost');
 expect(html).not.toContain('contribution_before_overhead');
 pending=page.waitForEvent('download');
 await page.locator('.modal').getByRole('link',{name:'Export CSV'}).click();
 const csv=await downloadText(await pending);
 expect(csv).toContain('billing.invoices');
 expect(csv).not.toContain('billing.costs');
 expect(csv).not.toContain('billing.totals');
 await page.getByRole('button',{name:'Close',exact:true}).click();

 await switchTo(page,/Creator · Asha Mehta/);
 await page.locator('.operation-row').filter({has:page.getByRole('heading',{name:'Browser evidence snapshot',exact:true})}).getByRole('button',{name:'Read report'}).click();
 const personal=await page.request.get('/api/reporting/reports/'+report.id).then(r=>r.json());
 expect(personal.payload.deliverables.every(d=>d.creator_id==='c_asha')).toBe(true);
 expect(personal.payload.billing).toBeUndefined();
 expect(personal.payload.campaign.budget).toBeUndefined();
 await expect(page.locator('.modal').getByText('Skincare essentials · Instagram Reel',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await switchTo(page,/Brand · Northstar/);
 await expect(page.getByRole('heading',{name:'Browser evidence snapshot',exact:true})).toHaveCount(0);
 expect((await page.request.get('/api/reporting/reports/'+report.id+'/download/html')).status()).toBe(403);
 expect(errors).toEqual([]);
});

test('agreement acknowledgements stay with the named parties and milestones reconcile linked records',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await enterOwner(page);
 const invoice=await page.request.post('/api/commerce/invoices',{data:{campaign_id:'cam_1',title:'Browser milestone obligation',due_on:'2099-12-31',request_key:'reporting-milestone-invoice',items:[{label:'Milestone service',quantity:1,unit_price:50000,tax_bps:0}]}}).then(r=>r.json());
 expect((await page.request.post('/api/commerce/issue',{data:{id:invoice.id}})).status()).toBe(200);
 await page.locator('[data-action="nav:reporting"]').click();
 await page.getByRole('button',{name:'Record agreement',exact:true}).click();
 await page.getByLabel('Campaign',{exact:true}).selectOption('cam_1');
 await page.getByLabel('Agreement title',{exact:true}).fill('Browser brand agreement');
 await page.getByLabel('Terms visible to the named counterparty').fill('Review the deliverable and recorded usage rights before publication.');
 await page.getByLabel('Document reference',{exact:true}).fill('BRAND-AGREEMENT-REFERENCE');
 await page.getByRole('button',{name:'Save agreement version',exact:true}).click();
 await page.getByRole('button',{name:'Acknowledge version 1',exact:true}).click();
 await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Record acknowledgement',exact:true}).click();
 await expect(page.locator('.operation-row').filter({has:page.getByRole('heading',{name:'Browser brand agreement',exact:true})}).getByText('1/2 acknowledgements',{exact:true})).toBeVisible();

 await page.getByRole('button',{name:'Record agreement',exact:true}).click();
 await page.getByLabel('Campaign',{exact:true}).selectOption('cam_1');
 await page.getByLabel('Agreement title',{exact:true}).fill('Browser private creator agreement');
 await page.getByLabel('Counterparty',{exact:true}).selectOption('Creator');
 await page.getByLabel('Creator (payables and creator agreements)').selectOption('c_asha');
 await page.getByLabel('Terms visible to the named counterparty').fill('Private agreed creator scope.');
 await page.getByLabel('Document reference',{exact:true}).fill('CREATOR-PRIVATE-AGREEMENT');
 await page.getByRole('button',{name:'Save agreement version',exact:true}).click();
 await page.getByRole('button',{name:'Close',exact:true}).click();

 await page.getByRole('button',{name:'Plan milestone',exact:true}).click();
 await page.getByLabel('Campaign',{exact:true}).selectOption('cam_1');
 await page.getByLabel('Milestone title',{exact:true}).fill('Browser linked milestone');
 await page.getByLabel('Planned amount ₹').fill('500');
 await page.getByRole('button',{name:'Save milestone',exact:true}).click();
 const milestoneRow=page.locator('.operation-row').filter({hasText:'Browser linked milestone'});
 await expect(milestoneRow.getByText('Planned',{exact:true})).toBeVisible();
 await milestoneRow.getByRole('button',{name:'Link financial record'}).click();
 await page.getByLabel('Matching financial record').selectOption(invoice.id);
 await page.getByRole('button',{name:'Link record',exact:true}).click();
 await expect(milestoneRow.getByText('Linked',{exact:true})).toBeVisible();
 const records=await page.request.get('/api/reporting').then(r=>r.json());
 expect(records.milestones.find(m=>m.title==='Browser linked milestone').invoice_id).toBe(invoice.id);

 await switchTo(page,/Brand · Olive & Earth/);
 await expect(page.getByRole('heading',{name:'Browser private creator agreement',exact:true})).toHaveCount(0);
 await page.locator('.operation-row').filter({has:page.getByRole('heading',{name:'Browser brand agreement',exact:true})}).getByRole('button',{name:'Review agreement'}).click();
 await page.getByRole('button',{name:'Acknowledge version 1',exact:true}).click();
 await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Record acknowledgement',exact:true}).click();
 await expect(page.locator('.operation-row').filter({has:page.getByRole('heading',{name:'Browser brand agreement',exact:true})}).getByText('2/2 acknowledgements',{exact:true})).toBeVisible();
 await expect(page.locator('.operation-row').filter({hasText:'Browser linked milestone'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Link financial record'})).toHaveCount(0);

 await switchTo(page,/Creator · Asha Mehta/);
 await expect(page.getByRole('heading',{name:'Browser brand agreement',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Browser private creator agreement',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:/Browser linked milestone/})).toHaveCount(0);
 await page.locator('.operation-row').filter({has:page.getByRole('heading',{name:'Browser private creator agreement',exact:true})}).getByRole('button',{name:'Review agreement'}).click();
 await page.getByRole('button',{name:'Acknowledge version 1',exact:true}).click();
 await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Record acknowledgement',exact:true}).click();
 await expect(page.locator('.operation-row').filter({has:page.getByRole('heading',{name:'Browser private creator agreement',exact:true})}).getByText('1/2 acknowledgements',{exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
