import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blackLibriEnabled, applyBlackLibriToQuote } from '../src/lib/v2-black-libri.js';

const config = {
  admin_enabled:1,
  compliance_confirmed:1,
  authorization_reference:'PROTOCOLO-TESTE',
  valid_from:'2026-11-20T00:00:00-03:00',
  valid_until:'2026-11-30T23:59:59-03:00'
};
test('Black Libri obedece à ativação e às datas do painel, sem secret',()=>{
  assert.equal(blackLibriEnabled({...config,admin_enabled:0},new Date('2026-11-25T12:00:00Z')),false);
  assert.equal(blackLibriEnabled({...config,valid_from:null},new Date('2026-11-25T12:00:00Z')),false);
  assert.equal(blackLibriEnabled({...config,valid_until:null},new Date('2026-11-25T12:00:00Z')),false);
  assert.equal(blackLibriEnabled({...config,authorization_reference:''},new Date('2026-11-25T12:00:00Z')),false);
  assert.equal(blackLibriEnabled(config,new Date('2026-11-10T12:00:00Z')),false);
  assert.equal(blackLibriEnabled(config,new Date('2026-12-02T12:00:00Z')),false);
  assert.equal(blackLibriEnabled(config,new Date('2026-11-25T12:00:00Z')),true);
});
const quote = method => ({
  subtotalCents:9500,baseTotalCents:9500,totalCents:9500,
  payment:{method,depositPercent:100,depositCents:9500,balanceCents:0}
});
const prize = (kind,value)=>({
  id:'blk_test',prize_code:'test',label:'Benefício de teste',kind,value,description:'',expires_at:'2026-12-01T12:00:00Z'
});

test('R$ 10 reduz o total cobrado pelo servidor em Pix',()=>{
  const adjusted=applyBlackLibriToQuote(quote('pix'),prize('fixed',1000));
  assert.equal(adjusted.totalCents,8500);
  assert.equal(adjusted.payment.depositCents,8500);
  assert.equal(adjusted.blackLibriDiscountCents,1000);
  assert.equal(adjusted.subtotalCents,8500);
});
test('10% reduz valor base e taxa do cartão é recalculada',()=>{
  const adjusted=applyBlackLibriToQuote(quote('card'),prize('percent',10));
  assert.equal(adjusted.baseTotalCents,8550);
  assert.ok(adjusted.totalCents>8550);
  assert.equal(adjusted.payment.depositCents,adjusted.totalCents);
});
test('brinde não altera o valor e fica documentado no snapshot',()=>{
  const adjusted=applyBlackLibriToQuote(quote('pix'),prize('gift',0));
  assert.equal(adjusted.totalCents,9500);
  assert.equal(adjusted.blackLibri.label,'Benefício de teste');
});
test('desconto não gera checkout de valor zero',()=>{
  const adjusted=applyBlackLibriToQuote(quote('pix'),prize('fixed',30000));
  assert.equal(adjusted.totalCents,100);
});

