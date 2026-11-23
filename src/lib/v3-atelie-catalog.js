// Catálogo de rascunho do Libri Ateliê, dentro do banco do Libri Pedidos.
// NÃO cria produtos à venda; integração ao checkout depende de escopo V4.1,
// carga de produção, termos, catálogo e liberação comercial aprovados.
const CODES = new Set(['essencia', 'encanto', 'universo']);
const SHARED_INCLUDED = [
  'Apresentação visual da identidade',
  'Uma simulação conceitual de decoração, sem execução física'
];
const SHARED_EXCLUDED = [
  'Impressão ou fabricação de personalizados',
  'Montagem ou projeto executivo de decoração',
  'Arquivo Silhouette e arquivos editáveis não contratados',
  'Convite cinematográfico ou interativo',
  'Personagens complexos a partir de fotos e peças especiais sem orçamento'
];
function parseArray(json) {
  let value;
  try { value=JSON.parse(json); } catch { value=[]; }
  return Array.isArray(value) ? value.filter(x=>typeof x==='string') : [];
}
function normalList(value, label) {
  if (!Array.isArray(value) || value.length>50) throw new Error(label+': informe até 50 itens.');
  return value.map(x=>{
    if (typeof x!=='string' || x.length>250) throw new Error(label+': cada item pode ter até 250 caracteres.');
    return x.trim();
  }).filter(Boolean);
}
function nullableInt(value, label, min) {
  if (value===null || value===undefined || value==='') return null;
  if (!Number.isSafeInteger(value) || value<min) throw new Error(label+' inválido.');
  return value;
}
function mapRow(row, admin=false) {
  const base = {
    code:row.code, name:row.name, shortDescription:row.short_description,
    includedCommon:SHARED_INCLUDED, excludedCommon:SHARED_EXCLUDED,
    // A vitrine nunca publica detalhes de pacotes em estudo como se fossem definitivos.
    includedItems:Number(row.scope_approved)===1 ? parseArray(row.included_json) : [],
    excludedItems:Number(row.scope_approved)===1 ? parseArray(row.excluded_json) : [],
    scopeApproved:Number(row.scope_approved)===1,
    purchaseAvailable:false
  };
  if (!admin) return base;
  return {
    ...base, includedDraft:parseArray(row.included_json),
    excludedDraft:parseArray(row.excluded_json),
    scopeReference:row.scope_reference,
    priceCents:row.price_cents===null?null:Number(row.price_cents),
    pointsUnits:row.points_units===null?null:Number(row.points_units),
    revisionLimit:row.revision_limit===null?null:Number(row.revision_limit),
    commercialNotes:row.commercial_notes,
    showcaseVisible:Number(row.showcase_visible)===1
  };
}
export async function listAteliePackages(db, {admin=false}={}) {
  const result=await db.prepare(
    "SELECT code,name,short_description,included_json,excluded_json,scope_reference,scope_approved,price_cents,points_units,revision_limit,commercial_notes,showcase_visible FROM v3_atelie_packages ORDER BY CASE code WHEN 'essencia' THEN 1 WHEN 'encanto' THEN 2 ELSE 3 END"
  ).all();
  return (result.results||[])
    .filter(row=>admin || Number(row.showcase_visible)===1)
    .map(row=>mapRow(row,admin));
}
export async function updateAtelieDraft(db,code,patch={}) {
  if (!CODES.has(code)) throw new Error('Pacote do Ateliê não encontrado.');
  if (!patch || typeof patch!=='object' || Array.isArray(patch)) throw new Error('Dados do pacote inválidos.');
  const allowed = new Set(['shortDescription','includedItems','excludedItems','scopeReference',
    'scopeApproved','priceCents','pointsUnits','revisionLimit','commercialNotes','showcaseVisible']);
  if (Object.keys(patch).some(key=>!allowed.has(key))) throw new Error('Configuração não permitida.');
  const rows=await db.prepare(
    'SELECT * FROM v3_atelie_packages WHERE code = ? LIMIT 1'
  ).bind(code).first();
  if (!rows) throw new Error('Pacote do Ateliê não encontrado.');
  const shortDescription=('shortDescription' in patch ? String(patch.shortDescription||'') : rows.short_description).trim();
  const included='includedItems' in patch?normalList(patch.includedItems,'Entregáveis'):parseArray(rows.included_json);
  const excluded='excludedItems' in patch?normalList(patch.excludedItems,'Exclusões'):parseArray(rows.excluded_json);
  const scopeReference=('scopeReference' in patch?String(patch.scopeReference||''):rows.scope_reference).trim();
  const scopeApproved='scopeApproved' in patch?patch.scopeApproved:!!rows.scope_approved;
  const price='priceCents' in patch?nullableInt(patch.priceCents,'Preço em centavos',1):rows.price_cents;
  const points='pointsUnits' in patch?nullableInt(patch.pointsUnits,'Capacidade em pontos',1):rows.points_units;
  const revisions='revisionLimit' in patch?nullableInt(patch.revisionLimit,'Rodadas de revisão',0):rows.revision_limit;
  const notes=('commercialNotes' in patch?String(patch.commercialNotes||''):rows.commercial_notes).trim();
  const visible='showcaseVisible' in patch?patch.showcaseVisible:!!rows.showcase_visible;
  if (shortDescription.length<5 || shortDescription.length>400) throw new Error('Descrição precisa ter entre 5 e 400 caracteres.');
  if (scopeReference.length>120 || notes.length>3000) throw new Error('Texto de configuração muito longo.');
  if (typeof scopeApproved!=='boolean'||typeof visible!=='boolean') throw new Error('Ativação inválida.');
  if (scopeApproved && (!scopeReference || !included.length || revisions===null)) {
    throw new Error('Para validar o escopo, confirme a versão oficial, a lista exata de entregáveis e as revisões.');
  }
  if (scopeApproved && !excluded.length) throw new Error('Informe as exclusões do pacote antes de validar o escopo.');
  const values=[shortDescription,JSON.stringify(included),JSON.stringify(excluded),
    scopeReference,scopeApproved?1:0,price,points,revisions,notes,visible?1:0,code];
  await db.prepare(
    'UPDATE v3_atelie_packages SET short_description=?,included_json=?,excluded_json=?,scope_reference=?,scope_approved=?,price_cents=?,points_units=?,revision_limit=?,commercial_notes=?,showcase_visible=?,updated_at=datetime(\'now\') WHERE code=?'
  ).bind(...values).run();
  const current=await db.prepare('SELECT * FROM v3_atelie_packages WHERE code=?').bind(code).first();
  return mapRow(current,true);
}
export const ATELIE_PUBLIC_SCOPE = Object.freeze({
  // Material interno para Instagram não é um entregável contratável.
  caseInternalOnly:true, childPhotosPublicByDefault:false,
  physicalGoodsIncluded:false, paymentPolicy:'existing'
});
