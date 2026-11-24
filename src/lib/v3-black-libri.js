import {blackLibriOperational,findBlackLibriClaim,revealBlackLibri,matchingBlackLibriGift} from './v2-black-libri.js';
import {normalizeWhatsapp} from './http.js';
const fail=(message,code='black_libri_invalid',status=422)=>{throw Object.assign(new Error(message),{code,status});};
const mapped={save_static:'save_static',save_animated:'save_animated',reminder_static:'reminder_static',reminder_animated:'reminder_animated',photo_filter:'custom_filter'};
function key(body){
 if(!/^[a-f0-9]{36}$/.test(body?.clientRequestId||''))fail('Identificador privado da surpresa inválido.');
 const whatsapp=normalizeWhatsapp(body.customer?.whatsapp);
 if(!/^\d{10,15}$/.test(whatsapp))fail('Confira o WhatsApp antes de escolher seu balão.');
 return 'v3:'+body.clientRequestId;
}
export function eligibleBlackV3(body){
 return Array.isArray(body?.items)&&body.items.some(i=>typeof i.productCode==='string'&&!/^(atelie_|retrospectiva)/.test(i.productCode));
}
export async function blackV3Ready(env,body){
 if(env.LIBRI_V3_CHECKOUT_ENABLED!=='true'||env.LIBRI_V3_BLACK_LIBRI_ENABLED!=='true'||!eligibleBlackV3(body)||!await blackLibriOperational(env))return false;
 // Do not silently change existing prize probabilities to work around missing
 // production definitions. Every enabled gift needs a verified workload.
 const gifts=(await env.DB.prepare("SELECT code FROM v2_black_libri_prizes WHERE enabled=1 AND kind='gift'").all()).results||[];
 for(const gift of gifts){
   if(!mapped[gift.code])return false;
   const row=await env.DB.prepare('SELECT points_units FROM v2_addons WHERE code=?').bind(mapped[gift.code]).first();
   if(!Number.isSafeInteger(row?.points_units)||row.points_units<0)return false;
 }
 return true;
}
const view=c=>c?{id:c.id,code:c.prize_code,label:c.label,kind:c.kind,value:c.value,description:c.description,status:c.status,expiresAt:c.expires_at}:null;
export async function getV3BlackClaim(db,body){
 if(!body?.blackLibriClaimId)return null;
 if(!eligibleBlackV3(body))fail('A Black Libri exige um convite no carrinho.');
 const claim=await findBlackLibriClaim({DB:db},body.customer,{privateRequestId:key(body),checkConflict:true});
 if(!claim||claim.id!==body.blackLibriClaimId||claim.status!=='reserved'||claim.order_id)fail('A reserva da surpresa mudou. Confira com a Libri.','black_libri_reservation_changed',409);
 return claim;
}
export async function v3BlackStatus(env,body,{reveal=false}={}){
 const enabled=await blackV3Ready(env,body);
 if(!enabled)return {enabled:false,claim:null};
 const requestId=key(body);
 const existing=await findBlackLibriClaim(env,body.customer,{privateRequestId:requestId,checkConflict:true});
 if(existing||!reveal)return {enabled:true,claim:view(existing)};
 if(!Number.isInteger(body.balloon)||body.balloon<0||body.balloon>=12)fail('Escolha um balão.');
 return revealBlackLibri(env,body.customer,requestId,{privateV3:true});
}
export async function v3BlackCandidate(db,claim,line){
 if(!claim)return null;
 if(!line)fail('A Black Libri exige um convite no carrinho.');
 const snapshot=line.commercialSnapshot;
 let cents=0,gift=null,duplicate=null;
 if(claim.kind==='fixed')cents=Number(claim.value);
 if(claim.kind==='percent')cents=Math.round((line.grossCents-line.extrasCents)*Number(claim.value)/100);
 if(claim.kind==='gift'){
   duplicate=matchingBlackLibriGift(snapshot,claim);
   if(duplicate)cents=duplicate.creditCents;
   else{
     const code=mapped[claim.prize_code];
     if(!code)fail('Este presente precisa de conferência de produção.','black_libri_gift_review',409);
     const row=await db.prepare('SELECT code,name,points_units,config_json FROM v2_addons WHERE code=?').bind(code).first();
     if(!row||!Number.isSafeInteger(row.points_units)||row.points_units<0)fail('Presente sem capacidade configurada.','black_libri_gift_review',409);
     gift={code:row.code,name:row.name,priceCents:0,pointsUnits:row.points_units,config:JSON.parse(row.config_json||'{}')};
   }
 }
 cents=Math.max(0,Math.min(line.grossCents-100,cents));
 return {claimId:claim.id,code:claim.prize_code,label:claim.label,kind:claim.kind,description:claim.description,expiresAt:claim.expires_at,
  convertedToDiscount:!!duplicate,matchingAddonCode:duplicate?.code||null,availableDiscountCents:cents,creditCents:0,gift};
}
