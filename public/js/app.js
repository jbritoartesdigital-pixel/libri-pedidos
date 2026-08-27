const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector));

/* ==================================================
   EXEMPLOS VISUAIS
================================================== */

const MASCOT_EXAMPLES = {
  drawing:
    '/images/exemplos/mascote-bonequinho.webp',

  real:
    '/images/exemplos/mascote-realista.webp',
};

/* ==================================================
   LIBRI MOMENTS
================================================== */

const PHOTO_ALBUM = {
  festa: {
    key: 'festa',
    name: 'Festa',
    priceCents: 7900,
    photos: 200,
    days: 30,
  },

  premium: {
    key: 'premium',
    name: 'Premium',
    priceCents: 11900,
    photos: 400,
    days: 60,
  },

  exclusive: {
    key: 'exclusive',
    name: 'Exclusive',
    priceCents: 14900,
    photos: 700,
    days: 90,
  },

  extra100Cents: 1500,
};

/* ==================================================
   ESTADO
================================================== */

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

      photoAlbumPlan: '',

      photoAlbumExtra100: 0,
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

    photoAlbumInterest: 'no',

    photoAlbumPlan: '',

    photoAlbumExtra100: 0,
  },

  portfolioConsent: null,

  termsAccepted: false,
};

/* ==================================================
   ELEMENTOS
================================================== */

const landing =
  $('#landing');

const flow =
  $('#flow');

const stepCard =
  $('#stepCard');

const finalScreen =
  $('#finalScreen');

const newOrderBtn =
  $('#newOrder');

const continueBtn =
  $('#continueOrder');

const helpWhatsapp =
  $('#helpWhatsapp');

const topHelpWhatsapp =
  $('#topHelpWhatsapp');

/* ==================================================
   HELPERS
================================================== */

function money(cents = 0) {
  return new Intl.NumberFormat(
    'pt-BR',
    {
      style: 'currency',
      currency: 'BRL',
    },
  ).format(
    (Number(cents) || 0) / 100,
  );
}

function esc(value = '') {
  return String(value).replace(
    /[&<>'"]/g,
    (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    })[char],
  );
}

function whatsappLink(
  number,
  text,
) {
  let digits =
    String(number || '')
      .replace(/\D/g, '');

  if (
    (
      digits.length === 10
      || digits.length === 11
    )
    && !digits.startsWith('55')
  ) {
    digits =
      `55${digits}`;
  }

  return digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : '#';
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  const parts =
    String(value).split('-');

  return parts.length === 3
    ? `${parts[2]}/${parts[1]}/${parts[0]}`
    : value;
}

function formatWhatsappInput(value) {
  let digits =
    String(value || '')
      .replace(/\D/g, '');

  if (
    digits.startsWith('55')
    && digits.length > 11
  ) {
    digits =
      digits.slice(2);
  }

  digits =
    digits.slice(0, 11);

  if (
    digits.length <= 2
  ) {
    return digits;
  }

  if (
    digits.length <= 6
  ) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }

  if (
    digits.length <= 10
  ) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function hasConfirmation() {
  return Boolean(
    state.selection
      .addons
      .confirmation,
  );
}

function hasPhotoAlbum() {
  return [
    'festa',
    'premium',
    'exclusive',
  ].includes(
    state.selection
      .addons
      .photoAlbumPlan,
  );
}

function currentAlbum() {
  return PHOTO_ALBUM[
    state.selection
      .addons
      .photoAlbumPlan
  ] || null;
}

function albumExtraCents() {
  const qty =
    Math.max(
      0,
      Number(
        state.selection
          .addons
          .photoAlbumExtra100
        || 0,
      ),
    );

  return qty
    * PHOTO_ALBUM
      .extra100Cents;
}

function albumTotalCents() {
  const album =
    currentAlbum();

  if (!album) {
    return 0;
  }

  return album.priceCents
    + albumExtraCents();
}

function humanExperience(value) {
  return value === 'reduced'
    ? 'Reduzida'
    : 'Completa';
}

function humanFormat(value) {
  return value === 'interactive'
    ? 'Interativo'
    : 'Vídeo';
}

function humanChildStyle(value) {
  return ({
    drawing:
      'Desenho / bonequinho',

    real:
      'Mais real e detalhado',

    libri:
      'A Libri escolhe',
  })[value]
    || 'A Libri escolhe';
}

function humanOutfit(value) {
  return ({
    party:
      'Parecida com a roupa da festa',

    specific:
      'Roupa específica',

    libri:
      'A Libri cria',
  })[value]
    || 'A Libri cria';
}

function humanSpeech(value) {
  return ({
    libri:
      'A Libri cria',

    approve:
      'Quero conferir antes',

    own:
      'Frase própria',
  })[value]
    || 'A Libri cria';
}

function humanTriState(value) {
  return ({
    yes:
      'Sim',

    no:
      'Não',

    unsure:
      'Ainda não sei',
  })[value]
    || 'Ainda não sei';
}

function humanConfirmation(value) {
  return ({
    open:
      'Livre',

    list:
      'Lista de convidados',

    unsure:
      'Ainda não definido',
  })[value]
    || 'Ainda não definido';
}

function humanAlbumPlan(value) {
  const plan =
    PHOTO_ALBUM[value];

  return plan
    ? `Libri Moments ${plan.name}`
    : 'Sem álbum';
}

function visualSteps() {
  return [
    {
      stateStep: 0,
      title: 'Seu convite',
    },

    {
      stateStep: 1,
      title: 'A festa',
    },

    {
      stateStep: 2,
      title: 'A criança',
    },

    {
      stateStep: 3,
      title: 'Seu estilo',
    },

    {
      stateStep: 4,
      title: 'Recursos',
    },

    {
      stateStep: 5,
      title: 'Revisão',
    },
  ];
}

function visualStepInfo() {
  const steps =
    visualSteps();

  let index =
    steps.findIndex(
      (item) =>
        item.stateStep
        === state.step,
    );

  if (
    index < 0
  ) {
    index = 0;
  }

  return {
    steps,
    index,

    total:
      steps.length,

    title:
      steps[index]?.title
      || '',
  };
}

function productLabelFromQuote(
  quote = state.quote,
) {
  if (!quote) {
    return '';
  }

  const size =
    quote.experience === 'reduced'
      ? 'Reduzido'
      : 'Completo';

  return `${humanFormat(quote.format)} ${size}`;
}

function addonLabel(
  key,
  qty = 1,
) {
  if (
    key === 'confirmation'
  ) {
    return 'Confirmação Libri';
  }

  if (
    key === 'filter'
  ) {
    return 'Filtro personalizado';
  }

  if (
    key === 'extraScene'
  ) {
    return qty > 1
      ? `${qty} cenas extras`
      : 'Cena extra';
  }

  if (
    key === 'extraPerson'
  ) {
    return qty > 1
      ? `${qty} pessoas extras`
      : 'Outra criança ou pessoa';
  }

  if (
    key === 'photoAlbumFesta'
  ) {
    return 'Libri Moments Festa';
  }

  if (
    key === 'photoAlbumPremium'
  ) {
    return 'Libri Moments Premium';
  }

  if (
    key === 'photoAlbumExclusive'
  ) {
    return 'Libri Moments Exclusive';
  }

  if (
    key === 'photoAlbumExtra100'
  ) {
    return qty > 1
      ? `${qty} pacotes de +100 fotos`
      : '+100 fotos no álbum';
  }

  return key;
}

function quoteBreakdownHtml(
  quote,
  {
    compact = false,
  } = {},
) {
  if (!quote) {
    return '';
  }

  const addonRows =
    (quote.addonLines || [])
      .filter(
        (line) =>
          Number(line.qty) > 0,
      )
      .map(
        (line) => `
          <div class="quote-row">
            <span>
              ${esc(
                addonLabel(
                  line.key,
                  Number(line.qty),
                ),
              )}
            </span>

            <strong>
              + ${money(
                line.totalCents,
              )}
            </strong>
          </div>
        `,
      )
      .join('');

  const urgencyRow =
    quote.urgencyEnabled
      ? `
        <div class="quote-row">
          <span>
            Urgência
            (+${esc(
              quote.urgencyPercent,
            )}%)
          </span>

          <strong>
            + ${money(
              quote.urgencyAmountCents,
            )}
          </strong>
        </div>
      `
      : '';

  return `
    <div class="quote-card">
      <div class="quote-row">
        <span>
          ${esc(
            productLabelFromQuote(
              quote,
            ),
          )}
        </span>

        <strong>
          ${money(
            quote.productCents,
          )}
        </strong>
      </div>

      ${addonRows}

      ${urgencyRow}

      <div class="quote-row total">
        <span>
          Valor total
        </span>

        <strong>
          ${money(
            quote.totalCents,
          )}
        </strong>
      </div>

      ${
        compact
          ? ''
          : `
            <div class="quote-row">
              <span>
                Entrada
                (${esc(
                  quote.depositPercent,
                )}%)
              </span>

              <strong>
                ${money(
                  quote.depositCents,
                )}
              </strong>
            </div>

            <div class="quote-row">
              <span>
                Restante
              </span>

              <strong>
                ${money(
                  quote.balanceCents,
                )}
              </strong>
            </div>
          `
      }
    </div>
  `;
}

