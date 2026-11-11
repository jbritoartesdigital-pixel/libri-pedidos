import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store=readFileSync(new URL('../public/js/client-v2-store.js',import.meta.url),'utf8');
const admin=readFileSync(new URL('../public/js/admin-v2-black-libri.js',import.meta.url),'utf8');
const demo=readFileSync(new URL('../public/js/black-libri-demo.js',import.meta.url),'utf8');
const shell=readFileSync(new URL('../public/client-v2.html',import.meta.url),'utf8');

test('a ativação é consultada no clique, não somente no carregamento inicial',()=>{
  const terms=store.slice(store.indexOf('function renderTerms('),
    store.indexOf('function renderBriefingSimulation('));
  assert.match(terms,/const live=await api\('\/api\/v2\/black-libri\/info',\{cache:'no-store'\}\)/);
  assert.match(terms,/state\.blackLibriEnabled=live\.enabled===true/);
  assert.match(terms,/if \(state\.blackLibriEnabled\) \{/);
  assert.match(terms,/await openBlackLibriBeforePayment\(/);
  assert.match(terms,/checkoutNow\(\)/);
});
test('simular passa pelo modal demonstrativo sem chamar o sorteio real',()=>{
  const terms=store.slice(store.indexOf('function renderTerms('),
    store.indexOf('function renderBriefingSimulation('));
  assert.match(terms,/if \(state\.simulationMode\) \{[\s\S]*?await openBlackLibriDemo\(\{onContinue:/);
  assert.match(demo,/MODO DE TESTE • Sem participação real • Sem pagamento/);
  assert.doesNotMatch(demo,/\/api\/v2\/black-libri\/(?:reveal|preview|status)/);
  assert.doesNotMatch(demo,/fetch\(|localStorage|sessionStorage/);
});
test('admin oferece prévia independente sem cobrar nem reservar',()=>{
  assert.match(admin,/id="blackDemo"/);
  assert.match(admin,/openBlackLibriDemo\(\)/);
  assert.match(demo,/data-demo-slot/);
  assert.match(demo,/Fechar prévia/);
});
test('client HTML aponta para o novo módulo em cache separado',()=>{
  const entry=readFileSync(new URL('../public/js/client-v2.js',import.meta.url),'utf8');
  assert.match(shell,/\/js\/client-v2\.js\?v=20261111-skip-offer-ios-1/);
  assert.match(entry,/client-v2-store\.js\?v=20261111-skip-offer-ios-1/);
  assert.match(store,/black-libri-demo\.js\?v=20261111-rose-v2-2/);
});


test('Rose Edition keeps server reveal, pop sound and stored gift re-opening',()=>{
 const live=readFileSync(new URL('../public/js/client-v2-black-libri.js',import.meta.url),'utf8');
 const area=readFileSync(new URL('../public/js/client-v2-area.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/lib/v2-customer-area.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/css/client-v2-black-libri.css',import.meta.url),'utf8');
 assert.match(live,/playBalloonPop\(soundOn\)/);
 assert.match(live,/window\.AudioContext/);
 assert.match(live,/Resgatar meu presente/);
 assert.match(live,/onContinue\(claim\)/);
 assert.match(live,/openBlackLibriPrizeDetails/);
 assert.match(area,/id="viewBlackLibriPrize"/);
 assert.match(store,/id="manualViewBlackLibriPrize"/);
 assert.match(server,/blackLibri: pricingSnapshot\.blackLibri/);
 assert.match(css,/grid-template-columns:repeat\(3/);
 assert.doesNotMatch(css,/#111017|#e9b25d/);
});


test('Rosé V2 mantém quatro colunas e o sorteio original',()=>{
 const live=readFileSync(new URL('../public/js/client-v2-black-libri.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/css/client-v2-black-libri.css',import.meta.url),'utf8');
 assert.match(live,/class="black-libri-campaign"/);
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/clip-path:polygon/);
 assert.match(live,/playBalloonPop\(soundOn\)/);
 assert.match(live,/api\(endpoint\+'\/reveal'/);
 assert.match(live,/onContinue\(claim\)/);
});
