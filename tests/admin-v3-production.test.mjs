import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day } from './helpers.mjs';
import { listV2Production } from '../src/lib/v2-admin-core.js';

function fixture() {
  const db=database(),sqlite=db.sqlite;
  sqlite.exec("INSERT INTO v2_customers(id,name,whatsapp) VALUES(900,'Cliente Fictícia','5511999990000')");
  const add=(id,product,stage)=>{
    sqlite.prepare(
      'INSERT INTO v2_orders(id,order_code,public_token,customer_id,event_type,honoree_display_name,event_date,status,delivery_start,delivery_end) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).run(id,'LIBRI-'+id,'ord_'+String(id).padStart(36,'a'),900,'birthday','Festa Exemplo',day(75),'in_production',day(12),day(14));
    sqlite.prepare('INSERT INTO v2_order_pricing(order_id,total_cents,payment_method) VALUES(?,?,?)')
      .run(id,18000,'pix');
    const variant=product==='atelie_essencia'?'atelie_essencia_default':'interactive_base';
    sqlite.prepare(
      'INSERT INTO v2_order_items(order_id,item_type,item_code,name_snapshot,unit_price_cents,configuration_json) VALUES(?,\'product\',?,?,?,?)'
    ).run(id,variant,'Serviço fictício',18000,JSON.stringify({productCode:product}));
    if(stage)sqlite.prepare(
      'INSERT INTO v3_atelie_art_production(order_id,stage,version) VALUES(?,?,0)'
    ).run(id,stage);
  };
  add(9001,'interactive_essential');
  add(9002,'atelie_essencia','creation');
  add(9003,'atelie_essencia');
  return db;
}
test('Fila V3 divide Ateliê e Convites por código do item, sem alterar dados V2',async()=>{
  const db=fixture();
  const before=db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n;
  const all=await listV2Production(db);
  assert.equal(all.length,3);
  assert.deepEqual(all.map(x=>x.service).sort(),['atelie','atelie','convites']);
  const invites=await listV2Production(db,{service:'convites'});
  assert.deepEqual(invites.map(x=>x.code),['LIBRI-9001']);
  assert.equal(invites[0].artStage,null);
  const atelie=await listV2Production(db,{service:'atelie'});
  assert.deepEqual(atelie.map(x=>x.code).sort(),['LIBRI-9002','LIBRI-9003']);
  assert.equal(atelie.find(x=>x.code==='LIBRI-9002').artStage,'creation');
  assert.equal(atelie.find(x=>x.code==='LIBRI-9003').artStage,'briefing');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,before);
});
test('Filtro de etapas identifica criação e briefing, inclusive sem linha prévia de progresso',async()=>{
  const db=fixture();
  const creation=await listV2Production(db,{service:'atelie',artStage:'creation'});
  const briefing=await listV2Production(db,{service:'atelie',artStage:'briefing'});
  assert.deepEqual(creation.map(x=>x.code),['LIBRI-9002']);
  assert.deepEqual(briefing.map(x=>x.code),['LIBRI-9003']);
  const all=await listV2Production(db,{service:'atelie',artStage:'unknown'});
  assert.equal(all.length,2);
});
test('Atalhos para Ateliê e filtros de serviço preservam Admin, Loja e rotas V2',()=>{
  const central=readFileSync('public/js/admin-v2-central.js','utf8');
  const production=readFileSync('public/js/admin-v2-production.js','utf8');
  const nav=readFileSync('public/js/admin-v2.js','utf8');
  const route=readFileSync('src/routes/admin-v2-core.js','utf8');
  assert.match(central,/view=production&service=atelie/);
  assert.match(central,/view=store&storeTab=atelie/);
  assert.match(central,/atelie_essencia/);
  assert.match(production,/productionService/);
  assert.match(production,/productionArtStage/);
  assert.match(production,/requestSequence/);
  assert.match(nav,/state.view !== 'production'/);
  assert.match(route,/get\('service'\)/);
  assert.match(route,/get\('artStage'\)/);
});