function addonNames() {
  const addons = [];

  const selection =
    state.selection.addons;

  if (
    selection.confirmation
  ) {
    addons.push(
      'Confirmação Libri',
    );
  }

  if (
    selection.filter
    && !hasPhotoAlbum()
  ) {
    addons.push(
      'Filtro personalizado',
    );
  }

  if (
    selection.extraScene
  ) {
    addons.push(
      `${selection.extraScene} cena(s) extra`,
    );
  }

  if (
    selection.extraPerson
  ) {
    addons.push(
      `${selection.extraPerson} pessoa(s) extra`,
    );
  }

  if (
    hasPhotoAlbum()
  ) {
    const album =
      currentAlbum();

    addons.push(
      `Libri Moments ${album.name}`,
    );

    if (
      selection.photoAlbumExtra100
    ) {
      addons.push(
        `${selection.photoAlbumExtra100} pacote(s) de +100 fotos`,
      );
    }
  }

  return addons;
}

/* ==================================================
   NORMALIZAÇÃO
================================================== */

function normalizeAlbumSelection() {
  if (
    hasPhotoAlbum()
  ) {
    /*
     * Todo plano Libri Moments
     * já inclui 1 filtro.
     * Evita cobrança duplicada.
     */
    state.selection
      .addons
      .filter = false;
  }

  const plan =
    state.selection
      .addons
      .photoAlbumPlan;

  if (
    ![
      '',
      'festa',
      'premium',
      'exclusive',
    ].includes(plan)
  ) {
    state.selection
      .addons
      .photoAlbumPlan = '';
  }

  state.selection
    .addons
    .photoAlbumExtra100 =
      Math.max(
        0,
        Math.min(
          20,
          Number(
            state.selection
              .addons
              .photoAlbumExtra100
            || 0,
          ),
        ),
      );

  if (
    !hasPhotoAlbum()
  ) {
    state.selection
      .addons
      .photoAlbumExtra100 = 0;
  }
}

function syncAlbumBriefing() {
  const plan =
    state.selection
      .addons
      .photoAlbumPlan;

  const extra =
    state.selection
      .addons
      .photoAlbumExtra100
    || 0;

  state.briefing
    .photoAlbumPlan =
      plan;

  state.briefing
    .photoAlbumExtra100 =
      extra;

  state.briefing
    .photoAlbumInterest =
      plan
        ? 'yes'
        : 'no';
}

/* ==================================================
   MODAL
================================================== */

function modal(
  title,
  html,
) {
  $('#modalTitle')
    .textContent =
      title;

  $('#modalContent')
    .innerHTML =
      html;

  $('#modalBackdrop')
    .classList
    .remove(
      'hidden',
    );

  document.body
    .style
    .overflow =
      'hidden';
}

function closeModal() {
  $('#modalBackdrop')
    .classList
    .add(
      'hidden',
    );

  document.body
    .style
    .overflow =
      '';
}

function showError(message) {
  modal(
    'Confira antes de continuar',

    `<p>${esc(message)}</p>`,
  );
}

$('#closeModal')
  .addEventListener(
    'click',
    closeModal,
  );

$('#modalBackdrop')
  .addEventListener(
    'click',
    (event) => {
      if (
        event.target.id
        === 'modalBackdrop'
      ) {
        closeModal();
      }
    },
  );

document.addEventListener(
  'keydown',
  (event) => {
    if (
      event.key
        === 'Escape'

      && !$('#modalBackdrop')
        .classList
        .contains(
          'hidden',
        )
    ) {
      closeModal();
    }
  },
);

/* ==================================================
   API
================================================== */

