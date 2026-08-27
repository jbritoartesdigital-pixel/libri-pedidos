const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const MASCOT_EXAMPLES = {
  drawing: '/images/exemplos/mascote-bonequinho.webp',
  real: '/images/exemplos/mascote-realista.webp',
};

const state = {
  step: 0,
  draftToken: null,
  catalog: null,
  terms: null,
  quote: null,
  selection: {
    experience: '',
    format: '',
    addons: {
      confirmation: false,
      filter: false,
      extraScene: 0,
      extraPerson: 0,
    },
  },
  briefing: {
    customerName: '',
    whatsapp: '',
    honoreeName: '',
    displayName: '',
    age: '',
    eventDate: '',
    eventTime: '',
    venueName: '',
    venueAddress: '',
    locationUrl: '',
    theme: '',
    characterWanted: '',
    mustHave: '',
    avoid: '',
    specialInfo: '',
    childStyle: 'libri',
    outfitChoice: 'libri',
    outfitDetails: '',
    appearanceDetails: '',
    colors: '',
    colorsAvoided: '',
    creativeIdea: '',
    speechPreference: 'libri',
    ownSpeech: '',
    confirmationMode: 'unsure',
    giftPage: 'unsure',
    giftDetails: '',
    photoAlbumInterest: 'unsure',
  },
  portfolioConsent: null,
  termsAccepted: false,
};

const landing = $('#landing');
const flow = $('#flow');
const stepCard = $('#stepCard');
const finalScreen = $('#finalScreen');
const newOrderBtn = $('#newOrder');
const continueBtn = $('#continueOrder');
const helpWhatsapp = $('#helpWhatsapp');
const topHelpWhatsapp = $('#topHelpWhatsapp');

/* ==================================================
   HELPERS
================================================== */

function money(cents = 0) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format((Number(cents) || 0) / 100);
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function whatsappLink(number, text) {
  let digits = String(number || '').replace(/\D/g, '');

  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }

  return digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : '#';
}

function formatDate(value) {
  if (!value) return '';
  const parts = String(value).split('-');
  return parts.length === 3
    ? `${parts[2]}/${parts[1]}/${parts[0]}`
    : value;
}

function formatWhatsappInput(value) {
  let digits = String(value || '').replace(/\D/g, '');

  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }

  digits = digits.slice(0, 11);

  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function hasConfirmation() {
  return Boolean(state.selection.addons.confirmation);
}

function humanExperience(value) {
  return value === 'reduced' ? 'Reduzida' : 'Completa';
}

function humanFormat(value) {
  return value === 'interactive' ? 'Interativo' : 'Vídeo';
}

function humanChildStyle(value) {
  return ({
    drawing: 'Desenho / bonequinho',
    real: 'Mais real e detalhado',
    libri: 'A Libri escolhe',
  })[value] || 'A Libri escolhe';
}

function humanOutfit(value) {
  return ({
    party: 'Parecida com a roupa da festa',
    specific: 'Roupa específica',
    libri: 'A Libri cria',
  })[value] || 'A Libri cria';
}

function humanSpeech(value) {
  return ({
    libri: 'A Libri cria',
    approve: 'Quero conferir antes',
    own: 'Frase própria',
  })[value] || 'A Libri cria';
}

function humanTriState(value) {
  return ({
    yes: 'Sim',
    no: 'Não',
    unsure: 'Ainda não sei',
  })[value] || 'Ainda não sei';
}

function humanConfirmation(value) {
  return ({
    open: 'Livre',
    list: 'Lista de convidados',
    unsure: 'Ainda não definido',
  })[value] || 'Ainda não definido';
}

function visualSteps() {
  return [
    { stateStep: 0, title: 'Seu convite' },
    { stateStep: 1, title: 'A festa' },
    { stateStep: 2, title: 'A criança' },
    { stateStep: 3, title: 'Seu estilo' },
    { stateStep: 4, title: 'Recursos' },
    { stateStep: 5, title: 'Revisão' },
  ];
}

function visualStepInfo() {
  const steps = visualSteps();
  let index = steps.findIndex((item) => item.stateStep === state.step);
  if (index < 0) index = 0;

  return {
    steps,
    index,
    total: steps.length,
    title: steps[index]?.title || '',
  };
}

