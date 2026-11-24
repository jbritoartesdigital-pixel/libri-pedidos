import test from 'node:test';
import assert from 'node:assert/strict';
import { database, day } from './helpers.mjs';
import {
  findV2DeliveryOptions, validateV2DeliveryWindow,
  planV2AllocationForWindow
} from '../src/lib/v2-agenda.js';
import {
  MIN_PRODUCTION_DAYS_ATELIE_RETRO,
  productionDaysForQuote, productionDaysForStoredQuote
} from '../src/lib/v3-production-policy.js';

test('15 dias para Ateliê e Retrospectivas, sem mexer no convite comum nem em pedidos antigos',()=>{
  assert.equal(MIN_PRODUCTION_DAYS_ATELIE_RETRO,15);
  assert.equal(productionDaysForQuote({product:{code:'atelie_essencia'}}),15);
  assert.equal(productionDaysForQuote({product:{code:'cinematic_video'},addons:[{group:'retrospectiva',code:'retro_070'}]}),15);
  assert.equal(productionDaysForQuote({product:{code:'cinematic_interactive'},addons:[]}),0);
  assert.equal(productionDaysForStoredQuote({product:{code:'cinematic_video'},addons:[{group:'retrospectiva'}]}),0,
    'pedido antigo não muda a reserva sem snapshot explícito');
  assert.equal(productionDaysForStoredQuote({productionDays:15}),15);
});

test('Ateliê somente oferece entregas com 15 dias de antecedência',async()=>{
  const db=database(), eventDate=day(60);
  const opts=await findV2DeliveryOptions(db,{eventDate,pointsUnits:800,productionDays:15,limit:8});
  assert.ok(opts.options.length>0);
  for (const o of opts.options) {
    assert.ok(o.start>=day(15), 'a primeira data da janela deve respeitar 15 dias');
    await assert.doesNotReject(validateV2DeliveryWindow(db,{eventDate,start:o.start,end:o.end,productionDays:15}));
  }
  await assert.rejects(
    validateV2DeliveryWindow(db,{eventDate,start:day(10),end:day(12),productionDays:15}),
    /15 dias corridos/
  );
});

test('pontos de Ateliê são reservados antes da janela de entrega e distribuídos',async()=>{
  const db=database(), eventDate=day(60);
  const result=await findV2DeliveryOptions(db,{eventDate,pointsUnits:800,productionDays:15,limit:5});
  const choice=result.options.find(x=>x.recommended)||result.options[0];
  const plan=await planV2AllocationForWindow(db,{start:choice.start,end:choice.end,pointsUnits:800,productionDays:15});
  assert.equal(plan.fits,true);
  assert.equal(plan.allocation.reduce((sum,x)=>sum+x.pointsUnits,0),800);
  assert.ok(plan.allocation.length>=3,'distribuir em vários dias, não concentrar em janela de 3 dias');
  assert.ok(plan.allocation.every(x=>x.day<choice.start),'produção antecede a entrega');
  assert.ok(plan.allocation.every(x=>x.pointsUnits<=400),'não ultrapassar 4 pontos diários disponíveis');
});
