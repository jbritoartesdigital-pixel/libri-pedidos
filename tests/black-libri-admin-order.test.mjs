import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeBlackLibriAwards } from '../public/js/admin-v2-black-libri-prize.js';

test('admin identifies free gift from the actual order item', () => {
  assert.deepEqual(summarizeBlackLibriAwards([
    {itemCode:'product',name:'Convite',itemType:'product',unitPriceCents:9500},
    {itemCode:'black_libri:save_animated',name:'Brinde Black Libri: Save the Date animado',
      itemType:'addon',unitPriceCents:0}
  ]),[{code:'save_animated',label:'Save the Date animado',amountCents:0,kind:'gift'}]);
});

test('admin identifies discount with its actual value', () => {
  assert.deepEqual(summarizeBlackLibriAwards([
    {itemCode:'black_libri:off_15',name:'Desconto Black Libri: R$ 15 de desconto',
      itemType:'combo_adjustment',unitPriceCents:-1500}
  ]),[{code:'off_15',label:'R$ 15 de desconto',amountCents:1500,kind:'discount'}]);
});

test('existing purchased gift converted into credit is not reported as an extra gift', () => {
  assert.deepEqual(summarizeBlackLibriAwards([
    {itemCode:'black_libri:save_static',name:'Desconto Black Libri: Save the Date estático',
      itemType:'combo_adjustment',unitPriceCents:-2000}
  ]),[{code:'save_static',label:'Save the Date estático',amountCents:2000,kind:'converted_gift'}]);
});

test('no Black Libri banner for a non-participating order', () => {
  assert.deepEqual(summarizeBlackLibriAwards(null),[]);
  assert.deepEqual(summarizeBlackLibriAwards([]),[]);
  assert.deepEqual(summarizeBlackLibriAwards([
    {itemCode:'save_static',name:'Save the Date',itemType:'addon',unitPriceCents:2000}
  ]),[]);
});

test('order detail displays award from items with escaped prize labels and versioned assets', () => {
  const ui=readFileSync('public/js/admin-v2-order.js','utf8');
  const entry=readFileSync('public/js/admin-v2.js','utf8');
  const shell=readFileSync('public/admin-v2.html','utf8');
  assert.match(ui,/const awards = summarizeBlackLibriAwards\(detail\.items\)/);
  assert.match(ui,/\$\{esc\(award\.label\)\}/);
  assert.match(ui,/Brinde convertido em crédito/);
  assert.match(ui,/não produzir em duplicidade/);
  assert.match(ui,/\$\{blackLibriPrizeBlock\(detail\)\}/);
  assert.match(entry,/admin-v2-order\.js\?v=20261113-deposit-exception-1/);
  assert.match(shell,/admin-v2\.js\?v=20261113-deposit-exception-1/);
});