async function api(
  path,
  options = {},
) {
  const response =
    await fetch(
      path,
      {
        ...options,

        headers: {
          'content-type':
            'application/json',

          ...(options.headers || {}),
        },
      },
    );

  const data =
    await response
      .json()
      .catch(
        () => ({}),
      );

  if (
    !response.ok
  ) {
    throw Object.assign(
      new Error(
        data.error
        || 'Não foi possível concluir.',
      ),

      {
        status:
          response.status,

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
    api(
      '/api/catalog',
    ),

    api(
      '/api/terms/current',
    ),
  ]);

  state.catalog =
    catalogData.catalog;

  state.terms =
    termsData.terms;

  setHelpLinks();
}

/* ==================================================
   AJUDA
================================================== */

function setHelpLinks() {
  const number =
    state.catalog
      ?.contact
      ?.libriWhatsapp
    || '';

  const href =
    whatsappLink(
      number,

      'Oi! Preciso de ajuda para preencher meu pedido no Portal da Libri Convites.',
    );

  [
    helpWhatsapp,
    topHelpWhatsapp,
  ].forEach(
    (link) => {
      if (!link) {
        return;
      }

      link.href =
        href;

      link.classList.toggle(
        'hidden',
        !number,
      );
    },
  );
}

/* ==================================================
   INICIALIZAÇÃO
================================================== */

async function bootstrap() {
  await refreshCatalogAndTerms();

  newOrderBtn.disabled =
    false;

  const savedToken =
    localStorage.getItem(
      'libriDraftToken',
    );

  if (
    savedToken
  ) {
    continueBtn
      .classList
      .remove(
        'hidden',
      );

    continueBtn.disabled =
      false;
  }
}

/* ==================================================
   RASCUNHO
================================================== */

async function createDraft() {
  const data =
    await api(
      '/api/drafts',

      {
        method: 'POST',

        body: '{}',
      },
    );

  state.draftToken =
    data.draft.token;

  localStorage.setItem(
    'libriDraftToken',
    state.draftToken,
  );

  state.step =
    0;

  await saveDraft();
}

async function loadDraft() {
  const token =
    localStorage.getItem(
      'libriDraftToken',
    );

  if (!token) {
    return false;
  }

  try {
    const data =
      await api(
        `/api/drafts/${token}`,
      );

    const draftData =
      data.draft.data
      || {};

    state.draftToken =
      token;

    state.step =
      Math.max(
        0,
        Math.min(
          5,

          Number(
            data.draft.step
            || 0,
          ),
        ),
      );

    state.selection = {
      ...state.selection,

      ...(draftData.selection || {}),

      addons: {
        ...state.selection.addons,

        ...(draftData
          .selection
          ?.addons
        || {}),
      },
    };

    state.briefing = {
      ...state.briefing,

      ...(draftData.briefing || {}),
    };

    /*
     * Compatibilidade com rascunhos
     * criados antes do Moments.
     */
    if (
      !state.selection
        .addons
        .photoAlbumPlan

      && state.briefing
        .photoAlbumPlan
    ) {
      state.selection
        .addons
        .photoAlbumPlan =
          state.briefing
            .photoAlbumPlan;
    }

    if (
      !state.selection
        .addons
        .photoAlbumExtra100

      && state.briefing
        .photoAlbumExtra100
    ) {
      state.selection
        .addons
        .photoAlbumExtra100 =
          Number(
            state.briefing
              .photoAlbumExtra100,
          )
          || 0;
    }

    normalizeAlbumSelection();

    syncAlbumBriefing();

    state.portfolioConsent =
      typeof draftData
        .portfolioConsent
        === 'boolean'

        ? draftData
          .portfolioConsent

        : null;

    const sameTermsVersion =
      String(
        draftData.termsVersion
        || '',
      )
      === String(
        state.terms
          ?.version
        || '',
      );

    state.termsAccepted =
      sameTermsVersion
      && Boolean(
        draftData
          .termsAccepted,
      );

    return true;
  } catch (error) {
    if (
      error.status === 404
      || error.status === 410
    ) {
      localStorage.removeItem(
        'libriDraftToken',
      );

      state.draftToken =
        null;

      return false;
    }

    throw error;
  }
}

function setSaveStatus(
  text,
  className = '',
) {
  const element =
    $('#saveStatus');

  if (!element) {
    return;
  }

  element.textContent =
    text;

  element.classList.remove(
    'is-saving',
    'is-error',
  );

  if (
    className
  ) {
    element.classList.add(
      className,
    );
  }
}

async function saveDraft() {
  if (
    !state.draftToken
  ) {
    return;
  }

  normalizeAlbumSelection();

  syncAlbumBriefing();

  setSaveStatus(
    'Salvando...',
    'is-saving',
  );

  try {
    await api(
      `/api/drafts/${state.draftToken}`,

      {
        method: 'PUT',

        body: JSON.stringify({
          step:
            state.step,

          data: {
            selection:
              state.selection,

            briefing:
              state.briefing,

            portfolioConsent:
              state.portfolioConsent,

            termsAccepted:
              state.termsAccepted,

            termsVersion:
              state.terms
                ?.version
              || '',
          },
        }),
      },
    );

    setSaveStatus(
      'Salvo',
    );
  } catch (error) {
    if (
      error.status === 404
      || error.status === 410
    ) {
      localStorage.removeItem(
        'libriDraftToken',
      );

      state.draftToken =
        null;
    }

    setSaveStatus(
      'Falha ao salvar',
      'is-error',
    );

    throw error;
  }
}

/* ==================================================
   FLUXO
================================================== */

function startFlow() {
  landing.classList.add(
    'hidden',
  );

  finalScreen.classList.add(
    'hidden',
  );

  flow.classList.remove(
    'hidden',
  );

  render();

  window.scrollTo({
    top: 0,

    behavior:
      'smooth',
  });
}

function progress() {
  const info =
    visualStepInfo();

  $('#progressLabel')
    .textContent =
      `Etapa ${info.index + 1} de ${info.total}`;

  $('#progressTitle')
    .textContent =
      info.title;

  $('#progressBar')
    .style
    .width =
      `${((info.index + 1) / info.total) * 100}%`;
}

async function refreshQuote() {
  if (
    !state.selection
      .experience

    || !state.selection
      .format
  ) {
    state.quote =
      null;

    return;
  }

  normalizeAlbumSelection();

  syncAlbumBriefing();

  const data =
    await api(
      '/api/quote',

      {
        method: 'POST',

        body: JSON.stringify({
          selection:
            state.selection,
        }),
      },
    );

  state.quote =
    data.quote;

  if (
    data.quote
      ?.formatAdjusted

    && data.quote
      ?.format
  ) {
    state.selection
      .format =
        data.quote
          .format;
  }
}

function stepHeader(
  title,
  description = '',
) {
  const info =
    visualStepInfo();

  return `
    <div class="step-head">
      <span class="step-number">
        Etapa
        ${info.index + 1}
      </span>

      <h2>
        ${title}
      </h2>

      ${
        description
          ? `
            <p>
              ${description}
            </p>
          `
          : ''
      }
    </div>
  `;
}

function choice({
  name,

  value,

  icon,

  title,

  desc = '',

  checked = false,

  tag = '',
}) {
  return `
    <label class="choice">
      <input
        type="radio"
        name="${name}"
        value="${value}"
        ${checked ? 'checked' : ''}
      >

      <span class="choice-top">
        <span class="choice-icon">
          ${icon}
        </span>

        <span class="choice-check">
          ✓
        </span>
      </span>

      <strong>
        ${title}
      </strong>

      ${
        desc
          ? `
            <p>
              ${desc}
            </p>
          `
          : ''
      }

      ${
        tag
          ? `
            <span class="tag">
              ${tag}
            </span>
          `
          : ''
      }
    </label>
  `;
}

function visualChoice({
  name,

  value,

  image,

  title,

  desc = '',

  checked = false,
}) {
  return `
    <label
      class="choice choice-visual"
    >
      <input
        type="radio"
        name="${name}"
        value="${value}"
        ${checked ? 'checked' : ''}
      >

      <span class="style-visual">
        <img
          src="${esc(image)}"
          alt="Exemplo de ${esc(title)}"
        >
      </span>

      <span class="choice-top">
        <span class="choice-check">
          ✓
        </span>
      </span>

      <strong>
        ${title}
      </strong>

      ${
        desc
          ? `
            <p>
              ${desc}
            </p>
          `
          : ''
      }
    </label>
  `;
}

function albumChoice(
  plan,
  {
    checked = false,
  } = {},
) {
  return choice({
    name:
      'photoAlbumPlan',

    value:
      plan.key,

    icon:
      '▣',

    title:
      `Moments ${plan.name}`,

    desc:
      `Até ${plan.photos} fotos • ${plan.days} dias • filtro personalizado incluso`,

    checked,

    tag:
      money(
        plan.priceCents,
      ),
  });
}

function actionBar({
  back = true,

  nextId = 'nextBtn',

  nextLabel =
    'Continuar',

  disabled = false,
}) {
  return `
    <div class="step-actions">
      ${
        back
          ? `
            <button
              class="btn btn-secondary"
              id="backBtn"
              type="button"
            >
              Voltar
            </button>
          `
          : ''
      }

      <button
        class="btn btn-primary"
        id="${nextId}"
        type="button"
        ${disabled ? 'disabled' : ''}
      >
        ${nextLabel}
      </button>
    </div>
  `;
}

function formValue(id) {
  return $(
    id,
    stepCard,
  )?.value?.trim()
  || '';
}

function checkedValue(name) {
  return $(
    `input[name="${name}"]:checked`,
    stepCard,
  )?.value
  || '';
}

function exampleUrl(
  experience,

  format =
    'interactive',
) {
  const examples =
    state.catalog
      ?.examples
    || {};

  if (
    format === 'video'
  ) {
    return experience
      === 'reduced'

      ? examples
        .videoReduced

      : examples
        .videoFull;
  }

  return experience
    === 'reduced'

    ? examples
      .interactiveReduced

    : examples
      .interactiveFull;
}

function openExample(url) {
  if (!url) {
    modal(
      'Exemplo',

      '<p>Esse exemplo ainda será configurado pela Libri.</p>',
    );

    return;
  }

  window.open(
    url,
    '_blank',
    'noopener',
  );
}

function scrollToElement(id) {
  requestAnimationFrame(
    () => {
      const element =
        document.getElementById(
          id,
        );

      if (!element) {
        return;
      }

      const top =
        element
          .getBoundingClientRect()
          .top
        + window.scrollY
        - 105;

      window.scrollTo({
        top,

        behavior:
          'smooth',
      });
    },
  );
}

/* ==================================================
   ETAPA 1 | PRODUTO
================================================== */

async function renderProduct() {
  normalizeAlbumSelection();

  await refreshQuote();

  const selection =
    state.selection;

  const quote =
    state.quote;

  const albumSelected =
    hasPhotoAlbum();

  const showFormat =
    Boolean(
      selection.experience,
    );

  const showCommercial =
    Boolean(
      selection.experience

      && selection.format

      && quote,
    );

  stepCard.innerHTML = `
    ${stepHeader(
      'Escolha seu convite',

      'Primeiro escolha o tamanho da experiência. Depois, como quer receber o convite.',
    )}

    <div class="step-body">
      <section class="section-block">
        <div class="section-title">
          <div>
            <span class="section-kicker">
              Experiência
            </span>

            <h3>
              Quanto de história
              você quer?
            </h3>
          </div>
        </div>

        <div class="choice-grid">
          ${choice({
            name:
              'experience',

            value:
              'full',

            icon:
              '✦',

            title:
              'Experiência Completa',

            desc:
              'Mais cenas, mais história, mais impacto.',

            checked:
              selection.experience
              === 'full',

            tag:
              'Mais escolhida',
          })}

          ${choice({
            name:
              'experience',

            value:
              'reduced',

            icon:
              '♡',

            title:
              'Experiência Reduzida',

            desc:
              'Mais curta, com menos cenas e uma experiência mais direta.',

            checked:
              selection.experience
              === 'reduced',
          })}
        </div>
      </section>

      ${
        showFormat
          ? `
            <section
              class="section-block reveal-block"
              id="formatBlock"
            >
              <div class="section-title">
                <div>
                  <span class="section-kicker">
                    Formato
                  </span>

                  <h3>
                    Como quer receber?
                  </h3>
                </div>
              </div>

              <div class="choice-grid">
                ${choice({
                  name:
                    'format',

                  value:
                    'video',

                  icon:
                    '▶',

                  title:
                    'Vídeo',

                  desc:
                    'Você recebe o arquivo para enviar pelo WhatsApp. Sem botões clicáveis.',

                  checked:
                    selection.format
                    === 'video',
                })}

                ${choice({
                  name:
                    'format',

                  value:
                    'interactive',

                  icon:
                    '◇',

                  title:
                    'Interativo',

                  desc:
                    'Abre por link e pode ter localização, presentes e outros recursos clicáveis.',

                  checked:
                    selection.format
                    === 'interactive',
                })}
              </div>

              ${
                selection.format
                  ? `
                    <div class="example-row">
                      <button
                        id="formatExample"
                        class="btn btn-ghost"
                        type="button"
                      >
                        Ver exemplo deste formato
                      </button>
                    </div>
                  `
                  : ''
              }
            </section>
          `
          : ''
      }

      ${
        showCommercial
          ? `
            <section
              class="section-block reveal-block"
              id="commercialBlock"
            >
              <div class="price-hero">
                <div>
                  <div class="label">
                    Seu convite
                  </div>

                  <div class="product-name">
                    ${esc(
                      productLabelFromQuote(
                        quote,
                      ),
                    )}
                  </div>
                </div>

                <div class="money-big">
                  ${money(
                    quote.productCents,
                  )}
                </div>
              </div>

              <div class="section-title">
                <div>
                  <span class="section-kicker">
                    Opcionais pagos
                  </span>

                  <h3>
                    Quer acrescentar algo?
                  </h3>
                </div>
              </div>

              <div class="addon-grid">
                <article class="addon-card">
                  <span class="addon-icon">
                    ✓
                  </span>

                  <div class="addon-copy">
                    <strong>
                      Confirmação de presença Libri
                    </strong>

                    <p>
                      Lista organizada de quem vai à festa, com painel para acompanhar as respostas.
                    </p>

                    <span class="hint">
                      Funciona no convite Interativo.
                    </span>

                    <button
                      type="button"
                      class="btn btn-ghost"
                      data-special-example="confirmation"
                    >
                      Ver como funciona
                    </button>
                  </div>

                  <div class="addon-control">
                    <div class="addon-price">
                      + ${money(
                        state.catalog
                          .addons
                          .confirmation,
                      )}
                    </div>

                    <label class="toggle-control">
                      <input
                        id="addonConfirmation"
                        type="checkbox"
                        ${
                          selection
                            .addons
                            .confirmation
                            ? 'checked'
                            : ''
                        }
                      >

                      <span>
                        Adicionar
                      </span>
                    </label>
                  </div>
                </article>

                <article class="addon-card">
                  <span class="addon-icon">
                    ✦
                  </span>

                  <div class="addon-copy">
                    <strong>
                      Filtro personalizado
                    </strong>

                    ${
                      albumSelected
                        ? `
                          <p>
                            Já está incluso no plano Libri Moments escolhido.
                          </p>

                          <span class="hint">
                            Não haverá cobrança separada do filtro.
                          </span>
                        `
                        : `
                          <p>
                            Filtro exclusivo para as fotos da festa.
                          </p>

                          <button
                            type="button"
                            class="btn btn-ghost"
                            data-special-example="filter"
                          >
                            Ver exemplo
                          </button>
                        `
                    }
                  </div>

                  <div class="addon-control">
                    ${
                      albumSelected
                        ? `
                          <div class="addon-price">
                            Incluso no álbum
                          </div>
                        `
                        : `
                          <div class="addon-price">
                            + ${money(
                              state.catalog
                                .addons
                                .filter,
                            )}
                          </div>

                          <label class="toggle-control">
                            <input
                              id="addonFilter"
                              type="checkbox"
                              ${
                                selection
                                  .addons
                                  .filter
                                  ? 'checked'
                                  : ''
                              }
                            >

                            <span>
                              Adicionar
                            </span>
                          </label>
                        `
                    }
                  </div>
                </article>

                <article class="addon-card">
                  <span class="addon-icon">
                    ＋
                  </span>

                  <div class="addon-copy">
                    <strong>
                      Cena extra
                    </strong>

                    <p>
                      Mais um momento no convite.
                    </p>
                  </div>

                  <div class="addon-control">
                    <div class="addon-price">
                      + ${money(
                        state.catalog
                          .addons
                          .extraScene,
                      )}
                      cada
                    </div>

                    <div class="stepper">
                      <button
                        type="button"
                        data-stepper="extraScene"
                        data-delta="-1"
                      >
                        −
                      </button>

                      <span>
                        ${
                          selection
                            .addons
                            .extraScene
                          || 0
                        }
                      </span>

                      <button
                        type="button"
                        data-stepper="extraScene"
                        data-delta="1"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </article>

                <article class="addon-card">
                  <span class="addon-icon">
                    ☺
                  </span>

                  <div class="addon-copy">
                    <strong>
                      Outra criança ou pessoa
                    </strong>

                    <p>
                      Inclua mais alguém na criação.
                    </p>
                  </div>

                  <div class="addon-control">
                    <div class="addon-price">
                      + ${money(
                        state.catalog
                          .addons
                          .extraPerson,
                      )}
                      cada
                    </div>

                    <div class="stepper">
                      <button
                        type="button"
                        data-stepper="extraPerson"
                        data-delta="-1"
                      >
                        −
                      </button>

                      <span>
                        ${
                          selection
                            .addons
                            .extraPerson
                          || 0
                        }
                      </span>

                      <button
                        type="button"
                        data-stepper="extraPerson"
                        data-delta="1"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </article>
              </div>

              <div class="notice notice-warning">
                <strong>
                  Precisa antes de
                  ${
                    state.catalog
                      .rules
                      .deadlineBusinessDays
                  }
                  dias úteis?
                </strong>

                <br>

                Consulte a disponibilidade.
                Se aprovada, a urgência acrescenta
                ${
                  state.catalog
                    .rules
                    .urgencyPercent
                }%.

                <div>
                  <a
                    id="urgencyLink"
                    target="_blank"
                    rel="noopener"
                  >
                    Consultar urgência
                  </a>
                </div>
              </div>

              ${quoteBreakdownHtml(
                quote,
              )}
            </section>
          `
          : ''
      }

      ${actionBar({
        back: false,

        nextLabel:
          'Continuar',

        disabled:
          !showCommercial,
      })}
    </div>
  `;

  $$(
    'input[name="experience"]',
    stepCard,
  ).forEach(
    (input) => {
      input.addEventListener(
        'change',

        async () => {
          selection.experience =
            input.value;

          selection.format =
            '';

          selection
            .addons
            .confirmation =
              false;

          await renderProduct();

          scrollToElement(
            'formatBlock',
          );
        },
      );
    },
  );

  $$(
    'input[name="format"]',
    stepCard,
  ).forEach(
    (input) => {
      input.addEventListener(
        'change',

        async () => {
          selection.format =
            input.value;

          await renderProduct();

          scrollToElement(
            'commercialBlock',
          );
        },
      );
    },
  );

  $(
    '#formatExample',
    stepCard,
  )?.addEventListener(
    'click',

    () => {
      openExample(
        exampleUrl(
          selection.experience,

          selection.format,
        ),
      );
    },
  );

  $$(
    '[data-special-example]',
    stepCard,
  ).forEach(
    (button) => {
      button.addEventListener(
        'click',

        () => {
          openExample(
            state.catalog
              .examples[
                button.dataset
                  .specialExample
              ],
          );
        },
      );
    },
  );

  $(
    '#addonConfirmation',
    stepCard,
  )?.addEventListener(
    'change',

    async (event) => {
      const checked =
        event.target.checked;

      selection
        .addons
        .confirmation =
          checked;

      if (
        checked

        && selection.format
        === 'video'
      ) {
        selection.format =
          'interactive';

        modal(
          'Confirmação Libri',

          '<p>A Confirmação Libri funciona no convite <strong>Interativo</strong>. O formato foi ajustado automaticamente e o valor foi recalculado.</p>',
        );
      }

      await rerenderProduct();
    },
  );

  $(
    '#addonFilter',
    stepCard,
  )?.addEventListener(
    'change',

    async (event) => {
      selection
        .addons
        .filter =
          event.target.checked;

      await rerenderProduct();
    },
  );

  $$(
    '[data-stepper]',
    stepCard,
  ).forEach(
    (button) => {
      button.addEventListener(
        'click',

        async () => {
          const key =
            button.dataset
              .stepper;

          const delta =
            Number(
              button.dataset
                .delta,
            );

          selection
            .addons[key] =
              Math.max(
                0,
                Math.min(
                  10,

                  Number(
                    selection
                      .addons[key]
                    || 0,
                  )
                  + delta,
                ),
              );

          await rerenderProduct();
        },
      );
    },
  );

  const urgencyLink =
    $(
      '#urgencyLink',
      stepCard,
    );

  if (
    urgencyLink
  ) {
    urgencyLink.href =
      whatsappLink(
        state.catalog
          .contact
          .libriWhatsapp,

        'Oi! Estou montando meu pedido na Libri e preciso receber antes do prazo normal. Podemos verificar a possibilidade de urgência?',
      );
  }

  $(
    '#nextBtn',
    stepCard,
  )?.addEventListener(
    'click',
    nextStep,
  );
}

async function rerenderProduct() {
  const y =
    window.scrollY;

  await renderProduct();

  window.scrollTo({
    top: y,
  });
}

/* ==================================================
   ETAPA 2 | FESTA
================================================== */

function renderParty() {
  const b =
    state.briefing;

  stepCard.innerHTML = `
    ${stepHeader(
      'Conte sobre a festa',

      'Os campos com * são obrigatórios.',
    )}

    <div class="step-body">
      <div class="form-panel">
        <div class="form-panel-head">
          <span class="panel-icon">
            ♡
          </span>

          <div>
            <h3>
              Quem
            </h3>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label>
              Seu nome

              <span class="required">
                *
              </span>
            </label>

            <input
              id="customerName"
              value="${esc(
                b.customerName,
              )}"
              autocomplete="name"
            >
          </div>

          <div class="field">
            <label>
              Seu WhatsApp

              <span class="required">
                *
              </span>
            </label>

            <input
              id="whatsapp"
              value="${esc(
                b.whatsapp,
              )}"
              inputmode="tel"
              autocomplete="tel"
              placeholder="(00) 00000-0000"
            >
          </div>

          <div class="field">
            <label>
              Nome da criança

              <span class="required">
                *
              </span>
            </label>

            <input
              id="honoreeName"
              value="${esc(
                b.honoreeName,
              )}"
            >
          </div>

          <div class="field">
            <label>
              Idade que vai completar

              <span class="required">
                *
              </span>
            </label>

            <input
              id="age"
              value="${esc(
                b.age,
              )}"
              type="number"
              min="0"
              max="120"
            >
          </div>

          <div class="field full">
            <label>
              Como o nome deve aparecer no convite?
            </label>

            <input
              id="displayName"
              value="${esc(
                b.displayName,
              )}"
              placeholder="Se deixar em branco, usaremos o nome informado acima"
            >
          </div>
        </div>
      </div>

      <div class="form-panel">
        <div class="form-panel-head">
          <span class="panel-icon">
            ◷
          </span>

          <div>
            <h3>
              Quando
            </h3>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label>
              Data

              <span class="required">
                *
              </span>
            </label>

            <input
              id="eventDate"
              type="date"
              value="${esc(
                b.eventDate,
              )}"
            >
          </div>

          <div class="field">
            <label>
              Horário

              <span class="required">
                *
              </span>
            </label>

            <input
              id="eventTime"
              type="time"
              value="${esc(
                b.eventTime,
              )}"
            >
          </div>
        </div>
      </div>

      <div class="form-panel">
        <div class="form-panel-head">
          <span class="panel-icon">
            ⌖
          </span>

          <div>
            <h3>
              Onde
            </h3>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label>
              Local

              <span class="required">
                *
              </span>
            </label>

            <input
              id="venueName"
              value="${esc(
                b.venueName,
              )}"
              placeholder="Ex.: Salão de festas"
            >
          </div>

          <div class="field">
            <label>
              Link da localização
            </label>

            <input
              id="locationUrl"
              value="${esc(
                b.locationUrl,
              )}"
              placeholder="Opcional"
            >
          </div>

          <div class="field full">
            <label>
              Endereço

              <span class="required">
                *
              </span>
            </label>

            <input
              id="venueAddress"
              value="${esc(
                b.venueAddress,
              )}"
            >
          </div>
        </div>
      </div>

      <div class="form-panel">
        <div class="form-panel-head">
          <span class="panel-icon">
            ✦
          </span>

          <div>
            <h3>
              Tema
            </h3>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label>
              Tema da festa

              <span class="required">
                *
              </span>
            </label>

            <input
              id="theme"
              value="${esc(
                b.theme,
              )}"
            >
          </div>

          <div class="field">
            <label>
              Personagem específico
            </label>

            <input
              id="characterWanted"
              value="${esc(
                b.characterWanted,
              )}"
              placeholder="Opcional"
            >
          </div>

          <div class="field full">
            <label>
              O que não pode faltar?
            </label>

            <textarea
              id="mustHave"
              placeholder="Personagem, objeto, flor, animal, brinquedo, cor..."
            >${esc(
              b.mustHave,
            )}</textarea>
          </div>

          <div class="field">
            <label>
              Tem algo que você não quer?
            </label>

            <textarea
              id="avoid"
              placeholder="Opcional"
            >${esc(
              b.avoid,
            )}</textarea>
          </div>

          <div class="field">
            <label>
              Informação especial da festa
            </label>

            <textarea
              id="specialInfo"
              placeholder="Ex.: traje sugerido, recado aos convidados, detalhe importante..."
            >${esc(
              b.specialInfo,
            )}</textarea>
          </div>
        </div>
      </div>

      ${actionBar({
        nextLabel:
          'Continuar',
      })}
    </div>
  `;

  const whatsappInput =
    $(
      '#whatsapp',
      stepCard,
    );

  whatsappInput
    ?.addEventListener(
      'input',

      () => {
        whatsappInput.value =
          formatWhatsappInput(
            whatsappInput.value,
          );
      },
    );

  $('#backBtn', stepCard)
    .addEventListener(
      'click',
      prevStep,
    );

  $('#nextBtn', stepCard)
    .addEventListener(
      'click',

      () => {
        Object.assign(
          b,

          {
            customerName:
              formValue(
                '#customerName',
              ),

            whatsapp:
              formValue(
                '#whatsapp',
              ),

            honoreeName:
              formValue(
                '#honoreeName',
              ),

            displayName:
              formValue(
                '#displayName',
              ),

            age:
              formValue(
                '#age',
              ),

            eventDate:
              formValue(
                '#eventDate',
              ),

            eventTime:
              formValue(
                '#eventTime',
              ),

            venueName:
              formValue(
                '#venueName',
              ),

            venueAddress:
              formValue(
                '#venueAddress',
              ),

            locationUrl:
              formValue(
                '#locationUrl',
              ),

            theme:
              formValue(
                '#theme',
              ),

            characterWanted:
              formValue(
                '#characterWanted',
              ),

            mustHave:
              formValue(
                '#mustHave',
              ),

            avoid:
              formValue(
                '#avoid',
              ),

            specialInfo:
              formValue(
                '#specialInfo',
              ),
          },
        );

        if (
          !b.displayName
        ) {
          b.displayName =
            b.honoreeName;
        }

        const required = [
          'customerName',

          'whatsapp',

          'honoreeName',

          'age',

          'eventDate',

          'eventTime',

          'venueName',

          'venueAddress',

          'theme',
        ];

        if (
          required.some(
            (key) =>
              !String(
                b[key]
                || '',
              ).trim(),
          )
        ) {
          showError(
            'Preencha os campos marcados com *.',
          );

          return;
        }

        nextStep();
      },
    );
}

/* ==================================================
   ETAPA 3 | CRIANÇA
================================================== */

function renderChild() {
  const b =
    state.briefing;

  stepCard.innerHTML = `
    ${stepHeader(
      'Como você imagina a criança?',

      'Escolha pela aparência do exemplo. As fotos reais serão enviadas pelo WhatsApp no final.',
    )}

    <div class="step-body">
      <section class="section-block">
        <div class="section-title">
          <div>
            <span class="section-kicker">
              Estilo do mascote
            </span>

            <h3>
              Qual resultado combina mais com você?
            </h3>
          </div>
        </div>

        <div
          class="choice-grid three mascot-choice-grid"
        >
          ${visualChoice({
            name:
              'childStyle',

            value:
              'drawing',

            image:
              MASCOT_EXAMPLES
                .drawing,

            title:
              'Bonequinho',

            desc:
              'Mais estilizado, com carinha de personagem.',

            checked:
              b.childStyle
              === 'drawing',
          })}

          ${visualChoice({
            name:
              'childStyle',

            value:
              'real',

            image:
              MASCOT_EXAMPLES
                .real,

            title:
              'Mais realista',

            desc:
              'Mais detalhado, mantendo aparência de criação artística.',

            checked:
              b.childStyle
              === 'real',
          })}

          ${choice({
            name:
              'childStyle',

            value:
              'libri',

            icon:
              '✦',

            title:
              'A Libri escolhe',

            desc:
              'Escolhemos o estilo que funciona melhor para o tema.',

            checked:
              b.childStyle
              === 'libri',
          })}
        </div>

        <div class="notice">
          Os exemplos servem apenas para mostrar a diferença de estilo.
          O mascote do seu convite será criado a partir das fotos enviadas.

          <button
            id="mascotInfo"
            class="btn btn-ghost"
            type="button"
          >
            Saiba mais
          </button>
        </div>
      </section>

      <section class="section-block">
        <div class="section-title">
          <div>
            <span class="section-kicker">
              Roupa
            </span>

            <h3>
              Como quer o look?
            </h3>
          </div>
        </div>

        <div class="choice-grid three">
          ${choice({
            name:
              'outfitChoice',

            value:
              'party',

            icon:
              '♡',

            title:
              'Parecida com a roupa da festa',

            checked:
              b.outfitChoice
              === 'party',
          })}

          ${choice({
            name:
              'outfitChoice',

            value:
              'specific',

            icon:
              '⌁',

            title:
              'Tenho uma roupa específica',

            checked:
              b.outfitChoice
              === 'specific',
          })}

          ${choice({
            name:
              'outfitChoice',

            value:
              'libri',

            icon:
              '✦',

            title:
              'A Libri cria',

            checked:
              b.outfitChoice
              === 'libri',
          })}
        </div>

        <div
          class="form-panel"
          style="margin-top:12px"
        >
          <div class="field">
            <label>
              Algum estilo ou detalhe que gostaria que a roupa seguisse?
            </label>

            <textarea
              id="outfitDetails"
              placeholder="Ex.: country, princesa, jardineira, vestido rosa, chapéu, laço..."
            >${esc(
              b.outfitDetails,
            )}</textarea>

            <span class="hint">
              Opcional. Se tiver foto da roupa, você poderá enviar no WhatsApp no final.
            </span>
          </div>
        </div>
      </section>

      <section class="section-block">
        <div class="form-panel">
          <div class="field">
            <label>
              Algum detalhe importante da aparência?
            </label>

            <textarea
              id="appearanceDetails"
              placeholder="Ex.: cachinhos, franja, laço, óculos..."
            >${esc(
              b.appearanceDetails,
            )}</textarea>
          </div>
        </div>
      </section>

      ${actionBar({
        nextLabel:
          'Continuar',
      })}
    </div>
  `;

  $('#mascotInfo', stepCard)
    .addEventListener(
      'click',

      () => {
        modal(
          'Sobre o mascote',

          `
            <p>
              O mascote é uma recriação artística feita a partir das fotos enviadas.
              A Libri busca preservar características importantes da criança,
              respeitando a idade e o estilo escolhido.
            </p>

            <p>
              Antes de produzir o convite, você recebe uma prévia do mascote para conferir.
            </p>
          `,
        );
      },
    );

  $('#backBtn', stepCard)
    .addEventListener(
      'click',
      prevStep,
    );

  $('#nextBtn', stepCard)
    .addEventListener(
      'click',

      () => {
        b.childStyle =
          checkedValue(
            'childStyle',
          )
          || 'libri';

        b.outfitChoice =
          checkedValue(
            'outfitChoice',
          )
          || 'libri';

        b.outfitDetails =
          formValue(
            '#outfitDetails',
          );

        b.appearanceDetails =
          formValue(
            '#appearanceDetails',
          );

        nextStep();
      },
    );
}

/* ==================================================
   ETAPA 4 | ESTILO
================================================== */

function renderStyle() {
  const b =
    state.briefing;

  stepCard.innerHTML = `
    ${stepHeader(
      'Agora, o seu gosto',

      'Se não tiver preferência, pode deixar por conta da Libri.',
    )}

    <div class="step-body">
      <div class="form-panel">
        <div class="form-grid">
          <div class="field">
            <label>
              Cores que gostaria de usar
            </label>

            <textarea
              id="colors"
              placeholder="Ex.: rosa, marrom e dourado"
            >${esc(
              b.colors,
            )}</textarea>
          </div>

          <div class="field">
            <label>
              Cores que prefere evitar
            </label>

            <textarea
              id="colorsAvoided"
              placeholder="Opcional"
            >${esc(
              b.colorsAvoided,
            )}</textarea>
          </div>

          <div class="field full">
            <label>
              Alguma ideia ou detalhe?
            </label>

            <textarea
              id="creativeIdea"
              placeholder="Opcional"
            >${esc(
              b.creativeIdea,
            )}</textarea>

            <span class="hint">
              Referências visuais podem ser enviadas pelo WhatsApp no final.
            </span>
          </div>
        </div>
      </div>

      <section class="section-block">
        <div class="section-title">
          <div>
            <span class="section-kicker">
              Falas
            </span>

            <h3>
              Você já tem alguma frase obrigatória?
            </h3>
          </div>
        </div>

        <div class="choice-grid">
          ${choice({
            name:
              'speechPreference',

            value:
              'libri',

            icon:
              '✦',

            title:
              'Pode deixar com a Libri',

            desc:
              'Criamos as falas de acordo com o convite.',

            checked:
              b.speechPreference
              === 'libri',
          })}

          ${choice({
            name:
              'speechPreference',

            value:
              'own',

            icon:
              '“”',

            title:
              'Tenho uma frase',

            desc:
              'Quero que uma frase específica seja considerada.',

            checked:
              b.speechPreference
              === 'own',
          })}

          ${
            b.speechPreference
              === 'approve'

              ? choice({
                name:
                  'speechPreference',

                value:
                  'approve',

                icon:
                  '✓',

                title:
                  'Quero conferir antes',

                desc:
                  'Opção preservada deste rascunho.',

                checked:
                  true,
              })

              : ''
          }
        </div>

        <div
          id="ownSpeechWrap"
          class="form-panel ${
            b.speechPreference
              === 'own'
              ? ''
              : 'hidden'
          }"
          style="margin-top:12px"
        >
          <div class="field">
            <label>
              Escreva a frase
            </label>

            <textarea
              id="ownSpeech"
            >${esc(
              b.ownSpeech,
            )}</textarea>
          </div>
        </div>
      </section>

      ${actionBar({
        nextLabel:
          'Continuar',
      })}
    </div>
  `;

  $$(
    'input[name="speechPreference"]',
    stepCard,
  ).forEach(
    (input) => {
      input.addEventListener(
        'change',

        () => {
          $('#ownSpeechWrap', stepCard)
            .classList
            .toggle(
              'hidden',

              input.value
              !== 'own',
            );
        },
      );
    },
  );

  $('#backBtn', stepCard)
    .addEventListener(
      'click',
      prevStep,
    );

  $('#nextBtn', stepCard)
    .addEventListener(
      'click',

      () => {
        b.colors =
          formValue(
            '#colors',
          );

        b.colorsAvoided =
          formValue(
            '#colorsAvoided',
          );

        b.creativeIdea =
          formValue(
            '#creativeIdea',
          );

        b.speechPreference =
          checkedValue(
            'speechPreference',
          )
          || 'libri';

        b.ownSpeech =
          b.speechPreference
          === 'own'

            ? formValue(
              '#ownSpeech',
            )

            : '';

        if (
          b.speechPreference
          === 'own'

          && !b.ownSpeech
        ) {
          showError(
            'Escreva a frase que deseja usar.',
          );

          return;
        }

        nextStep();
      },
    );
}

/* ==================================================
   ETAPA 5 | RECURSOS
================================================== */

function renderResources() {
  const b =
    state.briefing;

  normalizeAlbumSelection();

  syncAlbumBriefing();

  const interactive =
    state.selection
      .format
    === 'interactive';

  const selectedAlbum =
    state.selection
      .addons
      .photoAlbumPlan;

  const extra100 =
    Number(
      state.selection
        .addons
        .photoAlbumExtra100
      || 0,
    );

  stepCard.innerHTML = `
    ${stepHeader(
      'Recursos do convite',

      'Só vamos considerar o que você escolher aqui.',
    )}

    <div class="step-body">
      ${
        hasConfirmation()
          ? `
            <section class="section-block">
              <div class="section-title">
                <div>
                  <span class="section-kicker">
                    Confirmação Libri
                  </span>

                  <h3>
                    Como prefere organizar as confirmações?
                  </h3>
                </div>
              </div>

              <div class="choice-grid three">
                ${choice({
                  name:
                    'confirmationMode',

                  value:
                    'open',

                  icon:
                    '◎',

                  title:
                    'Livre',

                  desc:
                    'Quem receber o link pode confirmar.',

                  checked:
                    b.confirmationMode
                    === 'open',
                })}

                ${choice({
                  name:
                    'confirmationMode',

                  value:
                    'list',

                  icon:
                    '☷',

                  title:
                    'Lista de convidados',

                  desc:
                    'As confirmações ficam ligadas à lista de convidados.',

                  checked:
                    b.confirmationMode
                    === 'list',
                })}

                ${choice({
                  name:
                    'confirmationMode',

                  value:
                    'unsure',

                  icon:
                    '?',

                  title:
                    'Ainda não sei',

                  desc:
                    'Você decide depois com a Libri.',

                  checked:
                    b.confirmationMode
                    === 'unsure',
                })}
              </div>
            </section>
          `
          : ''
      }

      ${
        interactive
          ? `
            <section class="section-block">
              <div class="section-title">
                <div>
                  <span class="section-kicker">
                    Presentes
                  </span>

                  <h3>
                    Você quer uma página de sugestões de presentes?
                  </h3>
                </div>
              </div>

              <div class="choice-grid three">
                ${choice({
                  name:
                    'giftPage',

                  value:
                    'yes',

                  icon:
                    '🎁',

                  title:
                    'Sim',

                  checked:
                    b.giftPage
                    === 'yes',
                })}

                ${choice({
                  name:
                    'giftPage',

                  value:
                    'no',

                  icon:
                    '○',

                  title:
                    'Não',

                  checked:
                    b.giftPage
                    === 'no',
                })}

                ${choice({
                  name:
                    'giftPage',

                  value:
                    'unsure',

                  icon:
                    '?',

                  title:
                    'Ainda não sei',

                  checked:
                    b.giftPage
                    === 'unsure',
                })}
              </div>

              <div
                id="giftDetailsWrap"
                class="form-panel ${
                  b.giftPage
                  === 'yes'
                    ? ''
                    : 'hidden'
                }"
                style="margin-top:12px"
              >
                <div class="field">
                  <label>
                    O que gostaria de sugerir aos convidados?
                  </label>

                  <textarea
                    id="giftDetails"
                    placeholder="Ex.: roupa tamanho 4, calçado 26/27, brinquedos, perfumes, Pix..."
                  >${esc(
                    b.giftDetails,
                  )}</textarea>
                </div>
              </div>
            </section>
          `
          : ''
      }

      <section class="section-block">
        <div class="section-title">
          <div>
            <span class="section-kicker">
              Libri Moments
            </span>

            <h3>
              Quer um álbum de fotos da festa?
            </h3>

            <p>
              Os convidados podem registrar os momentos da festa em um álbum compartilhado.
              Todos os planos incluem 1 filtro personalizado.
            </p>
          </div>
        </div>

        <div class="choice-grid">
          ${choice({
            name:
              'photoAlbumPlan',

            value:
              '',

            icon:
              '○',

            title:
              'Não quero álbum',

            desc:
              'Meu pedido fica somente com os recursos escolhidos acima.',

            checked:
              !selectedAlbum,
          })}

          ${albumChoice(
            PHOTO_ALBUM.festa,

            {
              checked:
                selectedAlbum
                === 'festa',
            },
          )}

          ${albumChoice(
            PHOTO_ALBUM.premium,

            {
              checked:
                selectedAlbum
                === 'premium',
            },
          )}

          ${albumChoice(
            PHOTO_ALBUM.exclusive,

            {
              checked:
                selectedAlbum
                === 'exclusive',
            },
          )}
        </div>

        ${
          selectedAlbum
            ? `
              <div
                class="form-panel"
                style="margin-top:14px"
              >
                <div class="section-title">
                  <div>
                    <span class="section-kicker">
                      Fotos extras
                    </span>

                    <h3>
                      Precisa de mais espaço?
                    </h3>

                    <p>
                      Cada pacote acrescenta 100 fotos ao álbum por
                      ${money(
                        PHOTO_ALBUM
                          .extra100Cents,
                      )}.
                    </p>
                  </div>
                </div>

                <div class="addon-card">
                  <span class="addon-icon">
                    ＋
                  </span>

                  <div class="addon-copy">
                    <strong>
                      Pacote de +100 fotos
                    </strong>

                    <p>
                      Opcional.
                    </p>
                  </div>

                  <div class="addon-control">
                    <div class="addon-price">
                      + ${money(
                        PHOTO_ALBUM
                          .extra100Cents,
                      )}
                      cada
                    </div>

                    <div class="stepper">
                      <button
                        type="button"
                        data-album-extra="-1"
                      >
                        −
                      </button>

                      <span>
                        ${extra100}
                      </span>

                      <button
                        type="button"
                        data-album-extra="1"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <div class="notice">
                  <strong>
                    Seu Libri Moments:
                  </strong>

                  ${
                    esc(
                      humanAlbumPlan(
                        selectedAlbum,
                      ),
                    )
                  }

                  ${
                    extra100
                      ? `
                        +
                        ${extra100}
                        pacote(s) extra
                      `
                      : ''
                  }

                  •
                  ${money(
                    albumTotalCents(),
                  )}

                  <br>

                  O filtro personalizado já está incluído.
                  Ele não será cobrado separadamente.
                </div>
              </div>
            `
            : ''
        }
      </section>

      ${actionBar({
        nextLabel:
          'Revisar pedido',
      })}
    </div>
  `;

  $$(
    'input[name="giftPage"]',
    stepCard,
  ).forEach(
    (input) => {
      input.addEventListener(
        'change',

        () => {
          $(
            '#giftDetailsWrap',
            stepCard,
          )?.classList.toggle(
            'hidden',

            input.value
            !== 'yes',
          );
        },
      );
    },
  );

  $$(
    'input[name="photoAlbumPlan"]',
    stepCard,
  ).forEach(
    (input) => {
      input.addEventListener(
        'change',

        () => {
          state.selection
            .addons
            .photoAlbumPlan =
              input.value;

          if (
            input.value
          ) {
            /*
             * Moments inclui filtro.
             */
            state.selection
              .addons
              .filter =
                false;
          } else {
            state.selection
              .addons
              .photoAlbumExtra100 =
                0;
          }

          normalizeAlbumSelection();

          syncAlbumBriefing();

          renderResources();
        },
      );
    },
  );

  $$(
    '[data-album-extra]',
    stepCard,
  ).forEach(
    (button) => {
      button.addEventListener(
        'click',

        () => {
          const delta =
            Number(
              button.dataset
                .albumExtra,
            );

          state.selection
            .addons
            .photoAlbumExtra100 =
              Math.max(
                0,
                Math.min(
                  20,

                  Number(
                    state.selection
                      .addons
                      .photoAlbumExtra100
                    || 0,
                  )
                  + delta,
                ),
              );

          syncAlbumBriefing();

          renderResources();
        },
      );
    },
  );

  $('#backBtn', stepCard)
    .addEventListener(
      'click',
      prevStep,
    );

  $('#nextBtn', stepCard)
    .addEventListener(
      'click',

      () => {
        if (
          hasConfirmation()
        ) {
          b.confirmationMode =
            checkedValue(
              'confirmationMode',
            )
            || 'unsure';
        }

        if (
          interactive
        ) {
          b.giftPage =
            checkedValue(
              'giftPage',
            )
            || 'unsure';

          b.giftDetails =
            b.giftPage
            === 'yes'

              ? formValue(
                '#giftDetails',
              )

              : '';
        } else {
          b.giftPage =
            'no';

          b.giftDetails =
            '';
        }

        normalizeAlbumSelection();

        syncAlbumBriefing();

        nextStep();
      },
    );
}

