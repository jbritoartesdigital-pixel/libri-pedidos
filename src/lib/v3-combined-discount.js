// V3 multi-family discount: one commercial benefit, never stacked with the
// selected invitation combo. Discount rounding is deterministic in cents.
export function calculateV3CombinedDiscount(lines,{twoPercent=5,threePercent=10}={}){
  const count=new Set(lines.map(x=>x.family)).size;
  const percent=count===3?threePercent:count===2?twoPercent:0;
  const sorted=[...lines].sort((a,b)=>a.family.localeCompare(b.family));
  const total=Math.round(sorted.reduce((n,x)=>n+x.productCents,0)*percent/100);
  const allocations=sorted.map(x=>({family:x.family,cents:Math.floor(x.productCents*percent/100),remainder:(x.productCents*percent)%100}));
  let remaining=total-allocations.reduce((n,x)=>n+x.cents,0);
  for(const x of [...allocations].sort((a,b)=>b.remainder-a.remainder||a.family.localeCompare(b.family))){
    if(remaining<=0)break;
    x.cents++;remaining--;
  }
  const comboDiscountCents=lines.reduce((n,x)=>n+x.discountCents,0);
  const useCombined=percent>0&&total>0&&total>=comboDiscountCents;
  return {percent:useCombined?percent:0,availablePercent:percent,combinedDiscountCents:useCombined?total:0,
    selectedDiscount:useCombined?'combined':comboDiscountCents?'invitation_combo':'none',
    allocations:useCombined?Object.fromEntries(allocations.map(x=>[x.family,x.cents])):{}};
}
