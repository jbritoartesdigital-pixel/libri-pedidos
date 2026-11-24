import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database } from './helpers.mjs';
import { searchV2AdminOrders } from '../src/lib/v2-admin-search.js';

function fixtures() {
  const DB=database();
  const customer=DB.sqlite.prepare(
    "INSERT INTO v2_customers(name,whatsapp) VALUES ('Cliente Modelo','5511999999999')"
  ).run().lastInsertRowid;
  const cases=[
    ['LIBRI-9101','Vídeo um','2026-12-07','cinematic_video_1',{},false],
    ['LIBRI-9102','Interativo dois','2026-12-07','cinematic_interactive_2',
      {productCode:'cinematic_interactive',sceneCount:2},false],
    ['LIBRI-9103','Interativo três','2026-12-10','cinematic_interactive_3',{},true],
    ['LIBRI-9104','Interativo essencial','2026-12-07','interactive_essential_default',
      {productCode:'interactive_essential'},false],
    ['LIBRI-9105','Interativo dois legado','2026-12-08','cinematic_interactive_2',{},false],
    ['LIBRI-9106','Vídeo legado','2026-12-21','cinematic_video_1','not json',false],
    ['LIBRI-9107','Interativo manual','2026-12-08','cinematic_interactive',
      {productCode:'cinematic_interactive',sceneCount:2},false],
  ];
  for(const [code,name,date,item,config,archived] of cases) {
    const id=DB.sqlite.prepare(
      "INSERT INTO v2_orders(order_code,public_token,customer_id,event_type,honoree_display_name,event_date,archived_at) VALUES (?,?,?,'birthday',?,?,?)"
    ).run(code,'token-'+code,customer,name,date,
      archived?'2026-11-15T12:00:00Z':null).lastInsertRowid;
    const json=typeof config==='string'?config:JSON.stringify(config);
    DB.sqlite.prepare(
      "INSERT INTO v2_order_items(order_id,item_type,item_code,name_snapshot,unit_price_cents,configuration_json) VALUES (?,'product',?,'Convite',3500,?)"
    ).run(id,item,json);
  }
  return DB;
}
const codes=orders=>orders.map(x=>x.code);

test('busca número de cenas real para pedidos novos e variantes antigas',async()=>{
  const DB=fixtures();
  assert.deepEqual(codes(await searchV2AdminOrders(DB,{scenes:'1'})),
    ['LIBRI-9106','LIBRI-9101']);
  const found=await searchV2AdminOrders(DB,{product:'cinematic_interactive',scenes:'2'});
  assert.deepEqual(codes(found),['LIBRI-9107','LIBRI-9105','LIBRI-9102']);
  assert.ok(found.every(o=>o.productCode==='cinematic_interactive'&&o.sceneCount===2));
  assert.equal((await searchV2AdminOrders(DB,{product:'interactive_essential',scenes:'1'})).length,0);
  assert.deepEqual(codes(await searchV2AdminOrders(DB,{scenes:'3',archived:'yes'})),
    ['LIBRI-9103']);
});

test('filtra data exata da festa e combina com o modelo contratado',async()=>{
  const DB=fixtures();
  assert.deepEqual(codes(await searchV2AdminOrders(DB,{eventDate:'2026-12-07'})),
    ['LIBRI-9104','LIBRI-9102','LIBRI-9101']);
  assert.deepEqual(codes(await searchV2AdminOrders(DB,{
    eventDate:'2026-12-07',product:'cinematic_interactive',scenes:'2'
  })),['LIBRI-9102']);
  assert.deepEqual(codes(await searchV2AdminOrders(DB,{
    eventDate:'2026-12-08',scenes:'2',archived:'no'
  })),['LIBRI-9107','LIBRI-9105']);
  assert.deepEqual(codes(await searchV2AdminOrders(DB,{eventDate:'2026-12-09'})),[]);
});

test('período preservado e resultados ordenados pelas datas das festas',async()=>{
  const DB=fixtures();
  const result=await searchV2AdminOrders(DB,{
    from:'2026-12-07',to:'2026-12-10',product:'cinematic_interactive',scenes:'2'
  });
  assert.deepEqual(result.map(x=>x.eventDate),
    ['2026-12-07','2026-12-08','2026-12-08']);
  assert.deepEqual(codes(result),['LIBRI-9102','LIBRI-9107','LIBRI-9105']);
  assert.deepEqual(codes(await searchV2AdminOrders(DB,{from:'2026-12-21'})),
    ['LIBRI-9106']);
  assert.deepEqual(codes(await searchV2AdminOrders(DB,{to:'2026-12-07',archived:'yes'})),[]);
});

test('busca textual, arquivos e validação protegida de filtros',async()=>{
  const DB=fixtures();
  assert.deepEqual(codes(await searchV2AdminOrders(DB,{
    q:'Interativo',eventDate:'2026-12-08',scenes:'2'
  })),['LIBRI-9107','LIBRI-9105']);
  for(const scenes of ['0','21','99','2.1','2 OR 1=1','-1','abc']){
    await assert.rejects(searchV2AdminOrders(DB,{scenes}),/Número de cenas inválido/);
  }
  await assert.rejects(searchV2AdminOrders(DB,{eventDate:'07/12/2026'}),/data exata/);
  await assert.rejects(searchV2AdminOrders(DB,{from:'2026-12-21',to:'2026-12-07'}),/período/);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,7);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n,0);
});

test('painel mantém filtros recolhidos e oferece data exata, intervalo e cenas',()=>{
  const central=readFileSync('public/js/admin-v2-central.js','utf8');
  const entry=readFileSync('public/js/admin-v2.js','utf8');
  const shell=readFileSync('public/admin-v2.html','utf8');
  const details=central.indexOf('<details id="advancedOrderFilters"');
  const end=central.indexOf('</details>',details);
  assert.ok(details>0&&end>details);
  for(const id of ['advOrderScenes','advOrderDate','advOrderFrom','advOrderTo',
    'clearAdvancedOrderSearch','runAdvancedOrderSearch']){
    const i=central.indexOf('id="'+id+'"');
    assert.ok(i>details&&i<end,id+' deve permanecer recolhido por padrão');
  }
  assert.match(central,/\['scenes','advOrderScenes'\]/);
  assert.match(central,/\['eventDate','advOrderDate'\]/);
  assert.match(central,/item\.sceneCount/);
  assert.match(central,/data-searched-order/);
  assert.match(entry,/admin-v2-central\.js\?v=20261124-admin-v3-68/);
  assert.match(shell,/admin-v2\.js\?v=20261124-admin-v3-68/);
});
