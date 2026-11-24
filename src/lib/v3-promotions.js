import {couponRestrictionsMatch,discountValue} from './v2-commercial-pricing.js';
const fail=(message)=>{const e=new Error(message);e.status=422;e.code='cart_promotion_invalid';throw e;};
export function normalizeV3Coupon(code){
 if(code==null||code==='')return '';
 if(typeof code!=='string'||! /^[a-z0-9_-]{1,80}$/i.test(code.trim()))fail('Cupom inválido.');
 return code.trim().toUpperCase();
}
export async function activeV3CombinedCampaign(db,now=new Date()){
 const row=await db.prepare('SELECT * FROM v3_combined_campaigns WHERE active=1 AND starts_at<=? AND ends_at>? ORDER BY id DESC LIMIT 1').bind(now.toISOString(),now.toISOString()).first();
 return row?{id:row.id,name:row.name,twoPercent:row.two_percent,threePercent:row.three_percent,startsAt:row.starts_at,endsAt:row.ends_at}:null;
}
export async function listV3CombinedCampaigns(db){
 return (await db.prepare('SELECT * FROM v3_combined_campaigns ORDER BY starts_at DESC,id DESC LIMIT 100').all()).results||[];
}
export async function createV3CombinedCampaign(db,input={}){
 const name=typeof input.name==='string'?input.name.trim():'';
 const two=input.twoPercent,three=input.threePercent;
 const start=new Date(input.startsAt),end=new Date(input.endsAt);
 if(!name||name.length>100||!Number.isInteger(two)||!Number.isInteger(three)||two<0||three<two||three>50||
 !Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>=end||end<=new Date()||typeof input.startsAt!=='string'||typeof input.endsAt!=='string')fail('Confira nome, percentuais e vigência da campanha.');
 try{await db.prepare('INSERT INTO v3_combined_campaigns(name,two_percent,three_percent,starts_at,ends_at) VALUES(?,?,?,?,?)').bind(name,two,three,start.toISOString(),end.toISOString()).run();}
 catch(e){if(String(e.message).includes('v3_campaign_overlap'))fail('Já existe campanha ativa com período sobreposto.');throw e;}
 return listV3CombinedCampaigns(db);
}
export async function pauseV3CombinedCampaign(db,id){
 if(!Number.isSafeInteger(id)||id<1)fail('Campanha inválida.');
 await db.prepare('UPDATE v3_combined_campaigns SET active=0 WHERE id=?').bind(id).run();
 return listV3CombinedCampaigns(db);
}
export async function quoteV3Coupon(db,code,lines,eventType,now=new Date()){
 code=normalizeV3Coupon(code);if(!code)return null;
 const c=await db.prepare('SELECT * FROM v2_coupons WHERE code=? COLLATE NOCASE AND active=1').bind(code).first();
 if(!c)fail('Cupom inválido ou inativo.');
 if(c.valid_from&&(!Number.isFinite(Date.parse(c.valid_from))||Date.parse(c.valid_from)>now.getTime()))fail('Este cupom ainda não está válido.');
 if(c.valid_until&&(!Number.isFinite(Date.parse(c.valid_until))||Date.parse(c.valid_until)<now.getTime()))fail('Este cupom expirou.');
 // V2 currently records redemption on payment, not reservation. Do not
 // expose limited stock coupons on V3 until a shared atomic hold is ready.
 if(c.max_uses!==null||c.max_uses_per_customer!==null)fail('Este cupom tem limite de usos e ainda precisa de validação no checkout V3.');
 let restrictions;try{restrictions=JSON.parse(c.restrictions_json||'{}');}catch{fail('Configuração do cupom indisponível.');}
 if(!restrictions||typeof restrictions!=='object'||Array.isArray(restrictions)||Object.keys(restrictions).some(k=>!['productCodes','eventTypes','addonCodes','minScenes','maxScenes'].includes(k)))fail('Configuração do cupom não suportada.');
 if(restrictions.eventTypes?.length&&!eventType)fail('Informe o tipo de evento.');
 const eligible=lines.filter(l=>couponRestrictionsMatch(restrictions,{quote:l.commercialSnapshot,eventType})).map(l=>({family:l.family,base:l.grossCents-l.extrasCents}));
 const total=eligible.reduce((n,l)=>n+l.base,0);
 if(!total||total<Number(c.min_order_cents||0))fail('O carrinho não atende às condições deste cupom.');
 if(!['percent','fixed'].includes(c.discount_type)||!Number.isFinite(Number(c.discount_value))||Number(c.discount_value)<=0)fail('Configuração do cupom inválida.');
 // Preserve at least one cent of total to avoid a zero-value provider charge.
 const amount=Math.min(total,Math.max(0,lines.reduce((n,l)=>n+l.grossCents,0)-1),discountValue(total,c.discount_type,c.discount_value));
 const shares=eligible.map(l=>({...l,cents:Math.floor(amount*l.base/total),remainder:amount*l.base%total}));
 let left=amount-shares.reduce((n,l)=>n+l.cents,0);
 for(const l of shares.sort((a,b)=>b.remainder-a.remainder||a.family.localeCompare(b.family))){if(left){l.cents++;left--;}}
 return {id:c.id,code:c.code,discountCents:amount,allocations:Object.fromEntries(shares.map(l=>[l.family,l.cents]))};
}
