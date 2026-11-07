import {test,expect} from '@playwright/test';

const origin='http://127.0.0.1:3210';
const owner={email:'owner@browser-test.example',password:'Browser-only test passphrase 42!'};

async function signInOwner(page){
 const configResponse=await page.request.get('/api/identity/config');
 expect(configResponse.status()).toBe(200);
 const config=await configResponse.json();
 expect(config.demo).toBe(false);
 expect(config.provider).toBe('Password');
 const path=config.bootstrap_required?'bootstrap':'login';
 const body=config.bootstrap_required?{...owner,name:'Agency Owner',bootstrap_secret:'browser-test-only-bootstrap-key-0123456789'}:owner;
 const response=await page.request.post('/api/identity/password/'+path,{headers:{Origin:origin},data:body});
 expect(response.status(),await response.text()).toBeLessThan(400);
 expect((await response.json()).user.role).toBe('owner');
}

test('every extension route reads real records and unavailable providers stay disabled',async({page},testInfo)=>{
 test.setTimeout(150000);
 await signInOwner(page);
 const errors=[],failedRequests=[],mutations=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{
  if(new URL(response.url()).pathname.startsWith('/api/')&&response.status()>=400)failedRequests.push(response.status()+' '+new URL(response.url()).pathname);
 });
 page.on('request',request=>{
  if(new URL(request.url()).pathname.startsWith('/api/')&&request.method()!=='GET')mutations.push(request.method()+' '+new URL(request.url()).pathname);
 });

 const routes=[
  {view:'reporting',title:'Reports & agreements',endpoint:'reporting',section:'Campaign reports'},
  {view:'operations',title:'Operations',endpoint:'operations',section:'Processing queue'},
  {view:'trends',title:'Trend evidence',endpoint:'operations'},
  {view:'results',title:'Campaign results',endpoint:'operations'},
  {view:'optimization',title:'Matching & experiments',endpoint:'optimization',section:'Saved matching runs'},
  {view:'connections',title:'Connections',section:'Identity & sign-in'},
  {view:'instagram',title:'Instagram publishing',endpoint:'instagram',section:'Publishing availability'},
  {view:'cloud',title:'Media & AI',endpoint:'cloud',section:'Processing configuration'},
  {view:'email-delivery',title:'Email delivery',endpoint:'notifications/email',section:'Sending configuration'},
  {view:'exceptions',title:'A little attention goes a long way.',endpoint:'workflow'}
 ];
 for(const route of routes){
  await test.step(route.view,async()=>{
   const responsePromise=route.endpoint?page.waitForResponse(response=>new URL(response.url()).pathname==='/api/'+route.endpoint&&response.request().method()==='GET'):null;
   await page.goto('/workspace/'+route.view);
   let data=null;
   if(responsePromise){const response=await responsePromise;expect(response.status(),route.view+' API status').toBe(200);data=await response.json();}
   await expect(page.getByRole('heading',{name:route.title,level:1,exact:true})).toBeVisible();
   await expect(page.getByText('Loading workspace records…',{exact:true})).toHaveCount(0);
   if(route.section)await expect(page.getByRole('heading',{name:route.section,exact:true})).toBeVisible();
   // Next's route announcer is an alert outside the workspace, including when empty.
   await expect(page.getByRole('main').getByRole('alert').filter({hasText:/\S/})).toHaveCount(0);
   await expect(page.getByRole('dialog')).toHaveCount(0);
   if(route.view==='instagram'){
    if(!data.status.oauth_configured)await expect(page.getByRole('button',{name:'Connect account unavailable',exact:true})).toBeDisabled();
    if(!data.status.publishing_enabled||!data.status.media_delivery_configured){
     await expect(page.getByRole('button',{name:'Schedule publication unavailable',exact:true})).toBeDisabled();
     await expect(page.getByRole('button',{name:'Open manual handoff',exact:true})).toBeVisible();
     await expect(page.getByRole('button',{name:'Schedule real publication',exact:true})).toHaveCount(0);
    }
   }
   if(route.view==='cloud'){
    if(!data.status.storage.startsWith('Configured'))await expect(page.getByRole('button',{name:'Upload to AWS unavailable',exact:true})).toBeDisabled();
    await page.locator('summary').filter({hasText:'Prepare a package'}).click();
    const modes=page.getByRole('combobox',{name:'Processing mode',exact:true});
    await expect(modes).toHaveValue('local');
    if(!data.status.ai.startsWith('Configured'))await expect(modes.locator('option[value="aws"]')).toHaveCount(0);
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('extensions-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:720});
   }
   if(route.view==='email-delivery'&&!data.can_enqueue){
    await expect(page.getByRole('button',{name:'Queue email unavailable',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Queue real email',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Open in-app inbox',exact:true})).toBeVisible();
   }
   expect(errors,route.view+' JavaScript errors').toEqual([]);
  });
 }
 expect(failedRequests,'API reads should succeed for the owner').toEqual([]);
 expect(mutations,'The smoke test must not submit business actions').toEqual([]);
 expect(errors).toEqual([]);
});
