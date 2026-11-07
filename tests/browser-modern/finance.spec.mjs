import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin='http://127.0.0.1:3210';
const password='Browser-only test passphrase 42!';
const ownerEmail='owner@browser-test.example';
const date=(days=0)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);

async function post(client,path,body){
  const response=await client.post('/api/'+path,{headers:{Origin:origin},data:body});
  const data=await response.json();
  expect(response.ok(),path+': '+JSON.stringify(data)).toBe(true);
  return data;
}
async function get(client,path){
  const response=await client.get('/api/'+path);
  const data=await response.json();
  expect(response.ok(),path+': '+JSON.stringify(data)).toBe(true);
  return data;
}
async function ownerLogin(page){
  const config=await get(page.request,'identity/config');
  if(config.bootstrap_required)await post(page.request,'identity/password/bootstrap',{email:ownerEmail,name:'Agency Owner',password,bootstrap_secret:'browser-test-only-bootstrap-key-0123456789'});
  await post(page.request,'identity/password/login',{email:ownerEmail,password});
}
async function invitedAccount(browser,owner,{email,name,...membership}){
  const invitation=await post(owner,'identity/invitations',{email,...membership});
  const context=await browser.newContext({baseURL:origin});
  await post(context.request,'identity/password/register',{email,name,password,token:invitation.invitation_token});
  return {context,page:await context.newPage()};
}
async function creator(owner,name,handle){
  return post(owner,'catalog/creators',{name,handle,niche:'Design',location:'Mumbai',language:'English',bio:'A creator record for the connected financial workflow.',fee:125050,available:true,followers:null,engagement:null,metric_source:'Not supplied',visibility:'Approved',portfolio:[]});
}
async function campaign(owner,brandClient,brandId,creatorId,title){
  const proposal=await post(owner,'proposals',{brand_id:brandId,title,items:[{label:'Creator deliverable',quantity:1,unit_price:125050,creator_id:creatorId}],terms:'One revision. Financial records are entered independently.',rights:'Organic use for thirty days.',expires:date(14)});
  const workspace=await get(brandClient,'workspace');
  const record=workspace.proposals.find(item=>item.id===proposal.id);
  return post(brandClient,'proposals/accept',{id:proposal.id,version_id:record.versions[0].id});
}

