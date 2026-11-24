// Approved V3 extra catalogue. Values are authoritative on the server.
// V2 invitation add-ons continue using their existing catalogue and rules.
const extra=(code,name,priceCents,pointsUnits,category,maxQuantity=20)=>Object.freeze({code,name,priceCents,pointsUnits,category,maxQuantity});
export const V3_EXTRAS=Object.freeze({
  identidade_visual:Object.freeze([
    extra('atelie_child','Criança adicional ilustrada',3000,100,'Personagens'),
    extra('atelie_pet','Pet personalizado',2500,100,'Personagens'),
    extra('atelie_pose','Pose extra',2000,50,'Personagens'),
    extra('atelie_logo','Logotipo extra',2000,50,'Identidade'),
    extra('atelie_monogram','Monograma extra',2000,50,'Identidade'),
    extra('atelie_crest','Brasão extra',2000,50,'Identidade'),
    extra('atelie_pattern','Estampa extra',2000,50,'Identidade'),
    extra('atelie_element','Elemento ilustrado extra',2000,50,'Identidade'),
    extra('atelie_stationery','Arte de papelaria extra',2000,50,'Aplicações'),
    extra('atelie_revision','Rodada de revisão pontual extra',2000,50,'Ajustes')
  ]),
  retrospectiva:Object.freeze([
    extra('retro_more_photos','Mais 25 fotos',3500,100,'Materiais'),
    extra('retro_more_videos','Mais 5 vídeos de até 1 minuto cada',3500,100,'Materiais'),
    extra('retro_long_video','Seleção e recorte de até 10 minutos de material bruto',4000,100,'Materiais'),
    extra('retro_photo_order','Organização de até 100 fotos',3500,100,'Materiais'),
    extra('retro_animation','Animação temática exclusiva extra',4500,100,'Edição'),
    extra('retro_narration','Narração personalizada',4000,100,'Edição',1),
    extra('retro_trailer','Trailer vertical para Stories',3500,100,'Edição',1),
    extra('retro_captions','Legendas personalizadas',3000,100,'Edição',1),
    extra('retro_revision','Rodada de revisão extra',3000,100,'Ajustes')
  ])
});
const retroRank=code=>['070','100','150','200','250'].indexOf(String(code).replace(/^retrospectiva_|^RETRO_/,''));
export function listV3Extras(family,productCode){
  if(family==='identidade_visual'&&!/^atelie_(essencia|encanto|universo)$/.test(productCode||''))return [];
  if(family==='retrospectiva'){
    const rank=retroRank(productCode);
    if(rank<0)return [];
    return V3_EXTRAS.retrospectiva.filter(x=>!(rank>=1&&x.code==='retro_captions')&&!(rank>=3&&x.code==='retro_narration')&&!(rank>=4&&x.code==='retro_trailer'));
  }
  return V3_EXTRAS[family]||[];
}
function invalid(message){const e=new Error(message);e.status=422;e.code='cart_extra_invalid';throw e;}
export function normalizeV3ExtraSelection(value){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>20)invalid('Adicionais inválidos.');
  const seen=new Set();
  return value.map(x=>{
    if(!x||typeof x!=='object'||Array.isArray(x)||typeof x.code!=='string'||!/^[a-z0-9_]{3,80}$/.test(x.code)||
      !Number.isSafeInteger(x.quantity)||x.quantity<1||x.quantity>20||seen.has(x.code))invalid('Quantidade ou adicional inválido.');
    seen.add(x.code);
    return {code:x.code,quantity:x.quantity};
  }).sort((a,b)=>a.code.localeCompare(b.code));
}
export function quoteV3Extras(family,productCode,selection){
  const allowed=listV3Extras(family,productCode);
  return normalizeV3ExtraSelection(selection).map(x=>{
    const item=allowed.find(a=>a.code===x.code);
    if(!item||x.quantity>item.maxQuantity)invalid('Adicional incompatível com o serviço ou já incluído no pacote.');
    return {...item,quantity:x.quantity,totalCents:item.priceCents*x.quantity,totalPointsUnits:item.pointsUnits*x.quantity};
  });
}
