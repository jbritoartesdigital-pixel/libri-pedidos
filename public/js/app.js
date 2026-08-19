const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  step: 0,
  draftToken: null,
  catalog: null,
  terms: null,
  selection: {
    experience: '',
    format: '',
    addons: { confirmation: false, filter: false, extraScene: 0, extraPerson: 0 },
  },
  briefing: {
    customerName: '', whatsapp: '', honoreeName: '', displayName: '', age: '',
    eventDate: '', eventTime: '', venueName: '', venueAddress: '', locationUrl: '', theme: '',
    characterWanted: '', mustHave: '', avoid: '', specialInfo: '',
    childStyle: 'libri', outfitChoice: 'libri', appearanceDetails: '',
    colors: '', creativeIdea: '', speechPreference: 'libri', ownSpeech: '',
    confirmationMode: 'unsure',
  },
  portfolioConsent: null,
  termsAccepted: false,
  quote: null,
};

const landing = $('#landing');
const flow = $('#flow');
const stepCard = $('#stepCard');
const finalScreen = $('#finalScreen');
const continueBtn = $('#continueOrder');
const helpWhatsapp = $('#helpWhatsapp');

function money(cents = 0) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
}
function esc(v = '') {
  return String(v).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}
function whatsappLink(number, text) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return '#';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
function setHelpLink() {
  const number = state.catalog?.contact?.libriWhatsapp || '';
  helpWhatsapp.href = whatsappLink(number, 'Oi! Preciso de ajuda para preencher meu pedido no Portal da Libri Convites.');
  if (!number) helpWhatsapp.classList.add('hidden');
}
function modal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalContent').innerHTML = html;
  $('#modalBackdrop').classList.remove('hidden');
}
$('#closeModal').addEventListener('click', () => $('#modalBackdrop').classList.add('hidden'));
$('#modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') e.currentTarget.classList.add('hidden'); });

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Não foi possível concluir.'), { data, status: response.status });
  return data;
}

async function bootstrap() {
  const [catalogData, termsData] = await Promise.all([api('/api/catalog'), api('/api/terms/current')]);
  state.catalog = catalogData.catalog;
  state.terms = termsData.terms;
  setHelpLink();
  const savedToken = localStorage.getItem('libriDraftToken');
  if (savedToken) continueBtn.classList.remove('hidden');
}

async function createDraft() {
  const data = await api('/api/drafts', { method: 'POST', body: '{}' });
  state.draftToken = data.draft.token;
  localStorage.setItem('libriDraftToken', state.draftToken);
  state.step = 0;
  await saveDraft();
}

async function loadDraft() {
  const token = localStorage.getItem('libriDraftToken');
  if (!token) return false;
  try {
    const data = await api(`/api/drafts/${token}`);
    const d = data.draft.data || {};
    state.draftToken = token;
    state.step = Number(data.draft.step || 0);
    state.selection = { ...state.selection, ...(d.selection || {}), addons: { ...state.selection.addons, ...(d.selection?.addons || {}) } };
    state.briefing = { ...state.briefing, ...(d.briefing || {}) };
    state.portfolioConsent = typeof d.portfolioConsent === 'boolean' ? d.portfolioConsent : null;
    state.termsAccepted = Boolean(d.termsAccepted);
    return true;
  } catch {
    localStorage.removeItem('libriDraftToken');
    return false;
  }
}

async function saveDraft() {
  if (!state.draftToken) return;
  $('#saveStatus').textContent = 'Salvando...';
  await api(`/api/drafts/${state.draftToken}`, {
    method: 'PUT',
    body: JSON.stringify({
      step: state.step,
      data: {
        selection: state.selection,
        briefing: state.briefing,
        portfolioConsent: state.portfolioConsent,
        termsAccepted: state.termsAccepted,
      },
    }),
  });
  $('#saveStatus').textContent = 'Salvo automaticamente';
}

function startFlow() {
  landing.classList.add('hidden');
  finalScreen.classList.add('hidden');
  flow.classList.remove('hidden');
  render();
}

