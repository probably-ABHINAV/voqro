import {test,expect} from '@playwright/test';
test('private campaign pack shows current captions and allocation on mobile without publishing controls',async({page})=>{
 const campaign={id:'pack_test',brand_id:'brand_test',name:'Example Brand · Planning',description:'Imported planning brief',status:'Planning',budget:null,start_date:null,end_date:null,has_campaign_pack:true};
 await page.route('**/api/workspace',route=>route.fulfill({json:{user:{id:'test_owner',name:'Owner',role:'owner'},demo:false,connections:{identity:{provider:'Password'}},brands:[{id:'brand_test',name:'Example Brand'}],campaigns:[campaign],creators:[],assignments:[],deliverables:[],proposals:[],activities:[],leads:[],shortlists:[],finance:null}}));
 await page.route('**/api/campaign-packs/pack_test',route=>route.fulfill({json:{title:'Example Brand campaign pack',source_date:'2026-11-05',update_note:'Creator One replaces the previous creator. Updated captions include the collaboration partner before hashtags.',products:['Choco Chips Cookies','Honey Oats Cookies','Cranberry Pistachio Biscotti'],stock:[5,3,8],spare:[0,0,1],shop_url:'https://example.com/product',can_export:true,creators:[{creator_id:'creator_test',name:'Creator One',handle:'creator_one',concept:'A five-minute break',allocation:[1,1,1],priority:true,duration_seconds:34,caption:'#Ad | Gifted by @example_brand\nCollaboration partner: @example_partner\n#ExampleBrand',script:'<script>not executed</script>\nReadable source directions'}],rollout:[{day:'D9',action:'Proposed creator post after approval.'}]}}));
 await page.setViewportSize({width:390,height:844});
 await page.goto('/workspace/campaign%3Apack_test');await expect(page.getByText('Not agreed',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open campaign pack'}).click();await expect(page.getByRole('heading',{name:'Example Brand campaign pack'})).toBeVisible();
 await page.getByText('Full script and shooting directions',{exact:true}).click();await expect(page.getByText('<script>not executed</script>',{exact:false})).toBeVisible();
 await expect(page.getByRole('link',{name:'Download complete HTML pack'})).toHaveAttribute('href','/api/campaign-packs/pack_test/document');
 await expect(page.getByRole('button',{name:'Copy caption'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