// Uses the real Next -> Express -> persistent SQLite path. API setup creates
// identities/campaigns; each financial mutation below goes through the React UI.
test('financial work persists through reload and remains private to the correct brand and creator',async({page,browser})=>{
  test.setTimeout(180000);
  const suffix=randomUUID().slice(0,8),title='Finance campaign '+suffix;
  const contexts=[];
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await ownerLogin(page);
    const brand=await post(page.request,'catalog/brands',{name:'Finance brand '+suffix,industry:'Design'});
    const unrelatedBrand=await post(page.request,'catalog/brands',{name:'Separate brand '+suffix,industry:'Travel'});
    const talent=await creator(page.request,'Finance Creator '+suffix,'finance_'+suffix);
    const brandSession=await invitedAccount(browser,page.request,{email:`brand-${suffix}@browser-test.example`,name:'Finance Brand Contact',role:'brand',brand_id:brand.id});contexts.push(brandSession.context);
    const unrelatedSession=await invitedAccount(browser,page.request,{email:`separate-${suffix}@browser-test.example`,name:'Separate Brand Contact',role:'brand',brand_id:unrelatedBrand.id});contexts.push(unrelatedSession.context);
    const creatorSession=await invitedAccount(browser,page.request,{email:`creator-${suffix}@browser-test.example`,name:'Finance Creator',role:'creator',creator_id:talent.id});contexts.push(creatorSession.context);
    const accepted=await campaign(page.request,brandSession.context.request,brand.id,talent.id,title);
    const campaignId=accepted.campaign_id;

    await page.goto('/workspace/finance');
    await page.getByRole('button',{name:'New invoice',exact:true}).click();
    let dialog=page.getByRole('dialog');
    await dialog.getByRole('combobox',{name:/Campaign/}).selectOption(campaignId);
    await dialog.getByLabel('Invoice / milestone title',{exact:true}).fill('Production milestone '+suffix);
    let line=dialog.getByRole('group',{name:'Line 1',exact:true});
    await line.getByLabel('Description',{exact:true}).fill('Creator production');
    await line.getByLabel('Quantity',{exact:true}).fill('2');
    await line.getByLabel('Rate ₹',{exact:true}).fill('1500.25');
    await line.getByLabel('Tax %',{exact:true}).fill('18');
    await dialog.getByRole('button',{name:'Add line item',exact:true}).click();
    line=dialog.getByRole('group',{name:'Line 2',exact:true});
    await line.getByLabel('Description',{exact:true}).fill('Campaign management');
    await line.getByLabel('Rate ₹',{exact:true}).fill('500');
    await dialog.getByRole('button',{name:'Save invoice draft',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Issue invoice',exact:true})).toBeVisible();
    await expect(dialog.getByText('₹4,040.59',{exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'Issue invoice',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Record receipt',exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'Record receipt',exact:true}).click();
    await dialog.getByLabel('Amount ₹',{exact:true}).fill('2000.25');
    await dialog.getByLabel('External payment reference',{exact:true}).fill('receipt-'+suffix);
    await dialog.getByLabel('Evidence note (finance only)',{exact:true}).fill('Internal receipt verification '+suffix);
    await dialog.getByRole('button',{name:'Save settlement record',exact:true}).click();
    await expect(dialog.getByText('receipt-'+suffix,{exact:false})).toBeVisible();
    await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();

    await page.getByRole('button',{name:'Record cost',exact:true}).click();
    dialog=page.getByRole('dialog');
    await dialog.getByRole('combobox',{name:/Campaign/}).selectOption(campaignId);
    await dialog.getByRole('combobox',{name:/Assigned creator/}).selectOption(talent.id);
    await dialog.getByLabel('Description',{exact:true}).fill('Creator fee '+suffix);
    await dialog.getByLabel('Amount ₹',{exact:true}).fill('1250.50');
    await dialog.getByLabel('Evidence / agreement reference',{exact:true}).fill('Private creator agreement '+suffix);
    await dialog.getByRole('button',{name:'Record cost',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Record payout',exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'Record payout',exact:true}).click();
    await dialog.getByLabel('Amount ₹',{exact:true}).fill('500.25');
    await dialog.getByLabel('External payment reference',{exact:true}).fill('payout-'+suffix);
    await dialog.getByLabel('Evidence note (finance only)',{exact:true}).fill('Internal payout verification '+suffix);
    await dialog.getByRole('button',{name:'Save settlement record',exact:true}).click();
    await expect(dialog.getByText('payout-'+suffix,{exact:false})).toBeVisible();
    await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();

    await page.getByRole('button',{name:'Record cost',exact:true}).click();
    dialog=page.getByRole('dialog');
    await dialog.getByRole('combobox',{name:/Campaign/}).selectOption(campaignId);
    await dialog.getByRole('combobox',{name:/Category/}).selectOption('Editing');
    await dialog.getByLabel('Description',{exact:true}).fill('Internal editing expense '+suffix);
    await dialog.getByLabel('Amount ₹',{exact:true}).fill('450.10');
    await dialog.getByLabel('Evidence / agreement reference',{exact:true}).fill('Private editing evidence '+suffix);
    await dialog.getByRole('button',{name:'Record cost',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Record payout',exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.reload();
    await expect(page.getByText('Production milestone '+suffix,{exact:true})).toBeVisible();
    await expect(page.getByText('Creator fee '+suffix,{exact:true})).toBeVisible();

    const ledger=await get(page.request,'commerce');
    const invoice=ledger.invoices.find(item=>item.title==='Production milestone '+suffix);
    const fee=ledger.costs.find(item=>item.description==='Creator fee '+suffix);
    expect(invoice).toMatchObject({total:404059,paid:200025,outstanding:204034,status:'Part paid',state:'Issued'});
    expect(invoice.settlements).toHaveLength(1);
    expect(fee).toMatchObject({amount:125050,paid:50025,outstanding:75025});
    expect(fee.settlements).toHaveLength(1);
    expect(ledger.reports.find(item=>item.campaign_id===campaignId)).toMatchObject({invoiced_ex_tax:350050,recorded_costs:170060,contribution:179990,cash_movement:150000});

    const brandLedger=await get(brandSession.context.request,'commerce');
    expect(brandLedger.invoices.map(item=>item.id)).toContain(invoice.id);
    expect(brandLedger.costs).toEqual([]);expect(brandLedger.reports).toBeNull();
    expect(JSON.stringify(brandLedger)).not.toContain('Internal receipt verification');
    await brandSession.page.goto('/workspace/finance');
    await expect(brandSession.page.getByText('Production milestone '+suffix,{exact:true})).toBeVisible();
    await expect(brandSession.page.getByRole('button',{name:'New invoice',exact:true})).toHaveCount(0);
    await expect(brandSession.page.getByRole('heading',{name:'Costs & creator payables',exact:true})).toHaveCount(0);
    await expect(brandSession.page.getByText('Internal editing expense '+suffix,{exact:true})).toHaveCount(0);

    const creatorLedger=await get(creatorSession.context.request,'commerce');
    expect(creatorLedger.invoices).toEqual([]);expect(creatorLedger.reports).toBeNull();
    expect(creatorLedger.costs.map(item=>item.id)).toEqual([fee.id]);
    expect(creatorLedger.costs[0]).not.toHaveProperty('evidence');
    expect(JSON.stringify(creatorLedger)).not.toContain('Internal payout verification');
    await creatorSession.page.goto('/workspace/finance');
    await expect(creatorSession.page.getByText('Creator fee '+suffix,{exact:true})).toBeVisible();
    await expect(creatorSession.page.getByRole('heading',{name:'Your payout records',exact:true})).toBeVisible();
    await expect(creatorSession.page.getByRole('button',{name:'Record cost',exact:true})).toHaveCount(0);
    await expect(creatorSession.page.getByText('Production milestone '+suffix,{exact:true})).toHaveCount(0);

    const unrelatedLedger=await get(unrelatedSession.context.request,'commerce');
    expect(unrelatedLedger.invoices).toEqual([]);expect(unrelatedLedger.costs).toEqual([]);expect(unrelatedLedger.reports).toBeNull();
    const forbiddenInvoice=await unrelatedSession.context.request.get('/api/commerce/invoices/'+invoice.id);
    expect(forbiddenInvoice.status()).toBe(403);
    const creatorInvoice=await creatorSession.context.request.get('/api/commerce/invoices/'+invoice.id);
    expect(creatorInvoice.status()).toBe(403);
    const forbiddenMutation=await brandSession.context.request.post('/api/commerce/settle',{headers:{Origin:origin},data:{parent_type:'invoice',parent_id:invoice.id,amount:100,reference:'forbidden-'+suffix,effective_on:date(),note:'Unauthorized attempt'}});
    expect(forbiddenMutation.status()).toBe(403);
    expect(errors).toEqual([]);
  }finally{await Promise.all(contexts.map(context=>context.close()));}
});
