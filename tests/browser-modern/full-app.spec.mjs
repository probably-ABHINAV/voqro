import {test,expect} from '@playwright/test';

const password='Browser-only test passphrase 42!';
const origin='http://127.0.0.1:3210';
async function request(page,path,body){
 const result=await page.evaluate(async({path,body})=>{const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};},{path,body});
 expect(result.status,JSON.stringify(result.data)).toBeLessThan(400);return result.data;
}
async function register(browser,invitation,name){
 const context=await browser.newContext({baseURL:origin});
 const page=await context.newPage();
 await page.goto(invitation.registration_url);
 await page.getByLabel('Full name',{exact:true}).fill(name);
 await page.getByLabel('Email address',{exact:true}).fill(invitation.email);
 await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Accept invitation',exact:true}).click();
 await expect(page).toHaveURL(/\/workspace/);
 return {context,page};
}

test('real accounts complete enquiry, proposal, campaign brief and saved tasks through Next and Express',async({page,browser},testInfo)=>{
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const identity=await page.request.get('/api/identity/config').then(r=>r.json());
 await page.goto(identity.bootstrap_required?'/setup':'/login');
 if(identity.bootstrap_required)await page.getByLabel('Full name',{exact:true}).fill('Agency Owner');
 await page.getByLabel('Email address',{exact:true}).fill('owner@browser-test.example');
 await page.getByLabel('Password',{exact:true}).fill(password);
 if(identity.bootstrap_required)await page.getByLabel('Setup key',{exact:true}).fill('browser-test-only-bootstrap-key-0123456789');
 await page.getByRole('button',{name:identity.bootstrap_required?'Create owner account':'Sign in',exact:true}).click();
 await expect(page).toHaveURL(/\/workspace/);
 expect((await request(page,'workspace')).demo).toBe(false);

 await page.goto('/workspace/brands');
 await page.getByRole('button',{name:'Add brand',exact:true}).click();
 await page.getByLabel('Brand name',{exact:true}).fill('Persistent Brand');
 await page.getByLabel('Industry',{exact:true}).fill('Design');
 await page.getByRole('button',{name:'Save brand',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Persistent Brand',exact:true})).toBeVisible();
 const brand=(await request(page,'workspace')).brands.find(b=>b.name==='Persistent Brand');

 await page.goto('/workspace/creators');
 await page.getByRole('button',{name:'Add creator',exact:true}).click();
 await page.getByLabel('Full name',{exact:true}).fill('Real Creator');
 await page.getByLabel('Instagram handle',{exact:true}).fill('realcreator');
 await page.getByLabel('Niche',{exact:true}).fill('Design');
 await page.getByLabel('Geography',{exact:true}).fill('Mumbai');
 await page.getByLabel('Languages',{exact:true}).fill('English, Hindi');
 await page.getByLabel('Private planning fee (₹)',{exact:true}).fill('2500');
 await page.getByRole('combobox',{name:'Availability',exact:true}).selectOption('yes');
 await page.getByRole('combobox',{name:'Profile visibility',exact:true}).selectOption('Approved');
 await page.getByLabel('Biography',{exact:true}).fill('A real test record created through the connected catalogue.');
 await page.getByRole('button',{name:'Save creator profile',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Real Creator',exact:true})).toBeVisible();
 const creator=(await request(page,'workspace')).creators.find(c=>c.name==='Real Creator');

 const visitorContext=await browser.newContext({baseURL:origin});const visitor=await visitorContext.newPage();
 await visitor.goto('/');
 await expect(visitor.getByRole('heading',{name:'Real Creator',exact:true})).toBeVisible();
 await visitor.getByRole('button',{name:/Let’s work together/}).first().click();
 await visitor.getByLabel('Your name',{exact:true}).fill('Brand Contact');
 await visitor.getByLabel('Email address',{exact:true}).fill('brand@browser-test.example');
 await visitor.getByLabel('Brand / company',{exact:true}).fill('Persistent Brand');
 await visitor.getByLabel('Indicative budget (₹)',{exact:true}).fill('8000');
 await visitor.getByLabel('What are you imagining?',{exact:true}).fill('One creator video and a complete real account workflow.');
 await visitor.getByRole('button',{name:'Send your brief',exact:true}).click();
 await expect(visitor.getByRole('heading',{name:'A good beginning.',exact:true})).toBeVisible();
 await visitorContext.close();

 await page.goto('/workspace/pipeline');
 const leadCard=page.locator('article').filter({has:page.getByRole('heading',{name:'Persistent Brand',exact:true})});
 await leadCard.getByRole('button',{name:'Build proposal',exact:true}).click();
 await page.getByLabel('Proposal title',{exact:true}).fill('Connected campaign');
 await page.getByRole('combobox',{name:'Brand',exact:true}).selectOption(brand.id);
 await page.getByRole('combobox',{name:'Add creator line item',exact:true}).selectOption(creator.id);
 await page.getByRole('button',{name:'Remove line item 1',exact:true}).click();
 await page.getByLabel('Payment terms & included revisions',{exact:true}).fill('One revision; payment recorded separately.');
 await page.getByLabel('Usage rights & exclusions',{exact:true}).fill('Organic Instagram use in India for 30 days.');
 await page.getByRole('button',{name:'Share proposal',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 const brandInvite=await request(page,'identity/invitations',{email:'brand@browser-test.example',role:'brand',brand_id:brand.id});
 brandInvite.email='brand@browser-test.example';
 const brandSession=await register(browser,brandInvite,'Brand Contact');
 await brandSession.page.goto('/workspace/proposals');
 await brandSession.page.getByRole('button',{name:'View proposal',exact:true}).click();
 await brandSession.page.getByRole('checkbox').check();
 await brandSession.page.getByRole('button',{name:'Accept version 1',exact:true}).click();
 await expect(brandSession.page).toHaveURL(/campaign/);
 const campaign=(await request(brandSession.page,'workspace')).campaigns.find(c=>c.name==='Connected campaign');
 expect(campaign).toBeTruthy();

 await page.goto('/workspace/delivery-campaign:'+campaign.id);
 await page.getByRole('button',{name:'Prepare brief',exact:true}).click();
 await page.getByRole('textbox',{name:'Campaign goals',exact:true}).fill('Demonstrate a complete connected creative workflow.');
 await page.getByRole('textbox',{name:'Required content and deliverables',exact:true}).fill('One original video with cover and caption.');
 await page.getByRole('button',{name:'Save brief version',exact:true}).click();
 await expect(page.getByRole('button',{name:'Revise brief',exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByText('One original video with cover and caption.',{exact:true})).toBeVisible();

 const creatorInvite=await request(page,'identity/invitations',{email:'creator@browser-test.example',role:'creator',creator_id:creator.id});creatorInvite.email='creator@browser-test.example';
 const creatorSession=await register(browser,creatorInvite,'Real Creator');
 const creatorUser=(await request(creatorSession.page,'workspace')).user;
 await page.goto('/workspace/workflow');
 await page.getByRole('button',{name:'New task',exact:true}).click();
 await page.getByRole('combobox',{name:'Campaign',exact:true}).selectOption(campaign.id);
 await page.getByLabel('Task title',{exact:true}).fill('Film the connected campaign');
 await page.getByLabel('Instructions',{exact:true}).fill('Follow the saved creative brief.');
 await page.getByRole('combobox',{name:'Assignee',exact:true}).selectOption(creatorUser.id);
 await page.getByRole('button',{name:'Save task',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await creatorSession.page.goto('/workspace/workflow');
 await expect(creatorSession.page.getByText('Film the connected campaign',{exact:true})).toBeVisible();
 const creatorData=await request(creatorSession.page,'workspace');expect(creatorData.finance).toBeNull();expect(creatorData.campaigns.every(c=>!('budget' in c))).toBe(true);
 const denied=await creatorSession.page.request.get('/api/identity/members');expect(denied.status()).toBe(403);
 await page.goto('/workspace/pipeline');
 await expect(page.locator('article').filter({hasText:'Persistent Brand'})).toContainText('Won');
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.locator('.sidebar').evaluate(element=>element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
 await page.getByRole('button',{name:'Toggle navigation',exact:true}).click();
 await expect.poll(()=>page.locator('.sidebar').evaluate(element=>element.getBoundingClientRect().left)).toBeGreaterThanOrEqual(-1);
 await page.getByRole('navigation',{name:'Workspace',exact:true}).getByRole('link',{name:'Enquiry pipeline',exact:true}).click();
 await expect.poll(()=>page.locator('.sidebar').evaluate(element=>element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('connected-mobile.png'),fullPage:true});
 expect(errors).toEqual([]);
 await brandSession.context.close();await creatorSession.context.close();
});
