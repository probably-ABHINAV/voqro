import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:3210';
const password='Browser-only test passphrase 42!';
const excerpt='Example Foods makes roasted snacks with regional flavours. Our products are available online and in selected shops. Contact our team to learn more about the range.';
async function post(page,path,body){const r=await page.request.post('/api/'+path,{headers:{Origin:origin},data:body});expect(r.ok(),await r.text()).toBe(true);return r.json();}
async function login(page){const config=await page.request.get('/api/identity/config').then(r=>r.json());if(config.bootstrap_required)await post(page,'identity/password/bootstrap',{email:'owner@browser-test.example',name:'Agency Owner',password,bootstrap_secret:'browser-test-only-bootstrap-key-0123456789'});await post(page,'identity/password/login',{email:'owner@browser-test.example',password});}

test('client-team UI saves prospects, owner profile and real pipeline conversion without activating a provider',async({page})=>{
 await login(page);await page.goto('/workspace/pipeline');await page.getByRole('button',{name:'Open AI client team',exact:true}).click();
 const panel=page.getByRole('region',{name:'AI client team'});
 // Card renders a section with its accessible label.
 await expect(panel).toBeVisible();
 await panel.getByText('Service profile & sales allowance',{exact:true}).click();
 await panel.getByLabel('Target customers and locations',{exact:true}).fill('Regional snack brands in India');
 await panel.getByLabel('Monthly sales allowance (US$)',{exact:true}).fill('1');
 await panel.getByRole('button',{name:'Save service profile',exact:true}).click();
 await expect(panel).toContainText('$1.00');
 await panel.getByText('Add a business website',{exact:true}).click();
 await panel.getByLabel('Business name',{exact:true}).fill('Client Team Test Brand');
 await panel.getByLabel('Public website',{exact:true}).fill('https://client-team.example.com/');
 await panel.getByLabel('Public page excerpt (optional)',{exact:true}).fill(excerpt);
 await panel.getByRole('button',{name:'Save prospect',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Open Client Team Test Brand',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'Research & draft outreach',exact:true})).toBeDisabled();
 await panel.getByText('Add qualified prospect to pipeline',{exact:true}).click();
 await panel.getByLabel('Verified contact name',{exact:true}).fill('Test Contact');
 await panel.getByLabel('Verified contact email',{exact:true}).fill('contact@client-team.example');
 await panel.getByLabel('Qualified opportunity',{exact:true}).fill('A manually verified planning enquiry for regional creator work.');
 await panel.getByLabel('Planning budget (₹)',{exact:true}).fill('5000');
 await panel.getByRole('button',{name:'Add to enquiry pipeline',exact:true}).click();
 await expect(panel.getByText(/Added to the enquiry pipeline/)).toBeVisible();
 const workspace=await page.request.get('/api/workspace').then(r=>r.json());expect(workspace.leads.some(l=>l.company==='Client Team Test Brand'&&l.budget===500000)).toBe(true);
 await panel.getByText('Record an actual reply or opt-out',{exact:true}).click();
 await panel.getByLabel('Reply received',{exact:true}).fill('Please stop contacting us.');
 await panel.getByRole('checkbox',{name:'They declined further contact. Stop outreach.'}).check();
 await panel.getByRole('button',{name:'Save reply',exact:true}).click();
 await expect(panel).toContainText('Do not contact');
 await page.reload();await page.getByRole('button',{name:'Open AI client team',exact:true}).click();await page.getByRole('button',{name:'Open Client Team Test Brand',exact:true}).click();await expect(page.getByRole('region',{name:'AI client team'})).toContainText('Do not contact');
});

test('client-team renders source-linked model results and editable drafts using a deterministic browser fixture',async({page})=>{
 await login(page);
 const p=await post(page,'sales-ai/prospects',{name:'Draft UI Example',url:'https://draft-ui.example.com/',excerpt});
 let detail={prospect:{id:p.id,name:'Draft UI Example',url:'https://draft-ui.example.com/',excerpt,contact_state:'Not contacted',last_reply:'',lead_id:null},jobs:[{id:'fixture-job',kind:'outreach',state:'Completed',error:null,evidence:{url:'https://draft-ui.example.com/',text:excerpt,source:'Browser fixture; simulated model response',captured_at:new Date().toISOString()},result:{summary:'A brand with regional products.',findings:[{observation:'The page describes regional flavours.',evidence_quote:'regional flavours',opportunity:'Discuss a regional creator campaign.'}],limitations:'Human review required.'}}],drafts:[{id:'fixture-draft',kind:'outreach',message:'Would a regional creator campaign idea be useful?',revision:1,approved_revision:null,sent_at:null,channel:null,recipient:null}],events:[]};
 await page.route('**/api/sales-ai/prospects/'+p.id,route=>route.fulfill({json:detail}));
 await page.route('**/api/sales-ai/draft',async route=>{
  const b=route.request().postDataJSON(),d=detail.drafts[0];
  expect(b.revision).toBe(d.revision);
  if(b.action==='save'){d.message=b.message;d.revision++;d.approved_revision=null;}
  if(b.action==='approve')d.approved_revision=d.revision;
  if(b.action==='sent'){expect(d.approved_revision).toBe(d.revision);d.sent_at=new Date().toISOString();d.channel=b.channel;d.recipient=b.recipient;}
  await route.fulfill({json:{ok:true}});
 });
 await page.goto('/workspace/pipeline');await page.getByRole('button',{name:'Open AI client team',exact:true}).click();await page.getByRole('button',{name:'Open Draft UI Example',exact:true}).click();
 const panel=page.getByRole('region',{name:'AI client team'});await expect(panel.getByText('The page describes regional flavours.',{exact:true})).toBeVisible();
 await panel.getByLabel('Editable message',{exact:true}).fill('A revised message based on the public source.');
 await expect(panel.getByRole('button',{name:'Approve draft',exact:true})).toBeDisabled();
 await panel.getByRole('button',{name:'Save draft edits',exact:true}).click();await expect(panel.getByRole('button',{name:'Approve draft',exact:true})).toBeEnabled();
 await panel.getByRole('button',{name:'Approve draft',exact:true}).click();await panel.getByRole('button',{name:'Record manual send',exact:true}).click();
 await panel.getByLabel('Actual recipient',{exact:true}).fill('verified@example.com');await panel.getByRole('button',{name:'I sent this message',exact:true}).click();
 await expect(panel).toContainText('Delivery is not provider verified.');await expect(panel.getByLabel('Editable message',{exact:true})).toBeDisabled();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
