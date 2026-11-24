// Suggestions compare like-for-like scope. An upgrade must retain any
// extras not covered by the higher package. Nothing changes automatically.
import {ATELIE_V41_APPROVED_CATALOG} from './v3-atelie-v41-commercial-catalog.js';
import {quoteV3Extras} from './v3-extras-catalog.js';
const atelieCounts={
  atelie_essencia:{atelie_pose:3,atelie_monogram:1,atelie_pattern:1,atelie_element:2,atelie_stationery:0,atelie_revision:1},
  atelie_encanto:{atelie_pose:4,atelie_monogram:1,atelie_pattern:2,atelie_element:5,atelie_stationery:2,atelie_revision:1},
  atelie_universo:{atelie_pose:5,atelie_monogram:2,atelie_pattern:3,atelie_element:8,atelie_stationery:4,atelie_revision:2}
};
export function compareV3Upgrade({family,current,candidates,extras}){
  const currentGross=current.priceCents+extras.reduce((n,x)=>n+x.totalCents,0);
  const options=[];
  for(const candidate of candidates){
    if(candidate.priceCents<=current.priceCents)continue;
    const remaining=extras.map(x=>{
      // Only subtract additions actually included in the higher scope.
      // Count blocks of 25 photos/5 videos as complete blocks.
      const covered=Math.max(0,(candidate.counts[x.code]||0)-(current.counts[x.code]||0));
      return {code:x.code,quantity:Math.max(0,x.quantity-covered)};
    }).filter(x=>x.quantity>0);
    let priced;
    try{priced=quoteV3Extras(family,candidate.productCode,remaining);}catch{continue;}
    const newGross=candidate.priceCents+priced.reduce((n,x)=>n+x.totalCents,0);
    if(newGross>=currentGross)continue;
    options.push({productCode:candidate.productCode,variantCode:candidate.variantCode,name:candidate.name,
      extras:remaining,previousGrossCents:currentGross,newGrossCents:newGross,savingsCents:currentGross-newGross});
  }
  return options.sort((a,b)=>b.savingsCents-a.savingsCents||a.productCode.localeCompare(b.productCode))[0]||null;
}
export async function suggestV3Upgrade(db,{family,productCode,variantCode,quote,extras}){
  if(!extras.length||family!=='identidade_visual')return null;
  // Only exact approved, actually purchasable Ateliê scope can be compared.
  // Retro upgrades will use actual package limits after its activation.
  const rows=(await db.prepare(`SELECT a.code,a.name,a.included_json,a.price_cents,a.points_units,p.code AS product_code,v.code AS variant_code,v.price_cents AS variant_price,v.config_json
    FROM v3_atelie_packages a JOIN v2_products p ON p.code='atelie_'||a.code
    JOIN v2_product_variants v ON v.product_id=p.id AND v.code=p.code||'_default'
    WHERE a.sale_enabled=1 AND a.scope_approved=1 AND p.active=1 AND v.active=1`).all()).results||[];
  const packages=rows.filter(r=>{
    const spec=ATELIE_V41_APPROVED_CATALOG[r.code];
    if(!spec||!atelieCounts[r.product_code]||r.variant_price!==r.price_cents)return false;
    try{return JSON.stringify(JSON.parse(r.included_json))===JSON.stringify(spec.includedItems)&&
      JSON.stringify(JSON.parse(r.config_json).atelie.includedItems)===JSON.stringify(spec.includedItems);}catch{return false;}
  }).map(r=>({productCode:r.product_code,variantCode:r.variant_code,name:r.name,priceCents:r.price_cents,counts:atelieCounts[r.product_code]}));
  const current=packages.find(x=>x.productCode===productCode&&x.variantCode===variantCode&&x.priceCents===quote.productCents);
  if(!current)return null;
  return compareV3Upgrade({family,current,candidates:packages,extras});
}
