import {quoteV3Cart} from './v3-cart-quote.js';
import {priceWithCardProcessingFee} from './v2-payment-pricing.js';
import {findV2DeliveryOptions,validateV2DeliveryWindow} from './v2-agenda.js';
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
const rank={identidade_visual:['atelie_essencia','atelie_encanto','atelie_universo'],retrospectiva:['retrospectiva_070','retrospectiva_100','retrospectiva_150','retrospectiva_200','retrospectiva_250']};
const counts=[
 {atelie_pose:3,atelie_monogram:1,atelie_pattern:1,atelie_element:2,atelie_stationery:0,atelie_revision:1},
 {atelie_pose:4,atelie_monogram:1,atelie_pattern:2,atelie_element:5,atelie_stationery:2,atelie_revision:1},
 {atelie_pose:5,atelie_monogram:2,atelie_pattern:3,atelie_element:8,atelie_stationery:4,atelie_revision:2}
];
const familyOf=code=>code.startsWith('atelie_')?'identidade_visual':code.startsWith('retrospectiva_')?'retrospectiva':'convite';
const specific=s=>s.variant?.config?.atelie||s.variant?.config?.retrospective;
const sum=(xs,k)=>xs.reduce((n,x)=>n+Number(x[k]||0),0);
export const changeKind=input=>input.kind==='upgrade'?'upgrade':input.kind==='new_service'?'new_service':'extras';
export function canonicalChange(input){
 const kind=changeKind(input);
 if(kind==='extras')return null;
 if(typeof input.productCode!=='string'||typeof input.variantCode!=='string'||! /^[a-z0-9_]{3,80}$/.test(input.productCode)||! /^[a-z0-9_]{3,80}$/.test(input.variantCode))fail('Escolha o pacote e configuração.');
 return {kind,productCode:input.productCode,variantCode:input.variantCode,...(kind==='new_service'&&input.deliveryWindow?{deliveryWindow:{start:input.deliveryWindow.start,end:input.deliveryWindow.end}}:{})};
}
export function isNewService(offer){return JSON.parse(offer.offer_json).kind==='new_service';}
function covered(family,old,next,code){
 const a=rank[family]?.indexOf(old.product.code),b=rank[family]?.indexOf(next.product.code);
 if(family==='identidade_visual')return Math.max(0,(counts[b]?.[code]||0)-(counts[a]?.[code]||0));
 const x=old.variant.config.retrospective,y=next.variant.config.retrospective;
 const number={retro_more_photos:Math.floor((y.maxPhotos-x.maxPhotos)/25),retro_more_videos:Math.min(Math.floor((y.maxVideos-x.maxVideos)/5),Math.floor((y.maxTotalVideoSeconds-x.maxTotalVideoSeconds)/300)),retro_captions:Number(y.captionsIncluded)-Number(x.captionsIncluded),retro_animation:Math.max(0,b-1)-Math.max(0,a-1),retro_narration:Number(b>=3)-Number(a>=3),retro_trailer:Number(b>=4)-Number(a>=4),retro_revision:y.revisionLimit-x.revisionLimit};
 return Math.max(0,number[code]||0);
}
export function retainedUpgradeExtras(family,old,next){
 const retained=[],absorbed=[];
 for(const x of old.v3Extras||[]){
   const n=Math.min(x.quantity,covered(family,old,next,x.code)),remain=x.quantity-n;
   if(n)absorbed.push({...x,quantity:n,totalCents:x.priceCents*n,totalPointsUnits:x.pointsUnits*n});
   if(remain)retained.push({...x,quantity:remain,totalCents:x.priceCents*remain,totalPointsUnits:x.pointsUnits*remain});
 }
 return {retained,absorbed};
}
export async function changeCatalog(db,ctx,s){
 const present=new Set(ctx.services.map(x=>x.family));
 const rows=(await db.prepare("SELECT p.code AS productCode,p.name,v.code AS variantCode,v.label AS variantName,v.price_cents AS priceCents FROM v2_products p JOIN v2_product_variants v ON v.product_id=p.id WHERE p.active=1 AND v.active=1 ORDER BY p.sort_order,v.sort_order,p.code,v.code").all()).results||[];
 const retros=(await db.prepare("SELECT code,name,price_cents FROM v3_retrospective_packages WHERE scope_approved=1 AND sale_enabled=1 AND revision_limit IS NOT NULL AND specific_terms!='' ORDER BY max_photos").all()).results||[];
 for(const r of retros){const productCode='retrospectiva_'+r.code.slice(6);rows.push({productCode,variantCode:productCode+'_default',name:r.name,variantName:r.name,priceCents:r.price_cents});}
 return rows.flatMap(r=>{
  const family=familyOf(r.productCode),codes=rank[family];
  if(!present.has(family))return [{...r,family,kind:'new_service'}];
  if(family===s.family&&codes&&s.production_status==='ready'&&codes.indexOf(r.productCode)>codes.indexOf(s.snapshot.product.code))return [{...r,family,kind:'upgrade'}];
  return [];
 });
}
export async function quoteV3Change(db,ctx,s,input){
 const change=canonicalChange(input),{kind,productCode,variantCode}=change;
 if(!['pix','card'].includes(input.paymentMethod))fail('Escolha Pix ou cartão.');
 const target=familyOf(productCode),old=s.snapshot;
 if(kind==='upgrade'){
  const codes=rank[s.family];
  if(s.production_status!=='ready'||!codes||codes.indexOf(old.product.code)<0||codes.indexOf(productCode)<=codes.indexOf(old.product.code)||target!==s.family)fail('Upgrade disponível apenas antes de iniciar a produção, para um pacote superior da mesma linha.',409);
 }else{
  if(ctx.services.some(x=>x.family===target))fail('Esta linha já foi contratada.',409);
  if(target==='retrospectiva'&&ctx.services.some(x=>(x.snapshot.addons||[]).some(a=>/^retro_(070|100|150|200|250)$/.test(a.code))))fail('Já existe uma retrospectiva contratada como adicional.',409);
 }
 const q=await quoteV3Cart(db,{items:[{productCode,variantCode,addonCodes:[]}],eventType:ctx.order.event_type,paymentMethod:'pix'},{includeSnapshots:true,requireSale:true});
 const line=q.items[0],snapshot=line.commercialSnapshot;
 if(line.family!==target)fail('Serviço inválido.');
 const general=await db.prepare('SELECT version,body FROM v2_terms_versions WHERE active=1 ORDER BY published_at DESC LIMIT 1').first();
 const spec=specific(snapshot);
 if(!general||!general.body||(target!=='convite'&&(!spec?.specificTerms||!spec.termsVersion)))fail('Condições de contratação indisponíveis.',409);
 const terms={generalVersion:general.version,generalBody:general.body,specificVersion:spec?.termsVersion||null,specificBody:spec?.specificTerms||null};
 let subtotalCents=line.totalCents,pointsUnits=line.pointsUnits,deliveryWindow=null,absorbed=[];
 if(kind==='upgrade'){
  const result=retainedUpgradeExtras(target,old,snapshot);absorbed=result.absorbed;
  snapshot.v3Extras=result.retained;
  const oldGross=old.productCents+sum(old.v3Extras||[],'totalCents'),newGross=snapshot.productCents+sum(result.retained,'totalCents');
  subtotalCents=newGross-oldGross;
  pointsUnits=Math.max(0,line.pointsUnits+sum(result.retained,'totalPointsUnits')-s.points_units);
  snapshot.extrasCents=sum(result.retained,'totalCents');snapshot.extrasPointsUnits=sum(result.retained,'totalPointsUnits');
  snapshot.pointsUnits=s.points_units+pointsUnits;
  snapshot.totalCents=old.totalCents+subtotalCents;
  snapshot.baseTotalCents=old.baseTotalCents+subtotalCents;
  snapshot.payment={...old.payment,depositCents:snapshot.totalCents,balanceCents:0};
  if(!Number.isSafeInteger(subtotalCents)||subtotalCents<=0)fail('A diferença não é positiva. Confira os créditos e o escopo em uma revisão administrativa.',409);
 }else{
  const args={eventDate:ctx.order.event_date,pointsUnits,productionDays:line.productionDays};
  const options=(await findV2DeliveryOptions(db,{...args,limit:8})).options||[];
  if(!options.length)fail('Não há capacidade para esse novo serviço antes do evento.',409);
  if(!input.deliveryWindow)return {kind,targetFamily:target,productCode,variantCode,options:options.map(x=>({start:x.start,end:x.end})),requiresWindow:true,subtotalCents,pointsUnits,paymentMethod:input.paymentMethod,...priceWithCardProcessingFee(subtotalCents,input.paymentMethod)};
  deliveryWindow=change.deliveryWindow;
  await validateV2DeliveryWindow(db,{...args,...deliveryWindow});
  if(!options.some(x=>x.start===deliveryWindow.start&&x.end===deliveryWindow.end))fail('A previsão escolhida mudou. Consulte novamente.',409);
 }
 const pricing=priceWithCardProcessingFee(subtotalCents,input.paymentMethod);
 return {kind,targetFamily:target,productCode,variantCode,productionDays:line.productionDays,deliveryWindow,terms,targetSnapshot:snapshot,
  absorbed,items:[{code:productCode,name:(kind==='upgrade'?'Upgrade para ':'Novo serviço: ')+line.productName+' · '+line.variantName,quantity:1,totalCents:subtotalCents,totalPointsUnits:pointsUnits}],
  subtotalCents,pointsUnits,paymentMethod:input.paymentMethod,totalCents:pricing.totalCents,cardFeeCents:pricing.cardFeeCents};
}
