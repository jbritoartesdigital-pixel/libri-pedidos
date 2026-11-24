import {ATELIE_V41_APPROVED_CATALOG,ATELIE_V41_COMMON_TERMS} from './v3-atelie-v41-commercial-catalog.js';
import {verifyAtelieRelease,atelieActivationStatements} from './v3-atelie-release.js';
const retroSpecs=[['RETRO_070',14900,200,1,70,5,180,0],['RETRO_100',19900,300,1,100,10,300,1],['RETRO_150',26900,500,1,150,10,360,1],['RETRO_200',32900,700,2,200,10,480,1],['RETRO_250',39900,900,2,250,10,600,1]];
const list=s=>JSON.parse(s);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Error('Catálogo aprovado divergente: '+code+'. Nenhuma alteração automática autorizada.');};
const guard=(db,table,row,fields)=>db.prepare('SELECT CASE WHEN EXISTS(SELECT 1 FROM '+table+' WHERE code=? AND '+fields.map(k=>k+' IS ?').join(' AND ')+') THEN 1 ELSE json(\'release_catalog_changed\') END AS valid').bind(row.code,...fields.map(k=>row[k]));
const atelieFields=['price_cents','points_units','revision_limit','scope_approved','showcase_visible','included_json','excluded_json','specific_terms','scope_reference','short_description','updated_at','sale_enabled'];
const retroFields=['price_cents','points_units','revision_limit','scope_approved','max_photos','max_videos','max_video_seconds','max_total_video_seconds','minimum_production_days','captions_included','included_json','specific_terms','updated_at','sale_enabled'];
export async function activateApprovedV3Catalog(db,{apply=false}={}){
 const rowsA=(await db.prepare('SELECT * FROM v3_atelie_packages ORDER BY code').all()).results||[];
 const rowsR=(await db.prepare('SELECT * FROM v3_retrospective_packages ORDER BY code').all()).results||[];
 if(rowsA.length!==3||rowsR.length!==5)fail('quantidade de pacotes');
 const guards=[],writes=[];
 for(const row of rowsA){
  const spec=ATELIE_V41_APPROVED_CATALOG[row.code];
  if(!spec||verifyAtelieRelease(row).length||row.price_cents!==spec.priceCents||row.points_units!==spec.pointsUnits||row.revision_limit!==spec.revisionLimit||!same(list(row.included_json),spec.includedItems)||!same(list(row.excluded_json),spec.excludedItems)||row.specific_terms!==ATELIE_V41_COMMON_TERMS||row.short_description!==spec.shortDescription)fail(row.code);
  guards.push(guard(db,'v3_atelie_packages',row,atelieFields));
  if(!row.sale_enabled)writes.push(...atelieActivationStatements(db,row));
  else{
   const variant=await db.prepare("SELECT p.active AS product_active,v.active,v.price_cents,v.points_units,v.config_json FROM v2_products p JOIN v2_product_variants v ON v.product_id=p.id WHERE p.code=? AND v.code=?").bind('atelie_'+row.code,'atelie_'+row.code+'_default').first();
   const scope=variant?JSON.parse(variant.config_json||'{}').atelie:null;
   if(!variant||variant.active!==1||variant.product_active!==1||variant.price_cents!==spec.priceCents||variant.points_units!==spec.pointsUnits||scope?.termsVersion!==row.updated_at||scope.revisionLimit!==spec.revisionLimit||scope.includedMascotPoses!==spec.mascotPoses||scope.specificTerms!==row.specific_terms||!same(scope.includedItems,spec.includedItems))fail(row.code+' ativo');
  }
 }
 for(const [code,price,points,revisions,photos,videos,duration,captions] of retroSpecs){
  const row=rowsR.find(x=>x.code===code);
  if(!row||row.scope_approved!==1||row.price_cents!==price||row.points_units!==points||row.revision_limit!==revisions||row.max_photos!==photos||row.max_videos!==videos||row.max_video_seconds!==60||row.max_total_video_seconds!==duration||row.minimum_production_days!==15||row.captions_included!==captions||!list(row.included_json).length||!row.specific_terms.includes('WhatsApp')||!row.specific_terms.includes('15 dias'))fail(code);
  guards.push(guard(db,'v3_retrospective_packages',row,retroFields));
  if(!row.sale_enabled)writes.push(db.prepare('UPDATE v3_retrospective_packages SET sale_enabled=1 WHERE code=? AND sale_enabled=0').bind(code));
 }
 if(apply&&writes.length){
  await db.batch([...guards,...writes]);
  const check=await activateApprovedV3Catalog(db);
  if(check.pending!==0)throw Error('Ativação não confirmada; não publicar Worker.');
 }
 return {atelie:3,retrospectivas:5,pending:apply?0:rowsA.filter(r=>!r.sale_enabled).length+rowsR.filter(r=>!r.sale_enabled).length,applied:apply};
}
