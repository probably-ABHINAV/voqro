// Shared ceiling across media review and sales drafts. Call inside the reservation transaction.
export function monthlyAIReserved(db, monthStart) {
  let total=0;
  for(const table of ['cloud_ai_jobs','sales_ai_jobs']) {
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) total+=db.prepare(`SELECT COALESCE(SUM(reserved_cents),0) n FROM ${table} WHERE created>=?`).get(monthStart).n;
  }
  return total;
}
