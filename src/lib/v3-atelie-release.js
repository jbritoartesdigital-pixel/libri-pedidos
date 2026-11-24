// Libri Ateliê: publicação comercial controlada pela mesma Passkey Admin.
// Ativar exige preço, carga, revisões, lista V4.1 e termos específicos preenchidos.
// Não cria outro checkout; registra produtos principais nas tabelas V2 existentes.
import {ATELIE_V41_APPROVED_CATALOG} from './v3-atelie-v41-commercial-catalog.js';
const VALID = new Set(['essencia','encanto','universo']);
const parse = v=>{try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x:[]}catch{return []}};
export const atelieProductCode = code => VALID.has(code)?'atelie_'+code:null;
const variantCode = code => 'atelie_'+code+'_default';
export function verifyAtelieRelease(row) {
  const problems=[];
  if(!row || !VALID.has(row.code))return ['Pacote desconhecido'];
  if(Number(row.scope_approved)!==1)problems.push('Escopo comercial não aprovado');
  if(!/\bV4\.1\b/i.test(row.scope_reference||''))problems.push('Falta validar o catálogo V4.1');
  if(!parse(row.included_json).length)problems.push('Entregáveis exatos não informados');
  if(!parse(row.excluded_json).length)problems.push('Exclusões não informadas');
  if(!Number.isSafeInteger(row.price_cents)||row.price_cents<=0)problems.push('Preço final não aprovado');
  if(!Number.isSafeInteger(row.points_units)||row.points_units<=0)problems.push('Carga de produção não definida');
  if(!Number.isSafeInteger(row.revision_limit)||row.revision_limit<0)problems.push('Limite de revisões não definido');
  if(!String(row.specific_terms||'').trim()||String(row.specific_terms).trim().length<60)
    problems.push('Condições específicas do Ateliê não estão completas');
  if(Number(row.showcase_visible)!==1)problems.push('Pacote oculto na vitrine');
  return problems;
}
export async function setAtelieSaleStatus(db,code,enabled=false) {
  if(!VALID.has(code))throw new Error('Pacote do Ateliê não encontrado.');
  const row=await db.prepare('SELECT * FROM v3_atelie_packages WHERE code=?').bind(code).first();
  if(!row)throw new Error('Pacote do Ateliê não encontrado.');
  const product=atelieProductCode(code),variant=variantCode(code);
  if(!enabled){
    await db.batch([
      db.prepare('UPDATE v3_atelie_packages SET sale_enabled=0,updated_at=datetime(\'now\') WHERE code=?').bind(code),
      db.prepare('UPDATE v2_products SET active=0,updated_at=datetime(\'now\') WHERE code=?').bind(product),
      db.prepare('UPDATE v2_product_variants SET active=0,updated_at=datetime(\'now\') WHERE code=?').bind(variant)
    ]);
    return {code,enabled:false};
  }
  const problems=verifyAtelieRelease(row);
  if(problems.length){
    const error=new Error('Antes de liberar este pacote: '+problems.join('; ')+'.');
    error.details={missing:problems};throw error;
  }
  const snap={
    revisionLimit:row.revision_limit,
    scopeReference:row.scope_reference,
    contractedApplications:[],
    includedMascotPoses:ATELIE_V41_APPROVED_CATALOG[code].mascotPoses,
    includedIllustratedSubjects:1,
    additionalSubjectsNeedQuote:true,
    requiresChildPhoto:true,
    includedItems:parse(row.included_json),
    excludedItems:parse(row.excluded_json),
    specificTerms:row.specific_terms.trim(),
    termsVersion:row.updated_at,
    // Portfólio sempre exige autorização explícita fora do checkout.
    portfolioConsent:false
  };
  const productConfig=JSON.stringify({category:'atelie',packageCode:code});
  const variantConfig=JSON.stringify({atelie:snap});
  // db.batch é transacional no D1. O principal e a variante devem ficar coerentes.
  await db.batch([
    db.prepare(
      "INSERT INTO v2_products(code,slug,name,short_description,pricing_mode,active,sort_order,config_json) "+
      "VALUES(?,?,?,?,'fixed',1,?,?) "+
      "ON CONFLICT(code) DO UPDATE SET name=excluded.name,short_description=excluded.short_description,"+
      "pricing_mode='fixed',active=1,sort_order=excluded.sort_order,config_json=excluded.config_json,updated_at=datetime('now')"
    ).bind(product,'atelie-'+code,'Identidade Visual | '+row.name,row.short_description,200,productConfig),
    db.prepare(
      "INSERT INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,is_default,active,sort_order,config_json) "+
      "VALUES((SELECT id FROM v2_products WHERE code=?),?,?,NULL,?,?,1,1,0,?) "+
      "ON CONFLICT(code) DO UPDATE SET price_cents=excluded.price_cents,points_units=excluded.points_units,"+
      "active=1,config_json=excluded.config_json,updated_at=datetime('now')"
    ).bind(product,variant,'Pacote '+row.name,row.price_cents,row.points_units,variantConfig),
    db.prepare("UPDATE v3_atelie_packages SET sale_enabled=1,activated_at=datetime('now') "+
      "WHERE code=? AND scope_approved=1 AND price_cents=? AND points_units=? AND revision_limit=?")
      .bind(code,row.price_cents,row.points_units,row.revision_limit)
  ]);
  return {code,enabled:true,productCode:product,variantCode:variant};
}
export async function verifyAtelieQuoteSelection(db,selection,productCode) {
  if(!/^atelie_(essencia|encanto|universo)$/.test(productCode||''))return false;
  const packageCode=productCode.slice(7);
  const packageRow=await db.prepare('SELECT * FROM v3_atelie_packages WHERE code=?').bind(packageCode).first();
  if(!packageRow || Number(packageRow.sale_enabled)!==1 || verifyAtelieRelease(packageRow).length)
    throw new Error('Este pacote do Ateliê não está liberado para compra.');
  if(selection.variantCode && selection.variantCode!==variantCode(packageCode))
    throw new Error('Configuração do pacote não encontrada.');
  if(Array.isArray(selection.addonCodes)&&selection.addonCodes.length)
    throw new Error('Os adicionais do Ateliê precisam estar configurados e aprovados. Escolha apenas o pacote.');
  if(selection.comboCode||selection.couponCode)
    throw new Error('Promoções e cupons de convites não se aplicam automaticamente ao Ateliê.');
  return true;
}
