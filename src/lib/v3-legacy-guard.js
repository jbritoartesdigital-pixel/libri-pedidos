import {fail} from './http.js';
const msg='Este pedido utiliza o fluxo modular V3. Use a ficha V3 para esta operação.';
async function exists(db,sql,value){return !!await db.prepare(sql).bind(value).first();}
const byCode=(db,code)=>exists(db,'SELECT 1 FROM v3_order_checkout_snapshots s JOIN v2_orders o ON o.id=s.order_id WHERE o.order_code=?',String(code||'').trim().toUpperCase());
const byToken=(db,token)=>exists(db,'SELECT 1 FROM v3_order_checkout_snapshots s JOIN v2_orders o ON o.id=s.order_id WHERE o.public_token=?',token);
const byPayment=(db,id)=>exists(db,'SELECT 1 FROM v3_order_checkout_snapshots s JOIN v2_payments p ON p.order_id=s.order_id WHERE p.id=?',id);
const byContract=(db,id)=>exists(db,'SELECT 1 FROM v3_order_checkout_snapshots s JOIN v2_contracts c ON c.order_id=s.order_id WHERE c.id=?',id);
const byPreview=(db,id)=>exists(db,'SELECT 1 FROM v3_order_checkout_snapshots s JOIN v2_previews p ON p.order_id=s.order_id WHERE p.id=?',id);
export async function guardV3LegacyAdmin(request,db,url){
 const method=request.method,path=url.pathname,read=['GET','HEAD'].includes(method);
 // V3 endpoints are dispatched first. Existing read-only order summaries
 // remain available to finance/search; incompatible legacy actions fail closed.
 const order=path.match(/^\/api\/admin\/v2\/(?:atelie\/)?orders\/(LIBRI-\d+)(?:\/(.*))?$/);
 if(order){
   const suffix=order[2]||'';
   if(suffix.startsWith('v3/'))return fail('Rota V3 não encontrada.',404);
   if(!read||/^(edit|briefing|production|download-folder|contracts|previews)(\/|$)/.test(suffix)){
     if(!['notes','congratulations-sent','reuse-customer'].includes(suffix)&&await byCode(db,order[1]))return fail(msg,409);
   }
 }
 const purge=path.match(/^\/api\/admin\/v2\/storage\/retention\/(LIBRI-\d+)\/purge$/);
 if(purge&&!read&&await byCode(db,purge[1]))return fail(msg,409);
 const resource=path.match(/^\/api\/admin\/v2\/(finance\/payments|contracts|previews)\/(\d+)(?:\/|$)/);
 if(resource&&!read&&await ({'finance/payments':byPayment,contracts:byContract,previews:byPreview}[resource[1]])(db,Number(resource[2])))return fail(msg,409);
 if(method==='POST'&&['/api/admin/v2/finance/payments','/api/admin/v2/agenda/cascade/anticipate','/api/admin/v2/agenda/cascade/release'].includes(path)){
   let data;try{data=await request.clone().json();}catch{return fail('Dados inválidos.',422);}
   for(const code of [data?.orderCode,data?.sourceOrderCode,data?.targetOrderCode])if(code&&await byCode(db,code))return fail(msg,409);
 }
 return null;
}
export async function guardV3LegacyCustomer(request,db,url){
 const m=url.pathname.match(/^\/api\/v2\/(customer-area|manual-order|urgency)\/(ord_[a-f0-9]{36})(?:\/(.*))?$/);
 if(!m)return null;
 if(m[1]==='customer-area'&&m[3]?.startsWith('v3/'))return fail('Rota V3 não encontrada.',404);
 if(await byToken(db,m[2]))return fail(msg,409);
 return null;
}