function productLabelFromQuote(quote = state.quote) {
  if (!quote) return '';
  const size = quote.experience === 'reduced' ? 'Reduzido' : 'Completo';
  return `${humanFormat(quote.format)} ${size}`;
}

function addonLabel(key, qty = 1) {
  if (key === 'confirmation') return 'Confirmação Libri';
  if (key === 'filter') return 'Filtro personalizado';
  if (key === 'extraScene') return qty > 1 ? `${qty} cenas extras` : 'Cena extra';
  if (key === 'extraPerson') return qty > 1 ? `${qty} pessoas extras` : 'Outra criança ou pessoa';
  return key;
}

function quoteBreakdownHtml(quote, { compact = false } = {}) {
  if (!quote) return '';

  const addonRows = (quote.addonLines || [])
    .filter((line) => Number(line.qty) > 0)
    .map((line) => `
      <div class="quote-row">
        <span>${esc(addonLabel(line.key, Number(line.qty)))}</span>
        <strong>+ ${money(line.totalCents)}</strong>
      </div>
    `)
    .join('');

  const urgencyRow = quote.urgencyEnabled
    ? `
      <div class="quote-row">
        <span>Urgência (+${esc(quote.urgencyPercent)}%)</span>
        <strong>+ ${money(quote.urgencyAmountCents)}</strong>
      </div>
    `
    : '';

  return `
    <div class="quote-card">
      <div class="quote-row">
        <span>${esc(productLabelFromQuote(quote))}</span>
        <strong>${money(quote.productCents)}</strong>
      </div>
      ${addonRows}
      ${urgencyRow}
      <div class="quote-row total">
        <span>Valor total</span>
        <strong>${money(quote.totalCents)}</strong>
      </div>
      ${compact ? '' : `
        <div class="quote-row">
          <span>Entrada (${esc(quote.depositPercent)}%)</span>
          <strong>${money(quote.depositCents)}</strong>
        </div>
        <div class="quote-row">
          <span>Restante</span>
          <strong>${money(quote.balanceCents)}</strong>
        </div>
      `}
    </div>
  `;
}

function addonNames() {
  const addons = [];
  const selection = state.selection.addons;

  if (selection.confirmation) addons.push('Confirmação Libri');
  if (selection.filter) addons.push('Filtro personalizado');
  if (selection.extraScene) addons.push(`${selection.extraScene} cena(s) extra`);
  if (selection.extraPerson) addons.push(`${selection.extraPerson} pessoa(s) extra`);

  return addons;
}

/* ==================================================
   MODAL
================================================== */

function modal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalContent').innerHTML = html;
  $('#modalBackdrop').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('#modalBackdrop').classList.add('hidden');
  document.body.style.overflow = '';
}

function showError(message) {
  modal('Confira antes de continuar', `<p>${esc(message)}</p>`);
}

$('#closeModal').addEventListener('click', closeModal);

$('#modalBackdrop').addEventListener('click', (event) => {
  if (event.target.id === 'modalBackdrop') {
    closeModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape'
    && !$('#modalBackdrop').classList.contains('hidden')
  ) {
    closeModal();
  }
});

/* ==================================================
   API
================================================== */

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,

    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw Object.assign(
      new Error(
        data.error
        || 'Não foi possível concluir.',
      ),
      {
        status: response.status,
        data,
      },
    );
  }

  return data;
}

async function refreshCatalogAndTerms() {
  const [
    catalogData,
    termsData,
  ] = await Promise.all([
    api('/api/catalog'),
    api('/api/terms/current'),
  ]);

  state.catalog = catalogData.catalog;
  state.terms = termsData.terms;

  setHelpLinks();
}

/* ==================================================
   INICIALIZAÇÃO
================================================== */

function setHelpLinks() {
  const number =
    state.catalog
      ?.contact
      ?.libriWhatsapp
    || '';

  const href = whatsappLink(
    number,
    'Oi! Preciso de ajuda para preencher meu pedido no Portal da Libri Convites.',
  );

  [
   