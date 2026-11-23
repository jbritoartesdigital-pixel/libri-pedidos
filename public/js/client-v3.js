// Libri Pedidos V3 | etapa 1: prévia isolada e não transacional.
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
let catalog = null, quote = null, offer = null;
let state;
try {
  state = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
} catch {
  state = null;
}
if (!state || typeof state !== 'object') state = {};
state = {
  eventType: '', creation: '', intent: '', productCode: '', variantCode: '',
  addonCodes: [], step: 'event', offerFinished: false, dismissed: [],
  ...state
};
if (!Array.isArray(state.addonCodes)) state.addonCodes = [];
if (!Array.isArray(state.dismissed)) state.dismissed = [];
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
function stepBar(index) {
  return '<div class="v3-steps" aria-hidden="true">' +
    Array.from({length:5},(_,i)=>'<span class="' + (i<=index ? 'is-active' : '') + '"></span>').join('') +
    '</div>';
}
function panel(title, subtitle, content, buttons, index=0) {
  root.innerHTML = '<section class="v3-panel">' + stepBar(index) +
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
    '<strong>' + clean(title) + '</strong>' + (subtitle ? '<small>' + clean(subtitle) + '</small>' : '') +
    (price != null ? '<span class="v3-price">' + money(price) + '</span>' : '') + '</button>';
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
  const cards = [
    ['invitation','Convite digital','Um vídeo animado ou um convite que abre no celular e facilita a vida dos convidados.'],
    ['identity','Identidade visual','Uma coleção de artes combinando com o tema da festa.'],
    ['retrospective','Retrospectiva','Um vídeo com suas fotos e momentos especiais.']
  ];
  panel('O que gostaria de criar?', 'Escolha por onde quer começar. Depois mostramos as opções com calma.',
    '<div class="v3-choices-stack">' +
    cards.map(item => choice(item[0],item[1],item[2],state.creation,'creation')).join('') + '</div>',
    actions(true,'Continuar'),1);
}
function renderUnready() {
  const identity = state.creation === 'identity';
  panel(identity ? 'Identidade Visual' : 'Retrospectiva',
    'Essa categoria fará parte da V3. Por enquanto, o novo cadastro de pacotes ainda está em desenvolvimento.',
    '<div class="v3-notice"><strong>Sem valores inventados.</strong> A venda automática ficará disponível quando os pacotes e preços estiverem configurados no catálogo oficial. A loja atual segue funcionando normalmente.</div>',
    '<div class="v3-action-row"><button class="v3-btn v3-btn-text" type="button" data-action="back">Voltar</button><a href="/pedido" class="v3-btn v3-btn-primary">Abrir loja atual</a></div>',1);
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
function renderExtras() {
  const free = INTERACTIVE.has(state.productCode)
    ? '<div class="v3-notice"><strong>Já incluído: confirmação simples pelo WhatsApp · R$ 0,00.</strong> O convidado toca na opção, o WhatsApp abre com uma mensagem pronta, e ele só precisa tocar em Enviar. Não tem painel de convidados.</div>' : '';
  panel('Gostaria de completar seu pedido?',
    'Aqui você pode acrescentar artes e serviços. Tudo é opcional, e o preço aparece antes de adicionar.',
    free + '<div class="v3-choices-stack">' + availableGroups().map(addonCard).join('') + '</div>' + priceBar(),
    actions(true,'Conferir meu pedido'),4);
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
  panel('Seu pedido está tomando forma!', 'Confira suas escolhas. Este é um teste da V3; o pagamento continua na loja atual.',
    '<div class="v3-notice"><b>' + clean(labelForEvent()) + '</b> · ' + clean(PRODUCTS[state.productCode]?.title || '') +
    '</div>' + linesHtml() + priceBar() + offerHtml() +
    '<p class="v3-mini">Você ainda vai escolher a data da festa, conferir a agenda, revisar o total final e aceitar as condições na loja atual. Nenhum pagamento é criado nesta prévia.</p>',
    '<div class="v3-action-row"><button class="v3-btn v3-btn-text" type="button" data-action="back">Editar escolhas</button>' +
    '<button class="v3-btn v3-btn-primary" type="button" data-action="handoff">Continuar na loja atual</button></div>',4);
}
function render() {
  save();
  switch(state.step) {
    case 'event': renderEvent(); break;
    case 'creation': renderCreation(); break;
    case 'unready': renderUnready(); break;
    case 'intent': renderIntent(); break;
    case 'format': renderFormats(); break;
    case 'scenes': renderScenes(); break;
    case 'extras': renderExtras(); break;
    case 'review': renderReview(); break;
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
    if(action==='event'){state.eventType=value;state.creation='';state.intent='';state.productCode='';state.variantCode='';state.addonCodes=[];render();return;}
    if(action==='creation'){state.creation=value;render();return;}
    if(action==='intent'){state.intent=value;state.productCode='';state.variantCode='';state.addonCodes=[];render();return;}
    if(action==='product'){
      const product=getProduct(value);if(!product)return;
      state.productCode=value;
      state.variantCode=product.pricingMode==='scene_count'?'':product.variants[0]?.code||'';
      state.addonCodes=[];
      state.offerFinished=false;state.dismissed=[];
      quote=null;render();return;
    }
    if(action==='variant'){state.variantCode=value;state.offerFinished=false;render();return;}
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
    if(action==='handoff'){handoff();return;}
    if(action==='back'){
      const previous={
        creation:'event',unready:'creation',intent:'creation',
        format:'intent',scenes:'format',
        extras:SCENE_PRODUCTS.has(state.productCode)?'scenes':'format',
        review:'extras'
      };
      await go(previous[state.step]||'event');return;
    }
    if(action==='next'){
      const next={event:'creation',creation:state.creation==='invitation'?'intent':'unready',
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
async function init() {
  root.setAttribute('aria-busy','true');
  const result=await request('/api/v2/catalog');
  catalog=result.catalog;
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