/* ==================================================
   REVISÃO
================================================== */

async function renderReview() {
  normalizeAlbumSelection();

  syncAlbumBriefing();

  await refreshQuote();

  const b =
    state.briefing;

  const q =
    state.quote;

  const addons =
    addonNames();

  const album =
    currentAlbum();

  stepCard.innerHTML = `
    ${stepHeader(
      'Confira seu pedido',

      'Revise as informações e o valor antes de finalizar.',
    )}

    <div class="step-body">
      <div class="review-grid">
        <article class="review-card">
          <div class="review-card-head">
            <h3>
              Festa
            </h3>

            <button
              class="review-edit"
              type="button"
              data-go-step="1"
            >
              Editar
            </button>
          </div>

          <dl class="review-list">
            <div class="review-line">
              <dt>
                Nome no convite
              </dt>

              <dd>
                ${esc(
                  b.displayName
                  || b.honoreeName,
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Idade
              </dt>

              <dd>
                ${esc(
                  b.age,
                )}
                ano(s)
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Quando
              </dt>

              <dd>
                ${esc(
                  formatDate(
                    b.eventDate,
                  ),
                )}
                •
                ${esc(
                  b.eventTime,
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Onde
              </dt>

              <dd>
                ${esc(
                  b.venueName,
                )}

                <br>

                ${esc(
                  b.venueAddress,
                )}
              </dd>
            </div>

            ${
              b.locationUrl
                ? `
                  <div class="review-line">
                    <dt>
                      Localização
                    </dt>

                    <dd>
                      Link informado
                    </dd>
                  </div>
                `
                : ''
            }

            <div class="review-line">
              <dt>
                Tema
              </dt>

              <dd>
                ${esc(
                  b.theme,
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Não pode faltar
              </dt>

              <dd>
                ${esc(
                  b.mustHave
                  || 'Nada específico informado',
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Não quer
              </dt>

              <dd>
                ${esc(
                  b.avoid
                  || 'Nada específico informado',
                )}
              </dd>
            </div>
          </dl>
        </article>

        <article class="review-card">
          <div class="review-card-head">
            <h3>
              Convite
            </h3>

            <button
              class="review-edit"
              type="button"
              data-go-step="0"
            >
              Editar
            </button>
          </div>

          <dl class="review-list">
            <div class="review-line">
              <dt>
                Experiência
              </dt>

              <dd>
                ${humanExperience(
                  q.experience,
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Formato
              </dt>

              <dd>
                ${humanFormat(
                  q.format,
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Adicionais
              </dt>

              <dd>
                ${
                  addons.length
                    ? esc(
                      addons.join(
                        ', ',
                      ),
                    )
                    : 'Nenhum'
                }
              </dd>
            </div>
          </dl>
        </article>

        <article class="review-card">
          <div class="review-card-head">
            <h3>
              Criança
            </h3>

            <button
              class="review-edit"
              type="button"
              data-go-step="2"
            >
              Editar
            </button>
          </div>

          <dl class="review-list">
            <div class="review-line">
              <dt>
                Estilo
              </dt>

              <dd>
                ${humanChildStyle(
                  b.childStyle,
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Roupa
              </dt>

              <dd>
                ${humanOutfit(
                  b.outfitChoice,
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Direção da roupa
              </dt>

              <dd>
                ${esc(
                  b.outfitDetails
                  || 'Sem detalhe específico',
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Aparência
              </dt>

              <dd>
                ${esc(
                  b.appearanceDetails
                  || 'Sem detalhe adicional',
                )}
              </dd>
            </div>
          </dl>
        </article>

        <article class="review-card">
          <div class="review-card-head">
            <h3>
              Preferências
            </h3>

            <button
              class="review-edit"
              type="button"
              data-go-step="3"
            >
              Editar
            </button>
          </div>

          <dl class="review-list">
            <div class="review-line">
              <dt>
                Falas
              </dt>

              <dd>
                ${humanSpeech(
                  b.speechPreference,
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Cores desejadas
              </dt>

              <dd>
                ${esc(
                  b.colors
                  || 'Sem preferência',
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Cores a evitar
              </dt>

              <dd>
                ${esc(
                  b.colorsAvoided
                  || 'Nenhuma',
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Ideia / referência
              </dt>

              <dd>
                ${esc(
                  b.creativeIdea
                  || 'Nenhuma ideia extra informada',
                )}
              </dd>
            </div>
          </dl>
        </article>

        <article class="review-card full">
          <div class="review-card-head">
            <h3>
              Recursos
            </h3>

            <button
              class="review-edit"
              type="button"
              data-go-step="4"
            >
              Editar
            </button>
          </div>

          <dl class="review-list">
            ${
              hasConfirmation()
                ? `
                  <div class="review-line">
                    <dt>
                      Confirmação Libri
                    </dt>

                    <dd>
                      ${esc(
                        humanConfirmation(
                          b.confirmationMode,
                        ),
                      )}
                    </dd>
                  </div>
                `
                : ''
            }

            ${
              q.format
              === 'interactive'

                ? `
                  <div class="review-line">
                    <dt>
                      Página de presentes
                    </dt>

                    <dd>
                      ${esc(
                        humanTriState(
                          b.giftPage,
                        ),
                      )}
                    </dd>
                  </div>

                  ${
                    b.giftPage
                    === 'yes'

                    && b.giftDetails

                      ? `
                        <div class="review-line">
                          <dt>
                            Sugestões
                          </dt>

                          <dd>
                            ${esc(
                              b.giftDetails,
                            )}
                          </dd>
                        </div>
                      `
                      : ''
                  }
                `
                : ''
            }

            <div class="review-line">
              <dt>
                Álbum de fotos
              </dt>

              <dd>
                ${
                  album
                    ? `
                      ${esc(
                        `Libri Moments ${album.name}`,
                      )}

                      •
                      ${album.photos
                        + (
                          Number(
                            state.selection
                              .addons
                              .photoAlbumExtra100
                            || 0,
                          )
                          * 100
                        )
                      }
                      fotos

                      •
                      ${album.days}
                      dias
                    `
                    : 'Não'
                }
              </dd>
            </div>

            ${
              album
                ? `
                  <div class="review-line">
                    <dt>
                      Filtro
                    </dt>

                    <dd>
                      Incluso no Libri Moments
                    </dd>
                  </div>

                  <div class="review-line">
                    <dt>
                      Valor do álbum
                    </dt>

                    <dd>
                      ${money(
                        albumTotalCents(),
                      )}
                    </dd>
                  </div>
                `
                : ''
            }
          </dl>
        </article>
      </div>

      ${quoteBreakdownHtml(q)}

      <div class="terms-box">
        <strong>
          Condições do pedido
        </strong>

        <div class="notice">
          Prazo normal:
          até
          ${
            state.catalog
              .rules
              .deadlineBusinessDays
          }
          dias úteis.

          A produção começa após briefing completo,
          fotos adequadas,
          aceite das condições
          e confirmação da entrada.
        </div>

        <button
          id="readTerms"
          class="btn btn-ghost"
          type="button"
        >
          Ler todas as condições
        </button>

        <label class="checkline">
          <input
            id="termsAccepted"
            type="checkbox"
            ${
              state.termsAccepted
                ? 'checked'
                : ''
            }
          >

          <span>
            <strong>
              Li e concordo com as condições.
            </strong>
          </span>
        </label>
      </div>

      <section class="section-block">
        <div class="section-title">
          <div>
            <span class="section-kicker">
              Divulgação
            </span>

            <h3>
              A Libri pode mostrar seu convite no portfólio?
            </h3>

            <p>
              Isso não interfere na produção.
            </p>
          </div>
        </div>

        <div class="choice-grid">
          ${choice({
            name:
              'portfolioConsent',

            value:
              'yes',

            icon:
              '♡',

            title:
              'Sim, autorizo',

            checked:
              state.portfolioConsent
              === true,
          })}

          ${choice({
            name:
              'portfolioConsent',

            value:
              'no',

            icon:
              '○',

            title:
              'Não, prefiro que não',

            checked:
              state.portfolioConsent
              === false,
          })}
        </div>
      </section>

      ${actionBar({
        nextId:
          'finishBtn',

        nextLabel:
          'Finalizar pedido',
      })}
    </div>
  `;

  $('#readTerms', stepCard)
    .addEventListener(
      'click',

      () => {
        modal(
          `Condições • versão ${esc(
            state.terms.version,
          )}`,

          `<pre>${esc(
            state.terms.body,
          )}</pre>`,
        );
      },
    );

  $('#termsAccepted', stepCard)
    .addEventListener(
      'change',

      (event) => {
        state.termsAccepted =
          event.target.checked;
      },
    );

  $$(
    'input[name="portfolioConsent"]',
    stepCard,
  ).forEach(
    (input) => {
      input.addEventListener(
        'change',

        () => {
          state.portfolioConsent =
            input.value
            === 'yes';
        },
      );
    },
  );

  $$(
    '[data-go-step]',
    stepCard,
  ).forEach(
    (button) => {
      button.addEventListener(
        'click',

        () =>
          goToStep(
            Number(
              button.dataset
                .goStep,
            ),
          ),
      );
    },
  );

  $('#backBtn', stepCard)
    .addEventListener(
      'click',
      prevStep,
    );

  $('#finishBtn', stepCard)
    .addEventListener(
      'click',
      finishOrder,
    );
}

