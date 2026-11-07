const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function campaignPackHtml(pack){
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(pack.title)}</title><style>body{font:17px/1.7 system-ui;margin:3rem auto;max-width:920px;padding:0 1.5rem;color:#243326;background:#fafaf5}h1{line-height:1.2}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}section{margin:2rem 0;border-top:1px solid #ccd3c7;padding-top:1rem}small{color:#53664d}@media print{body{margin:0;max-width:none}}</style><h1>${escapeHtml(pack.title)}</h1><small>Private planning brief · supplied source ${escapeHtml(pack.source_date)} · agreements, dispatch and publishing remain unconfirmed</small><section><h2>Latest supplied update</h2><pre>${escapeHtml(pack.update_note||'No later update supplied.')}</pre></section>${pack.creators.map(c=>`<section><h2>${escapeHtml(c.name)} · ${escapeHtml(c.concept)}</h2><h3>Current caption draft</h3><pre>${escapeHtml(c.caption)}</pre><h3>Full script and directions</h3><pre>${escapeHtml(c.script)}</pre></section>`).join('')}<section><h2>Original supplied campaign pack</h2><pre>${escapeHtml(pack.source_text)}</pre></section></html>`;
}
export function createCampaignPacks({db,send,requireThat}){
 db.exec(`CREATE TABLE IF NOT EXISTS campaign_reference_packs(campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),source_id TEXT NOT NULL UNIQUE,source_sha256 TEXT NOT NULL,payload_json TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL);`);
 const row=(sql,...args)=>db.prepare(sql).get(...args);
 async function handler(req,res,path,u){
  const match=path.match(/^\/api\/campaign-packs\/([\w-]+)(\/document)?$/);if(!match)return false;
  requireThat(req.method==='GET',405,'Campaign source packs are read-only.');
  const record=row('SELECT p.*,c.brand_id FROM campaign_reference_packs p JOIN campaigns c ON c.id=p.campaign_id WHERE p.campaign_id=?',match[1]);requireThat(record,404,'Campaign pack not found.');
  const staff=['owner','manager','reviewer','finance'].includes(u.role);
  const assigned=u.role==='creator'&&row('SELECT id FROM assignments WHERE campaign_id=? AND creator_id=?',match[1],u.creator_id);
  requireThat(staff||(u.role==='brand'&&u.brand_id===record.brand_id)||assigned,403,'This campaign pack is outside your workspace.');
  const pack=JSON.parse(record.payload_json);
  if(match[2]){
   requireThat(staff,403,'Only the agency team can export the complete source pack.');
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox",'X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="VOQRO_Veda_Munch_Campaign.html"'});res.end(campaignPackHtml(pack));return true;
  }
  // Individual creators receive only their own brief. Full source contains
  // agency onboarding and other creators' scripts, so it stays with agency staff.
  const {source_text,...safe}=pack;
  if(u.role==='creator'){safe.creators=safe.creators.filter(c=>c.creator_id===u.creator_id);delete safe.stock;delete safe.spare;}
  send(res,200,{...safe,can_export:staff,campaign_id:record.campaign_id});return true;
 }
 return {handler};
}
