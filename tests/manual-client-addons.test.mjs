import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import { createV2ManualOrder, getV2ManualOrderForCustomer, startV2ManualOrderPayment } from '../src/lib/v2-orders-manual.js';
import { getManualClientAddonOffer, quoteManualClientAddons } from '../src/lib/v2-manual-client-addons.js';
import { handlePublicManualOrderV2Api } from '../src/routes/public-manual-order-v2.js';

const env = DB => ({ DB, MERCADO_PAGO_ACCESS_TOKEN:'TEST-token' });
const request = new Request('https://pedidos.libriconvites.com.br/api/v2/manual-order');
const body = (paymentDepositPercent = 50, paymentMethod = 'pix') => ({
  customer: {name:'Cliente Exemplo',whatsapp:'5511987766554',email:'customer@example.com'},
  event: {type:'birthday',honoreeName:'Criança Exemplo',date:day(70)},
  selection: {productCode:'interactive_essential',paymentMethod,addonCodes:[]},
  deliveryWindow: {start:day(20),end:day(22)},
  paymentDepositPercent,
});
async function manualOrder(DB, percent=50, method='pix') {
  const created = await createV2ManualOrder(request, env(DB), body(percent,method));
  const manual = await getV2ManualOrderForCustomer(DB, created.order.publicToken);
  return {created,manual};
}
async function availableAddon(DB, manual) {
  const offer = await getManualClientAddonOffer(DB, manual);
  assert.equal(offer.editable, true);
  const addon = offer.available.find(a=>a.code !== 'moments_extra_100'
    && a.group !== 'moments' && a.group !== 'confirmation')
    || offer.available.find(a=>a.code !== 'moments_extra_100');
  assert.ok(addon, 'produto tem ao menos um adicional elegível');
  return addon;
}

test('pedido manual com exceção preserva 50% e inclui adicionais na prévia sem mutação', async()=>{
  const DB=database();
  const {manual}=await manualOrder(DB,50);
  const addon=await availableAddon(DB,manual);
  const totalBefore=manual.pricing.totalCents;
  const quote=await quoteManualClientAddons(DB,manual,[addon.code]);
  assert.equal(quote.depositPercent,50);
  assert.equal(quote.totalCents,totalBefore+quote.increaseCents);
  assert.equal(quote.depositCents,Math.round(quote.totalCents/2));
  assert.equal(quote.depositCents+quote.balanceCents,quote.totalCents);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n,0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code=?').get('manual_customer_addons').n,0);
  const updated=await getV2ManualOrderForCustomer(DB,manual.token);
  assert.equal(updated.pricing.totalCents,totalBefore,'prévia não altera valor contratado');
});

test('checkout manual cobra adicional aprovado uma única vez e bloqueia revisão após iniciar',async t=>{
  const DB=database();const mp=providerMock(t);
  const {manual}=await manualOrder(DB,50);
  const addon=await availableAddon(DB,manual);
  const quote=await quoteManualClientAddons(DB,manual,[addon.code]);
  const result=await startV2ManualOrderPayment(request,env(DB),manual.token,{
    termsAccepted:true,termsVersion:manual.terms.version,
    addonCodes:[addon.code],expectedTotalCents:quote.totalCents,
    paymentDepositPercent:100, // tentativa pública não revoga exceção autorizada
  });
  assert.ok(result.payment.checkoutUrl);
  assert.equal(result.payment.amountDueNowCents,quote.depositCents);
  assert.equal(mp.bodies[0].total_amount,(quote.depositCents/100).toFixed(2));
  const saved=await getV2ManualOrderForCustomer(DB,manual.token);
  assert.equal(saved.pricing.totalCents,quote.totalCents);
  assert.equal(saved.pricing.depositPercent,50);
  assert.ok(saved.items.some(i=>i.item_code===addon.code));
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code='manual_customer_addons'").get().n,1);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n,1);
  assert.equal(mp.posts,1);
  const reused=await startV2ManualOrderPayment(request,env(DB),manual.token,{
    termsAccepted:true,termsVersion:manual.terms.version,
    addonCodes:[addon.code],expectedTotalCents:quote.totalCents,
  });
  assert.equal(reused.payment.checkoutUrl,result.payment.checkoutUrl);
  assert.equal(mp.posts,1);
  assert.equal((await getManualClientAddonOffer(DB,saved)).editable,false);
  await assert.rejects(quoteManualClientAddons(DB,saved,[addon.code]),/já iniciou o pagamento/);
});