/* ==================================================
   FINALIZAR
================================================== */

async function finishOrder() {
  state.termsAccepted =
    $('#termsAccepted', stepCard)
      ?.checked
    === true;

  const portfolio =
    checkedValue(
      'portfolioConsent',
    );

  state.portfolioConsent =
    portfolio === 'yes'

      ? true

      : portfolio === 'no'

        ? false

        : null;

  if (
    !state.termsAccepted
  ) {
    showError(
      'Marque que leu e concorda com as condições.',
    );

    return;
  }

  if (
    state.portfolioConsent
    === null
  ) {
    showError(
      'Escolha se autoriza ou não a divulgação.',
    );

    return;
  }

  normalizeAlbumSelection();

  syncAlbumBriefing();

  await refreshQuote();

  const button =
    $('#finishBtn', stepCard);

  button.disabled =
    true;

  button.textContent =
    'Salvando...';

  try {
    const data =
      await api(
        '/api/orders',

        {
          method: 'POST',

          body:
            JSON.stringify({
              draftToken:
                state.draftToken,

              selection:
                state.selection,

              briefing:
                state.briefing,

              termsAccepted:
                true,

              termsVersion:
                state.terms
                  ?.version
                || '',

              expectedTotalCents:
                state.quote
                  ?.totalCents,

              portfolioConsent:
                state.portfolioConsent,
            }),
        },
      );

    localStorage.removeItem(
      'libriDraftToken',
    );

    state.draftToken =
      null;

    flow.classList.add(
      'hidden',
    );

    await renderFinal(
      data.order,
    );

    window.scrollTo({
      top: 0,

      behavior:
        'smooth',
    });
  } catch (error) {
    button.disabled =
      false;

    button.textContent =
      'Finalizar pedido';

    const code =
      error.data
        ?.details
        ?.code;

    if (
      code === 'price_changed'
      || code === 'terms_changed'
    ) {
      await refreshCatalogAndTerms();

      state.termsAccepted =
        false;

      await renderReview();

      showError(
        code === 'price_changed'

          ? 'O valor foi atualizado. Confira o novo total antes de finalizar.'

          : 'As condições foram atualizadas. Leia e aceite a nova versão antes de finalizar.',
      );

      return;
    }

    const missing =
      error.data
        ?.details
        ?.missing;

    showError(
      missing?.length

        ? `Faltou conferir: ${missing.join(', ')}.`

        : error.message,
    );
  }
}

