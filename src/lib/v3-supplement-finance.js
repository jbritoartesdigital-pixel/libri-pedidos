// Reconcile one uniquely referenced supplemental charge, not the parent order.
import {mpFetch} from './v2-mercadopago.js';
const cents=v=>{if(v===null||v===undefined||v===''||!['string','number'].includes(typeof v))return null;const n=Number(v);return Number.isFinite(n)&&n>=0&&Number.isSafeInteger(Math.round(n*100))?Math.round(n*100):null;};
export async function reconcileV3SupplementFinance(env,p,expected){
 if(!p?.provider_order_id||!p.external_reference?.startsWith('SUP-')||!Number.isSafeInteger(expected)||expected<=0)return false;
 const result=await mpFetch(env,'/v1/payments/search?external_reference='+encodeURIComponent(p.external_reference)+'&limit=20');
 const matches=(Array.isArray(result?.results)?result.results:[]).filter(x=>x.external_reference===p.external_reference&&x.status==='approved'&&cents(x.transaction_amount)===expected);
 if(matches.length!==1||!matches[0].id)return false;
 const detail=await mpFetch(env,'/v1/payments/'+encodeURIComponent(String(matches[0].id)));
 const net=cents(detail?.transaction_details?.net_received_amount);
 if(String(detail?.id)!==String(matches[0].id)||detail.status!=='approved'||detail.external_reference!==p.external_reference||cents(detail.transaction_amount)!==expected||net===null||net>expected)return false;
 const paidAt=Date.parse(detail.date_approved||matches[0].date_approved||'');
 if(!Number.isFinite(paidAt))return false;
 await env.DB.prepare("UPDATE v3_supplement_payments SET finance_payment_id=?,finance_net_cents=?,finance_fee_cents=?,finance_paid_at=?,finance_verified_at=datetime('now') WHERE id=? AND provider_order_id=? AND status='approved' AND paid_at IS NOT NULL").bind(String(detail.id),net,expected-net,new Date(paidAt).toISOString(),p.id,p.provider_order_id).run();
 return true;
}
