import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day } from './helpers.mjs';
import { findV2DeliveryOptions, validateV2DeliveryWindow } from '../src/lib/v2-agenda.js';

test('janelas aparecem em ordem cronológica, inclusive as anteriores à recomendada', async () => {
  const DB = database();
  const eventDate = day(65);
  const optionsResult = await findV2DeliveryOptions(DB, {
    eventDate,
    pointsUnits: 100,
    limit: 8,
  });
  const { options } = optionsResult;

  assert.equal(optionsResult.recommendedTargetDate, day(25),
    'a recomendação usa a antecedência comercial de 40 dias');
  assert.equal(options.length, 8);
  assert.equal(options.filter(option => option.recommended).length, 1);

  const starts = options.map(option => option.start);
  assert.deepEqual(starts, [...starts].sort(),
    'as datas são ordenadas do dia mais cedo até o dia mais tarde');

  const recommended = options.find(option => option.recommended);
  assert.ok(options.some(option => option.start < recommended.start),
    'oferecer janelas anteriores mesmo quando a recomendada é posterior');
  assert.ok(options.some(option => option.start > recommended.start),
    'oferecer janelas posteriores igualmente');
  assert.notEqual(options[0].recommended, true,
    'a primeira data da lista não precisa ser a recomendada');

  for (const option of options) {
    await assert.doesNotReject(validateV2DeliveryWindow(DB, {
      eventDate,
      start: option.start,
      end: option.end,
    }));
  }
});

test('escolha cronológica não converte recomendação em restrição nem muda o visual da seleção', () => {
  const store = readFileSync('public/js/client-v2-store.js', 'utf8');
  const admin = readFileSync('public/js/admin-v2-manual.js', 'utf8');
  const agenda = readFileSync('src/lib/v2-agenda.js', 'utf8');
  const quoteStep = store.slice(store.indexOf('function renderDelivery('), store.indexOf('function renderAddons('));

  assert.match(agenda, /candidate === recommendedCandidate/);
  assert.match(agenda, /a\.start - b\.start/);
  assert.match(quoteStep, /\.start\.localeCompare\(b\.start\)/);
  assert.match(quoteStep, /inclusive anterior à recomendada/);
  assert.match(quoteStep, /option\.recommended/);
  assert.match(quoteStep, /name="delivery"/);
  assert.match(quoteStep, /state\.deliveryWindow = \{/);
  assert.match(admin, /const preferredWindow/);
  assert.match(admin, /option\.start === preferredWindow\?\.start/);
});
