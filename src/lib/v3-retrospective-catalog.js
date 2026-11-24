// Retrospectivas V3. Mesma fonte de dados/preços D1 que os adicionais legados.
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