function progress() {
  const label = `Etapa ${state.step + 1} de 6`;
  $('#progressLabel').textContent = label;
  $('#progressBar').style.width = `${((state.step + 1) / 6) * 100}%`;
}

async function refreshQuote() {
  if (!state.selection.experience || !state.selection.format) {
    state.quote = null;
    return;
  }
  const data = await api('/api/quote', { method: 'POST', body: JSON.stringify({ selection: state.selection }) });
  state.quote = data.quote;
}

function exampleUrl(experience, format = 'interactive') {
  const ex = state.catalog?.examples || {};
  if (format === 'video') return experience === 'reduced' ? ex.videoReduced : ex.videoFull;
  return experience === 'reduced' ? ex.interactiveReduced : ex.interactiveFull;
}
function openExample(url) {
  if (!url) return modal('Exemplo', '<p class="muted">O exemplo ainda será configurado pela Libri.</p>');
  window.open(url, '_blank', 'noopener');
}

function choice(name, value, title, desc, checked, extra = '') {
  return `<label class="choice"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><strong>${title}</strong><p>${desc}</p>${extra}</label>`;
}

async function renderProduct() {
  await refreshQuote();
  const s = state.selection;
  const q = state.quote;
  const showPrice = Boolean(s.experience && s.format);
  const fullUrl = exampleUrl('full', 'interactive');
  const reducedUrl = exampleUrl('reduced', 'interactive');
  stepCard.innerHTML = `
    <h2>Escolha seu convite ✨</h2>
    <p class="lead">Primeiro escolha a experiência. O valor aparece depois que você escolher também o formato.</p>

    <h3>Qual experiência você prefere?</h3>
    <div class="choice-grid" id="experienceChoices">
      ${choice('experience','full','✨ Experiência Completa','Mais cenas e mais momentos no convite.',s.experience==='full','<span class="tag">Mais escolhida</span>')}
      ${choice('experience','reduced','💛 Experiência Reduzida','Uma versão mais curta, com menos cenas.',s.experience==='reduced')}
    </div>
    <div class="row">
      <button class="btn btn-ghost btn-small" data-example="${esc(fullUrl)}">Ver exemplo completo</button>
      <button class="btn btn-ghost btn-small" data-example="${esc(reducedUrl)}">Ver exemplo reduzido</button>
    </div>

    <div id="formatBlock" class="${s.experience ? '' : 'hidden'}">
      <h3 style="margin-top:24px">Como você quer receber?</h3>
      <div class="choice-grid" id="formatChoices">
        ${choice('format','video','🎬 Em Vídeo','Você recebe o convite em vídeo para enviar pelo WhatsApp.',s.format==='video')}
        ${choice('format','interactive','✨ Interativo','Um convite que abre pelo link e tem botões para tocar, como localização, presentes e confirmação.',s.format==='interactive')}
      </div>
      ${s.format ? `<button class="btn btn-ghost btn-small" id="formatExample">Ver exemplo</button>` : ''}
    </div>

    <div id="commercialBlock" class="${showPrice ? '' : 'hidden'}">
      <div class="summary">
        <div class="muted small">Seu convite</div>
        <div class="money-big">${showPrice ? money(q.productCents) : ''}</div>
      </div>

      <h3>Quer acrescentar algo?</h3>
      <div>
        <div class="addon">
          <div><strong>✅ Confirmação de presença Libri</strong><p>Tenha uma lista organizada de quem vai à festa, sem precisar ficar perguntando pelo WhatsApp.</p><button class="btn btn-ghost btn-small" data-special-example="confirmation">Ver como funciona</button></div>
          <div><div class="addon-price">+ ${money(state.catalog.addons.confirmation)}</div><label class="small"><input type="checkbox" id="addonConfirmation" ${s.addons.confirmation ? 'checked' : ''}> Adicionar</label></div>
        </div>
        <div class="addon">
          <div><strong>✨ Filtro personalizado da festa</strong><p>Um filtro feito para o evento, para os convidados usarem nas fotos.</p><button class="btn btn-ghost btn-small" data-special-example="filter">Ver exemplo</button></div>
          <div><div class="addon-price">+ ${money(state.catalog.addons.filter)}</div><label class="small"><input type="checkbox" id="addonFilter" ${s.addons.filter ? 'checked' : ''}> Adicionar</label></div>
        </div>
        <div class="addon">
          <div><strong>🎬 Cena extra</strong><p>Mais uma cena no convite.</p></div>
          <div><div class="addon-price">+ ${money(state.catalog.addons.extraScene)} cada</div><div class="stepper"><button data-stepper="extraScene" data-delta="-1">−</button><span>${s.addons.extraScene || 0}</span><button data-stepper="extraScene" data-delta="1">+</button></div></div>
        </div>
        <div class="addon">
          <div><strong>👧 Outra criança ou pessoa</strong><p>Inclua mais uma pessoa na criação.</p></div>
          <div><div class="addon-price">+ ${money(state.catalog.addons.extraPerson)} cada</div><div class="stepper"><button data-stepper="extraPerson" data-delta="-1">−</button><span>${s.addons.extraPerson || 0}</span><button data-stepper="extraPerson" data-delta="1">+</button></div></div>
        </div>
      </div>

      <div class="notice notice-warning" style="margin-top:14px">
        <strong>Precisa antes de ${state.catalog.rules.deadlineBusinessDays} dias úteis?</strong><br>
        A urgência depende da disponibilidade da Libri e, quando aprovada, acrescenta ${state.catalog.rules.urgencyPercent}% ao pedido.
        <div><a id="urgencyLink" target="_blank" rel="noopener">Consultar urgência pelo WhatsApp</a></div>
      </div>

      <div class="summary" id="quoteSummary">
        <div class="summary-line"><span>Total até agora</span><strong>${money(q.totalCents)}</strong></div>
        <div class="summary-line"><span>Entrada para começar (${q.depositPercent}%)</span><strong>${money(q.depositCents)}</strong></div>
        <div class="summary-line"><span>Restante após aprovação</span><strong>${money(q.balanceCents)}</strong></div>
      </div>
    </div>

    <div class="actions"><button class="btn btn-primary" id="nextBtn" ${showPrice ? '' : 'disabled'}>Continuar para o briefing</button></div>
  `;

  $$('input[name="experience"]', stepCard).forEach((el) => el.addEventListener('change', async () => { s.experience = el.value; s.format = ''; await renderProduct(); }));
  $$('input[name="format"]', stepCard).forEach((el) => el.addEventListener('change', async () => { s.format = el.value; await renderProduct(); }));
  $$('[data-example]', stepCard).forEach((b) => b.addEventListener('click', () => openExample(b.dataset.example)));
  $('#formatExample', stepCard)?.addEventListener('click', () => openExample(exampleUrl(s.experience, s.format)));
  $$('[data-special-example]', stepCard).forEach((b) => b.addEventListener('click', () => openExample(state.catalog.examples[b.dataset.specialExample])));
  $('#addonConfirmation', stepCard)?.addEventListener('change', async (e) => { s.addons.confirmation = e.target.checked; await renderProduct(); });
  $('#addonFilter', stepCard)?.addEventListener('change', async (e) => { s.addons.filter = e.target.checked; await renderProduct(); });
  $$('[data-stepper]', stepCard).forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.stepper; const delta = Number(b.dataset.delta); s.addons[key] = Math.max(0, Math.min(10, Number(s.addons[key] || 0) + delta)); await renderProduct();
  }));
  const urgency = $('#urgencyLink', stepCard);
  if (urgency) urgency.href = whatsappLink(state.catalog.contact.libriWhatsapp, 'Oi! Estou montando meu pedido na Libri e preciso receber antes do prazo normal. Podemos verificar a possibilidade de urgência?');
  $('#nextBtn', stepCard)?.addEventListener('click', () => nextStep());
}

