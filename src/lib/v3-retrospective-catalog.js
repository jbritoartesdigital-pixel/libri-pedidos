// Retrospectivas V3: approved standalone catalogue, isolated from legacy addons.
// Sem venda até que briefing específico, aceite e checkout multi-produto existam.
export async function listV3RetrospectivePackages(db,{admin=false}={}) {
  const rs=await db.prepare(
    'SELECT code,name,max_photos,max_videos,captions_included,price_cents,points_units,'+
    'included_json,revision_limit,minimum_production_days,scope_approved,sale_enabled,max_video_seconds,max_total_video_seconds,specific_terms,updated_at '+
    'FROM v3_retrospective_packages ORDER BY max_photos'
  ).all();
  return (rs.results||[]).map(row=>({
    code:row.code,
    name:row.name,
    maxPhotos:Number(row.max_photos),
    maxVideos:Number(row.max_videos),
    maxVideoSeconds:Number(row.max_video_seconds),
    maxTotalVideoSeconds:Number(row.max_total_video_seconds),
    materialsChannel:'whatsapp',
    captionsIncluded:Number(row.captions_included)===1,
    included:Array.isArray(JSON.parse(row.included_json||'[]'))?JSON.parse(row.included_json||'[]'):[],
    minimumProductionDays:Math.max(15,Number(row.minimum_production_days||15)),
    previewAvailable:Number(row.scope_approved)===1&&row.revision_limit!==null&&!!row.specific_terms,
    ...(Number(row.scope_approved)===1&&row.revision_limit!==null&&row.specific_terms?{previewPriceCents:Number(row.price_cents),productCode:'retrospectiva_'+row.code.slice(6),variantCode:'retrospectiva_'+row.code.slice(6)+'_default'}:{}),
    purchaseAvailable:Number(row.scope_approved)===1 && Number(row.sale_enabled)===1 &&
      row.revision_limit!==null,
    ...(admin?{
      priceCents:Number(row.price_cents),pointsUnits:Number(row.points_units),
      specificTerms:row.specific_terms,termsVersion:row.updated_at,
      revisionLimit:row.revision_limit===null?null:Number(row.revision_limit),
      scopeApproved:Number(row.scope_approved)===1,saleEnabled:Number(row.sale_enabled)===1
    }:{})
  }));
}

export async function quoteV3Retrospective(db,item,{requireSale=false}={}){
  const match=String(item.productCode||'').match(/^retrospectiva_(070|100|150|200|250)$/);
  if(!match||item.variantCode!==item.productCode+'_default'||item.addonCodes?.length||item.comboCode)
    throw new Error('Pacote ou adicionais da retrospectiva inválidos.');
  const row=await db.prepare('SELECT * FROM v3_retrospective_packages WHERE code=?').bind('RETRO_'+match[1]).first();
  if(!row||row.scope_approved!==1||!row.specific_terms||row.revision_limit===null||(requireSale&&row.sale_enabled!==1))
    throw new Error('Este pacote de retrospectiva ainda não está liberado.');
  const product={code:item.productCode,slug:'retrospectiva-'+match[1],name:'Retrospectiva | '+row.name,pricingMode:'fixed',config:{category:'retrospectiva',packageCode:row.code}};
  const retrospective={maxPhotos:row.max_photos,maxVideos:row.max_videos,maxVideoSeconds:row.max_video_seconds,maxTotalVideoSeconds:row.max_total_video_seconds,
    captionsIncluded:row.captions_included===1,revisionLimit:row.revision_limit,includedItems:JSON.parse(row.included_json),specificTerms:row.specific_terms,termsVersion:row.updated_at,materialsChannel:'whatsapp'};
  const variant={code:item.variantCode,label:row.name,sceneCount:null,priceCents:row.price_cents,pointsUnits:row.points_units,config:{retrospective}};
  const cents=variant.priceCents;
  return {product,variant,addons:[],lines:[{type:'product',code:variant.code,name:product.name,amountCents:cents}],productCents:cents,addonsCents:0,
    combo:null,coupon:null,comboDiscountCents:0,couponDiscountCents:0,subtotalCents:cents,baseTotalCents:cents,totalCents:cents,cardFeeCents:0,
    urgency:{approved:false,percent:0,amountCents:0},pointsUnits:variant.pointsUnits,points:variant.pointsUnits/100,
    payment:{method:'pix',depositPercent:100,depositCents:cents,balanceCents:0}};
}
