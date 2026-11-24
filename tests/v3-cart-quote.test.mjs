import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {database} from './helpers.mjs';
import {quoteV3Cart} from '../src/lib/v3-cart-quote.js';
import {priceWithCardProcessingFee} from '../src/lib/v2-payment-pricing.js';
import {updateAtelieDraft} from '../src/lib/v3-atelie-catalog.js';
import {setAtelieSaleStatus} from '../src/lib/v3-atelie-release.js';

const base={eventType:'birthday',paymentMethod:'pix'};
const invitation={productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]};
async function enableAtelie(db) {
  await updateAtelieDraft(db,'essencia',{
    includedItems:['3 poses','1 brasão','1 paleta de cores','1 tipografia'],
    excludedItems:['Impressão e fabricação física','Outro personagem ilustrado sem orçamento'],
    priceCents:15900,pointsUnits:300,revisionLimit:1,
    scopeReference:'Libri Ateliê V4.1',
    specificTerms:'Entrega digital com licença de uso pessoal, revisão limitada e sem edição de arquivos. Mínimo de 15 dias de produção após briefing completo, sem publicação de fotos.'
  });
  await updateAtelieDraft(db,'essencia',{scopeApproved:true});
  await setAtelieSaleStatus(db,'essencia',true);
}
test('V3 usa catálogo real para cotar um convite e não cria cobrança',async()=>{
  const db=database({beforeApprovedAtelie:true});
  const cart=await quoteV3Cart(db,{...base,items:[invitation]});
  assert.equal(cart.items.length,1);
  assert.equal(cart.items[0].family,'convite');
  assert.equal(cart.items[0].totalCents,3500);
  assert.equal(cart.totalCents,3500);
  assert.equal(cart.canCheckout,false);
  assert.equal(cart.pricedOnServer,true);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n,0);
});
test('V3 combina convite com Ateliê ativado SEM duplicar produto, pagamento ou descontos',async()=>{
  const db=database({beforeApprovedAtelie:true});
  await enableAtelie(db);
  const cart=await quoteV3Cart(db,{...base,items:[
    invitation,
    {productCode:'atelie_essencia',variantCode:'atelie_essencia_default',addonCodes:[]}
  ]});
  assert.deepEqual(cart.items.map(x=>x.family),['convite','identidade_visual']);
  assert.equal(cart.totalCents,18430);
  assert.equal(cart.combinedDiscountCents,970);
  assert.deepEqual(cart.items.map(x=>x.discountCents),[175,795]);
  assert.equal(cart.pointsUnits,100+300);
  assert.equal(cart.items[1].productName,'Identidade Visual | Essência');
  assert.equal(cart.canCheckout,false);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);
});
test('V3 não permite linha duplicada, preços enviados pelo cliente ou promoções não implementadas',async()=>{
  const db=database({beforeApprovedAtelie:true});
  await assert.rejects(quoteV3Cart(db,{...base,items:[invitation,invitation]}),/no máximo um produto/);
  await assert.rejects(quoteV3Cart(db,{...base,items:[{...invitation,couponCode:'X'}]}),/Descontos combinados/);
  await assert.rejects(quoteV3Cart(db,{...base,items:[]}),/1 a 3 produtos/);
  await assert.rejects(quoteV3Cart(db,{...base,items:[{...invitation,addonCodes:'foo'}]}),/Adicionais inválidos/);
  await assert.rejects(quoteV3Cart(db,{...base,items:[{productCode:'atelie_essencia',variantCode:'atelie_essencia_default',addonCodes:[]}]}));
});
test('API V3 é pública somente para cotação e não afeta rotas V2',async()=>{
  const DB=database({beforeApprovedAtelie:true}),env={DB},ctx={waitUntil(){}};
  const response=await worker.fetch(new Request('https://test/api/v3/cart/quote',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({...base,items:[invitation]})
  }),env,ctx);
  assert.equal(response.status,200);
  const value=await response.json();
  assert.equal(value.quote.canCheckout,false);
  assert.equal(value.quote.totalCents,3500);
  const unknown=await worker.fetch(new Request('https://test/api/v3/cart/pay',{
    method:'POST',headers:{'content-type':'application/json'},body:'{}'
  }),env,ctx);
  assert.equal(unknown.status,404);
  const v2=await worker.fetch(new Request('https://test/api/v2/catalog'),env,ctx);
  assert.equal(v2.status,200);
});

test('V3 applies explicit eligible invite combo once and calculates card fee on aggregate',async()=>{
  const db=database({beforeApprovedAtelie:true});
  await enableAtelie(db);
  db.sqlite.exec("INSERT INTO v2_combos(code,name,discount_type,discount_value,active) VALUES ('cart_test','Combo teste','fixed',1200,1)");
  const items=[{...invitation,comboCode:'cart_test'},
    {productCode:'atelie_essencia',variantCode:'atelie_essencia_default',addonCodes:[]}];
  const cart=await quoteV3Cart(db,{...base,items,paymentMethod:'card'});
  assert.equal(cart.grossCents,19400);
  assert.equal(cart.discountCents,1200);
  assert.equal(cart.combinedDiscountCents,0);
  assert.equal(cart.items[0].comboCode,'cart_test');
  assert.equal(cart.items[1].discountCents,0);
  assert.equal(cart.baseTotalCents,18200);
  assert.equal(cart.totalCents,priceWithCardProcessingFee(18200,'card').totalCents);
  assert.equal(cart.cardFeeCents,cart.totalCents-18200);
  assert.equal(cart.canCheckout,false);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n,0);
});
test('V3 rejects cart-wide discounts, ineligible combos and Ateliê combos',async()=>{
  const db=database({beforeApprovedAtelie:true});
  await assert.rejects(quoteV3Cart(db,{...base,items:[invitation],couponCode:'TEST'}),/Descontos combinados/);
  await assert.rejects(quoteV3Cart(db,{...base,items:[{...invitation,comboCode:'missing_combo'}]}),/Combo não encontrado/);
  await assert.rejects(quoteV3Cart(db,{...base,items:[{productCode:'atelie_essencia',variantCode:'atelie_essencia_default',addonCodes:[],comboCode:'cart_test'}]}),/Descontos combinados/);
});
