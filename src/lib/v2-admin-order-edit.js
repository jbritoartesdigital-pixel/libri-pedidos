import { nowIso, parseJson } from './http.js';
import { loadV2Catalog, resolveV2ProductSelection, loadV2AddonsByCodes } from './v2-catalog.js';
import { getV2AgendaRange } from './v2-agenda-admin.js';

function reject(message, status = 422) { const err = new Error(message); err.status = status; throw err; }
function moneyInt(value, label, min = 0, max = 100000000) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) reject(`${label} inválido.`);
  return n;
}
function compact(items) { return items.map(x => ({type:x.item_type, code:x.item_code,
  name:x.name_snapshot, cents:x.unit_price_cents, points:x.points_units,
  config: parseJson(x.configuration_json, {})})); }
const sumPrice = xs => xs.reduce((n,x) => n + Number(x.unit_price_cents||0)*Number(x.quantity||1),0);
const sumPoints = xs => xs.reduce((n,x) => n + Number(x.points_units||0)*Number(x.quantity||1),0);
async function context(db, code) {
  if (!/^LIBRI-\d+$/.test(code)) reject('Código do pedido inválido.');
  const order = await db.prepare(`SELECT o.*,p.total_cents,p.subtotal_cents,p.deposit_cents,
    p.balance_cents,p.payment_method,p.pricing_snapshot_json,p.updated_at AS pricing_updated_at
    FROM v2_orders o JOIN v2_order_pricing p ON p.order_id=o.id
    WHERE o.order_code=? LIMIT 1`).bind(code).first();
  if (!order) reject('Pedido não encontrado.',404);
  if (['finalized','cancelled'].includes(order.status)) reject('Pedido encerrado. Não é possível editar esta contratação.',409);
  const [items, payments] = await Promise.all([
    db.prepare('SELECT * FROM v2_order_items WHERE order_id=? ORDER BY id').bind(order.id).all(),
    db.prepare('SELECT provider,status,payment_type,amount_cents FROM v2_payments WHERE order_id=?').bind(order.id).all(),
  ]);
  const pay = payments.results||[];
  const paid = Math.max(0,pay.reduce((n,p)=>p.status==='approved'
    ? n+(p.payment_type==='refund'?-Number(p.amount_cents):Number(p.amount_cents)):n,0));
  const pendingMp = pay.some(p=>p.provider==='mercado_pago'&&p.status==='pending');
  return {order,items:items.results||[],paid,pendingMp};
}
export async function getV2OrderEditOptions(db,code) {
  const [{order,items,paid,pendingMp},catalog] = await Promise.all([context(db,code),loadV2Catalog(db)]);
  const snapshot = parseJson(order.pricing_snapshot_json,{});
  return {catalog:{products:catalog.products,addons:catalog.addons},
    current:{items:compact(items),totalCents:order.total_cents,paidCents:paid,
      paymentMethod:order.payment_method,revision:order.pricing_updated_at,
      manualDiscountCents:Number(snapshot.adminEdit?.manualDiscountCents||0),
      priceAdjustmentCents:Number(snapshot.adminEdit?.priceAdjustmentCents||0),
      pendingMercadoPago:pendingMp},
  };
}
async function prepare(db,code,input) {
  const {order,items,paid,pendingMp}=await context(db,code);
  if(pendingMp) reject('Há cobrança pendente no Mercado Pago. Resolva essa cobrança antes de editar o total.',409);
  const oldProduct=items.find(x=>x.item_type==='product');
  if(!oldProduct) reject('Pedido sem produto registrado. Confira a importação da V1.',409);
  const addonRows=items.filter(x=>x.item_type==='addon');
  const oldConfig=parseJson(oldProduct.configuration_json,{});
  const activeCatalog=await loadV2Catalog(db);
  // Some historic orders have an item price/code from an earlier version but
  // their saved scene count and contracted total reflect a newer agreement.
  // Use the current product/scene as the baseline, never a stray old unit price.
  const catalogProduct=activeCatalog.products.find(p=>p.code===oldConfig.productCode)
    || activeCatalog.products.find(p=>p.variants.some(v=>v.code===oldProduct.item_code));
  const originalScene=Number(oldConfig.sceneCount||0);
  const originalVariant=catalogProduct?.variants.find(v=>originalScene>0&&Number(v.sceneCount)===originalScene)
    || catalogProduct?.variants.find(v=>v.code===oldConfig.variantCode)
    || catalogProduct?.variants.find(v=>v.code===oldProduct.item_code);
  const requestedProduct=String(input.productCode||'').trim();
  const requestedVariant=String(input.variantCode||'').trim();
  if(requestedProduct && !requestedVariant)
    reject('Escolha uma versão do produto ou mantenha o convite atual.');
  const productChange=Boolean(requestedProduct&&
    (requestedProduct!==String(catalogProduct?.code||oldConfig.productCode||'')
      || requestedVariant!==String(originalVariant?.code||oldConfig.variantCode||oldProduct.item_code)));
  const selectedAddonCodes=Array.isArray(input.addonCodes)
    ? [...new Set(input.addonCodes.map(x=>String(x||'').trim()).filter(Boolean))] : [];
  if(selectedAddonCodes.length>40) reject('Selecione até 40 adicionais.');
  const activeCodes=new Set(activeCatalog.addons.map(x=>x.code));
  const invalid=selectedAddonCodes.find(code=>!activeCodes.has(code));
  if(invalid) reject('Adicional inválido ou desativado: '+invalid);
  const selectedAddons=await loadV2AddonsByCodes(db,selectedAddonCodes);
  const allItems=[];
  let product=oldProduct;
  let productDifferenceCents=0;
  if(productChange){
    const resolved=await resolveV2ProductSelection(db,{productCode:requestedProduct,variantCode:requestedVariant});
    // Upgrading from 5 to 6 scenes costs the catalogue *difference*
    // (R$ 190 - R$ 155), not the difference against an old mismatched item
    // row (e.g. R$ 55) in a partially migrated/adjusted order.
    const baselinePrice=Number(originalVariant?.priceCents ?? oldProduct.unit_price_cents);
    productDifferenceCents=Number(resolved.variant.priceCents)-baselinePrice;
    product={...oldProduct,item_code:resolved.variant.code,
      name_snapshot:resolved.product.pricingMode==='scene_count'
        ? `${resolved.product.name} • ${resolved.variant.label}` : resolved.product.name,
      unit_price_cents:resolved.variant.priceCents,points_units:resolved.variant.pointsUnits,
      configuration_json:JSON.stringify({productCode:resolved.product.code,productSlug:resolved.product.slug,
        variantCode:resolved.variant.code,sceneCount:resolved.variant.sceneCount})};
  }
  const sceneOverride=input.sceneCountOverride==null||input.sceneCountOverride===''
    ? 0 : moneyInt(input.sceneCountOverride,'Número de cenas',1,30);
  if(sceneOverride&&productChange) reject('Escolha as cenas pela variante, sem substituir a contagem manualmente.');
  if(sceneOverride&&sceneOverride!==originalScene){
    const nextConf={...parseJson(product.configuration_json,{}),sceneCount:sceneOverride};
    product={...product,configuration_json:JSON.stringify(nextConf),
      name_snapshot:product.name_snapshot.replace(/ • \d+ cena\(s\)$/,'')+` • ${sceneOverride} cena(s)`};
  }
  allItems.push(product);
  const preserved=items.filter(x=>x.item_type!=='product'&&x.item_type!=='addon');
  const inactiveAddons=addonRows.filter(x=>!activeCodes.has(x.item_code));
  allItems.push(...inactiveAddons);
  for(const a of selectedAddons){
    const prior=addonRows.find(x=>x.item_code===a.code);
    allItems.push(prior||{order_id:order.id,item_type:'addon',item_code:a.code,
      name_snapshot:a.name,quantity:1,unit_price_cents:a.priceCents,points_units:a.pointsUnits,
      configuration_json:JSON.stringify(a.config||{})});
  }
  allItems.push(...preserved);
  const snapshot=parseJson(order.pricing_snapshot_json,{});
  const priorDiscount=Number(snapshot.adminEdit?.manualDiscountCents||0);
  const priorAdjustment=Number(snapshot.adminEdit?.priceAdjustmentCents||0);
  const manualDiscount=moneyInt(input.manualDiscountCents??priorDiscount,'Desconto',0,100000000);
  const adjustment=moneyInt(input.priceAdjustmentCents??priorAdjustment,'Ajuste adicional',-10000000,10000000);
  const addonDifferenceCents=sumPrice(allItems.filter(x=>x.item_type!=='product'))
    -sumPrice(items.filter(x=>x.item_type!=='product'));
  // The existing contracted total is authoritative: only explicit changes
  // can modify it. Retaining the same scenes may never silently reprice them.
  const itemsDelta=productDifferenceCents+addonDifferenceCents;
  const total=Number(order.total_cents)+itemsDelta+(adjustment-priorAdjustment)-(manualDiscount-priorDiscount);
  if(!Number.isSafeInteger(total)||total<1||total>100000000) reject('O novo total precisa ser positivo.');
  if(total<paid) reject('O total negociado ficou abaixo do valor já recebido. Registre um estorno real antes de reduzir o pedido.',409);
  const pointsDelta=sumPoints(allItems)-sumPoints(items);
  if(pointsDelta<0&&Math.abs(pointsDelta)>1000000) reject('Carga de produção inválida.');
  if((sceneOverride&&sceneOverride!==originalScene)&&adjustment===priorAdjustment&&!productChange)
    reject('Para alterar cenas de um modelo antigo, informe também o acréscimo ou desconto de preço combinado.');
  const changed=productChange || (sceneOverride>0&&sceneOverride!==originalScene)
    || selectedAddonCodes.slice().sort().join('|')!==addonRows.filter(x=>activeCodes.has(x.item_code)).map(x=>x.item_code).sort().join('|')
    || manualDiscount!==priorDiscount||adjustment!==priorAdjustment;
  return {order,items,allItems,paid,itemsDelta,pointsDelta,total,manualDiscount,adjustment,
    productDifferenceCents,addonDifferenceCents,
    priorDiscount,priorAdjustment,snapshot,changed,selectionChanged:productChange||
      sceneOverride>0&&sceneOverride!==originalScene || itemsDelta!==0||pointsDelta!==0,
    before:compact(items),after:compact(allItems)};
}
export async function previewV2AdminOrderEdit(db,code,input){
  const p=await prepare(db,code,input);
  return {beforeTotalCents:p.order.total_cents,newTotalCents:p.total,
    paidCents:p.paid,remainingCents:p.total-p.paid,itemsDifferenceCents:p.itemsDelta,
    productDifferenceCents:p.productDifferenceCents,
    addonDifferenceCents:p.addonDifferenceCents,
    manualDiscountCents:p.manualDiscount,priceAdjustmentCents:p.adjustment,
    pointsDifference:p.pointsDelta,changed:p.changed,items:p.after,
    note:'Cobranças do Mercado Pago não são alteradas; confirme o novo saldo diretamente com a cliente.'};
}
async function agendaChanges(db, order, pointsDelta) {
  if (!pointsDelta) return [];
  const rows=(await db.prepare('SELECT id,day,points_units FROM v2_agenda_allocations WHERE order_id=? ORDER BY day DESC,id DESC')
    .bind(order.id).all()).results||[];
  const changes=[];
  if (pointsDelta < 0) {
    let remaining=-pointsDelta;
    for (const row of rows) {
      if (!remaining) break;
      const take=Math.min(remaining,Number(row.points_units));
      const next=Number(row.points_units)-take;
      changes.push({id:row.id,day:row.day,points:next});
      remaining-=take;
    }
    if(remaining) reject('Não há alocações suficientes para reduzir esta carga. Revise a Agenda.',409);
    return changes;
  }
  if (!order.delivery_start || !order.delivery_end)
    reject('Defina a faixa de entrega na Agenda antes de acrescentar cenas ou adicionais.',409);
  const first=order.delivery_start, last=order.delivery_end;
  const dates=(Date.parse(last+'T12:00:00Z')-Date.parse(first+'T12:00:00Z'))/86400000;
  if (!Number.isFinite(dates)||dates<0||dates>180)
    reject('A faixa de entrega deve ter até 181 dias para reservar capacidade.',409);
  const available=await getV2AgendaRange(db,{start:first,end:last});
  let remaining=pointsDelta;
  for (const day of available.days.slice().reverse()) {
    if (!remaining) break;
    if(day.blocked) continue;
    const free=Math.max(0,Number(day.publicFreeUnits||0));
    const take=Math.min(remaining,free);
    if(take<=0)continue;
    const same=rows.find(a=>a.day===day.day);
    changes.push({id:same?.id||null,day:day.day,points:(same?Number(same.points_units):0)+take});
    remaining-=take;
  }
  if(remaining)reject('A Agenda não tem capacidade livre suficiente para as cenas/adicionais extras. Ajuste a agenda antes de salvar.',409);
  return changes;
}

