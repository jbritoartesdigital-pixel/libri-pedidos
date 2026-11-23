// Progresso artístico do Ateliê vinculado a um pedido Libri V2 real.
// Não altera status comercial, agenda, pagamentos, contrato nem briefing.
const PRODUCT_CODES = new Set([
  'atelie_essencia','atelie_encanto','atelie_universo'
]);
export const ATELIE_STAGES = Object.freeze([
  {code:'briefing',label:'Briefing criativo'},
  {code:'art_direction',label:'Direção de arte'},
  {code:'creation',label:'Criação das artes'},
  {code:'revision',label:'Revisão e ajustes'},
  {code:'approval',label:'Aprovação da cliente'},
  {code:'delivery',label:'Preparação dos arquivos finais'}
]);
const NEXT = Object.freeze({
  briefing:['art_direction'],
  art_direction:['creation','briefing'],
  creation:['revision','approval','art_direction'],
  revision:['creation','approval'],
  approval:['revision','delivery'],
  delivery:['approval']
});
const text = (value,max=1000)=>typeof value==='string'?value.trim().slice(0,max+1):'';
function parseJson(src) {
  try { return JSON.parse(src||'{}'); } catch { return {}; }
}
async function context(db,code) {
  if(!/^LIBRI-\d{1,12}$/.test(code||'')) return null;
  const row=await db.prepare(
    "SELECT o.id,o.order_code,o.status,p.code AS product_code,i.configuration_json FROM v2_orders o "+
    "JOIN v2_order_items i ON i.order_id=o.id AND i.item_type='product' "+
    "JOIN v2_product_variants pv ON pv.code=i.item_code "+
    "JOIN v2_products p ON p.id=pv.product_id "+
    "WHERE o.order_code=? LIMIT 1"
  ).bind(code).first();
  if(!row || !PRODUCT_CODES.has(row.product_code)) return null;
  const config=parseJson(row.configuration_json);
  const revisions=Number(config?.atelie?.revisionLimit);
  const snapshot=Number.isSafeInteger(revisions)&&revisions>=0
    &&config?.atelie?.revisionLimit!==null
    &&config?.atelie?.revisionLimit!==undefined ? revisions : null;
  const payment=await db.prepare(
    "SELECT COUNT(*) AS count FROM v2_payments WHERE order_id=? AND status='approved'"
  ).bind(row.id).first();
  return {
    id:row.id,code:row.order_code,productCode:row.product_code,status:row.status,
    revisionsIncluded:snapshot,
    canEdit:Number(payment?.count||0)>0
      && !['cancelled','finalized','awaiting_payment','awaiting_urgency_decision'].includes(row.status)
  };
}
async function progressRow(db,id) {
  return db.prepare(
    'SELECT stage,revisions_used,revisions_included,version,updated_at FROM v3_atelie_art_production WHERE order_id=?'
  ).bind(id).first();
}
async function history(db,id) {
  const r=await db.prepare(
    'SELECT action,from_stage,to_stage,note,created_at FROM v3_atelie_art_history WHERE order_id=? ORDER BY id DESC LIMIT 100'
  ).bind(id).all();
  return r.results||[];
}
export async function getAtelieArtProgress(db,code) {
  const order=await context(db,code);
  if(!order)return null;
  const row=await progressRow(db,order.id);
  return {
    orderCode:order.code,productCode:order.productCode,
    stage:row?.stage||'briefing',
    revisionsUsed:Number(row?.revisions_used||0),
    revisionsIncluded:row?.revisions_included??order.revisionsIncluded,
    version:Number(row?.version||0),
    canEdit:order.canEdit,stages:ATELIE_STAGES,
    nextStages:NEXT[row?.stage||'briefing']||[],
    history:await history(db,order.id),
    notice:'Controle artístico interno; não altera a situação, pagamento ou entrega do pedido.'
  };
}
export async function updateAtelieArtProgress(db,code,input={}) {
  const order=await context(db,code);
  if(!order)throw new Error('Pedido de identidade visual não encontrado.');
  if(!order.canEdit)throw new Error('Este pedido ainda não está liberado para produção artística.');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Ação inválida.');
  if(!['stage','revision','extra_quote'].includes(input.action))throw new Error('Ação de produção não permitida.');
  if(!Number.isSafeInteger(input.version)||input.version<0)throw new Error('Atualize a ficha antes de salvar.');
  const note=text(input.note);
  if(note.length>1000)throw new Error('Observação muito longa.');
  if(input.action==='extra_quote'&&note.length<10)throw new Error('Descreva o item extra a ser orçado.');
  if(input.action==='revision'&&note.length<5)throw new Error('Explique o ajuste realizado.');
  const existing=await progressRow(db,order.id);
  const version=Number(existing?.version||0);
  if(input.version!==version)throw new Error('A ficha foi alterada. Atualize antes de salvar novamente.');
  let stage=existing?.stage||'briefing';
  let action='',increment=0;
  if(input.action==='stage'){
    if(!NEXT[stage]?.includes(input.nextStage))throw new Error('Etapa seguinte inválida.');
    action='change_stage';stage=input.nextStage;
  }else if(input.action==='revision'){
    const max=existing?.revisions_included??order.revisionsIncluded;
    if(max===null)throw new Error('Defina as revisões contratadas antes de registrar ajustes.');
    if(Number(existing?.revisions_used||0)>=max)throw new Error('Revisões incluídas esgotadas. Orce o extra antes.');
    if(!['creation','revision','approval'].includes(stage))throw new Error('A revisão só pode ser registrada após a criação.');
    action='revision_used';increment=1;
  }else{
    action='extra_quote_requested';
  }
  if(!existing){
    await db.prepare(
      "INSERT OR IGNORE INTO v3_atelie_art_production(order_id,revisions_included,version) VALUES(?,?,0)"
    ).bind(order.id,order.revisionsIncluded).run();
  }
  const before=existing?.stage||'briefing';
  const statements=[
    db.prepare(
      "UPDATE v3_atelie_art_production SET stage=?,revisions_used=revisions_used+?,version=version+1,updated_at=datetime('now') "+
      "WHERE order_id=? AND version=?"
    ).bind(stage,increment,order.id,version),
    db.prepare(
      "INSERT INTO v3_atelie_art_history(order_id,action,from_stage,to_stage,note) "+
      "SELECT ?,?,?,?,? WHERE changes()=1"
    ).bind(order.id,action,before,stage,note)
  ];
  const result=await db.batch(statements);
  if(Number(result[0]?.meta?.changes||0)!==1)
    throw new Error('Outro ajuste foi registrado. Atualize a ficha antes de continuar.');
  return getAtelieArtProgress(db,code);
}
