import {trackStoreStage,setJourneyName} from './store-funnel.js';
import {mountStorePrivacy} from './store-privacy.js';
import {pendingV3CheckoutKey,mountV3PaymentRecovery} from './client-v3-payment-recovery.js?v=79';
import { mountV3Checkout } from './client-v3-checkout.js?v=96';
// Loja integrada: catálogo, cotações e checkout validados no servidor.
const root = document.getElementById('v3-app');
const modalRoot = document.getElementById('v3-modal');
const basket=document.getElementById('v3-live-basket');
const basketBody=document.getElementById('v3-basket-body');
const basketTotal=document.getElementById('v3-basket-total');
if(basket)basket.open=false;
const simulationMode=new URLSearchParams(location.search).get('simular')==='1';
const STORE_KEY = 'libriV3Draft';
if(simulationMode){document.body.dataset.simulation='true';document.querySelector('.v3-header-shell')?.insertAdjacentHTML('afterend','<aside class="v3-simulation-banner" role="status"><strong>MODO DE TESTE</strong> · Nenhum pedido, prêmio ou pagamento real. <a href="/loja">Sair do teste</a></aside>');}
// Personalização de conversa apenas em memória. Nunca incluir nome no rascunho,
// nos eventos de análise ou nas solicitações de catálogo/agenda.
let conversationName='',welcomeAnswered=false;
try{welcomeAnswered=!simulationMode&&sessionStorage.getItem('libriV3WelcomeSeen')==='1';}catch{}
function personalTitle(text){return conversationName?clean(conversationName)+', '+text:text.charAt(0).toUpperCase()+text.slice(1);}
function finishWelcome(name=''){conversationName=String(name).replace(/[\u0000-\u001f\u007f]/g,' ').trim().replace(/\s+/g,' ').slice(0,60);welcomeAnswered=true;if(!simulationMode)setJourneyName(conversationName);try{if(!simulationMode)sessionStorage.setItem('libriV3WelcomeSeen','1');}catch{}render();}
function shouldAskName(){return !welcomeAnswered&&state.step==='event'&&!state.eventType&&!state.cartItems.length;}
const EVENTS = [
 ['birthday','Aniversário','Infantil ou adulto'],['15_years','15 anos','Uma celebração especial'],['wedding','Casamento','A história do casal'],['celebration','Chá ou celebração','Bebê, revelação, chá de panela e outros'],['other','Outra celebração','Formatura, bodas e mais']
];
const EVENT_SUBTYPES={celebration:[['Chá de bebê','Chá de bebê'],['Chá revelação','Chá revelação'],['Chá de panela','Chá de panela'],['Outro chá','Outro chá']],other:[['Formatura','Formatura'],['Bodas','Bodas'],['Outra celebração','Outra celebração']]};
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
  ['confirmation', 'Formulário de confirmação de presença personalizado', 'Os convidados respondem pelo convite e você acompanha tudo em um painel, sem lotar seu WhatsApp.'],
  ['moments', 'Álbum de fotos', 'Seus convidados registram e compartilham os momentos da festa em um álbum digital. Inclui filtro personalizado.'],
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
let cartEventDate='',cartRevision=0,cartOpenDetails=new Set(),checkoutContactDraft={};
let state;
try {
  state = simulationMode?null:JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
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
  const old=state.cartItems.find(x=>cartFamily(x.productCode)===cartFamily(item.productCode));
  if(old){
    if(old.productCode!==item.productCode||old.variantCode!==item.variantCode){if(!window.confirm('Substituir o serviço anterior por este? Confira novamente os itens e adicionais do novo pacote.'))return false;}
    else if(old.extras?.length&&!item.extras)item={...item,extras:old.extras};
  }
  cartQuote=null;
  state.cartItems = state.cartItems.filter(x=>cartFamily(x.productCode)!==cartFamily(item.productCode)).concat(item);
  save();return true;
}
const getProduct = code => (catalog?.products || []).find(item => item.code === code);
const getAddon = code => (catalog?.addons || []).find(item => item.code === code);
const currentProduct = () => getProduct(state.productCode);
const currentVariant = () => currentProduct()?.variants.find(item => item.code === state.variantCode);
const groupCode = code => getAddon(code)?.group;
const hasGroup = group => state.addonCodes.some(code => groupCode(code) === group);
const labelForEvent = () => state.eventSubtype || EVENTS.find(x => x[0] === state.eventType)?.[1] || 'Seu evento';
const selectedAddons = () => state.addonCodes.map(getAddon).filter(Boolean);
function save() {
  if(simulationMode)return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch { /* O navegador pode bloquear o armazenamento. A sessão continua ativa. */ }
}
function loading(title,detail='Só um instante, por favor.'){
  root.setAttribute('aria-busy','true');
  root.innerHTML='<section class="v3-panel v3-panel--status" role="status"><div class="v3-status-content"><img class="v3-status-emblem" src="/images/libri-emblem.png" alt="" width="56" height="56"><span class="v3-status-brand">LIBRI CONVITES</span><h1 class="v3-status-title">'+clean(title)+'</h1><div class="v3-status-line" aria-hidden="true"></div><p class="v3-status-note">'+clean(detail)+'</p></div></section>';
}
function message(text) {
  hideBasket();root.innerHTML = '<section class="v3-panel v3-panel--status v3-panel--error" role="alert"><div class="v3-status-content"><img class="v3-status-emblem" src="/images/libri-emblem.png" alt="" width="56" height="56"><span class="v3-status-brand">LIBRI CONVITES</span><h1 class="v3-status-title">Não conseguimos continuar</h1><p class="v3-status-note">' + clean(text) + '</p><button type="button" class="v3-btn v3-btn-primary" data-action="retry">Tentar novamente</button></div></section>';
  root.setAttribute('aria-busy', 'false');
}
async function request(path, body) {
  if(simulationMode){const endpoint=new URL(path,location.origin).pathname;const allowed=body?['/api/v2/quote','/api/v3/cart/quote','/api/v3/cart/terms','/api/v3/cart/delivery-options']:['/api/v2/catalog','/api/v2/atelie/catalog','/api/v3/retrospectivas/catalog','/api/v3/extras/catalog','/api/v2/gallery'];if(!allowed.includes(endpoint))throw Error('Operação real bloqueada no modo de teste.');}
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
let liveQuoteKey='';
const quoteKey=()=>JSON.stringify([state.eventType,state.productCode,state.variantCode,[...state.addonCodes].sort()]);
async function refreshQuote() {
  if (!state.productCode || !state.variantCode) {quote = null;return;}
  const key=quoteKey();
  const result=await priceFor(state.productCode, state.variantCode, state.addonCodes);
  if(key===quoteKey()){quote=result;liveQuoteKey=key;}

}
const stepNames=['Evento','Serviço','Escolhas','Personalização','Carrinho'];
function stepBar(index) {
  return '<div class="v3-progress" aria-label="Etapa '+(index+1)+' de 5"><div class="v3-progress-label"><span>'+stepNames[index]+'</span></div><div class="v3-steps" aria-hidden="true">'+Array.from({length:5},(_,i)=>'<span class="'+(i<=index?'is-active':'')+'"></span>').join('')+'</div></div>';
}
let basketRequestKey='',basketRequestQuote=null,basketRequestSeq=0;
function hideBasket(){if(basket)basket.hidden=true;basketRequestKey='';basketRequestQuote=null;basketRequestSeq++;}
function renderBasket(){
 if(!basket||!basketBody||!basketTotal)return;
 if(state.step==='cart'||state.step==='atelie-checkout'){hideBasket();return;}
 const staged=state.creation==='invitation'&&state.productCode&&['intent','format','scenes','extras','review'].includes(state.step);
 const live=staged&&state.variantCode&&quote&&liveQuoteKey===quoteKey()?quote:null;
 const item=state.creation==='identity'&&['atelie','atelie-detail'].includes(state.step)?ateliePackages.find(p=>p.code===state.ateliePackage):null;
 if(!state.cartItems.length&&!staged&&!item){hideBasket();return;}
 basket.hidden=false;
 const rows=state.cartItems.map(x=>'<li><span>'+clean(getProduct(x.productCode)?.name||ateliePackages.find(p=>'atelie_'+p.code===x.productCode)?.name||retrosPackages.find(p=>p.productCode===x.productCode)?.name||'Serviço selecionado')+'</span></li>').join('');
 basketBody.innerHTML='<p class="v3-basket-event">'+clean(labelForEvent())+'</p>'+
 (rows?'<ul class="v3-basket-list">'+rows+'</ul>':'')+
 (staged?'<div class="v3-basket-draft"><small>Convite em configuração</small><strong>'+clean(PRODUCTS[state.productCode]?.title||currentProduct()?.name||'Convite')+'</strong>'+(currentVariant()?.sceneCount?'<span>'+Number(currentVariant().sceneCount)+' cenas</span>':'')+selectedAddons().map(x=>'<span>'+clean(x.name)+'</span>').join('')+(live?'<b>'+money(live.totalCents)+'</b><small>Total do convite no Pix</small>':'<small>Escolha a configuração para consultar o total.</small>')+'</div>':'')+
 (item?'<div class="v3-basket-draft"><small>Pacote em seleção</small><strong>'+clean(item.name)+'</strong>'+(item.purchaseAvailable?'<b>'+money(item.priceCents)+'</b>':'')+'</div>':'')+
 (!rows&&!staged&&!item?'<p class="v3-mini">Suas escolhas aparecem aqui, conforme você monta a comemoração.</p>':'')+
 (rows?'<button type="button" class="v3-btn v3-btn-secondary" id="v3-basket-open">Ver carrinho ('+state.cartItems.length+')</button>':'');
 basketTotal.textContent='A escolher';
 const pending=live?{productCode:state.productCode,variantCode:state.variantCode,addonCodes:[...state.addonCodes],comboCode:live.combo?.code||''}:item?.purchaseAvailable?{productCode:'atelie_'+item.code,variantCode:item.variantCode,addonCodes:[]}:null;
 const old=pending?state.cartItems.find(x=>cartFamily(x.productCode)===cartFamily(pending.productCode)):null;
 if(old&&old.productCode===pending.productCode&&old.variantCode===pending.variantCode&&old.extras?.length)pending.extras=old.extras;
 const combined=pending?state.cartItems.filter(x=>cartFamily(x.productCode)!==cartFamily(pending.productCode)).concat(pending):[...state.cartItems];
 const key=JSON.stringify([state.eventType,combined]);
 const applyTotal=q=>{if(basket.hidden||key!==basketRequestKey)return;basketTotal.textContent=money(q.totalCents);const el=basketBody.querySelector('#v3-basket-verified');if(el)el.textContent=(pending?'Total estimado com a seleção atual':'Total do carrinho')+' no Pix'+(q.combinedDiscountPercent?' · desconto combinado de '+q.combinedDiscountPercent+'%':'');};
 if(combined.length){basketBody.insertAdjacentHTML('beforeend','<p class="v3-basket-verified" id="v3-basket-verified">Conferindo total no catálogo…</p>');basketTotal.textContent='Conferindo…';if(key===basketRequestKey&&basketRequestQuote)applyTotal(basketRequestQuote);else{basketRequestKey=key;basketRequestQuote=null;const seq=++basketRequestSeq;request('/api/v3/cart/quote',{eventType:state.eventType,paymentMethod:'pix',items:combined}).then(data=>{if(seq!==basketRequestSeq||key!==basketRequestKey)return;basketRequestQuote=data.quote;applyTotal(data.quote);}).catch(()=>{if(seq!==basketRequestSeq||key!==basketRequestKey)return;basketTotal.textContent='A conferir';const el=basketBody.querySelector('#v3-basket-verified');if(el)el.textContent='Confira a combinação no carrinho.';});}}
 else{basketRequestKey='';basketRequestQuote=null;basketRequestSeq++;}
 basketBody.querySelector('#v3-basket-open')?.addEventListener('click',()=>{if(!guidedBusy&&!storeActionBusy)openCart().catch(e=>message(e.message));});
}
function panel(title, subtitle, content, buttons, index=0) {
  const fixed=['event','event-subtype','creation','intent','format','scenes','atelie','unready','atelie-detail','extras','review'].includes(state.step);
  root.innerHTML = '<section class="v3-panel v3-stage-'+clean(state.step)+(fixed?' v3-panel--guided':'')+'">' +
    (fixed?'':'<div class="v3-stage-progress">'+stepBar(index)+'</div>') +
    (fixed?'<div class="v3-stage-heading">':'')+
    '<h1 class="v3-title">' + title + '</h1>'+(subtitle?'<p class="v3-text">'+subtitle+'</p>':'') +
    (fixed?'</div><div class="v3-stage-body">':'')+
    content + (fixed?'</div>':'') + (buttons || '') +
    (fixed?'<div class="v3-stage-progress">'+stepBar(index)+'</div>':'') + '</section>';
  root.setAttribute('aria-busy','false');renderBasket();
}
function actions(back, nextText, nextAction = 'next') {
  return '<div class="v3-action-row">' +
    (back ? '<button class="v3-btn v3-btn-text" type="button" data-action="back">Voltar</button>' : '<span></span>') +
    (nextAction?'<button class="v3-btn v3-btn-primary" type="button" data-action="' + nextAction + '">' + clean(nextText) + '</button>':'')+'</div>';
}
function choice(value, title, subtitle, current, action, price) {
  return '<button type="button" class="v3-choice ' + (current === value ? 'is-selected' : '') +
    '" data-action="' + action + '" data-value="' + clean(value) + '" aria-pressed="' + (current===value) + '">' +
    '<span class="v3-choice-copy"><strong>'+clean(title)+'</strong>'+(subtitle?'<small>'+clean(subtitle)+'</small>':'')+(price!=null?'<span class="v3-price"><small>'+(action==='guided-addon'?'+ ':action==='product'&&SCENE_PRODUCTS.has(value)?'A partir de ':'Total ')+'</small>'+money(price)+'</span>':'')+'</span></button>';
}
function intro() {
  hideBasket();root.innerHTML = '<section class="v3-intro-screen">' +
    '<div class="v3-intro-inner"><span>UM ATELIÊ DE CELEBRAÇÕES</span><img src="/images/libri-wordmark.png" alt="Libri Convites" width="440" height="128"><i aria-hidden="true"></i><h1>Cada celebração tem sua própria história.</h1><span>FEITO COM ENCANTO. FEITO PARA VOCÊ.</span></div>' +
    '<button class="v3-btn v3-btn-text" type="button" data-action="skip-intro">Pular abertura</button></section>';
}
function renderWelcome(){
  hideBasket();
  root.innerHTML='<section class="v3-panel v3-panel--guided v3-stage-welcome"><div class="v3-stage-heading"><span class="v3-welcome-kicker">VAMOS COMEÇAR?</span><h1 class="v3-title">Como posso chamar você?</h1><p class="v3-text">Quero conhecer um pouquinho de você antes de criarmos algo especial.</p></div><div class="v3-stage-body"><form id="v3-welcome-form" class="v3-welcome-form"><label for="v3-welcome-name">Seu primeiro nome (opcional)</label><input id="v3-welcome-name" class="v3-at-input" maxlength="60" type="text" autocomplete="given-name" placeholder="Como você prefere ser chamada ou chamado?"><button type="submit" class="v3-btn v3-btn-primary">Continuar</button><button type="button" class="v3-btn v3-btn-text" data-action="welcome-skip">Prefiro não informar</button></form></div></section>';
  root.setAttribute('aria-busy','false');
  root.querySelector('#v3-welcome-form').addEventListener('submit',event=>{event.preventDefault();finishWelcome(root.querySelector('#v3-welcome-name').value);});
}
function renderEvent() {
  panel(personalTitle('qual é o seu evento?'), '',
    '<div class="v3-grid">' + EVENTS.map(item => choice(item[0],item[1],item[2],state.eventType,'event')).join('') + '</div>',
    '',0);
}
function renderEventSubtype(){
 const options=EVENT_SUBTYPES[state.eventType]||[];
 panel('Qual é a celebração?','','<div class="v3-choices-stack">'+options.map(x=>choice(x[0],x[1],'',state.eventSubtype,'event-subtype')).join('')+'</div>',actions(true,'',null),0);
}
function renderCreation() {
  panel('O que gostaria de criar?',
    'Você pode contratar mais de um serviço.',
    '<div class="v3-choices-stack">' +
    choice('invitation','Convite digital','Um convite personalizado para enviar aos convidados pelo celular.',state.creation,'creation') +
    choice('identity','Identidade visual',
      'Artes da festa com o nome, as cores e o tema combinando em cada detalhe.',state.creation,'creation') +
    choice('retrospective','Retrospectiva',
      'Transforme fotos e vídeos especiais em uma homenagem para exibir na festa.',state.creation,'creation') +
    '</div>',
    actions(true,'',null),1);
}
function renderUnready() {
  const cards=retrosPackages.map(item=>
    '<article class="v3-package-card"><div class="v3-package-heading"><strong>'+clean(item.name)+'</strong>'+(item.previewAvailable?'<b>'+money(item.previewPriceCents)+'</b>':'')+'</div>'+
    '<div class="v3-package-facts"><span><b>'+Number(item.maxPhotos)+'</b> fotos</span><span><b>'+Number(item.maxVideos)+'</b> vídeos</span></div><p class="v3-mini">Até '+Number(item.maxVideoSeconds)+' s por vídeo · '+Number(item.maxTotalVideoSeconds)/60+' min no conjunto.</p>'+
    '<details><summary>Ver o que está incluído</summary><ul>'+item.included.map(x=>'<li>'+clean(x)+'</li>').join('')+'</ul></details>'+
    (item.previewAvailable?'<button type="button" class="v3-btn v3-btn-primary" data-action="retro-buy" data-value="'+clean(item.code)+'">Adicionar ao carrinho</button>':'<p class="v3-mini">Pacote indisponível.</p>')+'</article>'
  ).join('');
  panel('Retrospectivas','Uma homenagem em vídeo, com suas fotos, músicas e lembranças.',
    '<p class="v3-mini">Materiais pelo WhatsApp após contratar. Mínimo de 15 dias após pagamento, briefing e materiais completos.</p>'+
    '<div class="v3-package-grid">'+(cards||'<p>Os pacotes ainda estão em configuração.</p>')+'</div>',
    '<div class="v3-action-row"><button type="button" class="v3-btn v3-btn-text" data-action="back">Voltar</button></div>',1);
}
function renderAtelie() {
  const cards = ateliePackages.map(item =>
    '<button type="button" class="v3-choice '+(item.code===state.ateliePackage?'is-selected':'')+
      '" data-action="atelie-package" data-value="'+clean(item.code)+'" aria-pressed="'+(item.code===state.ateliePackage)+'">'+
      '<span class="v3-choice-copy"><strong>'+clean(item.name)+'</strong><small>'+clean(item.shortDescription)+'</small>'+
      '<span class="v3-price">'+(item.purchaseAvailable?money(item.priceCents):'Consultar detalhes')+'</span></span></button>'
  ).join('');
  panel('Sua festa, com tudo combinando',
    'Artes digitais personalizadas para todos os detalhes da festa.',
    '<div class="v3-choices-stack">'+(cards||'<p>Pacotes em preparação. Nenhuma contratação está disponível.</p>')+'</div>'+
      '<p class="v3-mini">Artes digitais, sem impressão, montagem ou convite. Prazo mínimo de 15 dias após pagamento e briefing completo.</p>',
    actions(true,'',null),2);
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
    '<h2 class="v3-title" style="font-size:20px">O que você recebe</h2>'+includes+
    '<details class="v3-terms-disclosure"><summary>O que não está incluído</summary>'+excluded+'</details>'+
    '<div class="v3-total">'+(item.purchaseAvailable?'<strong>Valor do pacote</strong><b>'+money(item.priceCents)+'</b>':'<strong>Compra ainda não liberada.</strong>')+'</div>'+ 
    '',
    '<div class="v3-action-row"><button class="v3-btn v3-btn-text" type="button" data-action="back">Comparar pacotes</button>'+
    '<button class="v3-btn '+(item.purchaseAvailable?'v3-btn-primary':'v3-btn-secondary')+'" type="button" '+(item.purchaseAvailable?'data-action="atelie-buy"':'disabled')+'>'+(item.purchaseAvailable?'Adicionar ao carrinho':'Contratação em preparação')+'</button></div>',3);
}
function renderIntent() {
  panel(personalTitle('como imagina seu convite?'),
    '',
    '<div class="v3-choices-stack">' +
      choice('story','Convite cinematográfico','Uma história animada criada para sua festa, com personagens e cenários personalizados.',state.intent,'intent') +
      choice('simple','Convite interativo simples','Uma arte personalizada com as informações da festa, que abre pelo celular. Sem uma história longa.',state.intent,'intent') +
    '</div>',actions(true,'',null),2);
}
function formatCodes() {
  if (state.intent === 'story') return ['cinematic_video','cinematic_interactive'];
  const codes = ['interactive_essential','interactive_gif','interactive_animated'];
  if (state.eventType === 'wedding') codes.push('book','infinite');
  if (state.eventType === '15_years' || state.eventType === 'other') codes.push('infinite');
  return codes;
}
// Illustrative demonstrations of how each format behaves, not portfolio artwork.
const formatShort={cinematic_video:'Uma história animada personalizada. Envie o vídeo pronto pelo WhatsApp.',cinematic_interactive:'A mesma história animada, em um convite que o convidado abre pelo celular. No final, ele pode acessar a localização, confirmar presença e consultar presentes, sem procurar informações nas mensagens.',interactive_essential:'Uma arte personalizada com os dados da festa. O convidado abre pelo celular e pode acessar localização, confirmação de presença e presentes.',interactive_gif:'A arte do convite ganha movimento em pequenos detalhes. Os convidados acessam as informações da festa pelo próprio convite.',interactive_animated:'Uma abertura animada revela a arte personalizada da festa. Depois, o convidado acessa as informações e os atalhos do convite.',book:'Um convite de casamento em páginas que o convidado folheia pelo celular.',infinite:'Um convite em que o convidado desliza a tela para descobrir os detalhes da festa.'};
function formatVisual(code){
 const isFilm=SCENE_PRODUCTS.has(code),interactive=code!=='cinematic_video';
 return '<span aria-hidden="true" class="v3-format-demo v3-demo-'+clean(code)+'"><span class="v3-demo-phone"><span class="v3-demo-screen">'+(code==='book'?'<i class="v3-demo-page"></i>':isFilm?'<i class="v3-demo-film"></i><i class="v3-demo-play"></i><i class="v3-demo-progress"></i>':'<i class="v3-demo-art"></i><i class="v3-demo-title"></i><i class="v3-demo-lines"></i>')+(interactive?'<span class="v3-demo-buttons"><i></i><i></i><i></i></span>':'')+(code==='interactive_animated'?'<i class="v3-demo-cover"></i>':'')+'</span></span></span>';
}
function renderFormats(){
 const codes=formatCodes().filter(code=>getProduct(code));
 const cards=codes.map(code=>{
  const product=getProduct(code),detail=PRODUCTS[code],price=product.variants[0]?.priceCents;
  return '<article class="v3-format-card"><button type="button" class="v3-format-select" data-action="product" data-value="'+clean(code)+'" aria-pressed="'+(state.productCode===code)+'"><span class="v3-choice-copy"><strong>'+clean(detail?.title||product.name)+'</strong><small>'+clean(formatShort[code]||detail?.description||product.shortDescription)+'</small>'+(price!=null?'<span class="v3-price">'+(SCENE_PRODUCTS.has(code)?'A partir de ':'Total ')+money(price)+'</span>':'')+'</span></button><button type="button" class="v3-example-link" data-action="show-examples" data-value="'+clean(code)+'">Ver exemplo real</button></article>';
 }).join('');
 panel('Como seu convidado vai receber?', 'Toque no formato que prefere.', '<div class="v3-format-list">'+cards+'</div>',actions(true,'',null),2);
}
let customScenes=false;
function durationVisual(n){return '<span class="v3-duration-visual" aria-hidden="true">'+Array.from({length:n},(_,i)=>'<i style="--scene-index:'+i+'"></i>').join('')+'</span>';}
function renderScenes() {
 const product=currentProduct();
 if(!product||product.pricingMode!=='scene_count'){state.step='extras';render();return;}
 const options=product.variants.filter(v=>Number.isInteger(Number(v.sceneCount))&&Number(v.sceneCount)>0).sort((a,b)=>a.sceneCount-b.sceneCount);
 const preset=(n,title,description)=>{const v=options.find(x=>Number(x.sceneCount)===n);return v?'<button type="button" class="v3-choice v3-duration-card" data-action="variant" data-value="'+clean(v.code)+'" data-scenes="'+n+'"><span class="v3-choice-copy"><strong>'+title+'</strong><small>'+n+' cenas · '+description+'</small><span class="v3-price">Total '+money(v.priceCents)+'</span></span></button>':'';};
 const extra=customScenes?'<div class="v3-custom-scenes"><label for="v3-scene-select">Quantidade de cenas</label><select class="v3-at-input" id="v3-scene-select"><option value="">Escolha a quantidade</option>'+options.map(v=>'<option value="'+clean(v.code)+'" '+(state.variantCode===v.code?'selected':'')+'>'+Number(v.sceneCount)+(Number(v.sceneCount)===1?' cena':' cenas')+' · Total '+money(v.priceCents)+'</option>').join('')+'</select><button type="button" class="v3-btn v3-btn-primary" data-action="custom-scenes-confirm">Escolher esta duração</button></div>':'';
 panel('Qual tamanho de história você quer?','A abertura já está incluída. Os valores são do convite completo.',
 '<div class="v3-choices-stack">'+preset(3,'Curtinho e encantador','Mais direto')+preset(6,'Uma história completa','Mais momentos e detalhes')+'<button type="button" class="v3-choice v3-duration-card" data-action="custom-scenes" aria-expanded="'+customScenes+'"><span class="v3-choice-copy"><strong>Quero escolher</strong><small>Defina a quantidade de cenas.</small></span></button>'+extra+'</div>',actions(true,'',null),3);
}
function availableGroups() {
  return ADDON_GROUPS.filter(item => {
    if (item[0] === 'confirmation' && !INTERACTIVE.has(state.productCode)) return false;
    if (item[0] === 'filter' && hasGroup('moments')) return false;
    if (item[0] === 'filter' && !(catalog.addons || []).some(a => a.group === 'filter')) return false;
    return catalog.addons.some(a => a.group === item[0]);
  });
}
function priceBar() {
  return quote ? '<div class="v3-total"><div><strong>Total até agora</strong><div><small>Calculado pelo catálogo oficial · Pix</small></div></div><b>' + money(quote.totalCents) + '</b></div>' : '';
}
function renderExtras(){
 const groups=availableGroups();
 const short={save_the_date:'Avise a data com antecedência.',reminder:'Lembre seus convidados perto da festa.',confirmation:'Os convidados confirmam pelo formulário e você acompanha as respostas em um painel, sem lotar seu WhatsApp.',moments:'Reúna as fotos feitas pelos convidados durante a festa em um álbum digital. Inclui filtro personalizado.',filter:'Um efeito de fotos com o tema da festa.'};
 const cards=groups.map(g=>{
  const selected=selectedAddons().filter(a=>a.group===g[0]);
  const price=selected.reduce((n,a)=>n+Number(a.priceCents),0);
  const variants=catalog.addons.filter(a=>a.group===g[0]);const direct=variants.length===1;const text=direct?'+ '+money(variants[0].priceCents)+(selected.length?' · Retirar':' · Adicionar'):selected.length?'+ '+money(price)+' · Alterar':'Ver opções';
  return '<button type="button" class="v3-choice v3-optional-card '+(selected.length?'is-selected':'')+'" data-action="guided-options" data-value="'+clean(g[0])+'" aria-pressed="'+Boolean(selected.length)+'"><span class="v3-choice-copy"><strong>'+clean(g[1])+'</strong><small>'+clean(short[g[0]]||g[2])+'</small>'+(selected.length&&!direct?'<small>'+clean(selected.map(a=>a.name).join(', '))+'</small>':'')+'</span><span class="v3-optional-action">'+text+'</span></button>';
 }).join('');
 const free=INTERACTIVE.has(state.productCode)?'<p class="v3-free-confirmation"><strong>Confirmação pelo WhatsApp: grátis (R$ 0,00).</strong> O convidado toca em Enviar. Para acompanhar as respostas num painel, adicione o formulário personalizado.</p>':'';
 panel('Quer acrescentar algo ao seu convite?','Tudo aqui é opcional. Pode seguir sem adicionar nada.',free+'<div class="v3-optional-list">'+cards+'</div>'+priceBar(),
 '<div class="v3-action-row"><button type="button" class="v3-btn v3-btn-text" data-action="guided-back">Voltar</button><button type="button" class="v3-btn v3-btn-primary" data-action="guided-finish">Conferir meu pedido</button></div>',3);
}
let guidedBusy=false;
async function advanceGuided(group,code){
 if(guidedBusy)return;
 guidedBusy=true;
 try{
 const groups=availableGroups(),index=groups.findIndex(g=>g[0]===group);
 if(index<0)return;
 if(code){const a=getAddon(code);if(!a||a.group!==group)return;}
 const before=[...state.addonCodes],dismissed=[...state.dismissed];
 state.addonCodes=state.addonCodes.filter(c=>groupCode(c)!==group);
 if(code){if(group==='moments')state.addonCodes=state.addonCodes.filter(c=>groupCode(c)!=='filter');state.addonCodes.push(code);state.dismissed=state.dismissed.filter(x=>x!=='addon:'+group);}
 else if(!state.dismissed.includes('addon:'+group))state.dismissed.push('addon:'+group);
 try{await refreshQuote();}catch(e){state.addonCodes=before;state.dismissed=dismissed;throw e;}
 state.offerFinished=false;
 state.addonQuestion=0;render();root.querySelector('[data-action="guided-options"][data-value="'+group+'"]')?.focus({preventScroll:true});
 }finally{guidedBusy=false;}
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
  return '<div class="v3-modal-card v3-offer-card" role="dialog" aria-modal="true" aria-labelledby="v3-offer-title" tabindex="-1"><span class="v3-eyebrow">Uma sugestão para o seu convite</span>' +
    '<h2 id="v3-offer-title">' + clean(offer.title) + '</h2><p>' + clean(offer.description) + '</p>' +
    '<div class="v3-offer-price">' + (offer.delta === 0 ? 'Sem acréscimo' : offer.delta > 0 ? 'Por mais ' + money(offer.delta) : 'Economize ' + money(-offer.delta)) + '</div><p class="v3-mini">No total do pedido. A escolha é opcional.</p>' +
    '<div class="v3-action-row"><button class="v3-btn v3-btn-text" type="button" data-action="dismiss-offer">Agora não</button>' +
    '<button class="v3-btn v3-btn-primary" type="button" data-action="accept-offer">Quero adicionar</button></div></div>';
}
function renderReview() {
  panel('Seu convite', conversationName?clean(conversationName)+', confira se está tudo do jeitinho que você imaginou.':'Confira antes de adicionar ao carrinho.',
    linesHtml() + priceBar(),
    '<div class="v3-action-row"><button class="v3-btn v3-btn-text" type="button" data-action="back">Editar escolhas</button>' +
    '<button class="v3-btn v3-btn-primary" type="button" data-action="add-invitation">Adicionar ao carrinho</button></div>',4);
}
function openOfferModal(){
  const html=offerHtml();if(!html||!modalRoot.hidden)return;
  modalRoot.innerHTML=html;modalRoot.hidden=false;
  modalRoot.querySelector('[role="dialog"]')?.focus({preventScroll:true});
}
function cartDateHtml(){
  if(!cartQuote||cartError||!state.cartItems.length)return '';
  return '<div class="v3-cart-date"><label for="v3CartEventDate">Data da festa</label><input type="date" id="v3CartEventDate" value="'+clean(cartEventDate)+'" class="v3-at-input"><small>Confira o prazo na próxima etapa.</small></div>';
}
let cartExtrasCatalog=Object.create(null);
const EXTRA_INTENTS={
 Personagens:['Quer personalizar mais alguém ou ter outras poses?','Inclua apenas uma nova criação individual ou uma pose além do pacote. Personagens temáticos já previstos não contam como extras.'],
 Identidade:['Precisa de mais peças de identidade visual?','O pacote já contém os itens contratados; estas opções ampliam a quantidade.'],
 Aplicações:['Quer aplicar a identidade em mais peças de papelaria?','Você recebe a arte digital; a impressão não está incluída.'],
 Materiais:['Tem mais fotos, vídeos ou materiais para organizar?','Os materiais devem respeitar os limites contratados e ser enviados pelo WhatsApp.'],
 Edição:['Quer dar um toque especial à retrospectiva?','Mostramos apenas recursos ainda não incluídos no seu pacote.'],
 Ajustes:['Precisa contratar mais uma rodada de ajustes?','As revisões previstas no pacote permanecem incluídas.']
};
let extraFlow=null;
function cartExtrasHtml(item,i){
 const extras=cartExtrasCatalog[item.productCode]||[];if(!extras.length)return '';
 const selected=(item.extras||[]).map(x=>{const extra=extras.find(e=>e.code===x.code);return extra?'<li>'+Number(x.quantity)+' × '+clean(extra.name)+'</li>':'';}).join('');
 return '<div class="v3-package-personalize"><strong>Quer personalizar além do pacote?</strong>'+
 (selected?'<ul class="v3-included">'+selected+'</ul>':'<p class="v3-mini">Seu pacote já está completo. Os extras são opcionais.</p>')+
 '<button type="button" class="v3-btn v3-btn-secondary" data-action="cart-extra-start" data-value="'+i+'">'+(selected?'Alterar adicionais':'Ver opções de personalização')+'</button></div>';
}
function renderExtraQuestion(){
 trackStoreStage('adicionais');
 const f=extraFlow;if(!f)return;
 const item=state.cartItems[f.index];if(!item||item.productCode!==f.productCode){modalClose();return;}
 const all=cartExtrasCatalog[item.productCode]||[],group=f.groups[f.step],choices=all.filter(x=>x.category===group);
 const [question,description]=EXTRA_INTENTS[group]||['Quer acrescentar '+group+'?','Confira as opções e os valores.'];
 const current=f.selection;
 const controls=choices.map(x=>{
 const quantity=current.get(x.code)||0;
 return '<div class="v3-extra-quantity"><div><strong>'+clean(x.name)+'</strong><small>'+money(x.priceCents)+' por unidade</small></div><div class="v3-quantity-actions"><button type="button" class="v3-btn v3-btn-secondary" aria-label="Diminuir '+clean(x.name)+'" data-action="guided-cart-minus" data-value="'+clean(x.code)+'" '+(!quantity?'disabled':'')+'>−</button><b>'+quantity+'</b><button type="button" class="v3-btn v3-btn-secondary" aria-label="Aumentar '+clean(x.name)+'" data-action="guided-cart-plus" data-value="'+clean(x.code)+'" '+(quantity>=x.maxQuantity?'disabled':'')+'>+</button></div></div>';
 }).join('');
 const total=all.reduce((n,x)=>n+x.priceCents*(current.get(x.code)||0),0);
 modalRoot.innerHTML='<div class="v3-modal-card" role="dialog" aria-modal="true" aria-labelledby="v3-extra-title" tabindex="-1"><span class="v3-eyebrow">Personalização opcional · '+(f.step+1)+' de '+f.groups.length+'</span><h2 id="v3-extra-title">'+clean(question)+'</h2><p>'+clean(description)+'</p>'+
 (f.expanded?controls:'<div class="v3-choices-stack">'+choice(group,'Sim, quero ver as opções','Confira os valores e quantidades',null,'guided-cart-expand')+choice(group,'Agora não','Sem acrescentar custo',null,'guided-cart-skip')+'</div>')+
 '<div class="v3-total"><strong>Adicionais selecionados</strong><b>'+money(total)+'</b></div><p class="v3-mini">O total do pedido e os descontos serão recalculados antes de confirmar.</p><div class="v3-action-row">'+(f.step>0?'<button type="button" class="v3-btn v3-btn-text" data-action="guided-cart-back">Voltar</button>':'')+(f.expanded?'<button type="button" class="v3-btn v3-btn-primary" data-action="guided-cart-next">'+(f.step===f.groups.length-1?'Aplicar escolhas':'Continuar')+'</button>':'')+'<button type="button" class="v3-btn v3-btn-text" data-action="close-modal">Cancelar alterações</button></div></div>';
 modalRoot.hidden=false;
}
async function moveExtraFlow({skip=false}={}){
 const f=extraFlow;if(!f)return;
 if(skip){const group=f.groups[f.step];for(const x of cartExtrasCatalog[f.productCode]||[])if(x.category===group)f.selection.delete(x.code);}
 if(f.step<f.groups.length-1){f.step++;f.expanded=(cartExtrasCatalog[f.productCode]||[]).some(x=>x.category===f.groups[f.step]&&f.selection.has(x.code));renderExtraQuestion();return;}
 const item=state.cartItems[f.index];if(!item||item.productCode!==f.productCode){modalClose();return;}
 const proposed=Array.from(f.selection,([code,quantity])=>({code,quantity}));
 const proposedItems=state.cartItems.map((x,i)=>i===f.index?{...x,extras:proposed}:x);
 // No mutation or persistence before the server validates all selected quantities.
 const confirmButton=modalRoot.querySelector('[data-action="guided-cart-next"]');if(confirmButton)confirmButton.disabled=true;
 if(f.busy)return;f.busy=true;
 try{
  const data=await request('/api/v3/cart/quote',{eventType:state.eventType,paymentMethod:'pix',items:proposedItems});
  if(extraFlow!==f)return;
  if(!window.confirm('Confirmar personalização? Novo total no Pix: '+money(data.quote.totalCents)+'. Nenhuma cobrança será criada agora.')){f.busy=false;renderExtraQuestion();return;}
  state.cartItems=proposedItems;modalClose();await openCart();
 }catch(e){f.busy=false;renderExtraQuestion();const msg=document.createElement('p');msg.setAttribute('role','alert');msg.textContent=e.message;modalRoot.querySelector('.v3-modal-card')?.prepend(msg);}
}
function renderCart() {
  trackStoreStage('carrinho');
  const items=state.cartItems;
  const lines=items.map((item,i)=>{
    const priced=cartQuote?.items?.find(x=>x.productCode===item.productCode&&x.variantCode===item.variantCode);
    const product=getProduct(item.productCode);
    const name=priced?.productName||product?.name||ateliePackages.find(p=>'atelie_'+p.code===item.productCode)?.name||'Serviço selecionado';
    const upgrade=priced?.upgradeSuggestion;
    const suggestion=upgrade?'<div class="v3-notice"><strong>Vale conferir o pacote '+clean(upgrade.name)+'</strong><p class="v3-mini">'+(upgrade.savingsCents?'Economize '+money(upgrade.savingsCents)+' antes dos descontos':'Pelo mesmo valor, aproveite um pacote superior')+'. Os extras não contemplados serão mantidos.</p><button type="button" class="v3-btn v3-btn-secondary" data-action="cart-upgrade-preview" data-value="'+i+'">Ver sugestão</button></div>':'';
    return '<article class="v3-cart-item"><div class="v3-line"><div><strong>'+clean(name)+'</strong>'+
      (priced?'<p class="v3-mini">'+clean(priced.variantName||'')+(priced.comboName?' · '+clean(priced.comboName):'')+'</p>':'')+
      (priced?'<b>'+money(priced.totalCents)+'</b>':'')+'</div>'+
      '<div class="v3-cart-edit-actions"><button type="button" class="v3-btn v3-btn-secondary" data-action="cart-edit" data-value="'+i+'">Alterar</button><button type="button" class="v3-btn v3-btn-text" data-action="remove-cart" data-value="'+i+'">Retirar</button></div></div>'+cartExtrasHtml(item,i)+suggestion+'</article>';
  }).join('');
  const totals=cartQuote?'<div class="v3-lines">'+(cartQuote.discountCents?'<div class="v3-line"><span>Subtotal</span><b>'+money(cartQuote.grossCents)+'</b></div>':'')+
    (cartQuote.discountCents?'<div class="v3-line"><span>'+ (cartQuote.combinedDiscountPercent?'Desconto combinado ('+cartQuote.combinedDiscountPercent+'%)':'Desconto do convite') +'</span><b>− '+money(cartQuote.discountCents)+'</b></div>':'')+
    '</div><div class="v3-total"><strong>Total estimado no Pix</strong><b>'+money(cartQuote.totalCents)+'</b></div>':'';
  const notice=cartError?'<div class="v3-notice" role="alert">'+clean(cartError)+'</div>':'';
  panel('Seu carrinho',clean(labelForEvent())+' · confira seu total.',
    '<div class="v3-cart-list">'+(lines||'<p>Seu carrinho está vazio.</p>')+'</div>'+totals+notice+cartDateHtml(),
    '<div class="v3-action-row"><button class="v3-btn v3-btn-secondary" type="button" data-action="cart-more">'+(items.length?'Escolher outro serviço':'Escolher serviço')+'</button>'+
    (items.length&&cartQuote&&!cartError?'<button class="v3-btn v3-btn-primary" type="button" data-action="cart-unified-checkout">Continuar contratação</button>':'')+'</div>',4);
}
function showCartAdded(){
 modalClose();modalRoot.innerHTML='<div class="v3-modal-card" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="v3-added-title"><span class="v3-eyebrow">Seu pedido</span><h2 id="v3-added-title">Adicionado ao carrinho!</h2><p>Você pode contratar mais um serviço ou conferir o pedido.</p><div class="v3-action-row"><button type="button" class="v3-btn v3-btn-secondary" data-action="added-more">Continuar escolhendo</button><button type="button" class="v3-btn v3-btn-primary" data-action="added-view">Ver carrinho</button></div></div>';modalRoot.hidden=false;modalRoot.querySelector('[role="dialog"]')?.focus({preventScroll:true});
}
async function openCart(){
  const revision=cartRevision+1;
  if(state.step==='cart'){cartEventDate=root.querySelector('#v3CartEventDate')?.value||cartEventDate;cartOpenDetails=new Set(Array.from(root.querySelectorAll('details[data-cart-group][open]'),el=>el.dataset.cartGroup));}
  hideBasket();state.step='cart';save();cartQuote=null;cartError='';cartRevision++;
  root.setAttribute('aria-busy','true');
  root.innerHTML='<section class="v3-panel v3-panel--status v3-cart-transition" role="status"><div class="v3-cart-transition-copy"><span class="v3-cart-transition-line" aria-hidden="true"></span><h1>Preparando seu pedido</h1><p>Conferindo suas escolhas e o valor final.</p></div></section>';
  if(state.cartItems.length){
    try {
      const [data]=await Promise.all([request('/api/v3/cart/quote',{eventType:state.eventType,paymentMethod:'pix',items:state.cartItems}),...state.cartItems.map(async item=>{if(!cartExtrasCatalog[item.productCode]){const response=await request('/api/v3/extras/catalog?productCode='+encodeURIComponent(item.productCode));cartExtrasCatalog[item.productCode]=response.extras||[];}})]);
      if(revision!==cartRevision||state.step!=='cart')return;
      cartQuote=data.quote;
    } catch(e){if(revision!==cartRevision||state.step!=='cart')return;cartError=e.message||'Não foi possível conferir o carrinho. Revise os serviços selecionados.';}
  }
  if(revision!==cartRevision||state.step!=='cart')return;
  renderCart();window.scrollTo({top:0,behavior:'auto'});
}
function render() {
  if(shouldAskName()){renderWelcome();return;}
  trackStoreStage(({event:'evento',creation:'servico',unready:'servico',atelie:'modelo','atelie-detail':'configuracao','atelie-checkout':'dados',intent:'modelo',format:'modelo',scenes:'configuracao',extras:'adicionais',review:'revisao',cart:'carrinho'})[state.step]||'evento');
  save();
  switch(state.step) {
    case 'event': renderEvent(); break;
    case 'event-subtype': renderEventSubtype();break;
    case 'creation': renderCreation(); break;
    case 'unready': renderUnready(); break;
    case 'atelie': renderAtelie(); break;
    case 'atelie-detail': renderAtelieDetail(); break;
    case 'atelie-checkout': openCart().catch(e=>message(e.message));break;
    case 'intent': renderIntent(); break;
    case 'format': renderFormats(); break;
    case 'scenes': renderScenes(); break;
    case 'extras': renderExtras(); break;
    case 'review': renderReview();openOfferModal(); break;
    case 'cart': renderCart(); break;
    default: state.step='event';renderEvent();
  }
}
function modalClose() {
  if(modalRoot.querySelector('.v3-offer-card')&&offer&&!state.offerFinished){
    state.dismissed.push(offer.id);state.offerFinished=true;offer=null;save();
  }
  extraFlow=null;
  modalRoot.hidden = true;
  modalRoot.innerHTML = '';
}
async function showExamples(code){
 if(!getProduct(code)||!formatCodes().includes(code))return;
 modalRoot.hidden=false;modalRoot.innerHTML='<div class="v3-modal-card" role="dialog" aria-modal="true" tabindex="-1"><h2>Exemplos deste formato</h2><p class="v3-inline-loading" role="status"><span class="v3-inline-line" aria-hidden="true"></span>Preparando os exemplos…</p><button type="button" class="v3-btn v3-btn-text" data-action="close-modal">Voltar</button></div>';
 try{
  const response=await request('/api/v2/gallery?productCode='+encodeURIComponent(code)+'&eventType='+encodeURIComponent(state.eventType));
  const cards=(response.items||[]).filter(x=>x.productCode===code).slice(0,8).map(x=>{
    const media=/^\/api\/v2\/gallery\/\d+\/media$/.test(x.mediaPath||'')?x.mediaPath:'';
    const preview=/^\/api\/v2\/gallery\/\d+\/preview$/.test(x.previewPath||'')?x.previewPath:'';
    const url=/^https:\/\//i.test(x.externalUrl||'')?x.externalUrl:'';
    return '<article class="v3-gallery-example">'+(preview?'<img src="'+clean(preview)+'" loading="lazy" alt="Exemplo da Libri">':media&&x.mediaType==='image'?'<img src="'+clean(media)+'" loading="lazy" alt="Exemplo da Libri">':'')+
      (media&&x.mediaType==='video'?'<video controls playsinline preload="none" '+(preview?'poster="'+clean(preview)+'" ':'')+'src="'+clean(media)+'"></video>':'')+
      (url?'<a href="'+clean(url)+'" target="_blank" rel="noopener noreferrer">Abrir exemplo</a>':'')+
      (x.themeLabel?'<strong>'+clean(x.themeLabel)+'</strong>':'')+(x.caption?'<p>'+clean(x.caption)+'</p>':'')+'</article>';
  }).join('');
  if(modalRoot.hidden)return;
  modalRoot.innerHTML='<div class="v3-modal-card" role="dialog" aria-modal="true" aria-labelledby="v3-example-title" tabindex="-1"><h2 id="v3-example-title">'+clean(PRODUCTS[code]?.title||'Exemplos')+'</h2><p>Veja exemplos reais disponíveis deste formato. A arte do seu pedido será personalizada.</p><div class="v3-gallery-grid">'+(cards||'<p>Ainda não há exemplos publicados desse formato para esta celebração. Você pode falar com a Libri para saber mais.</p>')+'</div><button type="button" class="v3-btn v3-btn-secondary" data-action="close-modal">Voltar às opções</button></div>';
 }catch(e){if(!modalRoot.hidden)modalRoot.innerHTML='<div class="v3-modal-card" role="dialog" aria-modal="true"><p>Não foi possível carregar a galeria agora. Sua escolha foi mantida.</p><button type="button" class="v3-btn v3-btn-secondary" data-action="close-modal">Voltar</button></div>';}
 modalRoot.querySelector('[role="dialog"]')?.focus();
}
function openAddonGroup(group,guided=false) {
  const variants = (catalog?.addons || []).filter(a => a.group === group);
  if (!variants.length) return;
  const groupItem = ADDON_GROUPS.find(x=>x[0]===group);
  const selected = state.addonCodes.find(code => groupCode(code) === group);
  const explanations = {
    save_the_date:'Escolha se prefere uma imagem sem movimento ou uma pequena animação.',
    reminder:'Escolha se prefere uma imagem sem movimento ou uma pequena animação.',
    moments:'Escolha um plano conforme a quantidade de fotos e o período em que o álbum ficará disponível.',
    confirmation:'O convidado responde no próprio convite, e você acompanha as confirmações em um painel.',
    filter:'O filtro personalizado já vem incluído no álbum de fotos.'
  };
  modalRoot.innerHTML = '<div class="v3-modal-card" role="dialog" aria-modal="true" aria-labelledby="v3-modal-title" tabindex="-1">' +
    '<h2 id="v3-modal-title">'+clean(groupItem?.[1]||'Adicional')+'</h2><p>'+clean(explanations[group]||groupItem?.[2]||'')+'</p>' +
    '<div class="v3-modal-actions">' + variants.map(a=>{
      const extra = a.config?.photoLimit ? ' · até '+a.config.photoLimit+' fotos' : '';
      return '<button type="button" class="v3-choice '+(selected===a.code?'is-selected':'')+'" data-action="'+(guided?'guided-addon':'select-addon')+'" data-value="'+clean(a.code)+'">' +
        '<strong>'+clean(a.name)+'</strong><small>'+clean(extra || (a.code.endsWith('_animated')?'Com movimento':a.code.endsWith('_static')?'Sem movimento':''))+'</small>' +
        '<span class="v3-price">+ '+money(a.priceCents)+'</span></button>';
    }).join('') +
    (selected ? '<button class="v3-btn v3-btn-secondary" data-action="'+(guided?'guided-skip':'remove-addon')+'" data-value="'+clean(group)+'">Retirar esse adicional</button>' : '') +
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
    loading('Preparando os detalhes','Estamos conferindo os valores do seu convite.');
    try {await refreshQuote(); offer=target==='review'?await determineOffer():null;}
    catch(e) {message(e.message);return;}
  }
  render();
  window.scrollTo({top:0,behavior:'auto'});
}
let storeActionBusy=false;
async function handleStoreClick(event) {
  const button=event.target.closest('[data-action]');
  if (!button||storeActionBusy) return;
  const action=button.dataset.action, value=button.dataset.value;
  storeActionBusy=true;
  try {
    if(action==='skip-intro'){sessionStorage.setItem('libriV3IntroSeen','1');render();return;}
    if(action==='welcome-skip'){finishWelcome();return;}
    if(action==='retry'){await init();return;}
    if(action==='event'){if(!EVENTS.some(x=>x[0]===value))return;if(state.eventType===value){await go(EVENT_SUBTYPES[value]?'event-subtype':'creation');return;}if(state.eventType!==value&&state.cartItems.length&&!window.confirm('Alterar o tipo de evento? Os serviços serão mantidos no carrinho, mas os valores e as condições precisarão ser conferidos novamente.'))return;state.eventType=value;state.eventSubtype='';state.creation='';state.ateliePackage='';state.intent='';state.productCode='';state.variantCode='';state.addonCodes=[];state.addonQuestion=0;quote=null;liveQuoteKey='';await go(EVENT_SUBTYPES[value]?'event-subtype':'creation');return;}
    if(action==='event-subtype'){if(!(EVENT_SUBTYPES[state.eventType]||[]).some(x=>x[0]===value))return;state.eventSubtype=value;await go('creation');return;}
    if(action==='creation'){if(!['invitation','identity','retrospective'].includes(value))return;if(state.creation!==value)state.ateliePackage='';state.creation=value;await go(value==='invitation'?'intent':value==='identity'?'atelie':'unready');return;}
    if(action==='atelie-package'){if(!ateliePackages.some(p=>p.code===value))return;state.ateliePackage=value;await go('atelie-detail');return;}
    if(action==='atelie-detail'){if(state.ateliePackage)await go('atelie-detail');return;}
    if(action==='retro-buy'){
      const item=retrosPackages.find(p=>p.code===value);
      if(!item?.previewAvailable)return message('Pacote indisponível.');
      if(putCart({productCode:item.productCode,variantCode:item.variantCode,addonCodes:[]}))showCartAdded();return;
    }
    if(action==='atelie-buy'){
      const item=ateliePackages.find(p=>p.code===state.ateliePackage);
      if(!item?.purchaseAvailable||!item.variantCode)return message('Pacote indisponível para compra.');
      if(putCart({productCode:'atelie_'+item.code,variantCode:item.variantCode,addonCodes:[]}))showCartAdded();return;
    }
    if(action==='intent'){if(!['story','simple'].includes(value))return;if(state.intent!==value){if(state.addonCodes.length&&!confirm('Mudar o estilo? Os adicionais desta seleção serão revistos. O carrinho permanece salvo.'))return;state.intent=value;state.productCode='';state.variantCode='';state.addonCodes=[];state.addonQuestion=0;quote=null;liveQuoteKey='';}await go('format');return;}
    if(action==='product'){
      const product=getProduct(value);if(!product||!formatCodes().includes(value))return;
      if(value===state.productCode&&(SCENE_PRODUCTS.has(value)||currentVariant())){customScenes=false;await go(SCENE_PRODUCTS.has(value)?'scenes':'extras');return;}
      if(state.addonCodes.length&&!confirm('Mudar o formato? Os adicionais desta seleção serão revistos. O carrinho permanece salvo.'))return;
      state.productCode=value;
      state.variantCode=product.pricingMode==='scene_count'?'':product.variants[0]?.code||'';
      state.addonCodes=[];state.addonQuestion=0;
      state.offerFinished=false;state.dismissed=[];
      quote=null;liveQuoteKey='';customScenes=false;await go(SCENE_PRODUCTS.has(value)?'scenes':'extras');return;
    }
    if(action==='custom-scenes'){customScenes=!customScenes;render();if(customScenes)root.querySelector('#v3-scene-select')?.focus({preventScroll:true});if(customScenes)root.querySelector('.v3-custom-scenes')?.scrollIntoView({block:'nearest',behavior:'auto'});return;}
    if(action==='variant'||action==='custom-scenes-confirm'){const code=action==='variant'?value:root.querySelector('#v3-scene-select')?.value;if(state.step!=='scenes'||!currentProduct()?.variants.some(v=>v.code===code)){root.querySelector('#v3-scene-select')?.focus();return;}state.variantCode=code;state.offerFinished=false;state.addonQuestion=0;customScenes=false;await go('extras');return;}
    if(action==='show-examples'){await showExamples(value);return;}
    if(action==='guided-options'){if(!guidedBusy){const variants=catalog.addons.filter(a=>a.group===value);if(variants.length===1)await advanceGuided(value,hasGroup(value)?null:variants[0].code);else openAddonGroup(value,true);}return;}
    if(action==='guided-addon'||action==='guided-skip'){modalClose();button.disabled=true;try{await advanceGuided(action==='guided-addon'?groupCode(value):value,action==='guided-addon'?value:null);}finally{button.disabled=false;}return;}
    if(action==='guided-back'){if(guidedBusy)return;state.addonQuestion=0;await go(SCENE_PRODUCTS.has(state.productCode)?'scenes':'format');return;}
    if(action==='guided-finish'){if(guidedBusy)return;state.addonQuestion=0;for(const g of availableGroups())if(!hasGroup(g[0])&&!state.dismissed.includes('addon:'+g[0]))state.dismissed.push('addon:'+g[0]);await go('review');return;}
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
      if(offer)state.dismissed.push(offer.id);state.offerFinished=true;offer=null;modalClose();render();return;
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
      state.offerFinished=true;offer=null;modalClose();await go('review');return;
    }
    if(action==='add-invitation'){
      if(!currentVariant()||!quote||liveQuoteKey!==quoteKey())return message('Confira a configuração do convite.');
      if(putCart({productCode:state.productCode,variantCode:state.variantCode,addonCodes:[...state.addonCodes],comboCode:quote.combo?.code||''}))showCartAdded();return;
    }
    if(action==='added-more'){modalClose();await go('creation');return;} if(action==='added-view'){modalClose();await openCart();return;} if(action==='open-cart'){await openCart();return;}
    if(action==='cart-more'){cartEventDate=root.querySelector('#v3CartEventDate')?.value||cartEventDate;await go('creation');return;}
    if(action==='cart-edit'){
      const item=state.cartItems[Number(value)];if(!item)return;
      cartEventDate=root.querySelector('#v3CartEventDate')?.value||cartEventDate;
      const family=cartFamily(item.productCode);state.creation=family;
      if(family==='invitation'){state.productCode=item.productCode;state.variantCode=item.variantCode;state.intent=SCENE_PRODUCTS.has(item.productCode)?'story':'simple';state.addonCodes=[...item.addonCodes];state.addonQuestion=0;state.offerFinished=true;state.dismissed=[];await go('review');}
      else if(family==='identity'){state.ateliePackage=item.productCode.replace(/^atelie_/,'');await go('atelie-detail');}
      else await go('unready');
      return;
    }
    if(action==='remove-cart'){
      const i=Number(value);
      if(Number.isInteger(i)&&i>=0&&i<state.cartItems.length)state.cartItems.splice(i,1);
      await openCart();return;
    }
    if(action==='cart-upgrade-preview'){
      const i=Number(value),item=state.cartItems[i];
      const s=cartQuote?.items?.find(x=>x.productCode===item?.productCode&&x.variantCode===item?.variantCode)?.upgradeSuggestion;
      if(!s||cartError)return;
      modalRoot.innerHTML='<div class="v3-modal-card v3-offer-card" role="dialog" aria-modal="true" aria-labelledby="v3-package-offer" tabindex="-1"><span class="v3-eyebrow">Uma sugestão para seu pedido</span><h2 id="v3-package-offer">Conheça o pacote '+clean(s.name)+'</h2><p>Os extras não contemplados serão mantidos.</p><div class="v3-offer-price">'+(s.savingsCents?'Economize '+money(s.savingsCents)+' antes dos descontos':'Pelo mesmo valor')+'</div><div class="v3-action-row"><button type="button" class="v3-btn v3-btn-text" data-action="close-modal">Agora não</button><button type="button" class="v3-btn v3-btn-primary" data-action="cart-upgrade" data-value="'+i+'">Trocar pacote</button></div></div>';modalRoot.hidden=false;modalRoot.querySelector('[role="dialog"]')?.focus({preventScroll:true});return;
    }
    if(action==='cart-upgrade'){
      const i=Number(value),item=state.cartItems[i];
      const suggestion=cartQuote?.items?.find(x=>x.productCode===item?.productCode&&x.variantCode===item?.variantCode)?.upgradeSuggestion;
      if(!item||!suggestion||cartError)return;
      state.cartItems[i]={productCode:suggestion.productCode,variantCode:suggestion.variantCode,addonCodes:[],extras:suggestion.extras};
      modalClose();await openCart();return;
    }
    if(action==='cart-extra-start'){
      const i=Number(value),item=state.cartItems[i],extras=cartExtrasCatalog[item?.productCode]||[];if(!extras.length)return;
      extraFlow={index:i,productCode:item.productCode,groups:[...new Set(extras.map(x=>x.category))],step:0,expanded:false,selection:new Map((item.extras||[]).map(x=>[x.code,x.quantity]))};
      extraFlow.expanded=extras.some(x=>x.category===extraFlow.groups[0]&&extraFlow.selection.has(x.code));renderExtraQuestion();modalRoot.querySelector('[role="dialog"]')?.focus();return;
    }
    if(action.startsWith('guided-cart-')){
      const f=extraFlow;if(!f||f.busy)return;
      if(action==='guided-cart-expand'){f.expanded=true;renderExtraQuestion();return;}
      if(action==='guided-cart-back'){f.step=Math.max(0,f.step-1);f.expanded=(cartExtrasCatalog[f.productCode]||[]).some(x=>x.category===f.groups[f.step]&&f.selection.has(x.code));renderExtraQuestion();return;}
      if(action==='guided-cart-next'||action==='guided-cart-skip'){await moveExtraFlow({skip:action==='guided-cart-skip'});return;}
      const extra=(cartExtrasCatalog[f.productCode]||[]).find(x=>x.code===value&&x.category===f.groups[f.step]);if(!extra)return;
      const n=Math.max(0,Math.min(extra.maxQuantity,(f.selection.get(value)||0)+(action==='guided-cart-plus'?1:-1)));
      if(n)f.selection.set(value,n);else f.selection.delete(value);
      renderExtraQuestion();return;
    }
    if(action==='cart-unified-checkout'||action==='cart-single-checkout'){
      if(!cartQuote||cartError||!state.cartItems.length)return;
      cartEventDate=root.querySelector('#v3CartEventDate')?.value||cartEventDate;
      state.step='cart';save();
      hideBasket();mountV3Checkout(root,{items:state.cartItems,eventType:state.eventType,eventSubtype:state.eventSubtype||'',eventDate:cartEventDate,preferredName:conversationName,contactDraft:checkoutContactDraft,simulationMode,request,onBack:draft=>{checkoutContactDraft=draft||{};if(draft?.eventDate)cartEventDate=draft.eventDate;return openCart();}});
      return;
    }
    if(action==='back'){
      const previous={
        'event-subtype':'event',creation:EVENT_SUBTYPES[state.eventType]?'event-subtype':'event',unready:'creation',atelie:'creation','atelie-detail':'atelie',intent:'creation',
        format:'intent',scenes:'format',
        extras:SCENE_PRODUCTS.has(state.productCode)?'scenes':'format',
        review:'extras'
      };
      await go(previous[state.step]||'event');return;
    }
    if(action==='next'){
      const next={event:EVENT_SUBTYPES[state.eventType]?'event-subtype':'creation','event-subtype':'creation',creation:state.creation==='invitation'?'intent':state.creation==='identity'?'atelie':'unready',
        intent:'format',
        format:SCENE_PRODUCTS.has(state.productCode)?'scenes':'extras',
        scenes:'extras',extras:'review'};
      if(state.step==='event'&&!state.eventType)return message('Escolha o tipo de evento para continuar.');
      if(state.step==='event-subtype'&&!state.eventSubtype)return message('Escolha o tipo de celebração para continuar.');
      if(state.step==='creation'&&!state.creation)return message('Escolha o que gostaria de criar.');
      if(state.step==='intent'&&!state.intent)return message('Escolha o estilo do convite.');
      if(state.step==='format'&&!state.productCode)return message('Escolha o formato do convite.');
      if(state.step==='scenes'&&!state.variantCode)return message('Escolha quantas cenas quer no vídeo.');
      await go(next[state.step]||'event');
    }
  }catch(err){message(err.message || 'Não foi possível continuar.');}finally{storeActionBusy=false;}
}
root.addEventListener('click',handleStoreClick);
modalRoot.addEventListener('click',event=>{
 if(event.target===modalRoot)modalClose();else handleStoreClick(event);
});
document.addEventListener('keydown', event => {
  if(event.key==='Escape'&&!modalRoot.hidden)modalClose();
});
async function init({skipRecovery=false}={}) {
  if(!simulationMode&&!skipRecovery&&pendingV3CheckoutKey()){
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
  if(state.step==='cart'||state.step==='atelie-checkout'){await openCart();return;}
  if(state.step==='extras'||state.step==='review'){await go(state.step);return;}
  if(state.productCode&&state.variantCode&&['format','scenes'].includes(state.step))await refreshQuote();
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!simulationMode&&!sessionStorage.getItem('libriV3IntroSeen')&&state.step==='event'&&!reduced){
    intro();
    window.setTimeout(()=>{
      if(!sessionStorage.getItem('libriV3IntroSeen')){
        sessionStorage.setItem('libriV3IntroSeen','1');
        render();
      }
    },2300);
  }else render();
}
if(!simulationMode)mountStorePrivacy();
// V3 keeps the privacy controls accessible inside its single viewport.
const site=document.querySelector('.v3-site'),privacy=document.getElementById('libri-privacy');
if(site&&privacy)site.append(privacy);
init().catch(err=>message(err.message));