/* ==================================================
   TELA FINAL
================================================== */

async function renderFinal(order) {
  const data =
    await api(
      `/api/orders/${order.publicToken}/final`,
    );

  const final =
    data.final;

  const hasPix =
    Boolean(
      final.pixKey,
    );

  const hasWhatsapp =
    Boolean(
      final.libriWhatsapp,
    );

  finalScreen.innerHTML = `
    <div class="final-hero">
      <div class="final-check">
        ✓
      </div>

      <h2>
        Pedido recebido 💛
      </h2>

      <p>
        Agora envie as fotos, referências e o comprovante pelo WhatsApp.
      </p>

      <div class="final-code">
        ${esc(
          final.orderCode,
        )}
      </div>
    </div>

    <div class="final-body">
      <div class="final-summary">
        <div class="quote-row total">
          <span>
            Total
          </span>

          <strong>
            ${money(
              final.totalCents,
            )}
          </strong>
        </div>

        <div class="quote-row">
          <span>
            Entrada
          </span>

          <strong>
            ${money(
              final.depositCents,
            )}
          </strong>
        </div>

        <div class="quote-row">
          <span>
            Restante
          </span>

          <strong>
            ${money(
              final.balanceCents,
            )}
          </strong>
        </div>
      </div>

      <div class="pix-box">
        <div class="pix-title">
          ◇ Pagamento via Pix
        </div>

        ${
          hasPix
            ? `
              <div class="pix-data">
                <div>
                  <span>
                    Recebedor
                  </span>

                  <strong>
                    ${esc(
                      final.pixRecipientName
                      || '',
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    Chave Pix
                  </span>

                  <strong id="pixKey">
                    ${esc(
                      final.pixKey,
                    )}
                  </strong>
                </div>
              </div>

              <button
                id="copyPix"
                class="btn btn-secondary"
                type="button"
                style="margin-top:12px"
              >
                Copiar chave Pix
              </button>
            `
            : `
              <div class="notice notice-warning">
                Os dados do Pix ainda não foram configurados.
              </div>
            `
        }
      </div>

      <div class="send-list">
        <strong>
          Envie:
        </strong>

        <ul>
          <li>
            fotos da criança;
          </li>

          <li>
            foto da roupa, se tiver;
          </li>

          <li>
            referências, se tiver;
          </li>

          <li>
            comprovante da entrada.
          </li>
        </ul>
      </div>

      ${
        hasWhatsapp
          ? `
            <a
              class="final-whatsapp"
              href="${whatsappLink(
                final.libriWhatsapp,

                `Oi! Finalizei meu pedido ${final.orderCode}. Vou enviar aqui as fotos, referências e o comprovante da entrada.`,
              )}"
              target="_blank"
              rel="noopener"
            >
              Finalizar e enviar tudo pelo WhatsApp
            </a>
          `
          : `
            <div class="notice notice-warning">
              O WhatsApp da Libri ainda não foi configurado.
            </div>
          `
      }
    </div>
  `;

  $('#copyPix', finalScreen)
    ?.addEventListener(
      'click',

      async () => {
        try {
          await copyText(
            final.pixKey,
          );

          $('#copyPix', finalScreen)
            .textContent =
              'Chave copiada ✓';
        } catch {
          modal(
            'Chave Pix',

            `<p>${esc(
              final.pixKey,
            )}</p>`,
          );
        }
      },
    );

  finalScreen
    .classList
    .remove(
      'hidden',
    );
}