function formValue(id) { return $(id, stepCard)?.value?.trim() || ''; }
function checkedValue(name) { return $(`input[name="${name}"]:checked`, stepCard)?.value || ''; }
function showError(msg) { modal('Confira antes de continuar', `<p>${esc(msg)}</p>`); }

function renderParty() {
  const b = state.briefing;
  stepCard.innerHTML = `
    <h2>Sobre a festa 🎈</h2><p class="lead">Só as informações que precisamos para preparar seu convite.</p>
    <div class="field"><label>Seu nome *</label><input id="customerName" value="${esc(b.customerName)}" autocomplete="name"></div>
    <div class="field"><label>Seu WhatsApp *</label><input id="whatsapp" value="${esc(b.whatsapp)}" inputmode="tel" placeholder="(00) 00000-0000"></div>
    <div class="field"><label>Nome da criança ou homenageado(a) *</label><input id="honoreeName" value="${esc(b.honoreeName)}"></div>
    <div class="field"><label>Como você quer que o nome apareça?</label><input id="displayName" value="${esc(b.displayName)}" placeholder="Se deixar vazio, usaremos o nome acima"></div>
    <div class="field"><label>Quantos anos vai fazer? *</label><input id="age" value="${esc(b.age)}" type="number" min="0" max="120"></div>
    <div class="row" style="align-items:flex-start"><div class="field" style="flex:1;min-width:170px"><label>Data da festa *</label><input id="eventDate" value="${esc(b.eventDate)}" type="date"></div><div class="field" style="flex:1;min-width:150px"><label>Horário *</label><input id="eventTime" value="${esc(b.eventTime)}" type="time"></div></div>
    <div class="field"><label>Onde vai ser a festa? *</label><input id="venueName" value="${esc(b.venueName)}" placeholder="Nome do local"></div>
    <div class="field"><label>Endereço *</label><input id="venueAddress" value="${esc(b.venueAddress)}"></div>
    <div class="field"><label>Link da localização</label><input id="locationUrl" value="${esc(b.locationUrl)}" placeholder="Opcional"></div>
    <div class="field"><label>Qual é o tema da festa? *</label><input id="theme" value="${esc(b.theme)}"></div>
    <div class="field"><label>Tem algum personagem que você quer no convite?</label><input id="characterWanted" value="${esc(b.characterWanted)}" placeholder="Se não tiver, deixe em branco"></div>
    <div class="field"><label>Tem alguma coisa que não pode faltar?</label><textarea id="mustHave">${esc(b.mustHave)}</textarea><span class="hint">Pode ser um personagem, objeto, flor, animal, brinquedo, cor ou detalhe importante.</span></div>
    <div class="field"><label>Tem alguma coisa que você NÃO quer?</label><textarea id="avoid">${esc(b.avoid)}</textarea></div>
    <div class="field"><label>Tem alguma informação especial que precisa aparecer?</label><textarea id="specialInfo">${esc(b.specialInfo)}</textarea><span class="hint">Ex.: traga sua bebida, use roupa confortável ou outro recado importante.</span></div>
    <div class="actions"><button class="btn btn-secondary" id="backBtn">Voltar</button><button class="btn btn-primary" id="nextBtn">Continuar</button></div>`;
  $('#backBtn', stepCard).onclick = () => prevStep();
  $('#nextBtn', stepCard).onclick = async () => {
    Object.assign(b, {
      customerName: formValue('#customerName'), whatsapp: formValue('#whatsapp'), honoreeName: formValue('#honoreeName'), displayName: formValue('#displayName'), age: formValue('#age'),
      eventDate: formValue('#eventDate'), eventTime: formValue('#eventTime'), venueName: formValue('#venueName'), venueAddress: formValue('#venueAddress'), locationUrl: formValue('#locationUrl'), theme: formValue('#theme'),
      characterWanted: formValue('#characterWanted'), mustHave: formValue('#mustHave'), avoid: formValue('#avoid'), specialInfo: formValue('#specialInfo'),
    });
    const required = ['customerName','whatsapp','honoreeName','age','eventDate','eventTime','venueName','venueAddress','theme'];
    if (required.some((k) => !String(b[k] || '').trim())) return showError('Preencha os campos marcados com * para continuar.');
    nextStep();
  };
}

