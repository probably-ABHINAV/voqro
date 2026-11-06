import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';process.env.DB_PATH=':memory:';process.env.DEMO_MODE='1';
const {server}=await import('../server.mjs');let base;const cookies={};
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;for(const role of ['owner','finance','brand','other','creator','manager','reviewer']){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:'u_'+role})});cookies[role]=r.headers.get('set-cookie').split(';')[0];}});
after(()=>new Promise(r=>server.close(r)));
async function req(path='',data,role='owner'){const r=await fetch(base+'/api/commerce'+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookies[role]||'',...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
const today=new Date().toISOString().slice(0,10);
const draft=(key,extra={})=>({campaign_id:'cam_1',title:'Campaign deposit',due_on:'2099-12-31',request_key:key,items:[{label:'Creative services',quantity:2,unit_price:10001,tax_bps:1800}],...extra});
const cost=(key,extra={})=>({campaign_id:'cam_1',creator_id:'c_asha',category:'Creator fee',description:'Agreed creation fee',amount:5000,due_on:today,evidence:'Private agreement reference',request_key:key,...extra});
const settle=(type,id,value,reference)=>({parent_type:type,parent_id:id,amount:value,reference,effective_on:today,note:'Internal bank evidence'});

test('invoice snapshots use paise and per-line rounding, retries deduplicate and drafts remain private',async()=>{
 const payload=draft('invoice-rounding');const r=await req('/invoices',payload);assert.equal(r.status,201);assert.equal(r.data.subtotal,20002);assert.equal(r.data.tax,3600);assert.equal(r.data.total,23602);assert.equal(r.data.state,'Draft');assert.equal((await req('/invoices',payload)).data.id,r.data.id);
 assert.equal((await req('/invoices',{...payload,title:'Changed'})).status,409);
 assert.equal((await req('/invoices/'+r.data.id,undefined,'brand')).status,403);
 assert.equal((await req('/settle',settle('invoice',r.data.id,100,'draft-receipt'))).status,409);
 assert.equal((await req('/issue',{id:r.data.id},'finance')).status,200);
 assert.equal((await req('/issue',{id:r.data.id})).data.issued_on,today);
 assert.equal((await req('/invoices/'+r.data.id,undefined,'brand')).status,200);
 assert.equal((await req('/invoices/'+r.data.id,undefined,'other')).status,403);
 assert.equal((await req('/invoices/'+r.data.id,undefined,'creator')).status,403);
 assert.equal((await req('/invoices',draft('brand-forged'),'brand')).status,403);
});

test('receipts enforce balances and unique references, corrections retain history and are idempotent',async()=>{
 const i=(await req('/invoices',draft('settlements'))).data;await req('/issue',{id:i.id});
 const payload=settle('invoice',i.id,10000,'BANK-IN-001'),s=await req('/settle',payload);assert.equal(s.status,201);
 assert.equal((await req('/settle',payload)).data.id,s.data.id);
 assert.equal((await req('/settle',{...payload,amount:9999})).status,409);
 assert.equal((await req('/settle',settle('invoice',i.id,20000,'BANK-IN-OVER'))).status,409);
 assert.equal((await req('/void',{parent_type:'invoice',parent_id:i.id})).status,409);
 let v=(await req('/invoices/'+i.id)).data;assert.equal(v.paid,10000);assert.equal(v.outstanding,13602);assert.equal(v.status,'Part paid');
 const brand=(await req('/invoices/'+i.id,undefined,'brand')).data;assert.equal('note' in brand.settlements[0],false);assert.equal('created_by' in brand.settlements[0],false);
 const r=await req('/reverse',{id:s.data.id,reason:'Bank reference belonged to another campaign'});assert.equal(r.status,201);assert.equal((await req('/reverse',{id:s.data.id,reason:'Retry correction'})).data.id,r.data.id);
 v=(await req('/invoices/'+i.id)).data;assert.equal(v.paid,0);assert.equal(v.settlements.length,2);assert.equal(v.settlements[1].reversal_of,s.data.id);
 assert.equal((await req('/settle',settle('invoice',i.id,23602,'BANK-IN-CORRECT'))).status,201);assert.equal((await req('/invoices/'+i.id)).data.status,'Paid');
 assert.equal((await req('/reverse',{id:r.data.id,reason:'Reverse reversal'})).status,404);
});

test('costs, partial payouts and contributions use recorded amounts with brand and creator isolation',async()=>{
 const campaign_id='cam_3';const i=(await req('/invoices',draft('report-invoice',{campaign_id,items:[{label:'Campaign fee',quantity:1,unit_price:100000,tax_bps:1800}]}))).data;await req('/issue',{id:i.id});await req('/settle',settle('invoice',i.id,50000,'BANK-REPORT-IN'));
 const c=(await req('/costs',cost('report-cost',{campaign_id,creator_id:'c_meera',amount:30000}))).data;assert.equal(c.amount,30000);assert.equal((await req('/costs',cost('report-cost',{campaign_id,creator_id:'c_meera',amount:30000}))).data.id,c.id);
 assert.equal((await req('/costs',cost('report-cost',{campaign_id,creator_id:'c_meera',amount:30001}))).status,409);
 await req('/settle',settle('cost',c.id,10000,'BANK-REPORT-OUT'));
 const report=(await req()).data.reports.find(r=>r.campaign_id===campaign_id);assert.deepEqual([report.invoiced_ex_tax,report.tax,report.receipts,report.receivable,report.recorded_costs,report.costs_paid,report.payable,report.contribution,report.cash_movement],[100000,18000,50000,68000,30000,10000,20000,70000,40000]);
 const own=(await req('/costs',cost('asha-payable'))).data;await req('/settle',settle('cost',own.id,2000,'ASHA-PAYOUT'));
 const creator=(await req('',undefined,'creator')).data;assert.deepEqual(creator.invoices,[]);assert.equal(creator.reports,null);assert.ok(creator.costs.every(c=>c.creator_id==='c_asha'));assert.ok(!creator.costs.some(x=>x.id===c.id));const personal=creator.costs.find(x=>x.id===own.id);assert.equal(personal.outstanding,3000);assert.equal('evidence' in personal,false);assert.equal('note' in personal.settlements[0],false);
 const brand=(await req('',undefined,'brand')).data;assert.deepEqual(brand.costs,[]);assert.equal(brand.reports,null);assert.ok(brand.invoices.every(x=>x.campaign_id==='cam_1'));
});

test('simultaneous settlements cannot overspend a payable, and voids remain historical',async()=>{
 const c=(await req('/costs',cost('race-cost'))).data;
 const results=await Promise.all([req('/settle',settle('cost',c.id,4000,'RACE-A')),req('/settle',settle('cost',c.id,4000,'RACE-B'))]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const accepted=results.find(r=>r.status===201).data;await req('/reverse',{id:accepted.id,reason:'Correct mistaken payment'});assert.equal((await req('/void',{parent_type:'cost',parent_id:c.id})).status,200);
 assert.equal((await req('/settle',settle('cost',c.id,1,'VOID-PAYMENT'))).status,409);const historical=(await req()).data.costs.find(x=>x.id===c.id);assert.equal(historical.status,'Void');assert.equal(historical.outstanding,0);assert.equal(historical.settlements.length,2);
 const i=(await req('/invoices',draft('void-draft'))).data;await req('/void',{parent_type:'invoice',parent_id:i.id});assert.equal((await req('/issue',{id:i.id})).status,409);assert.equal((await req('/invoices/'+i.id,undefined,'brand')).status,403);assert.ok(!(await req('',undefined,'brand')).data.invoices.some(x=>x.id===i.id));
});

test('financial access, malformed input, invalid fees and future payments fail closed',async()=>{
 for(const role of ['manager','reviewer','anonymous'])assert.equal((await req('',undefined,role)).status,role==='anonymous'?401:403);
 for(const extra of [{items:[null]},{items:[]},{items:[{label:'bad',quantity:1,unit_price:0.5,tax_bps:0}]},{due_on:'2099-02-30'},{campaign_id:null}])assert.equal((await req('/invoices',draft('bad',extra))).status,400);
 assert.equal((await req('/invoices',null)).status,400);assert.equal((await req('/costs',cost('unassigned',{creator_id:'c_meera'}))).status,400);
 assert.equal((await req('/costs',cost('not-a-fee',{category:'Storage'}))).status,400);
 const i=(await req('/invoices',draft('validation'))).data;await req('/issue',{id:i.id});const s=settle('invoice',i.id,10,'validation');
 assert.equal((await req('/settle',{...s,effective_on:'2099-01-01'})).status,400);assert.equal((await req('/settle',{...s,reference:'reversal:reserved'})).status,400);assert.equal((await req('/settle',{...s,amount:-1})).status,400);
 assert.equal((await req('/void',{parent_type:'invoice',parent_id:i.id},'brand')).status,403);
});
