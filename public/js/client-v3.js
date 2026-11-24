import {trackStoreStage} from './store-funnel.js';
import {pendingV3CheckoutKey,mountV3PaymentRecovery} from './client-v3-payment-recovery.js';
import { mountV3Checkout } from './client-v3-checkout.js';
import { mountAtelieCheckout } from './client-v3-atelie-checkout.js';
// Libri Pedidos V3: convites integrados à V2; Ateliê libera compra por pacote configurado.
// O catálogo, os preços e o cálculo de descontos permanecem nas APIs V2.
// A etapa de pagamento continua exclusivamente no fluxo V2 existente.
const root = document.getElementById('v3-app');
const modalRoot = document.getElementById('v3-modal');
const STORE_KEY = 'libriV3Draft';
const V2_KEY = 'libriV2StoreState';
const EVENTS = [
  ['birthday', 'Aniversário', 'Uma comemoração cheia de personalidade.'],
  ['15_years', 'Festa de 15 anos', 'Uma celebração para guardar na memória.'],
  ['wedding', 'Casamento', 'Cada detalhe de um dia especial.'],
  ['celebration', 'Chá ou celebração', 'Chá de bebê, revelação e outros momentos.'],
  ['other', 'Outro evento', 'Vamos encontrar um formato para você.']
];
const PRODUCTS = {
  cinematic_video: {
    title: 'Cinematográfico em Vídeo',
    description: 'A criança ou homenageado pode virar personagem de uma história feita para a festa, com cenários e animações personalizados. Você envia o vídeo pelo WhatsApp.'
  },
  cinematic_interactive: {
    title: 'Cinematográfico Interativo',
    description: 'É a história animada personalizada e, no final, uma tela com botões para os convidados verem o caminho, confirmarem presença ou consultarem presentes.'
  },
  interactive_essential: {
    title: 'Interativo Essencial',
    description: 'Você envia pelo WhatsApp. O convidado toca na mensagem, abre o convite no celular e encontra até 3 botões já incluídos para acessar informações da festa.'
  },
  interactive_gif: {
    title: 'Interativo GIF',
    description: 'O convite abre na tela do celular, com detalhes que se movimentam sem parar e até 3 botões já incluídos para ajudar os convidados.'
  },
  interactive_animated: {
    title: 'Interativo com Abertura Animada',
    description: 'Uma pequena animação revela seu convite. Depois, os convidados encontram as informações e até 3 botões já incluídos.'
  },
  book: {
    title: 'Convite em Livro',
    description: 'Um convite de casamento que abre como um livro. Os convidados passam pelas páginas para conhecer os detalhes.'
  },
  infinite: {
    title: 'Convite Infinito',
    description: 'As informações aparecem uma após a outra conforme o convidado desliza a tela para baixo.'
  }
};
const ADDON_GROUPS = [
  ['save_the_date', 'Save the Date', 'Uma arte extra para avisar a data da festa com antecedência.'],
  ['reminder', 'Lembrete da festa', 'Uma arte para enviar quando a comemoração estiver chegando.'],
  ['confirmation', 'Confirmação Libri', 'Os convidados preenchem a confirmação no próprio convite. Você acompanha as respostas em um painel.'],
  ['moments', 'Libri Moments', 'Um espaço digital para reunir as fotos da festa. O filtro da câmera Libri já vem incluído.'],
  ['filter', 'Filtro de fotos personalizado', 'Um efeito com o tema da festa para tirar fotos na câmera Libri.']
];
const INTERACTIVE = new Set([
  'cinematic_interactive', 'interactive_essential', 'interactive_gif',
  'interactive_animated', 'book', 'infinite'
]);
const SCENE_PRODUCTS = new Set(['cinematic_video', 'cinematic_interactive']);
const money = cents => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(Number(cents || 0)/100);
const clean = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let catalog = null, quote = null, offer = null, cartQuote = null, cartError = '', ateliePackages = [], retrosPackages = [];
let cartDelivery=null,cartDeliveryError='',cartEventDate='',cartDeliveryBusy=false,cartRevision=0,cartOpenDetails=new Set();
let state;
try {
  state = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
} catch {
  state = null;
}
if (!state || typeof state !== 'object') state = {};
state = {
  eventType: '', creation: '', intent: '', productCode: '', variantCode: '',
  addonCodes: [], ateliePackage: '', step: 'event', offerFinished: false, dismissed: [], cartItems: [],
  ...state
};
if (!Array.isArray(state.addonCodes)) state.addonCodes = [];
if (!Array.isArray(state.dismissed)) state.dismissed = [];
// Store selection identifiers only: no personal data, prices or payment authority.
state.cartItems = Array.isArray(state.cartItems) ? state.cartItems.filter(x=>x&&typeof x.productCode==='string'&&typeof x.variantCode==='string'&&Array.isArray(x.addonCodes)).slice(0,3) : [];
const cartFamily = code => code.startsWith('atelie_')?'identity':/^retrospectiva(?:_|$)/.test(code)?'retrospective':'invitation';
function putCart(item) {
  state.cartItems = state.cartItems.filter(x=>cartFamily(x.productCode)!==cartFamily(item.productCode)).concat(item);
  save();
}
function cartButton(){return state.cartItems.length?'<div class="v3-action-row"><button type="button" class="v3-btn v3-btn-secondary" data-action="open-cart">Ver meu carrinho ('+state.cartItems.length+')</button></div>':'';}
const getProduct = code => (catalog?.products || []).find(item => item.code === code);
const getAddon = code => (catalog?.addons || []).find(item => item.code === code);
const currentProduct = () => getProduct(state.productCode);
const currentVariant = () => currentProduct()?.variants.find(item => item.code === state.variantCode);
const groupCode = code => getAddon(code)?.group;
const hasGroup = group => state.addonCodes.some(code => groupCode(code) === group);
const labelForEvent = () => EVENTS.find(x => x[0] === state.eventType)?.[1] || 'Seu evento';
const selectedAddons = () => state.addonCodes.map(getAddon).filter(Boolean);
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch { /* O navegador pode bloquear o armazenamento. A sessão continua ativa. */ }
}
function message(text) {
  root.innerHTML = '<section class="v3-panel"><span class="v3-eyebrow">Libri Convites</span><h1 class="v3-title">Não conseguimos continuar</h1><p class="v3-text">' + clean(text) + '</p><div class="v3-action-row"><a class="v3-btn v3-btn-secondary" href="/pedido">Abrir a loja atual</a><button type="button" class="v3-btn v3-btn-primary" data-action="retry">Tentar novamente</button></div></section>';
  root.setAttribute('aria-busy', 'false');
}
async function request(path, body) {
  const response = await fetch(path, body ? {
    method: 'POST', credentials: 'same-origin',
    headers: {'content-type':'application/json'}, body: JSON.stringify(body)
  } : {credentials:'same-origin'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || 'Não foi possível carregar os dados agora.');
  return data;
}
function selection(overrides = {}) {
  return {
    productCode: state.productCode,
    variantCode: state.variantCode,
    addonCodes: [...state.addonCodes],
    comboCode: '',
    couponCode: '',
    paymentMethod: 'pix',
    ...overrides
  };
}
function moneyBase() {
  return Number(quote?.productCents || 0) + Number(quote?.addonsCents || 0);
}
function comboEligible(combo, addonCodes, productCode) {
  const groups = new Set(addonCodes.map(groupCode).filter(Boolean));
  return (combo.items || []).filter(item => item.required !== false).every(item =>
    (item.itemType === 'addon_group' && groups.has(item.itemCode)) ||
    (item.itemType === 'addon' && addonCodes.includes(item.itemCode)) ||
    (item.itemType === 'main_product' && productCode === item.itemCode));
}
function comboDiscount(combo, cents) {
  if (!combo || Number(combo.discountValue || 0) <= 0) return 0;
  const raw = combo.discountType === 'percent'
    ? Math.round(cents * Number(combo.discountValue) / 100)
    : Number(combo.discountValue);
  return Math.min(cents, Math.max(0, raw));
}
function bestCombo(productCode, addonCodes, baseCents) {
  return (catalog?.combos || [])
    .filter(c => comboEligible(c, addonCodes, productCode))
    .map(c => ({code:c.code, discount:comboDiscount(c, baseCents)}))
    .sort((a,b) => b.discount - a.discount)[0] || null;
}
async function priceFor(productCode, variantCode, addonCodes) {
  const product = getProduct(productCode), variant = product?.variants.find(x => x.code === variantCode);
  if (!variant) throw new Error('A configuração escolhida não está disponível.');
  const baseCents = Number(variant.priceCents) + addonCodes.reduce((sum, code) => sum + Number(getAddon(code)?.priceCents || 0), 0);
  const combo = bestCombo(productCode, addonCodes, baseCents);
  const data = await request('/api/v2/quote', {
    eventType: state.eventType,
    selection: {
      productCode, variantCode, addonCodes,
      comboCode: combo?.discount > 0 ? combo.code : '',
      couponCode:'', paymentMethod:'pix'
    }
  });
  return data.quote;
}
async function refreshQuote() {
  if (!state.productCode || !state.variantCode) {quote = null;return;}
  quote = await priceFor(state.productCode, state.variantCode, state.addonCodes);
}
const stepNames=['Evento','Serviço','Escolhas','Personalização','Carrinho'];
const symbols={invitation:'mail',identity:'palette',retrospective:'film',birthday:'cake','15_years':'sparkles',wedding:'heart',celebration:'gift',other:'star',story:'film',simple:'mail'};
function choiceIcon(kind){const icons={mail:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',palette:'<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.8h2A4 4 0 0 0 21 10c0-4-4-7-9-7Z"/><path d="M7 11h.01M10 7h.01M15 7h.01" stroke-width="3"/>',film:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 12h4m10 0h4m-11-3 4 3-4 3Z"/>',cake:'<path d="M4 13h16v7H4zM2 20h20M4 13l4 3 4-3 4 3 4-3M8 9V6m4 3V5m4 4V6"/>',heart:'<path d="M12 21 4 13C-2 6 7 1 12 8c5-7 14-2 8 5Z"/>',gift:'<rect x="4" y="10" width="16" height="11" rx="1"/><path d="M3 6h18v4H3zM12 6v15M12 6C3-1 4 7 12 6c9-7 8 1 0 0Z"/>',star:'<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',sparkles:'<path d="m12 2 2 7 7 3-7 3-2 7-2-7-7-3 7-3Z"/>'};return icons[kind]?'<span class="v3-choice-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+icons[kind]+'</svg></span>':'';}
function stepBar(index) {
  return '<div class="v3-progress" aria-label="Etapa '+(index+1)+' de 5"><div class="v3-progress-label"><span>'+stepNames[index]+'</span><span>'+(index+1)+' de 5</span></div><div class="v3-steps" aria-hidden="true">'+Array.from({length:5},(_,i)=>'<span class="'+(i<=index?'is-active':'')+'"></span>').join('')+'</div></div>';
}
function panel(title, subtitle, content, buttons, index=0) {
  root.innerHTML = '<section class="v3-panel v3-stage-'+clean(state.step)+'">' + stepBar(index) +
    '<span class="v3-eyebrow">Libri Convites · seu pedido</span>' +
    '<h1 class="v3-title">' + title + '</h1><p class="v3-text">' + subtitle + '</p>' +
    content + (buttons || '') + '</section>';
  root.setAttribute('aria-busy','false');
}
function actions(back, nextText, nextAction = 'next') {
  return '<div class="v3-action-row">' +
    (back ? '<button class="v3-btn v3-btn-text" type="button" data-action="back">Voltar</button>' : '<span></span>') +
    '<button class="v3-btn v3-btn-primary" type="button" data-action="' + nextAction + '">' + clean(nextText) + '</button></div>';
}
function choice(value, title, subtitle, current, action, price) {
  return '<button type="button" class="v3-choice ' + (current === value ? 'is-selected' : '') +
    '" data-action="' + action + '" data-value="' + clean(value) + '" aria-pressed="' + (current===value) + '">' +
    choiceIcon(symbols[value])+'<span class="v3-choice-copy"><strong>'+clean(title)+'</strong>'+(subtitle?'<small>'+clean(subtitle)+'</small>':'')+(price!=null?'<span class="v3-price"><small>'+(action==='product'&&SCENE_PRODUCTS.has(value)?'A partir de ':'Total ')+'</small>'+money(price)+'</span>':'')+'</span><span class="v3-choice-check" aria-hidden="true"></span></button>';
}
function intro() {
  root.innerHTML = '<section class="v3-panel v3-panel--entrance">' +
    '<div class="v3-entrance-emblem" aria-hidden="true"><span>L</span></div>' +
    '<span class="v3-eyebrow">Libri Convites</span>' +
    '<h1 class="v3-title">Toda celebração começa com uma história.</h1>' +
    '<p class="v3-text">Uma experiência criada especialmente para você.</p>' +
    '<button class="v3-btn v3-btn-text" type="button" data-action="skip-intro">Pular abertura</button></section>';
}
function renderEvent() {
  panel('Qual é o seu evento?', 'Assim mostramos os formatos que fazem mais sentido para a sua comemoração.',
    '<div class="v3-grid">' + EVENTS.map(item => choice(item[0],item[1],item[2],state.eventType,'event')).join('') + '</div>',
    actions(false,'Continuar'),0);
}
function renderCreation() {
  panel('O que gostaria de criar?',
    'Escolha um serviço para começar. Você pode reunir outros no mesmo pedido.',
    '<div class="v3-choices-stack">' +
    choice('invitation','Convites Digitais','Histórias em vídeo ou convites que abrem no celular e ajudam os convidados.',state.creation,'creation') +
    choice('identity','Identidade Visual para Festas | Libri Ateliê',
      'Criamos a aparência personalizada da festa: brasão, nome decorado, cores, personagens, elementos e estampas conforme o pacote.',state.creation,'creation') +
    choice('retrospective','Retrospectiva de fotos e vídeos',
      'Uma homenagem em vídeo com suas lembranças, músicas e dedicatória. Você escolhe conforme a quantidade de fotos e vídeos.',state.creation,'creation') +
    '</div>'+cartButton(),
    actions(true,'Continuar'),1);
}
function renderUnready() {
  const cards=retrosPackages.map(item=>
    '<article class="v3-package-card"><div class="v3-package-heading"><strong>'+clean(item.name)+'</strong>'+(item.previewAvailable?'<b>'+money(item.previewPriceCents)+'</b>':'')+'</div>'+
    '<div class="v3-package-facts"><span><b>'+Number(item.maxPhotos)+'</b> fotos</span><span><b>'+Number(item.maxVideos)+'</b> vídeos</span></div><p class="v3-mini">Até '+Number(item.maxVideoSeconds)+' s por vídeo · '+Number(item.maxTotalVideoSeconds)/60+' min no conjunto.</p>'+
    '<details><summary>Ver o que está incluído</summary><ul>'+item.included.map(x=>'<li>'+clean(x)+'</li>').join('')+'</ul></details>'+
    (item.previewAvailable?'<button type="button" class="v3-btn v3-btn-primary" data-action="retro-buy" data-value="'+clean(item.code)+'">Adicionar ao carrinho</button>':'<p class="v3-mini">Pacote indisponível.</p>')+'</article>'
  ).join('');
  panel('Retrospectivas','Uma homenagem em vídeo, com suas fotos, músicas e lembranças.',
    '<div class="v3-notice">Envie os materiais organizados pelo WhatsApp após a contratação. Prazo mínimo de 15 dias corridos após pagamento, briefing completo e recebimento dos materiais.</div>'+
    '<div class="v3-package-grid">'+(cards||'<p>Os pacotes ainda estão em configuração.</p>')+'</div>'+cartButton(),
    '<div class="v3-action-row"><button type="button" class="v3-btn v3-btn-text" data-action="back">Voltar</button></div>',1);
}
function renderAtelie() {
  const cards = ateliePackages.map(item =>
    '<button type="button" class="v3-choice '+(item.code===state.ateliePackage?'is-selected':'')+
      '" data-action="atelie-package" data-value="'+clean(item.code)+'" aria-pressed="'+(item.code===state.ateliePackage)+'">'+
      '<span class="v3-choice-copy"><strong>'+clean(item.name)+'</strong><small>'+clean(item.shortDescription)+'</small>'+
      '<span class="v3-price">'+(item.purchaseAvailable?money(item.priceCents):'Consultar detalhes')+'</span></span><span class="v3-choice-check" aria-hidden="true"></span></button>'
  ).join('');
  panel('Sua festa, com tudo combinando',
    'A identidade visual é o conjunto de artes que dá a mesma aparência ao brasão, ao nome decorado, às estampas e aos detalhes da festa. Não é um convite digital.',
    '<div class="v3-notice"><strong>Todos os pacotes:</strong> uma apresentação da identidade visual em PDF. Não inclui projeto ou simulação de decoração.</div>'+
      '<div class="v3-choices-stack">'+(cards||'<p>Pacotes em preparação. Nenhuma contratação está disponível.</p>')+'</div>'+
      '<p class="v3-mini" style="margin-top:16px">Não inclui impressão ou fabricação, montagem da festa nem convite em vídeo ou interativo. Peças especiais, personagens elaborados a partir de fotos e alterações grandes precisam de orçamento individual.</p>',
    '<div class="v3-action-row"><button class="v3-btn v3-btn-text" type="button" data-action="back">Voltar</button>'+
      '<button class="v3-btn v3-btn-primary" type="button" data-action="atelie-detail" '+(!state.ateliePackage?'disabled':'')+'>Conhecer pacote</button></div>',2);
}
function renderAtelieDetail() {
  const item = ateliePackages.find(p=>p.code===state.ateliePackage);
  if (!item) {state.step='atelie';renderAtelie();return;}
  const includes=item.scopeApproved&&item.includedItems.length
    ? '<ul class="v3-included">'+item.includedItems.map(x=>'<li>'+clean(x)+'</li>').join('')+'</ul>'
    : '<p class="v3-text">Os itens e quantidades exatos ainda aguardam aprovação do catálogo oficial. Não vamos prometer entregas antes disso.</p>';
  const exclusions=[...(item.excludedCommon||[]),...(item.excludedItems||[])];
  const excluded='<ul class="v3-mini">'+exclusions.map(x=>'<li>'+clean(x)+'</li>').join('')+'</ul>';
  panel('Pacote '+clean(item.name),clean(item.shortDescription),
    '<div class="v3-notice"><strong>Já previsto em todos os pacotes:</strong><p>Apresentação da identidade visual em PDF.</p></div>'+
    '<h2 class="v3-title" style="font-size:23px">O que você recebe</h2>'+includes+
    '<details class="v3-terms-disclosure"><summary>O que não está incluído</summary>'+excluded+'</details>'+
    '<div class="v3-notice">'+(item.purchaseAvailable?'<strong>Pacote liberado: '+money(item.priceCents)+'</strong> · Você verá a agenda e o total antes do pagamento.':'<strong>Compra ainda não liberada.</strong> Os valores e condições aguardam aprovação comercial.')+' Fotos de crianças não são autorização de divulgação.</div>'+ 
    '',
    '<div class="v3-action-row"><button class="v3-btn v3-btn-text" type="button" data-action="back">Comparar pacotes</button>'+
    '<button class="v3-btn '+(item.purchaseAvailable?'v3-btn-primary':'v3-btn-secondary')+'" type="button" '+(item.purchaseAvailable?'data-action="atelie-buy"':'disabled')+'>'+(item.purchaseAvailable?'Adicionar ao carrinho':'Contratação em preparação')+'</button></div>',3);
}
function renderIntent() {
  panel('Como imagina seu convite?',
    'Não precisa conhecer os nomes dos modelos. Escolha o que gostaria que seus convidados recebessem.',
    '<div class="v3-choices-stack">' +
      choice('story','Uma história animada','Um vídeo com personagens, cenários e animações criados especialmente para o evento.',state.intent,'intent') +
      choice('simple','Um convite mais simples','Uma arte no celular, com informações da festa e botões para os convidados usarem.',state.intent,'intent') +
    '</div>',actions(true,'Ver formatos'),2);
}
function formatCodes() {
  if (state.intent === 'story') return ['cinematic_video','cinematic_interactive'];
  const codes = ['interactive_essential','interactive_gif','interactive_animated'];
  if (state.eventType === 'wedding') codes.push('book','infinite');
  if (state.eventType === '15_years' || state.eventType === 'other') codes.push('infinite');
  return codes;
}
function renderFormats() {
  const codes = formatCodes().filter(code => getProduct(code));
  panel('Escolha o formato', state.intent === 'story'
    ? 'Em todos os cinematográficos, a história, os cenários e personagens são personalizados.'
    : 'O convidado recebe a mensagem pelo WhatsApp, toca para abrir e vê o convite na tela do celular.',
    '<div class="v3-choices-stack">' + codes.map(code => {
      const product = getProduct(code), detail = PRODUCTS[code];
      return choice(code,detail?.title || product.name,detail?.description || product.shortDescription,
        state.productCode,'product',product.variants[0]?.priceCents);
    }).join('') + '</div>',
    actions(true,SCENE_PRODUCTS.has(state.productCode) ? 'Escolher cenas' : 'Continuar'),2);
}
function renderScenes() {
  const product = currentProduct();
  if (!product || product.pricingMode !== 'scene_count') {state.step='extras';render();return;}
  const options = product.variants.filter(item => Number.isInteger(Number(item.sceneCount))).sort((a,b)=>a.sceneCount-b.sceneCount);
  panel('Quantas cenas gostaria?', 'Cada cena mostra um momento da história. A abertura já vem incluída e não entra nessa contagem.',
    '<div class="v3-grid">' + options.map(item => {
      const label = String(item.sceneCount) + (Number(item.sceneCount)===1 ? ' cena' : ' cenas');
      const sub = Number(item.sceneCount)===3 ? 'Uma história mais curtinha · sugestão Libri' :
        Number(item.sceneCount)===6 ? 'Uma história mais completa · sugestão Libri' : '';
      return choice(item.code,label,sub,state.variantCode,'variant',item.priceCents);
    }).join('') + '</div>',actions(true,'Continuar'),3);
}
function availableGroups() {
  return ADDON_GROUPS.filter(item => {
    if (item[0] === 'confirmation' && !INTERACTIVE.has(state.productCode)) return false;
    if (item[0] === 'filter' && hasGroup('moments')) return false;
    if (item[0] === 'filter' && !(catalog.addons || []).some(a => a.group === 'filter')) return false;
    return catalog.addons.some(a => a.group === item[0]);
  });
}
function addonCard(group) {
  const checked = selectedAddons().filter(a => a.group === group[0]);
  const detail = checked.map(a=>a.name).join(', ');
  return '<button class="v3-choice ' + (checked.length ? 'is-selected':'') + '" data-action="addon-group" data-value="' + clean(group[0]) + '">' +
    '<strong>' + clean(group[1]) + '</strong><small>' + clean(detail || group[2]) + '</small>' +
    (checked.length ? '<span class="v3-price">' + money(checked.reduce((sum,a)=>sum+Number(a.priceCents),0)) + ' · Alterar</span>' : '<span class="v3-mini">Ver opções e valores</span>') +
    '</button>';
}
function priceBar() {
  return quote ? '<div class="v3-total"><div><strong>Total até agora</strong><div><small>Calculado pelo catálogo oficial · Pix</small></div></div><b>' + money(quote.totalCents) + '</b></div>' : '';
}
const ADDON_QUESTIONS={
 save_the_date:'Quer avisar a data antes de enviar o convite?',
 reminder:'Quer lembrar seus convidados quando a festa estiver chegando?',
 confirmation:'Como gostaria de acompanhar as confirmações?',
 moments:'Quer guardar as fotos que seus convidados tirarem na festa?',
 filter:'Quer um filtro de fotos personalizado com o tema da festa?'
};
function renderExtras(){
 const groups=availableGroups();
 if(!groups.length){panel('Seu convite está pronto para conferir','Nenhum adicional disponível para este formato.',priceBar(),actions(true,'Conferir meu pedido'),3);return;}
 const i=Math.max(0,Math.min(groups.length-1,Number(state.addonQuestion)||0));
 state.addonQuestion=i;
 const g=groups[i],group=g[0],selected=selectedAddons().find(a=>a.group===group);
 const variants=(catalog.addons||[]).filter(a=>a.group===group);
 const free=group==='confirmation'?'<div class="v3-notice"><strong>WhatsApp · sem custo</strong><p>O convidado abre uma mensagem pronta e envia pelo WhatsApp. Você recebe as respostas na conversa, sem painel de convidados.</p></div>':'';
 const choiceList=variants.map(a=>choice(a.code,a.name,group==='confirmation'?'Confirmação pelo próprio convite, com painel de respostas.':a.config?.photoLimit?'Até '+a.config.photoLimit+' fotos':a.code.endsWith('_animated')?'Com movimento':a.code.endsWith('_static')?'Sem movimento':'',selected?.code,'guided-addon',a.priceCents)).join('');
 panel(ADDON_QUESTIONS[group]||g[1],g[2],
  '<div class="v3-guided-question"><span class="v3-eyebrow">Personalize seu convite · '+(i+1)+' de '+groups.length+'</span>'+free+'<div class="v3-choices-stack">'+choiceList+choice(group,group==='confirmation'?'Continuar com WhatsApp':'Agora não','Sem adicionar custo',selected?null:group,'guided-skip')+'</div></div>'+priceBar(),
  '<div class="v3-action-row"><button type="button" class="v3-btn v3-btn-text" data-action="guided-back">Voltar</button><button type="button" class="v3-btn v3-btn-secondary" data-action="guided-finish">Conferir meu pedido</button></div>',3);
}
async function advanceGuided(group,code){
 const groups=availableGroups(),index=groups.findIndex(g=>g[0]===group);
 if(index<0)return;
 if(code){const a=getAddon(code);if(!a||a.group!==group)return;}
 const before=[...state.addonCodes],dismissed=[...state.dismissed];
 state.addonCodes=state.addonCodes.filter(c=>groupCode(c)!==group);
 if(code){if(group==='moments')state.addonCodes=state.addonCodes.filter(c=>groupCode(c)!=='filter');state.addonCodes.push(code);}
 else if(!state.dismissed.includes('addon:'+group))state.dismissed.push('addon:'+group);
 try{await refreshQuote();}catch(e){state.addonCodes=before;state.dismissed=dismissed;throw e;}
 state.offerFinished=false;
 const next=availableGroups().findIndex(g=>groups.slice(index+1).some(old=>old[0]===g[0]));
 if(next<0){state.addonQuestion=0;await go('review');}
 else{state.addonQuestion=next;render();window.scrollTo({top:0,behavior:'auto'});}
}
function linesHtml() {
  let all = [
    ['Convite', (PRODUCTS[state.productCode]?.title || currentProduct()?.name || '') +
      (currentVariant()?.sceneCount ? ' · ' + currentVariant().sceneCount + ' cenas' : ''),quote?.productCents]
  ];
  all = all.concat(selectedAddons().map(a=>['Adicional',a.name,a.priceCents]));
  let html = '<div class="v3-lines">' + all.map(x=>'<div class="v3-line"><span>'+clean(x[1])+'</span><b>'+money(x[2])+'</b></div>').join('') + '</div>';
  if (Number(quote?.comboDiscountCents || 0)>0) html += '<div class="v3-line"><span>Desconto de combo aplicado</span><b>− '+money(quote.comboDiscountCents)+'</b></div>';
  return html;
}
function offerHtml() {
  if (!offer || state.offerFinished) return '';
  return '<div class="v3-notice"><span class="v3-eyebrow">Uma sugestão que combina com seu pedido</span>' +
    '<strong>' + clean(offer.title) + '</strong><p>' + clean(offer.description) + '</p>' +
    '<p><b>' + (offer.delta >= 0 ? 'Por mais ' + money(offer.delta) : 'Economize ' + money(-offer.delta)) + '</b> no total do pedido.</p>' +
    '<div class="v3-action-row"><button class="v3-btn v3-btn-text" type="button" data-action="dismiss-offer">Agora não</button>' +
    '<button class="v3-btn v3-btn-primary" type="button" data-action="accept-offer">Quero adicionar</button></div></div>';
}
function renderReview() {
  panel('Seu pedido está tomando forma!', 'Confira suas escolhas. O próximo passo conclui o pedido com segurança no checkout Libri.',
    '<div class="v3-notice"><b>' + clean(labelForEvent()) + '</b> · ' + clean(PRODUCTS[state.productCode]?.title || '') +
    '</div>' + linesHtml() + priceBar() + offerHtml() +
    '<p class="v3-mini">Você pode guardar este convite no carrinho e escolher outro serviço para o mesmo evento.</p>',
    '<div class="v3-action-row"><button class="v3-btn v3-btn-text" type="button" data-action="back">Editar escolhas</button>' +
    '<button class="v3-btn v3-btn-primary" type="button" data-action="add-invitation">Adicionar ao carrinho</button></div>',4);
}
function cartDeliveryHtml(){
  if(!cartQuote||cartError||!state.cartItems.length||(state.cartItems.length===1&&cartFamily(state.cartItems[0].productCode)!=='retrospective'&&!(state.cartItems[0].extras||[]).length))return '';
  const formatDate=s=>s.split('-').reverse().join('/');
  const options=cartDelivery?.options||[];
  return '<div class="v3-notice"><strong>Quando é a festa?</strong><p>Consulte a agenda para todos os serviços juntos.</p>'+
    '<label for="v3CartEventDate" class="v3-mini">Data do evento</label>'+
    '<input type="date" id="v3CartEventDate" value="'+clean(cartEventDate)+'" class="v3-at-input">'+
    '<button type="button" class="v3-btn v3-btn-secondary" data-action="cart-delivery" '+(cartDeliveryBusy?'disabled':'')+'>'+(cartDeliveryBusy?'Consultando…':'Consultar prazos')+'</button>'+
    (cartDeliveryError?'<p role="alert">'+clean(cartDeliveryError)+'</p>':'')+
    (cartDelivery?'<div role="status"><p><strong>Previsão de entrega conjunta</strong></p>'+
      (options.length?options.map(o=>'<p>'+clean(formatDate(o.start))+' a '+clean(formatDate(o.end))+(o.recommended?' · sugerida':'')+'</p>').join(''):'<p>Sem janela automática para esta data. Será necessário avaliar a disponibilidade antes de pagar.</p>')+
      '<p class="v3-mini">'+(cartDelivery.provisionalUntilBriefing?'Mínimo de 15 dias corridos após pagamento e briefing completos. ':'')+'Consulta sem reserva de vaga. A data ainda deverá ser confirmada na contratação.</p></div>':'')+'</div>';
}
let cartExtrasCatalog=Object.create(null);
function cartExtrasHtml(item,i){
  const extras=cartExtrasCatalog[item.productCode]||[];
  if(!extras.length)return '';
  const selected=new Map((item.extras||[]).map(x=>[x.code,x.quantity]));
  const groups=[...new Set(extras.map(x=>x.category))];
  return '<div class="v3-notice"><strong>Personalize seu pacote</strong><p class="v3-mini">Selecione somente o que precisar além dos itens inclusos.</p>'+
    groups.map(group=>'<details data-cart-group="'+clean(item.productCode+':'+group)+'" '+(cartOpenDetails.has(item.productCode+':'+group)||extras.some(x=>x.category===group&&selected.has(x.code))?'open':'')+'><summary>'+clean(group)+'</summary>'+extras.filter(x=>x.category===group).map(x=>{
      const n=selected.get(x.code)||0;
      return '<div class="v3-line"><div><strong>'+clean(x.name)+'</strong><p class="v3-mini">'+money(x.priceCents)+' por unidade</p></div>'+
        '<div><button type="button" aria-label="Diminuir '+clean(x.name)+'" class="v3-btn v3-btn-text" data-action="cart-extra-minus" data-value="'+i+':'+clean(x.code)+'" '+(!n?'disabled':'')+'>−</button> <strong>'+n+'</strong> <button type="button" aria-label="Aumentar '+clean(x.name)+'" class="v3-btn v3-btn-text" data-action="cart-extra-plus" data-value="'+i+':'+clean(x.code)+'" '+(n>=x.maxQuantity?'disabled':'')+'>+</button></div></div>';
    }).join('')+'</details>').join('')+'</div>';
}
function needsUnifiedCheckout(items){return items.length>1||items.some(x=>cartFamily(x.productCode)==='retrospective'||(x.extras||[]).length);}
function renderCart() {
  trackStoreStage('carrinho');
  const items=state.cartItems;
  const lines=items.map((item,i)=>{
    const priced=cartQuote?.items?.find(x=>x.productCode===item.productCode&&x.variantCode===item.variantCode);
    const product=getProduct(item.productCode);
    const name=priced?.productName||product?.name||ateliePackages.find(p=>'atelie_'+p.code===item.productCode)?.name||'Serviço selecionado';
    const upgrade=priced?.upgradeSuggestion;
    const suggestion=upgrade?'<div class="v3-notice"><strong>Vale conferir o pacote '+clean(upgrade.name)+'</strong><p class="v3-mini">'+(upgrade.savingsCents?'Economize '+money(upgrade.savingsCents)+' antes dos descontos':'Pelo mesmo valor, aproveite um pacote superior')+'. Os extras não contemplados serão mantidos.</p><button type="button" class="v3-btn v3-btn-secondary" data-action="cart-upgrade" data-value="'+i+'">Trocar pacote</button></div>':'';
    return '<article class="v3-cart-item"><div class="v3-line"><div><strong>'+clean(name)+'</strong>'+
      (priced?'<p class="v3-mini">'+clean(priced.variantName||'')+(priced.comboName?' · '+clean(priced.comboName):'')+'</p>':'')+
      (priced?'<b>'+money(priced.totalCents)+'</b>':'')+'</div>'+
      '<button type="button" class="v3-btn v3-btn-text" data-action="remove-cart" data-value="'+i+'">Retirar</button></div>'+cartExtrasHtml(item,i)+suggestion+'</article>';
  }).join('');
  const totals=cartQuote?'<div class="v3-lines"><div class="v3-line"><span>Subtotal antes dos descontos</span><b>'+money(cartQuote.grossCents)+'</b></div>'+
    (cartQuote.discountCents?'<div class="v3-line"><span>'+ (cartQuote.combinedDiscountPercent?'Desconto combinado ('+cartQuote.combinedDiscountPercent+'%)':'Desconto do convite') +'</span><b>− '+money(cartQuote.discountCents)+'</b></div>':'')+
    '</div><div class="v3-total"><strong>Total estimado no Pix</strong><b>'+money(cartQuote.totalCents)+'</b></div>':'';
  const notice=cartError?'<div class="v3-notice" role="alert">'+clean(cartError)+'</div>':
    (items.length>1||items.some(x=>cartFamily(x.productCode)==='retrospective'))?'<div class="v3-notice">Confira os dados, os prazos e as condições da sua contratação no checkout. Nenhuma cobrança foi criada.</div>':
    items.some(x=>(x.extras||[]).length)?'<div class="v3-notice">Confira os dados e as condições dos seus adicionais no checkout. Nenhuma cobrança foi criada.</div>':items.length?'<p class="v3-mini">O checkout individual ainda vai confirmar o preço, a agenda e as condições.</p>':'';
  panel('Seu carrinho',clean(labelForEvent())+' · revise os serviços escolhidos.',
    '<div class="v3-cart-list">'+(lines||'<p>Seu carrinho está vazio.</p>')+'</div>'+totals+notice+cartDeliveryHtml(),
    '<div class="v3-action-row"><button class="v3-btn v3-btn-secondary" type="button" data-action="cart-more">'+(items.length?'Escolher outro serviço':'Escolher serviço')+'</button>'+
    (items.length&&cartQuote&&!cartError&&needsUnifiedCheckout(items)?'<button class="v3-btn v3-btn-primary" type="button" data-action="cart-unified-checkout">Continuar contratação</button>':'')+
    (items.length===1&&cartQuote&&!cartError&&!needsUnifiedCheckout(items)?'<button class="v3-btn v3-btn-primary" type="button" data-action="cart-single-checkout">Continuar para o pagamento</button>':'')+'</div>',4);
}
async function openCart(){
  if(state.step==='cart'){cartEventDate=root.querySelector('#v3CartEventDate')?.value||cartEventDate;cartOpenDetails=new Set(Array.from(root.querySelectorAll('details[data-cart-group][open]'),el=>el.dataset.cartGroup));}
  state.step='cart';save();cartQuote=null;cartError='';cartDelivery=null;cartDeliveryError='';cartDeliveryBusy=false;cartRevision++;
  root.setAttribute('aria-busy','true');
  root.innerHTML='<section class="v3-panel"><p>Conferindo os valores no catálogo oficial…</p></section>';
  if(state.cartItems.length){
    try {
      await Promise.all(state.cartItems.map(async item=>{if(!cartExtrasCatalog[item.productCode]){const data=await request('/api/v3/extras/catalog?productCode='+encodeURIComponent(item.productCode));cartExtrasCatalog[item.productCode]=data.extras||[];}}));
      const data=await request('/api/v3/cart/quote',{eventType:state.eventType,paymentMethod:'pix',items:state.cartItems});
      cartQuote=data.quote;
    } catch(e){cartError=e.message||'Não foi possível conferir o carrinho. Revise os serviços selecionados.';}
  }
  renderCart();window.scrollTo({top:0,behavior:'auto'});
}
function render() {
  trackStoreStage(({event:'evento',creation:'servico',unready:'servico',atelie:'modelo','atelie-detail':'configuracao','atelie-checkout':'dados',intent:'modelo',format:'modelo',scenes:'configuracao',extras:'adicionais',review:'revisao',cart:'carrinho'})[state.step]||'evento');
  save();
  switch(state.step) {
    case 'event': renderEvent(); break;
    case 'creation': renderCreation(); break;
    case 'unready': renderUnready(); break;
    case 'atelie': renderAtelie(); break;
    case 'atelie-detail': renderAtelieDetail(); break;
    case 'atelie-checkout': {
      const item=ateliePackages.find(p=>p.code===state.ateliePackage);
      mountAtelieCheckout(root,{item,eventType:state.eventType,onBack:()=>go('atelie-detail')});
      break;
    }
    case 'intent': renderIntent(); break;
    case 'format': renderFormats(); break;
    case 'scenes': renderScenes(); break;
    case 'extras': renderExtras(); break;
    case 'review': renderReview(); break;
    case 'cart': renderCart(); break;
    default: state.step='event';renderEvent();
  }
}
function modalClose() {
  modalRoot.hidden = true;
  modalRoot.innerHTML = '';
}
function openAddonGroup(group) {
  const variants = (catalog?.addons || []).filter(a => a.group === group);
  if (!variants.length) return;
  const groupItem = ADDON_GROUPS.find(x=>x[0]===group);
  const selected = state.addonCodes.find(code => groupCode(code) === group);
  const explanations = {
    save_the_date:'Escolha se prefere uma imagem sem movimento ou uma pequena animação.',
    reminder:'Escolha se prefere uma imagem sem movimento ou uma pequena animação.',
    moments:'Escolha um plano conforme a quantidade de fotos e o período em que o álbum ficará disponível.',
    confirmation:'O convidado responde no próprio convite, e você acompanha as confirmações em um painel.',
    filter:'O filtro da câmera Libri já vem incluído quando você escolhe Libri Moments.'
  };
  modalRoot.innerHTML = '<div class="v3-modal-card" role="dialog" aria-modal="true" aria-labelledby="v3-modal-title" tabindex="-1">' +
    '<h2 id="v3-modal-title">'+clean(groupItem?.[1]||'Adicional')+'</h2><p>'+clean(explanations[group]||groupItem?.[2]||'')+'</p>' +
    '<div class="v3-modal-actions">' + variants.map(a=>{
      const extra = a.config?.photoLimit ? ' · até '+a.config.photoLimit+' fotos' : '';
      return '<button type="button" class="v3-choice '+(selected===a.code?'is-selected':'')+'" data-action="select-addon" data-value="'+clean(a.code)+'">' +
        '<strong>'+clean(a.name)+'</strong><small>'+clean(extra || (a.code.endsWith('_animated')?'Com movimento':a.code.endsWith('_static')?'Sem movimento':''))+'</small>' +
        '<span class="v3-price">+ '+money(a.priceCents)+'</span></button>';
    }).join('') +
    (selected ? '<button class="v3-btn v3-btn-secondary" data-action="remove-addon" data-value="'+clean(group)+'">Retirar esse adicional</button>' : '') +
    '<button type="button" class="v3-btn v3-btn-text" data-action="close-modal">Voltar sem alterar</button></div></div>';
  modalRoot.hidden = false;
  modalRoot.querySelector('[role="dialog"]')?.focus();
}
function variantFor(productCode, sceneCount) {
  return getProduct(productCode)?.variants.find(v=>Number(v.sceneCount) === Number(sceneCount));
}
async function determineOffer() {
  if (!quote || state.offerFinished) return null;
  const current = state.productCode;
  if (current === 'cinematic_video' && !state.dismissed.includes('upgrade:cinematic_interactive')) {
    const item = variantFor('cinematic_interactive',currentVariant()?.sceneCount);
    if (item) {
      const alternative = await priceFor('cinematic_interactive',item.code,state.addonCodes);
      return {
        id:'upgrade:cinematic_interactive',kind:'upgrade',
        title:'Que tal deixar seu vídeo interativo?',
        description:'O mesmo vídeo e as mesmas cenas. No final, os convidados poderão tocar nos botões para acessar as informações da festa.',
        productCode:'cinematic_interactive',variantCode:item.code,
        delta:alternative.totalCents-quote.totalCents
      };
    }
  }
  if (current === 'interactive_essential' && !state.dismissed.includes('upgrade:interactive_animated')) {
    const product = getProduct('interactive_animated');
    const variant = product?.variants?.[0];
    if (variant) {
      const alternative = await priceFor(product.code, variant.code, state.addonCodes);
      return {
        id:'upgrade:interactive_animated',kind:'upgrade',
        title:'Quer uma abertura animada para seu convite?',
        description:'Seu convite continua com os mesmos recursos. Só acrescentamos uma pequena animação especial antes de mostrar a arte principal.',
        productCode:product.code,variantCode:variant.code,
        delta:alternative.totalCents-quote.totalCents
      };
    }
  }
  const available = availableGroups()
    .filter(g => !hasGroup(g[0]) && !state.dismissed.includes('addon:'+g[0]));
  const groups = new Set(selectedAddons().map(a=>a.group));
  const currentCode = state.productCode;
  const nearCombo = (catalog?.combos || []).filter(c=>Number(c.discountValue||0)>0).map(c=>{
    const missing = (c.items||[]).filter(item=>item.required!==false && !(
      item.itemType === 'addon_group' && groups.has(item.itemCode) ||
      item.itemType === 'addon' && state.addonCodes.includes(item.itemCode) ||
      item.itemType === 'main_product' && currentCode === item.itemCode));
    return {combo:c,missing};
  }).filter(x=>x.missing.length===1);
  const ranked = available.sort((a,b)=>{
    const preference = {moments:5,confirmation:4,save_the_date:3,reminder:2,filter:1};
    const nearA=nearCombo.some(x=>x.missing[0].itemCode===a[0])?10:0;
    const nearB=nearCombo.some(x=>x.missing[0].itemCode===b[0])?10:0;
    return (nearB+(preference[b[0]]||0))-(nearA+(preference[a[0]]||0));
  });
  for (const group of ranked) {
    // A oferta sugere a opção mais acessível daquele grupo e calcula o total real.
    const choices = catalog.addons.filter(a=>a.group===group[0]).sort((a,b)=>a.priceCents-b.priceCents);
    const addon = choices[0];
    if (!addon) continue;
    const nextCodes = state.addonCodes.filter(c=>groupCode(c)!==group[0]).concat(addon.code)
      .filter(c=>group[0]!=='moments'||c!=='custom_filter');
    try {
      const alternative = await priceFor(currentCode,state.variantCode,nextCodes);
      const combo = alternative.combo?.name;
      return {
        id:'addon:'+group[0],kind:'addon',addonCode:addon.code,delta:alternative.totalCents-quote.totalCents,
        title:combo ? 'Complete o pacote '+combo : 'Gostaria de acrescentar '+group[1]+'?',
        description:group[2]+(combo?' Com essa escolha, o desconto do pacote já entra no cálculo.':'')
      };
    } catch { /* Ignorar somente uma oferta inválida. */ }
  }
  return null;
}
async function go(target) {
  state.step=target;
  root.setAttribute('aria-busy','true');
  if (target==='extras'||target==='review') {
    root.innerHTML='<section class="v3-panel"><p>Conferindo os valores no catálogo oficial…</p></section>';
    try {await refreshQuote(); offer=target==='review'?await determineOffer():null;}
    catch(e) {message(e.message);return;}
  }
  render();
  window.scrollTo({top:0,behavior:'auto'});
}
function handoff() {
  // Transferir somente os dados que o checkout V2 já compreende.
  // Ele continua responsável por agenda, termos, pagamento e briefing.
  const product = currentProduct();
  if (!product || !currentVariant()) return message('Escolha um modelo disponível antes de continuar.');
  const order = {
    step: 3,
    deepProductSlug: '',
    event: {type:state.eventType,subtype:'',honoreeName:'',date:''},
    customer: {name:'',whatsapp:'',email:''},
    selection: {
      productSlug: product.slug,productCode: product.code,
      variantCode:state.variantCode,addonCodes:state.addonCodes,
      comboCode:quote?.combo?.code || '',couponCode:'',paymentMethod:'pix'
    },
    termsAccepted:false
  };
  try {
    localStorage.setItem(V2_KEY,JSON.stringify(order));
  } catch {
    return message('Seu navegador não permitiu transferir a seleção. Você pode acessar a loja atual e escolher novamente.');
  }
  window.location.assign('/pedido');
}
root.addEventListener('click', async event => {
  const button=event.target.closest('[data-action]');
  if (!button) return;
  const action=button.dataset.action, value=button.dataset.value;
  try {
    if(action==='skip-intro'){sessionStorage.setItem('libriV3IntroSeen','1');render();return;}
    if(action==='retry'){await init();return;}
    if(action==='event'){if(state.eventType!==value&&state.cartItems.length&&!window.confirm('Alterar o tipo de evento? Os serviços serão mantidos no carrinho, mas os valores e as condições precisarão ser conferidos novamente.'))return;state.eventType=value;state.creation='';state.ateliePackage='';state.intent='';state.productCode='';state.variantCode='';state.addonCodes=[];render();return;}
    if(action==='creation'){if(state.creation!==value)state.ateliePackage='';state.creation=value;render();return;}
    if(action==='atelie-package'){state.ateliePackage=value;render();return;}
    if(action==='atelie-detail'){if(state.ateliePackage)await go('atelie-detail');return;}
    if(action==='retro-buy'){
      const item=retrosPackages.find(p=>p.code===value);
      if(!item?.previewAvailable)return message('Pacote indisponível.');
      putCart({productCode:item.productCode,variantCode:item.variantCode,addonCodes:[]});await openCart();return;
    }
    if(action==='atelie-buy'){
      const item=ateliePackages.find(p=>p.code===state.ateliePackage);
      if(!item?.purchaseAvailable||!item.variantCode)return message('Pacote indisponível para compra.');
      putCart({productCode:'atelie_'+item.code,variantCode:item.variantCode,addonCodes:[]});
      await openCart();return;
    }
    if(action==='intent'){state.intent=value;state.productCode='';state.variantCode='';state.addonCodes=[];render();return;}
    if(action==='product'){
      const product=getProduct(value);if(!product)return;
      state.productCode=value;
      state.variantCode=product.pricingMode==='scene_count'?'':product.variants[0]?.code||'';
      state.addonCodes=[];state.addonQuestion=0;
      state.offerFinished=false;state.dismissed=[];
      quote=null;render();return;
    }
    if(action==='variant'){state.variantCode=value;state.offerFinished=false;render();return;}
    if(action==='guided-addon'||action==='guided-skip'){button.disabled=true;try{await advanceGuided(action==='guided-addon'?groupCode(value):value,action==='guided-addon'?value:null);}finally{button.disabled=false;}return;}
    if(action==='guided-back'){if(Number(state.addonQuestion)>0){state.addonQuestion--;render();}else await go(SCENE_PRODUCTS.has(state.productCode)?'scenes':'format');return;}
    if(action==='guided-finish'){state.addonQuestion=0;await go('review');return;}
    if(action==='addon-group'){openAddonGroup(value);return;}
    if(action==='close-modal'){modalClose();return;}
    if(action==='remove-addon'){
      state.addonCodes=state.addonCodes.filter(c=>groupCode(c)!==value);
      state.offerFinished=false;
      modalClose();await go('extras');return;
    }
    if(action==='select-addon'){
      const addon=getAddon(value);if(!addon)return;
      state.addonCodes=state.addonCodes.filter(c=>groupCode(c)!==addon.group);
      if(addon.group==='moments')state.addonCodes=state.addonCodes.filter(c=>c!=='custom_filter');
      state.addonCodes.push(value);
      state.offerFinished=false;
      modalClose();await go('extras');return;
    }
    if(action==='dismiss-offer'){
      if(offer)state.dismissed.push(offer.id);state.offerFinished=true;offer=null;render();return;
    }
    if(action==='accept-offer'){
      if(!offer)return;
      if(offer.kind==='upgrade'){
        state.productCode=offer.productCode;state.variantCode=offer.variantCode;
      } else if(offer.kind==='addon'){
        const item=getAddon(offer.addonCode);
        state.addonCodes=state.addonCodes.filter(code=>groupCode(code)!==item.group);
        if(item.group==='moments')state.addonCodes=state.addonCodes.filter(code=>code!=='custom_filter');
        state.addonCodes.push(item.code);
      }
      state.offerFinished=true;offer=null;await go('review');return;
    }
    if(action==='add-invitation'){
      if(!currentVariant()||!quote)return message('Confira a configuração do convite.');
      putCart({productCode:state.productCode,variantCode:state.variantCode,addonCodes:[...state.addonCodes],comboCode:quote.combo?.code||''});
      await openCart();return;
    }
    if(action==='open-cart'){await openCart();return;}
    if(action==='cart-delivery'){
      if(cartDeliveryBusy||!cartQuote||!state.cartItems.length)return;
      const revision=cartRevision;
      cartEventDate=root.querySelector('#v3CartEventDate')?.value||'';
      cartDelivery=null;cartDeliveryError='';cartDeliveryBusy=true;renderCart();
      try{
        const result=await request('/api/v3/cart/delivery-options',{eventType:state.eventType,eventDate:cartEventDate,paymentMethod:'pix',items:state.cartItems});
        if(revision===cartRevision&&state.step==='cart'){cartDelivery=result.delivery;cartQuote=result.quote;}
      }catch(e){if(revision===cartRevision)cartDeliveryError=e.message||'Não foi possível consultar a agenda.';}
      finally{if(revision===cartRevision){cartDeliveryBusy=false;if(state.step==='cart')renderCart();}}
      return;
    }
    if(action==='cart-more'){await go('creation');return;}
    if(action==='remove-cart'){
      const i=Number(value);
      if(Number.isInteger(i)&&i>=0&&i<state.cartItems.length)state.cartItems.splice(i,1);
      await openCart();return;
    }
    if(action==='cart-upgrade'){
      const i=Number(value),item=state.cartItems[i];
      const suggestion=cartQuote?.items?.find(x=>x.productCode===item?.productCode&&x.variantCode===item?.variantCode)?.upgradeSuggestion;
      if(!item||!suggestion||cartError)return;
      state.cartItems[i]={productCode:suggestion.productCode,variantCode:suggestion.variantCode,addonCodes:[],extras:suggestion.extras};
      await openCart();return;
    }
    if(action==='cart-extra-plus'||action==='cart-extra-minus'){
      const [idx,code]=String(value).split(':');const item=state.cartItems[Number(idx)];
      const extra=(cartExtrasCatalog[item?.productCode]||[]).find(x=>x.code===code);if(!item||!extra)return;
      const selected=new Map((item.extras||[]).map(x=>[x.code,x.quantity]));
      const quantity=Math.max(0,Math.min(extra.maxQuantity,(selected.get(code)||0)+(action==='cart-extra-plus'?1:-1)));
      if(quantity)selected.set(code,quantity);else selected.delete(code);
      item.extras=Array.from(selected,([code,quantity])=>({code,quantity}));await openCart();return;
    }
    if(action==='cart-unified-checkout'){
      if(!cartQuote||cartError||!needsUnifiedCheckout(state.cartItems))return;
      state.step='cart';save();
      mountV3Checkout(root,{items:state.cartItems,eventType:state.eventType,eventDate:cartEventDate,request,onBack:()=>openCart()});
      return;
    }
    if(action==='cart-single-checkout'){
      if(state.cartItems.length!==1||!cartQuote||cartError)return;
      const item=state.cartItems[0];
      if((item.extras||[]).length)return message('A contratação desses adicionais ainda está em preparação.');
      if(cartFamily(item.productCode)==='identity'){
        const pkg=ateliePackages.find(p=>'atelie_'+p.code===item.productCode&&p.purchaseAvailable&&p.variantCode===item.variantCode);
        if(!pkg)return message('Pacote indisponível para compra.');
        state.ateliePackage=pkg.code;await go('atelie-checkout');return;
      }
      if(cartFamily(item.productCode)!=='invitation')return;
      Object.assign(state,{productCode:item.productCode,variantCode:item.variantCode,addonCodes:[...item.addonCodes]});
      // Retain the explicit combo accepted on the cart; the V2 checkout still revalidates.
      const result=await request('/api/v2/quote',{eventType:state.eventType,selection:{...item,couponCode:'',paymentMethod:'pix'}});
      quote=result.quote;
      handoff();return;
    }
    if(action==='back'){
      const previous={
        creation:'event',unready:'creation',atelie:'creation','atelie-detail':'atelie',intent:'creation',
        format:'intent',scenes:'format',
        extras:SCENE_PRODUCTS.has(state.productCode)?'scenes':'format',
        review:'extras'
      };
      await go(previous[state.step]||'event');return;
    }
    if(action==='next'){
      const next={event:'creation',creation:state.creation==='invitation'?'intent':state.creation==='identity'?'atelie':'unready',
        intent:'format',
        format:SCENE_PRODUCTS.has(state.productCode)?'scenes':'extras',
        scenes:'extras',extras:'review'};
      if(state.step==='event'&&!state.eventType)return message('Escolha o tipo de evento para continuar.');
      if(state.step==='creation'&&!state.creation)return message('Escolha o que gostaria de criar.');
      if(state.step==='intent'&&!state.intent)return message('Escolha o estilo do convite.');
      if(state.step==='format'&&!state.productCode)return message('Escolha o formato do convite.');
      if(state.step==='scenes'&&!state.variantCode)return message('Escolha quantas cenas quer no vídeo.');
      await go(next[state.step]||'event');
    }
  }catch(err){message(err.message || 'Não foi possível continuar.');}
});
modalRoot.addEventListener('click', event => {
  if(event.target===modalRoot)modalClose();
});
document.addEventListener('keydown', event => {
  if(event.key==='Escape'&&!modalRoot.hidden)modalClose();
});
async function init({skipRecovery=false}={}) {
  if(!skipRecovery&&pendingV3CheckoutKey()){
    const handled=await mountV3PaymentRecovery(root,{request,onMissing:()=>init({skipRecovery:true})});
    if(handled||pendingV3CheckoutKey())return;
  }
  root.setAttribute('aria-busy','true');
  const [result, atelie, retrospective] = await Promise.all([
    request('/api/v2/catalog'),
    request('/api/v2/atelie/catalog').catch(()=>({packages:[]})),
    request('/api/v3/retrospectivas/catalog').catch(()=>({packages:[]}))
  ]);
  catalog=result.catalog;
  ateliePackages=atelie.packages || [];
  retrosPackages=retrospective.packages || [];
  if(state.ateliePackage && !ateliePackages.some(p=>p.code===state.ateliePackage)) state.ateliePackage='';
  if(!catalog?.products?.length)throw new Error('O catálogo está indisponível. Confira a loja atual.');
  // Um código de produto desativado nunca deve ficar selecionado em rascunhos antigos.
  if(state.productCode&&!getProduct(state.productCode)){
    state.productCode='';state.variantCode='';state.addonCodes=[];state.step='format';
  }
  if(state.productCode && !currentVariant()) {
    state.variantCode='';
    state.step=SCENE_PRODUCTS.has(state.productCode)?'scenes':'format';
  }
  if(!state.eventType)state.step='event';
  if(state.step==='cart'){await openCart();return;}
  if(state.step==='extras'||state.step==='review'){await go(state.step);return;}
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!sessionStorage.getItem('libriV3IntroSeen')&&state.step==='event'&&!reduced){
    intro();
    window.setTimeout(()=>{
      if(!sessionStorage.getItem('libriV3IntroSeen')){
        sessionStorage.setItem('libriV3IntroSeen','1');
        render();
      }
    },2300);
  }else render();
}
init().catch(err=>message(err.message));