function renderChild() {
  const b = state.briefing;
  stepCard.innerHTML = `
    <h2>Sobre a criança 👧</h2><p class="lead">As fotos serão enviadas pelo WhatsApp só no final. Agora precisamos apenas das suas escolhas.</p>
    <h3>Como você prefere o estilo da criança no convite?</h3>
    <div class="choice-grid">
      ${choice('childStyle','drawing','Com aparência de desenho/bonequinho','Um visual mais suave, com jeitinho de animação.',b.childStyle==='drawing')}
      ${choice('childStyle','real','Com aparência mais real e detalhada','Com mais detalhes naturais de pele, cabelo e traços.',b.childStyle==='real')}
      ${choice('childStyle','libri','Quero que a Libri escolha','Escolhemos o estilo que combinar melhor com o convite.',b.childStyle==='libri')}
    </div>
    <div class="notice">Em qualquer opção, usamos as fotos como referência para manter as características da criança. <button id="mascotInfo" class="btn btn-ghost btn-small">Saiba mais</button></div>
    <h3 style="margin-top:24px">Como você quer a roupa?</h3>
    <div class="choice-grid">
      ${choice('outfitChoice','party','Parecida com a roupa da festa','Você enviará uma foto da roupa no WhatsApp no final.',b.outfitChoice==='party')}
      ${choice('outfitChoice','specific','Tenho uma roupa específica','Você enviará a referência no WhatsApp no final.',b.outfitChoice==='specific')}
      ${choice('outfitChoice','libri','Quero que a Libri crie','Criamos uma roupa que combine com o tema.',b.outfitChoice==='libri')}
    </div>
    <div class="field"><label>Tem algum detalhe da aparência que quer que a gente mantenha com atenção?</label><textarea id="appearanceDetails">${esc(b.appearanceDetails)}</textarea><span class="hint">Ex.: cachinhos, franja, laço, óculos ou algum acessório especial.</span></div>
    <div class="actions"><button class="btn btn-secondary" id="backBtn">Voltar</button><button class="btn btn-primary" id="nextBtn">Continuar</button></div>`;
  $('#mascotInfo', stepCard).onclick = () => modal('Sobre o mascote', '<p>O mascote é criado pela Libri com base nas fotos enviadas. A intenção é manter as principais características da criança, mas, como se trata de uma criação artística, ele não será uma cópia exata da foto e pode ter pequenas diferenças. Antes de seguir com o convite, você poderá ver e aprovar o mascote.</p>');
  $('#backBtn', stepCard).onclick = () => prevStep();
  $('#nextBtn', stepCard).onclick = () => { b.childStyle = checkedValue('childStyle') || 'libri'; b.outfitChoice = checkedValue('outfitChoice') || 'libri'; b.appearanceDetails = formValue('#appearanceDetails'); nextStep(); };
}