async function copyText(value) {
  if (!value) {
    return;
  }

  if (
    navigator
      .clipboard
      ?.writeText
  ) {
    await navigator
      .clipboard
      .writeText(
        value,
      );

    return;
  }

  const area =
    document.createElement(
      'textarea',
    );

  area.value =
    value;

  area.style.position =
    'fixed';

  area.style.opacity =
    '0';

  document.body
    .appendChild(
      area,
    );

  area.select();

  document.execCommand(
    'copy',
  );

  area.remove();
}

/* ==================================================
   NAVEGAÇÃO
================================================== */

async function nextStep() {
  const previous =
    state.step;

  state.step =
    Math.min(
      5,
      state.step + 1,
    );

  try {
    await saveDraft();

    render();

    window.scrollTo({
      top: 0,

      behavior:
        'smooth',
    });
  } catch (error) {
    state.step =
      previous;

    showError(
      `Não foi possível salvar esta etapa. ${error.message}`,
    );
  }
}

async function prevStep() {
  const previous =
    state.step;

  state.step =
    Math.max(
      0,
      state.step - 1,
    );

  try {
    await saveDraft();

    render();

    window.scrollTo({
      top: 0,

      behavior:
        'smooth',
    });
  } catch (error) {
    state.step =
      previous;

    showError(
      `Não foi possível salvar esta etapa. ${error.message}`,
    );
  }
}

