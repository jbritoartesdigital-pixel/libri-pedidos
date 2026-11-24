import {createV2AdminNotification} from './v2-notifications.js';
export async function runV3DeliveryRetention(env,{now=new Date(),limit=20}={}){
 const db=env.DB,stamp=now.toISOString(),plus=n=>new Date(now.getTime()+n*86400000).toISOString();
 const result={notices:0,originals:0,previews:0,finals:0,failed:0};
 // Notices are visible in Admin; customer area also shows its own deadline
 // and warning. This does not imply a WhatsApp message was sent.
 for(const [code,days] of [['download_1_day',1],['download_7_days',7]]){
 const rows=(await db.prepare(`SELECT s.id,s.order_id,s.family,o.order_code,s.download_until
 FROM v3_order_services s JOIN v2_orders o ON o.id=s.order_id
 WHERE s.production_status='delivered' AND s.download_until>? AND s.download_until<=?
 AND (s.external_delivery_channel='drive' OR EXISTS(SELECT 1 FROM v3_service_final_files f WHERE f.service_id=s.id AND f.purged_at IS NULL))
 AND NOT EXISTS(SELECT 1 FROM v3_delivery_notices n WHERE n.service_id=s.id AND n.notice_code=?)
 ORDER BY s.download_until LIMIT ?`).bind(stamp,plus(days),code,limit).all()).results||[];
 for(const r of rows){
  try{
   await createV2AdminNotification(env,{eventCode:'V3_DOWNLOAD_EXPIRING',orderId:r.order_id,title:'Downloads a vencer',body:r.order_code+' · '+r.family+' · '+r.download_until.slice(0,10)+'. Lembre a cliente de baixar os arquivos.',actionUrl:'/admin-v2?order='+encodeURIComponent(r.order_code),dedupeKey:'v3-download:'+r.id+':'+code,pushEligible:true});
   await db.prepare('INSERT OR IGNORE INTO v3_delivery_notices(service_id,notice_code) VALUES(?,?)').bind(r.id,code).run();result.notices++;
  }catch{result.failed++;}
 }
 }
 // The app can remove stored external links, not revoke access in Drive or WhatsApp.
 await db.prepare("UPDATE v3_service_previews SET external_url=NULL,purged_at=datetime('now') WHERE external_channel IS NOT NULL AND purged_at IS NULL AND service_id IN(SELECT id FROM v3_order_services WHERE production_status='delivered' AND originals_until<=?)").bind(stamp).run();
 await db.prepare("UPDATE v3_order_services SET external_delivery_url=NULL WHERE external_delivery_url IS NOT NULL AND production_status='delivered' AND download_until<=?").bind(stamp).run();
 if(!env.FILES)return result;
 const groups=[
  {kind:'originals',query:`SELECT u.id,u.r2_key FROM v3_service_uploads u JOIN v3_order_services s ON s.order_id=u.order_id AND s.family=u.family WHERE s.production_status='delivered' AND s.originals_until<=? ORDER BY u.id LIMIT ?`,update:"DELETE FROM v3_service_uploads WHERE id=?"},
  {kind:'previews',query:`SELECT p.id,p.r2_key FROM v3_service_previews p JOIN v3_order_services s ON s.id=p.service_id WHERE s.production_status='delivered' AND s.originals_until<=? AND p.purged_at IS NULL AND p.external_channel IS NULL ORDER BY p.id LIMIT ?`,update:"UPDATE v3_service_previews SET purged_at=datetime('now') WHERE id=? AND purged_at IS NULL"},
  {kind:'finals',query:`SELECT f.id,f.r2_key FROM v3_service_final_files f JOIN v3_order_services s ON s.id=f.service_id WHERE s.production_status='delivered' AND s.download_until<=? AND f.purged_at IS NULL ORDER BY f.id LIMIT ?`,update:"UPDATE v3_service_final_files SET purged_at=datetime('now'),filename='Arquivo expirado' WHERE id=? AND purged_at IS NULL"}
 ];
 for(const g of groups){
  const rows=(await db.prepare(g.query).bind(stamp,limit).all()).results||[];
  for(const r of rows){
   try{
    // All these media are immutable once delivered. Remove from storage
    // first; on failure keep metadata so the next run can retry.
    await env.FILES.delete(r.r2_key);
    await db.prepare(g.update).bind(r.id).run();result[g.kind]++;
   }catch{result.failed++;}
  }
 }
 return result;
}
