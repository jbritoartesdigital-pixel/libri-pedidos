import { buildAtelieBriefingBlueprint } from './v3-atelie-briefing.js';

const TOKEN_RE = /^ord_[a-f0-9]{36}$/;
const ATELIE_CODES = new Set(['atelie_essencia','atelie_encanto','atelie_universo']);
const CLOSED = new Set(['cancelled','finalized']);
const SECTIONS = new Set(['celebracao','theme','style','references','applications','permissions']);

function jsonValue(value) {
  try { const v=JSON.parse(value||'{}'); return v&&typeof v==='object'&&!Array.isArray(v)?v:{}; }
  catch { return {}; }
}
function error(message,status=422) {
  const x=new Error(message);x.status=status;return x;
}
function normalize(field,value) {
  if(typeof value!=='string')throw error('Informe um texto válido para '+field.label+'.');
  if(value.length>2000)throw error(field.label+': limite de 2.000 caracteres.');
  if(field.type==='choice'&&value!==''&&!field.options.includes(value))
    throw error('Escolha uma opção válida em '+field.label+'.');
  if(field.type==='date'&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw error('Informe uma data válida.');
  return value.trim();
}
async function context(db,token) {
  if(!TOKEN_RE.test(String(token||'')))return null;
  // Confirma o produto principal REAL do pedido. O cliente não escolhe esse código.
  const order=await db.prepare(
    "SELECT o.id,o.order_code,o.status,o.event_type,o.event_date,o.honoree_display_name,p.code AS product_code,i.configuration_json "+
    "FROM v2_orders o JOIN v2_order_items i ON i.order_id=o.id AND i.item_type='product' "+
    "JOIN v2_product_variants pv ON pv.code=i.item_code "+
    "JOIN v2_products p ON p.id=pv.product_id WHERE o.public_token=? LIMIT 1"
  ).bind(token).first();
  if(!order||!ATELIE_CODES.has(order.product_code))return null;
  const paid=await db.prepare(
    "SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=? AND status='approved'"
  ).bind(order.id).first();
  const raw=jsonValue(order.configuration_json);
  const contract=raw.atelie&&typeof raw.atelie==='object'?raw.atelie:{};
  const applications=Array.isArray(contract.contractedApplications)
    ?contract.contractedApplications.filter(s=>typeof s==='string').slice(0,30):[];
  return {order,paid:Number(paid?.n||0)>0,applications,
    requiresChildPhoto:contract.requiresChildPhoto===true};
}
function schemaFor(ctx,data) {
  return buildAtelieBriefingBlueprint({
    event:{honoreeName:ctx.order.honoree_display_name,
      type:ctx.order.event_type,date:ctx.order.event_date},
    packageCode:ctx.order.product_code.replace('atelie_',''),
    contractedApplications:ctx.applications,
    requiresChildPhoto:ctx.requiresChildPhoto,data
  });
}
function missingFor(schema,data) {
  return schema.sections.flatMap(section=>section.fields
    .filter(field=>field.required&&field.type!=='upload'&&!String(data[field.key]??field.prefill??'').trim())
    .map(field=>({section:section.id,label:field.label})));
}
function safeSection(value) { return SECTIONS.has(value)?value:'celebracao'; }

async function listUploadRows(db,orderId) {
  const rows=await db.prepare(
    'SELECT id,field_key,original_filename,mime_type,size_bytes,note,created_at FROM v3_atelie_uploads WHERE order_id=? ORDER BY id'
  ).bind(orderId).all();
  return rows.results||[];
}
function publicUploads(rows,base) {
  return rows.map(row=>({
    id:row.id,fieldKey:row.field_key,originalFilename:row.original_filename,
    mimeType:row.mime_type,sizeBytes:row.size_bytes,note:row.note,
    createdAt:row.created_at,
    contentPath:base+'/'+row.id+'/content'
  }));
}
export async function getAtelieUploadAccess(db,token) {
  const ctx=await context(db,token);
  if(!ctx)return null;
  const row=await db.prepare(
    'SELECT data_json FROM v3_atelie_briefings WHERE order_id=?'
  ).bind(ctx.order.id).first();
  const data=jsonValue(row?.data_json);
  return {
    orderId:ctx.order.id,orderCode:ctx.order.order_code,
    paid:ctx.paid,canWrite:ctx.paid&&!CLOSED.has(ctx.order.status),
    allowsChildPhotos:ctx.requiresChildPhoto&&data.childPhotoPermission==='sim'
  };
}

export async function getAtelieCustomerBriefing(db,token) {
  const ctx=await context(db,token);
  if(!ctx)return null;
  if(!ctx.paid)return {kind:'atelie',orderCode:ctx.order.order_code,
    locked:true,reason:'O briefing criativo será liberado após a confirmação do pagamento.'};
  const row=await db.prepare(
    'SELECT data_json,current_section,revision,updated_at FROM v3_atelie_briefings WHERE order_id=?'
  ).bind(ctx.order.id).first();
  const data=jsonValue(row?.data_json);
  const schema=schemaFor(ctx,data);
  const missing=missingFor(schema,data);
  const uploads=publicUploads(await listUploadRows(db,ctx.order.id),
    '/api/v2/customer-area/'+token+'/atelie/briefing/uploads');
  const required=schema.sections.flatMap(s=>s.fields)
    .filter(x=>x.required&&x.type!=='upload').length;
  return {kind:'atelie',orderCode:ctx.order.order_code,locked:false,
    editable:!CLOSED.has(ctx.order.status),
    schema,data,revision:Number(row?.revision||0),
    currentSection:safeSection(row?.current_section),updatedAt:row?.updated_at||null,
    missing,progress:required?Math.round(100*(required-missing.length)/required):100,
    uploadsEnabled:!CLOSED.has(ctx.order.status),canSubmit:false,
    uploads,uploadLimits:{referenceFiles:6,childPhotos:ctx.requiresChildPhoto&&data.childPhotoPermission==='sim'?4:0},
    notice:'Suas respostas ficam no pedido. Fotos e dados não são publicados no portfólio automaticamente.'};
}
export async function saveAtelieCustomerBriefing(db,token,payload={}) {
  const ctx=await context(db,token);
  if(!ctx)return null;
  if(!ctx.paid||CLOSED.has(ctx.order.status))
    throw error('O briefing não está liberado para alterações neste pedido.',403);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    throw error('Dados inválidos.');
  if(!Number.isSafeInteger(payload.revision)||payload.revision<0)
    throw error('Atualize a página antes de salvar.');
  const patch=payload.data;
  if(!patch||typeof patch!=='object'||Array.isArray(patch))
    throw error('Informe as respostas para salvar.');
  if(Object.keys(patch).length>35)
    throw error('Muitas respostas em uma atualização.');
  const row=await db.prepare(
    'SELECT data_json,current_section,revision FROM v3_atelie_briefings WHERE order_id=?'
  ).bind(ctx.order.id).first();
  const prior=Number(row?.revision||0);
  if(payload.revision!==prior)
    throw error('As respostas foram atualizadas em outro lugar. Reabra o briefing antes de salvar.',409);
  const data=jsonValue(row?.data_json);
  const schema=schemaFor(ctx,data);
  const fields=new Map(schema.sections.flatMap(s=>s.fields).map(f=>[f.key,f]));
  for(const [key,value] of Object.entries(patch)) {
    const field=fields.get(key);
    if(!field||field.type==='upload')throw error('Pergunta indisponível: '+key+'.');
    data[key]=normalize(field,value);
  }
  if(data.styleFreedom!=='quero escolher')delete data.styleDetails;
  if(data.childPhotoPermission!=='sim')delete data.childPhotos;
  if(ctx.requiresChildPhoto && data.childPhotoPermission!=='sim' &&
    ('childPhotoPermission' in patch)) {
    const count=await db.prepare(
      "SELECT COUNT(*) AS n FROM v3_atelie_uploads WHERE order_id=? AND field_key='childPhotos'"
    ).bind(ctx.order.id).first();
    if(Number(count?.n||0)>0)
      throw error('Para retirar a autorização de uso das fotos, exclua primeiro as fotos da criança deste pedido.');
  }
  const section=payload.currentSection||safeSection(row?.current_section);
  if(!SECTIONS.has(section))throw error('Etapa do briefing inválida.');
  const encoded=JSON.stringify(data);
  if(encoded.length>30000)throw error('Briefing muito longo.');
  await db.prepare(
    "INSERT OR IGNORE INTO v3_atelie_briefings(order_id,data_json,current_section,revision) VALUES(?,'{}','celebracao',0)"
  ).bind(ctx.order.id).run();
  const result=await db.prepare(
    "UPDATE v3_atelie_briefings SET data_json=?,current_section=?,revision=revision+1,updated_at=datetime('now') WHERE order_id=? AND revision=?"
  ).bind(encoded,section,ctx.order.id,prior).run();
  if(Number(result?.meta?.changes||0)!==1)
    throw error('Outra atualização foi salva. Atualize antes de tentar novamente.',409);
  return getAtelieCustomerBriefing(db,token);
}


// Consulta interna por número do pedido. NUNCA devolve token privado ao Admin.
export async function getAtelieAdminBriefing(db,orderCode) {
  if(!/^LIBRI-\d{1,12}$/.test(orderCode||''))return null;
  const order=await db.prepare(
    "SELECT o.id,o.order_code,o.status,o.event_type,o.event_date,o.honoree_display_name,p.code AS product_code,i.configuration_json "+
    "FROM v2_orders o JOIN v2_order_items i ON i.order_id=o.id AND i.item_type='product' "+
    "JOIN v2_product_variants pv ON pv.code=i.item_code "+
    "JOIN v2_products p ON p.id=pv.product_id WHERE o.order_code=? LIMIT 1"
  ).bind(orderCode).first();
  if(!order||!ATELIE_CODES.has(order.product_code))return null;
  const item=jsonValue(order.configuration_json);
  const contract=item.atelie&&typeof item.atelie==='object'?item.atelie:{};
  const ctx={
    order,applications:Array.isArray(contract.contractedApplications)
      ?contract.contractedApplications.filter(x=>typeof x==='string').slice(0,30):[],
    requiresChildPhoto:contract.requiresChildPhoto===true
  };
  const row=await db.prepare(
    'SELECT data_json,current_section,revision,updated_at FROM v3_atelie_briefings WHERE order_id=?'
  ).bind(order.id).first();
  const data=jsonValue(row?.data_json);
  const schema=schemaFor(ctx,data);
  const missing=missingFor(schema,data);
  const uploads=publicUploads(await listUploadRows(db,order.id),
    '/api/admin/v2/atelie/orders/'+orderCode+'/briefing/uploads');
  return {
    orderCode:order.order_code,
    schema,data,revision:Number(row?.revision||0),
    updatedAt:row?.updated_at||null,
    missing,uploads,
    uploadsEnabled:true,
    note:'Arquivos privados do R2, disponíveis somente na Área da Cliente ou no Admin autenticado. Portfólio exige autorização separada.'
  };
}