async function goToStep(step) {
  state.step =
    Math.max(
      0,
      Math.min(
        5,
        Number(step),
      ),
    );

  try {
    await saveDraft();

    render();

    window.scrollTo({
      top: 0,

      behavior:
        'smooth',
    });
  } catch (error) {
    showError(
      error.message,
    );
  }
}

async function render() {
  progress();

  if (
    state.step === 0
  ) {
    return renderProduct();
  }

  if (
    state.step === 1
  ) {
    return renderParty();
  }

  if (
    state.step === 2
  ) {
    return renderChild();
  }

  if (
    state.step === 3
  ) {
    return renderStyle();
  }

  if (
    state.step === 4
  ) {
    return renderResources();
  }

  return renderReview();
}

/* ==================================================
   EVENTOS INICIAIS
================================================== */

newOrderBtn.addEventListener(
  'click',

  async () => {
    newOrderBtn.disabled =
      true;

    try {
      await createDraft();

      startFlow();
    } catch (error) {
      newOrderBtn.disabled =
        false;

      showError(
        error.message,
      );
    }
  },
);

continueBtn.addEventListener(
  'click',

  async () => {
    continueBtn.disabled =
      true;

    try {
      const loaded =
        await loadDraft();

      if (
        loaded
      ) {
        startFlow();

        return;
      }

      continueBtn
        .classList
        .add(
          'hidden',
        );

      modal(
        'Pedido não encontrado',

        '<p>Esse rascunho não está mais disponível. Você pode iniciar um novo pedido.</p>',
      );
    } catch (error) {
      modal(
        'Não conseguimos carregar seu pedido',

        `<p>${esc(
          error.message,
        )}</p><p>Seu rascunho continua salvo neste aparelho. Tente novamente em alguns instantes.</p>`,
      );
    } finally {
      continueBtn.disabled =
        false;
    }
  },
);

bootstrap().catch(
  (error) => {
    modal(
      'Não conseguimos carregar o portal',

      `<p>${esc(
        error.message,
      )}</p><p>Tente recarregar a página.</p>`,
    );
  },
);