export async function saveV2AdminOrderEdit(db,code,input){
  const p=await prepare(db,code,input);
  const note=String(input.note||'').trim();
  if(Number(input.expectedTotalCents)!==Number(p.order.total_cents)
    || String(input.expectedRevision||'')!==String(p.order.pricing_updated_at||''))
    reject('O pedido mudou desde que você abriu a edição. Atualize antes de salvar.',409);
  if(!p.changed) reject('Nenhuma alteração foi selecionada.');
  if(note.length<5||note.length>800) reject('Informe o que a cliente pediu no WhatsApp (mínimo 5 caracteres).');
  const agenda=await agendaChanges(db,p.order,p.pointsDelta);
  const stamp=nowIso();
  const revision=crypto.randomUUID();
  const pricingSnapshot=JSON.stringify({...p.snapshot,adminEdit:{
    ...(p.snapshot.adminEdit||{}),manualDiscountCents:p.manualDiscount,
    priceAdjustmentCents:p.adjustment,lastRevision:revision,updatedAt:stamp,
  }});
  const deposit=Math.min(p.total,Number(p.order.deposit_cents||0));
  const newBriefingStatus=p.selectionChanged&&p.order.briefing_status==='completed'
    ? 'in_progress' : p.order.briefing_status;
  const history=JSON.stringify({source:'admin_whatsapp',reason:note,
    beforeTotalCents:p.order.total_cents,afterTotalCents:p.total,paidCents:p.paid,
    before:p.before,after:p.after,itemsDifferenceCents:p.itemsDelta,
    productDifferenceCents:p.productDifferenceCents,
    addonDifferenceCents:p.addonDifferenceCents,
    manualDiscountCents:p.manualDiscount,priceAdjustmentCents:p.adjustment,
    oldBriefingStatus:p.order.briefing_status,newBriefingStatus,
    agendaNeedsReview:false,agendaAllocationsAdjusted:agenda});
  const isCurrent=`EXISTS(SELECT 1 FROM v2_order_pricing q WHERE q.order_id=?
    AND q.pricing_snapshot_json=?)`;
  const operations=[
    db.prepare(`UPDATE v2_order_pricing SET total_cents=?,subtotal_cents=?,
      deposit_cents=?,balance_cents=?,pricing_snapshot_json=?,updated_at=?
      WHERE order_id=? AND total_cents=? AND pricing_snapshot_json=?
      AND NOT EXISTS(SELECT 1 FROM v2_payments pm WHERE pm.order_id=?
        AND pm.provider='mercado_pago' AND pm.status='pending')
      AND COALESCE((SELECT SUM(CASE WHEN pm.status='approved' THEN
        CASE WHEN pm.payment_type='refund' THEN -pm.amount_cents ELSE pm.amount_cents END
        ELSE 0 END) FROM v2_payments pm WHERE pm.order_id=?),0)<=?`)
      .bind(p.total,Math.max(0,Number(p.order.subtotal_cents)+p.itemsDelta),
        deposit,p.total-deposit,pricingSnapshot,stamp,p.order.id,
        p.order.total_cents,p.order.pricing_snapshot_json,p.order.id,p.order.id,p.total),
    db.prepare(`UPDATE v2_orders SET briefing_status=?,updated_at=?
      WHERE id=? AND ${isCurrent}`)
      .bind(newBriefingStatus,stamp,p.order.id,p.order.id,pricingSnapshot),
    db.prepare(`DELETE FROM v2_order_items WHERE order_id=? AND ${isCurrent}`)
      .bind(p.order.id,p.order.id,pricingSnapshot),
  ];
  for(const item of p.allItems){
    operations.push(db.prepare(`INSERT INTO v2_order_items
      (order_id,item_type,item_code,name_snapshot,quantity,unit_price_cents,points_units,configuration_json,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${isCurrent}`)
      .bind(p.order.id,item.item_type,item.item_code,item.name_snapshot,
        item.quantity||1,item.unit_price_cents,item.points_units||0,
        item.configuration_json||'{}',item.created_at||stamp,p.order.id,pricingSnapshot));
  }
  for(const change of agenda){
    if(change.id){
      if(change.points>0) operations.push(db.prepare(`UPDATE v2_agenda_allocations
        SET points_units=? WHERE id=? AND ${isCurrent}`)
        .bind(change.points,change.id,p.order.id,pricingSnapshot));
      else operations.push(db.prepare(`DELETE FROM v2_agenda_allocations
        WHERE id=? AND ${isCurrent}`).bind(change.id,p.order.id,pricingSnapshot));
    } else {
      operations.push(db.prepare(`INSERT OR IGNORE INTO v2_agenda_days(day) VALUES(?)`).bind(change.day));
      operations.push(db.prepare(`INSERT INTO v2_agenda_allocations
        (order_id,day,points_units,allocation_type)
        SELECT ?,?,?,'confirmed' WHERE ${isCurrent}`)
        .bind(p.order.id,change.day,change.points,p.order.id,pricingSnapshot));
    }
  }
  operations.push(db.prepare(`INSERT INTO v2_order_history
    (order_id,action_code,description,metadata_json,created_at)
    SELECT ?,'admin_order_edited','Pedido e valores alterados pela administradora após contato pelo WhatsApp',?,?
    WHERE ${isCurrent}`).bind(p.order.id,history,stamp,p.order.id,pricingSnapshot));
  const results=await db.batch(operations);
  if(Number(results?.[0]?.meta?.changes||0)!==1)
    reject('O pedido mudou durante a gravação. Atualize e tente novamente.',409);
  return {ok:true,totalCents:p.total,paidCents:p.paid,remainingCents:p.total-p.paid,
    briefingNeedsReview:newBriefingStatus!==p.order.briefing_status};
}
