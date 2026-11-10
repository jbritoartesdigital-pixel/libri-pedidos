import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database,day,providerMock} from './helpers.mjs';
import {createV2ManualOrder,startV2ManualOrderPayment,getV2ManualOrderForCustomer}
  from '../src/lib/v2-orders-manual.js';
import {saveBlackLibriCampaign} from '../src/lib/v2-black-libri-admin.js';
import {applyBlackLibriToQuote} from '../src/lib/v2-black-libri.js';
import {statusManualBlackLibri,revealManualBlackLibri,previewManualBlackLibri}
  from '../src/lib/v2-black-libri-manual.js';
import {handlePublicManualOrderV2Api} from '../src/routes/public-manual-order-v2.js';

const request=new Request('https://pedidos.libriconvites.com.br/pedido/manual');
const campaign={
  adminEnabled:true,complianceConfirmed:true,authorizationReference:'REGISTRO-TESTE',
  adminNote:'Ambiente sintético',validFrom:'2020-01-01',validUntil:'2030-12-31'
};
async function fixture(t,{depositPercent=100,paymentMethod='pix',phone='5511999997456'}={}) {
  const DB=database();
  providerMock(t);
  const env={DB,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'};
  const created=await createV2ManualOrder(request,env,{
    customer:{name:'Cliente Manual',whatsapp:phone,email:'manual-test@example.com'},
    event:{type:'birthday',honoreeName:'Teste Manual Black Libri',date:day(60)},
    selection:{productCode:'interactive_essential',paymentMethod},
    deliveryWindow:{start:day(12),end:day(14)},
    paymentDepositPercent:depositPercent
  });
  const token=created.order.publicToken;
  const original=await getV2ManualOrderForCustomer(DB,token);
  await saveBlackLibriCampaign(env,campaign);
  const terms=(await DB.prepare('SELECT version FROM v2_terms_versions WHERE active=1').first()).version;
  const payBody={
    termsAccepted:true,termsVersion:terms,addonCodes:[],
    productCode:original.pricing.snapshot.product.code,
    variantCode:original.pricing.snapshot.variant.code,
    expectedTotalCents:original.pricing.totalCents
  };
  return {DB,env,original,token,payBody};
}

test('pedido manual revela prêmio por token e atualiza valor original antes do MP',async t=>{
  const f=await fixture(t);
  f.DB.sqlite.exec("UPDATE v2_black_libri_prizes SET enabled=CASE WHEN code='off_15' THEN 1 ELSE 0 END");
  assert.equal((await statusManualBlackLibri(f.env,f.token)).enabled,true);
  const revealed=await revealManualBlackLibri(f.env,f.token);
  assert.equal(revealed.claim.code,'off_15');
  const repeat=await revealManualBlackLibri(f.env,f.token);
  assert.equal(repeat.claim.id,revealed.claim.id,'Mesmo pedido não sorteia outra vez');
  const preview=await previewManualBlackLibri(f.env,f.token,{
    productCode:f.payBody.productCode,variantCode:f.payBody.variantCode,addonCodes:[]
  });
  const expected=applyBlackLibriToQuote(f.original.pricing.snapshot,{
    id:revealed.claim.id,prize_code:'off_15',label:revealed.claim.label,
    description:'',kind:'fixed',value:1500,expires_at:revealed.claim.expiresAt
  });
  assert.equal(preview.quote.totalCents,expected.totalCents);
  const paid=await startV2ManualOrderPayment(request,f.env,f.token,f.payBody);
  assert.ok(paid.payment.checkoutUrl);
  assert.equal(paid.payment.amountDueNowCents,expected.payment.depositCents);
  const current=await getV2ManualOrderForCustomer(f.DB,f.token);
  assert.equal(current.pricing.totalCents,expected.totalCents);
  assert.equal(current.pricing.snapshot.blackLibri?.code,'off_15');
  assert.equal(current.pricing.snapshot.blackLibriDiscountCents,1500);
  const saved=f.DB.sqlite.prepare('SELECT status,order_id FROM v2_black_libri_claims').get();
  assert.equal(saved.status,'attached');
  assert.equal(saved.order_id,current.id);
  assert.equal((await statusManualBlackLibri(f.env,f.token)).enabled,false,
    'Cobrança existente não deve oferecer novo balão');
});

test('pedido manual Pix 50% preserva parcelamento após prêmio',async t=>{
  const f=await fixture(t,{depositPercent:50,phone:'5511988881236'});
  f.DB.sqlite.exec("UPDATE v2_black_libri_prizes SET enabled=CASE WHEN code='off_10' THEN 1 ELSE 0 END");
  const prize=await revealManualBlackLibri(f.env,f.token);
  assert.equal(prize.claim.code,'off_10');
  const result=await startV2ManualOrderPayment(request,f.env,f.token,f.payBody);
  const current=await getV2ManualOrderForCustomer(f.DB,f.token);
  assert.equal(current.pricing.depositPercent,50);
  assert.equal(current.pricing.totalCents,f.original.pricing.totalCents-1000);
  assert.equal(current.pricing.depositCents,
    Math.round(current.pricing.totalCents/2));
  assert.equal(result.payment.amountDueNowCents,current.pricing.depositCents);
  assert.equal(current.pricing.depositCents+current.pricing.balanceCents,
    current.pricing.totalCents);
});

test('brinde no pedido manual fica registrado como adicional sem custo',async t=>{
  const f=await fixture(t,{phone:'5511988881237'});
  f.DB.sqlite.exec("UPDATE v2_black_libri_prizes SET enabled=CASE WHEN code='save_static' THEN 1 ELSE 0 END");
  assert.equal((await revealManualBlackLibri(f.env,f.token)).claim.code,'save_static');
  await startV2ManualOrderPayment(request,f.env,f.token,f.payBody);
  const current=await getV2ManualOrderForCustomer(f.DB,f.token);
  assert.equal(current.pricing.totalCents,f.original.pricing.totalCents);
  const gift=f.DB.sqlite.prepare(
    "SELECT item_type,unit_price_cents FROM v2_order_items WHERE order_id=? AND item_code='black_libri:save_static'"
  ).get(current.id);
  assert.equal(gift.item_type,'addon');
  assert.equal(gift.unit_price_cents,0);
});

test('pagamento manual já iniciado não permite revelar novo prêmio',async t=>{
  const f=await fixture(t,{phone:'5511988881238'});
  const result=await startV2ManualOrderPayment(request,f.env,f.token,f.payBody);
  assert.ok(result.payment.checkoutUrl);
  assert.equal((await statusManualBlackLibri(f.env,f.token)).enabled,false);
  await assert.rejects(revealManualBlackLibri(f.env,f.token),/já começou/i);
});

test('rota manual não aceita WhatsApp forjado enviado pelo navegador',async t=>{
  const f=await fixture(t,{phone:'5511988881239'});
  f.DB.sqlite.exec("UPDATE v2_black_libri_prizes SET enabled=CASE WHEN code='off_15' THEN 1 ELSE 0 END");
  const url='https://pedidos.libriconvites.com.br/api/v2/manual-order/'+f.token+'/black-libri/reveal';
  const response=await handlePublicManualOrderV2Api(
    new Request(url,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({customer:{whatsapp:'5511977770000'}})}),
    f.env,new URL(url));
  assert.equal(response.status,200);
  const expected=await response.json();
  assert.equal(expected.claim.code,'off_15');
  const got=f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_black_libri_claims').get().n;
  assert.equal(got,1);
  const ui=readFileSync('public/js/client-v2-black-libri.js','utf8');
  assert.doesNotMatch(ui,/vinculada ao seu WhatsApp|Uma chance por cliente|Prêmio único/);
  assert.match(ui,/Surpresa para você!/);
});