function renderStyle() {
  const b = state.briefing;
  stepCard.innerHTML = `
    <h2>Seu estilo ✨</h2><p class="lead">Se não tiver preferência, pode deixar por conta da Libri.</p>
    <div class="field"><label>Tem alguma cor que você quer ou não quer no convite?</label><textarea id="colors">${esc(b.colors)}</textarea></div>
    <div class="field"><label>Tem alguma ideia ou detalhe que gostaria de ver?</label><textarea id="creativeIdea">${esc(b.creativeIdea)}</textarea><span class="hint">Se tiver referências, você poderá enviar pelo WhatsApp no final.</span></div>
    <h3>E as falas?</h3>
    <div class="choice-grid">
      ${choice('speechPreference','libri','Pode deixar com a Libri','A Libri cria as falas de acordo com o convite.',b.speechPreference==='libri')}
      ${choice('speechPreference','approve','Quero aprovar antes','A Libri prepara e você confere antes da produção dessa parte.',b.speechPreference==='approve')}
      ${choice('speechPreference','own','Já tenho uma frase','Você escreve abaixo exatamente como deseja.',b.speechPreference==='own')}
    </div>
    <div class="field ${b.speechPreference==='own' ? '' : 'hidden'}" id="ownSpeechWrap"><label>Escreva a frase</label><textarea id="ownSpeech">${esc(b.ownSpeech)}</textarea></div>
    <div class="actions"><button class="btn btn-secondary" id="backBtn">Voltar</button><button class="btn btn-primary" id="nextBtn">Continuar</button></div>`;
  $$('input[name="speechPreference"]', stepCard).forEach((el) => el.onchange = () => $('#ownSpeechWrap', stepCard).classList.toggle('hidden', el.value !== 'own'));
  $('#backBtn', stepCard).onclick = () => prevStep();
  $('#nextBtn', stepCard).onclick = () => {
    b.colors = formValue('#colors'); b.creativeIdea = formValue('#creativeIdea'); b.speechPreference = checkedValue('speechPreference') || 'libri'; b.ownSpeech = b.speechPreference === 'own' ? formValue('#ownSpeech') : '';
    if (b.speechPreference === 'own' && !b.ownSpeech) return showError('Escreva a frase que deseja usar.');
    nextStep();
  };
}

