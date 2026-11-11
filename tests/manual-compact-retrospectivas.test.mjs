import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import { loadV2Catalog } from '../src/lib/v2-catalog.js';
import { createV2ManualOrder, getV2ManualOrderForCustomer, startV2ManualOrderPayment } from '../src/lib/v2-orders-manual.js';
import { quoteManualClientAddons, getManualClientAddonOffer } from '../src/lib/v2-manual-client-addons.js';
import { compactManualAddonGroups, compactManualAddonsHtml } from '../public/js/client-v2-manual-addon-groups.js';

const request = new Request('https://pedidos.libriconvites.com.br/api/v2/manual-order');
const env = DB => ({ DB, MERCADO_PAGO_ACCESS_TOKEN: 'TEST-token' });
const money = cents => 'R$ ' + (cents / 100).toFixed(2);
const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
async function manual(DB, percent=50) {
  const c = await createV2ManualOrder(request, env(DB), {
    customer: {name:'Cliente Teste',whatsapp:'5511988877665',email:'user@example.com'},
    event: {type:'birthday',honoreeName:'Festa Teste',date:day(70)},
    deliveryWindow: {start:day(17),end:day(19)},
    selection: {productCode:'interactive_essential',paymentMethod:'pix',addonCodes:[]},
    paymentDepositPercent: percent,
  });
  return getV2ManualOrderForCustomer(DB,c.order.publicToken);
}

test('catálogo das retrospectivas corresponde aos cinco pacotes aprovados', async () => {
  const DB=database();
  const catalog=await loadV2Catalog(DB);
  const retros=catalog.addons.filter(a=>a.group==='retrospectiva');
  assert.deepEqual(retros.map(a=>[a.code,a.priceCents,a.config.maxPhotos,a.config.maxVideos,a.config.captions]),[
    ['retro_070',10000,70,5,false],
    ['retro_100',15000,100,10,false],
    ['retro_150',20000,150,10,true],
    ['retro_200',25000,200,10,true],
    ['retro_250',30000,250,10,true],
  ]);
  assert.deepEqual(retros.map(a=>a.pointsUnits),[200,300,400,500,600]);
  assert.ok(retros.every(a=>a.config.fulfillment==='manual'));
});

test('resumo compacto apresenta um Save the Date e um grupo de retrospectivas', async () => {
  const DB=database();
  const manualOrder=await manual(DB);
  const offer=await getManualClientAddonOffer(DB,manualOrder);
  const groups=compactManualAddonGroups(offer.available);
  const save=groups.find(g=>g.key==='save_the_date');
  const retro=groups.find(g=>g.key==='retrospectiva');
  assert.equal(save.options.length,2);
  assert.equal(save.minPriceCents,2000);
  assert.equal(retro.options.length,5);
  assert.equal(retro.minPriceCents,10000);
  const html=compactManualAddonsHtml(offer.available,[],[],money,esc);
  assert.equal((html.match(/data-manual-addon-group="save_the_date"/g)||[]).length,4);
  assert.equal((html.match(/<summary>/g)||[]).length,4);
  assert.match(html,/Save the Date/);
  assert.match(html,/A partir de R\$ 20\.00/);
  assert.match(html,/Retrospectiva/);
  assert.match(html,/A partir de R\$ 100\.00/);
  assert.match(html,/70 fotos/);
  assert.match(html,/250 fotos/);
  assert.match(html,/id="manualMomentsExtraRow"/);
  assert.match(html,/class="manual-addon-single hidden"/);
});

test('não cobra duas versões da mesma categoria, nem +100 fotos sem álbum',async()=>{
  const DB=database(), order=await manual(DB);
  await assert.rejects(
    quoteManualClientAddons(DB,order,['save_static','save_animated']),
    /apenas uma versão/
  );
  await assert.rejects(
    quoteManualClientAddons(DB,order,['retro_070','retro_100']),
    /somente um pacote/
  );
  await assert.rejects(
    quoteManualClientAddons(DB,order,['moments_festa','moments_premium']),
    /apenas uma versão/
  );
  await assert.rejects(
    quoteManualClientAddons(DB,order,['moments_extra_100']),
    /combinação|disponível|compatível/
  );
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_payments").get().n,0);
});

test('retrospectiva adiciona o preço correto e preserva a autorização de 50%',async t=>{
  const DB=database(), mp=providerMock(t), order=await manual(DB);
  const original=order.pricing.totalCents;
  const quote=await quoteManualClientAddons(DB,order,['retro_100']);
  assert.equal(quote.totalCents,original+15000);
  assert.equal(quote.depositPercent,50);
  assert.equal(quote.depositCents,Math.round((original+15000)/2));
  assert.equal(quote.balanceCents,quote.totalCents-quote.depositCents);
  assert.equal((await getV2ManualOrderForCustomer(DB,order.token)).pricing.totalCents,original);
  const payment=await startV2ManualOrderPayment(request,env(DB),order.token,{
    termsAccepted:true,termsVersion:order.terms.version,
    addonCodes:['retro_100'],expectedTotalCents:quote.totalCents,
    paymentDepositPercent:100, // ignora tentativa pública de revogar a exceção da Central
  });
  assert.equal(payment.payment.amountDueNowCents,quote.depositCents);
  assert.equal(mp.posts,1);
  const saved=await getV2ManualOrderForCustomer(DB,order.token);
  assert.ok(saved.items.some(x=>x.item_code==='retro_100'));
  assert.equal(saved.pricing.depositPercent,50);
  const again=await startV2ManualOrderPayment(request,env(DB),order.token,{
    termsAccepted:true,termsVersion:order.terms.version,
    addonCodes:['retro_100'],expectedTotalCents:quote.totalCents,
  });
  assert.equal(again.payment.checkoutUrl,payment.payment.checkoutUrl);
  assert.equal(mp.posts,1);
});

test('alterações de retrospectiva são bloqueadas após iniciar checkout',async t=>{
  const DB=database(), mp=providerMock(t),order=await manual(DB,100);
  await startV2ManualOrderPayment(request,env(DB),order.token,{
    termsAccepted:true,termsVersion:order.terms.version,
  });
  assert.equal(mp.posts,1);
  const latest=await getV2ManualOrderForCustomer(DB,order.token);
  await assert.rejects(
    quoteManualClientAddons(DB,latest,['retro_250']),
    /iniciou o pagamento/
  );
  assert.equal((await getManualClientAddonOffer(DB,latest)).editable,false);
});

test('interface compacta preserva fluxo de cotação e cache renovado',()=>{
  const store=readFileSync('public/js/client-v2-store.js','utf8');
  const html=readFileSync('public/client-v2.html','utf8');
  const entry=readFileSync('public/js/client-v2.js','utf8');
  assert.match(store,/compactManualAddonsHtml/);
  assert.match(store,/syncManualAddonSelection/);
  assert.match(store,/data-manual-addon="1"/);
  assert.match(store,/refreshManualQuote\(\)/);
  assert.match(html,/client-v2\.css\?v=20261110-confirmation-clear-1/);
  assert.match(html,/client-v2\.js\?v=20261110-confirmation-clear-1/);
  assert.match(entry,/client-v2-store\.js\?v=20261110-confirmation-clear-1/);
});