test('pedido integral Pix e cartão preservam percentual e tarifas sobre extras',async()=>{
  for(const method of ['pix','card']){
    const DB=database();
    const {manual}=await manualOrder(DB,100,method);
    const addon=await availableAddon(DB,manual);
    const quote=await quoteManualClientAddons(DB,manual,[addon.code]);
    assert.equal(quote.depositPercent,100);
    assert.equal(quote.depositCents,quote.totalCents);
    assert.equal(quote.balanceCents,0);
    assert.ok(quote.increaseCents >= addon.priceCents);
    if(method==='card') assert.ok(quote.increaseCents > addon.priceCents);
  }
});

test('API pública não permite remover adicionais, trocar produto ou falsificar desconto e valida agenda',async()=>{
  const DB=database();
  const {manual}=await manualOrder(DB,50);
  const addon=await availableAddon(DB,manual);
  await assert.rejects(quoteManualClientAddons(DB,manual,[addon.code,addon.code]),/inválida/);
  await assert.rejects(quoteManualClientAddons(DB,manual,['addon_nao_existe']),/não encontrado/);
  const path='/api/v2/manual-order/'+manual.token+'/addons/quote';
  const res=await handlePublicManualOrderV2Api(
    new Request('https://pedidos.libriconvites.com.br'+path,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({addonCodes:[addon.code],paymentDepositPercent:100,
        productCode:'cinematic_interactive', totalCents:1}),
    }),env(DB),new URL('https://pedidos.libriconvites.com.br'+path));
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.result.depositPercent,50);
  assert.equal(data.result._additions,undefined);
  assert.ok(data.result.totalCents>manual.pricing.totalCents);
  const expiredDay=day(20);
  DB.sqlite.prepare('INSERT INTO v2_agenda_days(day,sellable_capacity_units,blocked,created_at,updated_at) VALUES (?,?,1,datetime(\'now\'),datetime(\'now\'))')
    .run(expiredDay,0);
  DB.sqlite.prepare('INSERT INTO v2_agenda_days(day,sellable_capacity_units,blocked,created_at,updated_at) VALUES (?,?,1,datetime(\'now\'),datetime(\'now\'))')
    .run(day(21),0);
  DB.sqlite.prepare('INSERT INTO v2_agenda_days(day,sellable_capacity_units,blocked,created_at,updated_at) VALUES (?,?,1,datetime(\'now\'),datetime(\'now\'))')
    .run(day(22),0);
  await assert.rejects(quoteManualClientAddons(DB,manual,[addon.code]),/capacidade/);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_order_items WHERE item_code=?').get(addon.code).n,0);
});

test('valor ou revisão desatualizados impedem criar cobrança ou modificar pedido',async()=>{
  const DB=database(); const {manual}=await manualOrder(DB,50);
  const addon=await availableAddon(DB,manual);
  const before=DB.sqlite.prepare('SELECT total_cents FROM v2_order_pricing WHERE order_id=?').get(manual.id).total_cents;
  await assert.rejects(startV2ManualOrderPayment(request,env(DB),manual.token,{
    termsAccepted:true,termsVersion:manual.terms.version,
    addonCodes:[addon.code],expectedTotalCents:1,
  }),/valor mudou/);
  assert.equal(DB.sqlite.prepare('SELECT total_cents FROM v2_order_pricing WHERE order_id=?').get(manual.id).total_cents,before);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n,0);
});

test('interface do pedido manual solicita prévia e mostra saldo somente na exceção',()=>{
  const ui=readFileSync('public/js/client-v2-store.js','utf8');
  const routes=readFileSync('src/routes/public-manual-order-v2.js','utf8');
  assert.match(ui,/manualAddonOffer/);
  assert.match(ui,/manualAddonQuoteFeedback/);
  assert.match(ui,/addonCodes: selectedManualAddonCodes/);
  assert.match(ui,/expectedTotalCents: manualAddonQuote\?\.totalCents/);
  assert.match(ui,/selectedManualAddonCodes\.length && !manualAddonQuote/);
  assert.match(routes,/\/addons\/quote/);
  assert.match(ui,/Saldo após a entrada/);
});