test('catálogo mantém exatamente 19 prêmios e 100% de peso inicial',()=>{
  const migration=readFileSync(new URL('../migrations/0029_black_libri.sql',import.meta.url),'utf8');
  const entries=[...migration.matchAll(/\('([a-z0-9_]+)','[^']+','(?:gift|fixed|percent)',\d+,(\d+),(?:NULL|\d+),/g)];
  assert.equal(entries.length,19);
  assert.equal(entries.reduce((n,row)=>n+Number(row[2]),0),200);
  assert.equal(new Set(entries.map(row=>row[1])).size,19);
  assert.match(migration,/customer_key TEXT NOT NULL UNIQUE/);
  assert.match(migration,/status IN \('reserved','attached','redeemed','expired'\)/);
});

test('Save the Date já contratado vira crédito, sem brinde duplicado',()=>{
  const base={...quote('pix'),
    addons:[{code:'save_static',priceCents:2000,group:'save_the_date'}]};
  const award={...prize('gift',0),prize_code:'save_static',label:'Save the Date estático'};
  const adjusted=applyBlackLibriToQuote(base,award);
  assert.equal(adjusted.blackLibriDiscountCents,2000);
  assert.equal(adjusted.totalCents,7500);
  assert.equal(adjusted.blackLibri.convertedToDiscount,true);
  assert.equal(adjusted.blackLibri.matchingAddonCode,'save_static');
  assert.equal(adjusted.couponDiscountCents,0);
});

test('Lembrete contratado: prêmio estático limita crédito da versão animada',()=>{
  const base={...quote('pix'),
    addons:[{code:'reminder_animated',priceCents:3500,group:'reminder'}]};
  const award={...prize('gift',0),prize_code:'reminder_static',label:'Lembrete estático'};
  const adjusted=applyBlackLibriToQuote(base,award);
  assert.equal(adjusted.blackLibriDiscountCents,2000);
  assert.equal(adjusted.totalCents,7500);
  assert.equal(adjusted.blackLibri.convertedToDiscount,true);
});

test('brinde animado com item estático já comprado dá crédito até o valor pago',()=>{
  const base={...quote('pix'),
    addons:[{code:'save_static',priceCents:2000,group:'save_the_date'}]};
  const award={...prize('gift',0),prize_code:'save_animated'};
  const adjusted=applyBlackLibriToQuote(base,award);
  assert.equal(adjusted.blackLibriDiscountCents,2000);
  assert.equal(adjusted.totalCents,7500);
});

test('filtro e brinde genérico exato: descontar somente adicional já comprado',()=>{
  const base={...quote('pix'),
    addons:[{code:'custom_filter',priceCents:3500,group:'filter'}]};
  const award={...prize('gift',0),prize_code:'photo_filter'};
  const adjusted=applyBlackLibriToQuote(base,award);
  assert.equal(adjusted.blackLibriDiscountCents,3500);
  assert.equal(adjusted.totalCents,6000);
  const absent=applyBlackLibriToQuote({...quote('pix'),addons:[]},award);
  assert.equal(absent.totalCents,9500);
  assert.equal(absent.blackLibri.convertedToDiscount,false);
});

test('crédito respeita preços negociados inferiores, sem checkout zero',()=>{
  const negotiated={...quote('pix'),
    addons:[{code:'save_static',priceCents:1200}]};
  const adjusted=applyBlackLibriToQuote(negotiated,{
    ...prize('gift',0),prize_code:'save_static'
  });
  assert.equal(adjusted.blackLibriDiscountCents,1200);
  const tiny=applyBlackLibriToQuote({...quote('pix'),
    subtotalCents:1500,baseTotalCents:1500,totalCents:1500,
    addons:[{code:'save_static',priceCents:2000}],
    payment:{...quote('pix').payment,depositCents:1500}
  },{...prize('gift',0),prize_code:'save_static'});
  assert.equal(tiny.totalCents,100);
});

test('migração cadastra 20% OFF como vigésimo prêmio raro, sem ativação automática',()=>{
  const add=readFileSync(new URL('../migrations/0032_black_libri_20pct.sql',import.meta.url),'utf8');
  assert.match(add,/off_20p','20% OFF','percent',20,1,3,0/);
  assert.match(add,/UPDATE v2_black_libri_prizes SET sort_order=sort_order\+1/);
});

test('20% OFF reduz o total no Pix, inclusive entrada de 50%',()=>{
  const base={...quote('pix'),
    payment:{method:'pix',depositPercent:50,depositCents:4750,balanceCents:4750}};
  const adjusted=applyBlackLibriToQuote(base,{
    ...prize('percent',20),prize_code:'off_20p',label:'20% OFF'
  });
  assert.equal(adjusted.blackLibriDiscountCents,1900);
  assert.equal(adjusted.baseTotalCents,7600);
  assert.equal(adjusted.totalCents,7600);
  assert.equal(adjusted.payment.depositCents,3800);
  assert.equal(adjusted.payment.balanceCents,3800);
});

test('20% OFF recalcula a taxa no cartão sem alterar o percentual do prêmio',()=>{
  const adjusted=applyBlackLibriToQuote(quote('card'),{
    ...prize('percent',20),prize_code:'off_20p'
  });
  assert.equal(adjusted.blackLibriDiscountCents,1900);
  assert.equal(adjusted.baseTotalCents,7600);
  assert.ok(adjusted.totalCents>7600);
});