function renderResources() {
  const b = state.briefing;
  const hasConfirmation = Boolean(state.selection.addons.confirmation);
  stepCard.innerHTML = `
    <h2>Recursos do convite 🎁</h2>
    <p class="lead">Só mostramos aqui o que faz parte do seu pedido.</p>
    ${hasConfirmation ? `
      <h3>Como você quer que funcione a confirmação?</h3>
      <div class="choice-grid">
        ${choice('confirmationMode','open','Qualquer convidado pode confirmar','Quem receber o link poderá preencher a confirmação.',b.confirmationMode==='open')}
        ${choice('confirmationMode','list','Quero usar uma lista de convidados','Você poderá cadastrar e organizar seus convidados diretamente no seu painel.',b.confirmationMode==='list')}
        ${choice('confirmationMode','unsure','Ainda não sei','Você poderá decidir depois com a Libri.',b.confirmationMode==='unsure')}
      </div>` : '<div class="notice notice-success">Tudo certo. Não precisamos de nenhuma informação extra nesta etapa.</div>'}
    <div class="actions"><button class="btn btn-secondary" id="backBtn">Voltar</button><button class="btn btn-primary" id="nextBtn">Continuar</button></div>`;
  $('#backBtn', stepCard).onclick = () => prevStep();
  $('#nextBtn', stepCard).onclick = () => { if (hasConfirmation) b.confirmationMode = checkedValue('confirmationMode') || 'unsure'; nextStep(); };
}

function humanExperience(v) { return v === 'reduced' ? 'Reduzida' : 'Completa'; }
function humanFormat(v) { return v === 'interactive' ? 'Interativo' : 'Vídeo'; }
function humanChildStyle(v) { return ({ drawing:'Desenho/bonequinho', real:'Mais real e detalhado', libri:'Libri escolhe' })[v] || 'Libri escolhe'; }
function humanOutfit(v) { return ({ party:'Parecida com a roupa da festa', specific:'Roupa específica', libri:'Libri cria' })[v] || 'Libri cria'; }
function humanSpeech(v) { return ({ libri:'Libri cria', approve:'Cliente quer aprovar', own:'Frase própria' })[v] || 'Libri cria'; }

