import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store=readFileSync(new URL('../public/js/client-v2-store.js',import.meta.url),'utf8');
const entry=readFileSync(new URL('../public/js/client-v2.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/client-v2.html',import.meta.url),'utf8');
const browser=readFileSync(new URL('./etapa2-browser.mjs',import.meta.url),'utf8');

test('recusar confirmação opcional avança diretamente para os dados sem alterar preço ou adicionais',()=>{
  const continuation=store.slice(store.indexOf('async function continueAfterRecommendation('),
    store.indexOf('function addonGroups('));
  assert.match(continuation,/state\.step\s*=\s*7;/);
  assert.match(continuation,/render\(\)/);
  assert.doesNotMatch(continuation,/updateQuote|refreshDelivery|\/api\/|selection\.addonCodes/);
  const skip=store.slice(store.indexOf("getElementById(\n      'skipFinalOffer'"),
    store.indexOf("getElementById(\n      'acceptFinalOffer'"));
  assert.match(skip,/await continueAfterRecommendation\(state, render\)/);
  assert.doesNotMatch(skip,/loading\(|renderRecommendation\(state, render\)/);
  assert.doesNotMatch(skip,/updateQuote\(|selection\.addonCodes/);
});

test('carrinhos antigos e Safari sem localStorage não obrigam a comprar o upsell',()=>{
  const saved=store.slice(store.indexOf('function readSaved('),store.indexOf('function persist('));
  assert.match(saved,/saved\.customer && typeof saved\.customer === 'object'/);
  assert.match(store,/QuotaExceededError/);
  assert.match(store,/SecurityError/);
  assert.match(store,/NotAllowedError/);
  assert.match(browser,/checkOptionalOfferSkipOnMobile/);
  assert.match(browser,/confirmationUpsell/);
  assert.match(browser,/Storage\.prototype\.setItem/);
});

test('cache atualizado somente no checkout público',()=>{
  assert.match(html,/client-v2\.js\?v=20261111-skip-offer-ios-1/);
  assert.match(entry,/client-v2-store\.js\?v=20261111-skip-offer-ios-1/);
  assert.match(entry,/client-v2-area\.js\?v=20261111-rose-v2-2/);
});