async function renderReview() {
  await refreshQuote();
  const b = state.briefing, q = state.quote;
  const addonNames = [];
  if (state.selection.addons.confirmation) addonNames.push('Confirmação Libri');
  if (state.selection.addons.filter) addonNames.push('Filtro personalizado');
  if (state.selection.addons.extraScene) addonNames.push(`${state.selection.addons.extraScene} cena(s) extra`);
  if (state.selection.addons.extraPerson) addonNames.push(`${state.selection.addons.extraPerson} pessoa(s) extra`);
  stepCard.innerHTML = `
    <h2>Confira e finalize ✅</h2><p class="lead">Dê uma última olhada. Se precisar, volte e corrija antes de enviar.</p>
    <div class="review-section"><h3>Festa</h3><dl><dt>Nome</dt><dd>${esc(b.displayName || b.honoreeName)}</dd><dt>Idade</dt><dd>${esc(b.age)} ano(s)</dd><dt>Data e horário</dt><dd>${esc(b.eventDate)} • ${esc(b.eventTime)}</dd><dt>Local</dt><dd>${esc(b.venueName)}<br>${esc(b.venueAddress)}</dd><dt>Tema</dt><dd>${esc(b.theme)}</dd></dl></div>
    <div class="review-section"><h3>Convite</h3><dl><dt>Experiência</dt><dd>${humanExperience(state.selection.experience)}</dd><dt>Formato</dt><dd>${humanFormat(state.selection.format)}</dd><dt>Adicionais</dt><dd>${addonNames.length ? esc(addonNames.join(', ')) : 'Nenhum'}</dd></dl></div>
    <div class="review-section"><h3>Preferências</h3><dl><dt>Estilo da criança</dt><dd>${humanChildStyle(b.childStyle)}</dd><dt>Roupa</dt><dd>${humanOutfit(b.outfitChoice)}</dd><dt>Falas</dt><dd>${humanSpeech(b.speechPreference)}</dd><dt>Cores</dt><dd>${esc(b.colors || 'Sem preferência informada')}</dd></dl></div>
    <div class="summary"><div class="summary-line"><span>Valor total</span><strong>${money(q.totalCents)}</strong></div><div class="summary-line"><span>Entrada para começar (${q.depositPercent}%)</span><strong>${money(q.depositCents)}</strong></div><div class="summary-line"><span>Restante após aprovação</span><strong>${money(q.balanceCents)}</strong></div></div>
    <div class="notice"><strong>Antes de finalizar</strong><br>Prazo normal: até ${state.catalog.rules.deadlineBusinessDays} dias úteis. A produção começa depois da entrada, do briefing completo e das fotos adequadas. Você poderá conferir e aprovar as etapas.</div>
    <p><button id="readTerms" class="btn btn-ghost btn-small">Ler todas as condições</button></p>
    <label class="checkline"><input id="termsAccepted" type="checkbox" ${state.termsAccepted ? 'checked' : ''}><span><strong>Li e concordo com as condições do pedido.</strong></span></label>
    <h3>Divulgação</h3><p class="muted small">A Libri pode mostrar seu convite em seu portfólio e redes sociais? Essa escolha não interfere na produção.</p>
    <div class="choice-grid">
      ${choice('portfolioConsent','yes','Sim, autorizo','A Libri poderá divulgar o convite conforme os termos.',state.portfolioConsent===true)}
      ${choice('portfolioConsent','no','Não, prefiro que não seja divulgado','Seu convite será produzido normalmente.',state.portfolioConsent===false)}
    </div>
    <div class="actions"><button class="btn btn-secondary" id="backBtn">Voltar e corrigir</button><button class="btn btn-primary" id="finishBtn">Finalizar pedido</button></div>`;
  $('#readTerms', stepCard).onclick = () => modal(`Condições do pedido • versão ${esc(state.terms.version)}`, `<pre>${esc(state.terms.body)}</pre>`);
  $('#termsAccepted', stepCard).onchange = (e) => state.termsAccepted = e.target.checked;
  $$('input[name="portfolioConsent"]', stepCard).forEach((el) => el.onchange = () => state.portfolioConsent = el.value === 'yes');
  $('#backBtn', stepCard).onclick = () => prevStep();
  $('#finishBtn', stepCard).onclick = finishOrder;
}

async function finishOrder() {
  state.termsAccepted = $('#termsAccepted', stepCard).checked;
  const portfolio = checkedValue('portfolioConsent');
  state.portfolioConsent = portfolio === 'yes' ? true : portfolio === 'no' ? false : null;
  if (!state.termsAccepted) return showError('Marque que leu e concorda com as condições do pedido.');
  if (state.portfolioConsent === null) return showError('Escolha se autoriza ou não a divulgação do convite.');
  const btn = $('#finishBtn', stepCard); btn.disabled = true; btn.textContent = 'Salvando pedido...';
  try {
    const data = await api('/api/orders', { method: 'POST', body: JSON.stringify({ draftToken: state.draftToken, selection: state.selection, briefing: state.briefing, termsAccepted: true, portfolioConsent: state.portfolioConsent }) });
    localStorage.removeItem('libriDraftToken');
    flow.classList.add('hidden');
    renderFinal(data.order);
  } catch (error) {
    btn.disabled = false; btn.textContent = 'Finalizar pedido';
    const missing = error.data?.details?.missing;
    showError(missing?.length ? `Faltou conferir: ${missing.join(', ')}.` : error.message);
  }
}

async function renderFinal(order) {
  const data = await api(`/api/orders/${order.publicToken}/final`);
  const f = data.final;
  finalScreen.innerHTML = `
    <h2>Pedido salvo com sucesso 💛</h2>
    <div class="final-code">${esc(f.orderCode)}</div>
    <p class="lead">Agora falta só enviar as fotos, referências e o comprovante pelo WhatsApp.</p>
    <div class="summary"><div class="summary-line"><span>Valor total</span><strong>${money(f.totalCents)}</strong></div><div class="summary-line"><span>Entrada de 50%</span><strong>${money(f.depositCents)}</strong></div><div class="summary-line"><span>Restante após aprovação</span><strong>${money(f.balanceCents)}</strong></div></div>
    <div class="pix-box"><strong>Pagamento via Pix</strong><p><span class="muted">Recebedor:</span><br>${esc(f.pixRecipientName || 'A configurar')}</p><p><span class="muted">Chave Pix:</span><br><strong id="pixKey">${esc(f.pixKey || 'A configurar')}</strong></p><button id="copyPix" class="btn btn-secondary btn-small" ${f.pixKey ? '' : 'disabled'}>Copiar chave Pix</button></div>
    <div class="notice notice-success" style="text-align:left"><strong>Envie no WhatsApp:</strong><br>• fotos da criança;<br>• foto da roupa, se tiver;<br>• referências, se tiver;<br>• comprovante da entrada.</div>
    <a class="btn btn-primary btn-wide" style="display:flex;align-items:center;justify-content:center;text-decoration:none;margin-top:18px" href="${whatsappLink(f.libriWhatsapp, `Oi! Finalizei meu pedido ${f.orderCode}. Vou enviar aqui as fotos, referências e o comprovante da entrada.`)}" target="_blank" rel="noopener">Finalizar e enviar tudo pelo WhatsApp</a>`;
  $('#copyPix', finalScreen)?.addEventListener('click', async () => { await navigator.clipboard.writeText(f.pixKey); $('#copyPix', finalScreen).textContent = 'Chave copiada ✓'; });
  finalScreen.classList.remove('hidden');
}

async function nextStep() { state.step = Math.min(5, state.step + 1); await saveDraft(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
async function prevStep() { state.step = Math.max(0, state.step - 1); await saveDraft(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

async function render() {
  progress();
  if (state.step === 0) return renderProduct();
  if (state.step === 1) return renderParty();
  if (state.step === 2) return renderChild();
  if (state.step === 3) return renderStyle();
  if (state.step === 4) return renderResources();
  return renderReview();
}

$('#newOrder').addEventListener('click', async () => { await createDraft(); startFlow(); });
continueBtn.addEventListener('click', async () => { if (await loadDraft()) startFlow(); else modal('Pedido não encontrado', '<p>Esse rascunho não está mais disponível. Você pode iniciar um novo pedido.</p>'); });

bootstrap().catch((error) => modal('Ops', `<p>${esc(error.message)}</p>`));
