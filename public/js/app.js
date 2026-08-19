const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STEP_TITLES = ['Seu convite', 'A festa', 'A criança', 'Seu estilo', 'Recursos', 'Revisão'];

const state = {
  step: 0,
  draftToken: null,
  catalog: null,
  terms: null,
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
    appearanceDetails: '',
    colors: '',
    creativeIdea: '',
    speechPreference: 'libri',
    ownSpeech: '',
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
const newOrderBtn = $('#newOrder');
const continueBtn = $('#continueOrder');
const helpWhatsapp = $('#helpWhatsapp');
const topHelpWhatsapp = $('#topHelpWhatsapp');

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
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return '#';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function formatDate(value) {
  if (!value) return '';
  const parts = String(value).split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatWhatsappInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 13);
  let local = digits;

  if (local.startsWith('55') && local.length > 11) {
    local = local.slice(2);
  }

  if (local.length <= 2) return local;
  if (local.length <= 6) return `(${local.slice(0, 2)}) ${local.slice(2)}`;
  if (local.length <= 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7, 11)}`;
}

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

$('#closeModal').addEventListener('click', closeModal);

$('#modalBackdrop').addEventListener('click', (event) => {
  if (event.target.id === 'modalBackdrop') closeModal();
});

document.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape'
    && !$('#modalBackdrop').classList.contains('hidden')
  ) {
    closeModal();
  }
});

function showError(message) {
  modal('Confira antes de continuar', `<p>${esc(message)}</p>`);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Object.assign(
      new Error(data.error || 'Não foi possível concluir.'),
      {
        data,
        status: response.status,
      },
    );
  }

  return data;
}

function setHelpLinks() {
  const number = state.catalog?.contact?.libriWhatsapp || '';

  const href = whatsappLink(
    number,
    'Oi! Preciso de ajuda para preencher meu pedido no Portal da Libri Convites.',
  );

  [helpWhatsapp, topHelpWhatsapp].forEach((link) => {
    if (!link) return;
    link.href = href;
    link.classList.toggle('hidden', !number);
  });
}

async function bootstrap() {
  const [catalogData, termsData] = await Promise.all([
    api('/api/catalog'),
    api('/api/terms/current'),
  ]);

  state.catalog = catalogData.catalog;
  state.terms = termsData.terms;

  setHelpLinks();

  newOrderBtn.disabled = false;

  const savedToken = localStorage.getItem('libriDraftToken');

  if (savedToken) {
    continueBtn.classList.remove('hidden');
    continueBtn.disabled = false;
  }
}

async function createDraft() {
  const data = await api('/api/drafts', {
    method: 'POST',
    body: '{}',
  });

  state.draftToken = data.draft.token;

  localStorage.setItem(
    'libriDraftToken',
    state.draftToken,
  );

  state.step = 0;

  await saveDraft();
}

async function loadDraft() {
  const token = localStorage.getItem('libriDraftToken');

  if (!token) return false;

  try {
    const data = await api(`/api/drafts/${token}`);
    const draftData = data.draft.data || {};

    state.draftToken = token;
    state.step = Number(data.draft.step || 0);

    state.selection = {
      ...state.selection,
      ...(draftData.selection || {}),
      addons: {
        ...state.selection.addons,
        ...(draftData.selection?.addons || {}),
      },
    };

    state.briefing = {
      ...state.briefing,
      ...(draftData.briefing || {}),
    };

    state.portfolioConsent =
      typeof draftData.portfolioConsent === 'boolean'
        ? draftData.portfolioConsent
        : null;

    state.termsAccepted =
      Boolean(draftData.termsAccepted);

    return true;
  } catch {
    localStorage.removeItem('libriDraftToken');
    return false;
  }
}

function setSaveStatus(text, className = '') {
  const el = $('#saveStatus');

  if (!el) return;

  el.textContent = text;

  el.classList.remove(
    'is-saving',
    'is-error',
  );

  if (className) {
    el.classList.add(className);
  }
}

async function saveDraft() {
  if (!state.draftToken) return;

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
          step: state.step,
          data: {
            selection: state.selection,
            briefing: state.briefing,
            portfolioConsent: state.portfolioConsent,
            termsAccepted: state.termsAccepted,
          },
        }),
      },
    );

    setSaveStatus(
      'Salvo automaticamente',
    );
  } catch (error) {
    setSaveStatus(
      'Falha ao salvar',
      'is-error',
    );

    throw error;
  }
}

function startFlow() {
  landing.classList.add('hidden');
  finalScreen.classList.add('hidden');
  flow.classList.remove('hidden');

  render();

  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  });
}

function progress() {
  const step = Math.max(
    0,
    Math.min(5, state.step),
  );

  $('#progressLabel').textContent =
    `Etapa ${step + 1} de 6`;

  $('#progressTitle').textContent =
    STEP_TITLES[step];

  $('#progressBar').style.width =
    `${((step + 1) / 6) * 100}%`;

  $('#stepDots').innerHTML =
    STEP_TITLES
      .map((_, index) => {
        const cls =
          index < step
            ? 'done'
            : index === step
              ? 'current'
              : '';

        return `<span class="step-dot ${cls}"></span>`;
      })
      .join('');
}

async function refreshQuote() {
  if (
    !state.selection.experience
    || !state.selection.format
  ) {
    state.quote = null;
    return;
  }

  const data = await api(
    '/api/quote',
    {
      method: 'POST',
      body: JSON.stringify({
        selection: state.selection,
      }),
    },
  );

  state.quote = data.quote;
}

function exampleUrl(
  experience,
  format = 'interactive',
) {
  const examples =
    state.catalog?.examples || {};

  if (format === 'video') {
    return experience === 'reduced'
      ? examples.videoReduced
      : examples.videoFull;
  }

  return experience === 'reduced'
    ? examples.interactiveReduced
    : examples.interactiveFull;
}

function openExample(url) {
  if (!url) {
    modal(
      'Exemplo',
      '<p>Esse exemplo ainda será configurado pela Libri. Você pode continuar o pedido normalmente.</p>',
    );
    return;
  }

  window.open(
    url,
    '_blank',
    'noopener',
  );
}

function choice({
  name,
  value,
  icon,
  title,
  desc,
  checked,
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

      <strong>${title}</strong>

      <p>${desc}</p>

      ${
        tag
          ? `<span class="tag">${tag}</span>`
          : ''
      }
    </label>
  `;
}

function stepHeader(
  number,
  title,
  description,
) {
  return `
    <div class="step-head">
      <span class="step-number">
        Etapa ${number} de 6
      </span>

      <h2>${title}</h2>

      <p>${description}</p>
    </div>
  `;
}

function actionBar({
  back = true,
  nextId = 'nextBtn',
  nextLabel = 'Continuar',
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

function scrollIntoViewSoon(id) {
  requestAnimationFrame(() => {
    const el =
      document.getElementById(id);

    if (!el) return;

    const top =
      el.getBoundingClientRect().top
      + window.scrollY
      - 112;

    window.scrollTo({
      top,
      behavior: 'smooth',
    });
  });
}

async function rerenderProductKeepingScroll() {
  const y = window.scrollY;

  await renderProduct();

  window.scrollTo({
    top: y,
  });
}

async function renderProduct() {
  await refreshQuote();

  const selection = state.selection;
  const quote = state.quote;

  const showFormat =
    Boolean(selection.experience);

  const showCommercial =
    Boolean(
      selection.experience
      && selection.format,
    );

  const fullUrl =
    exampleUrl(
      'full',
      'interactive',
    );

  const reducedUrl =
    exampleUrl(
      'reduced',
      'interactive',
    );

  stepCard.innerHTML = `
    ${stepHeader(
      1,
      'Escolha a experiência',
      'Primeiro você escolhe quanto de história quer no convite. Depois escolhe como quer receber.',
    )}

    <div class="step-body">
      <section class="section-block">
        <div class="section-title">
          <div>
            <span class="section-kicker">
              1. Experiência
            </span>

            <h3>
              Quanto você quer viver desse convite?
            </h3>

            <p>
              O valor aparece só depois que você escolher também o formato.
            </p>
          </div>
        </div>

        <div
          class="choice-grid"
          id="experienceChoices"
        >
          ${choice({
            name: 'experience',
            value: 'full',
            icon: '✦',
            title: 'Experiência Completa',
            desc: 'Mais cenas, mais momentos e uma experiência mais rica do começo ao fim.',
            checked:
              selection.experience === 'full',
            tag: 'Mais escolhida',
          })}

          ${choice({
            name: 'experience',
            value: 'reduced',
            icon: '♡',
            title: 'Experiência Reduzida',
            desc: 'Uma versão mais curta, com menos cenas, mantendo a identidade da festa.',
            checked:
              selection.experience === 'reduced',
          })}
        </div>

        <div class="example-row">
          <button
            class="btn btn-ghost"
            type="button"
            data-example="${esc(fullUrl)}"
          >
            Ver exemplo completo
          </button>

          <button
            class="btn btn-ghost"
            type="button"
            data-example="${esc(reducedUrl)}"
          >
            Ver exemplo reduzido
          </button>
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
                2. Formato
              </span>

              <h3>
                Como você quer receber?
              </h3>

              <p>
                Escolha a forma que combina melhor com a sua festa.
              </p>
            </div>
          </div>

          <div class="choice-grid">
            ${choice({
              name: 'format',
              value: 'video',
              icon: '▶',
              title: 'Em Vídeo',
              desc: 'Você recebe um arquivo em vídeo pronto para enviar pelo WhatsApp.',
              checked:
                selection.format === 'video',
            })}

            ${choice({
              name: 'format',
              value: 'interactive',
              icon: '◇',
              title: 'Interativo',
              desc: 'Abre por link e pode ter botões como localização, presentes e confirmação.',
              checked:
                selection.format === 'interactive',
            })}
          </div>

          ${
            selection.format
              ? `
            <div class="example-row">
              <button
                class="btn btn-ghost"
                type="button"
                id="formatExample"
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
                Seu convite escolhido
              </div>

              <div class="product-name">
                ${humanExperience(selection.experience)}
                •
                ${humanFormat(selection.format)}
              </div>
            </div>

            <div class="money-big">
              ${money(quote.productCents)}
            </div>
          </div>

          <div class="section-title">
            <div>
              <span class="section-kicker">
                3. Personalize mais
              </span>

              <h3>
                Quer acrescentar algo?
              </h3>

              <p>
                Todos os itens abaixo são opcionais.
              </p>
            </div>
          </div>

          <div class="addon-grid">
            <article class="addon-card">
              <div class="addon-icon">
                ✓
              </div>

              <div class="addon-copy">
                <strong>
                  Confirmação de presença Libri
                </strong>

                <p>
                  Organize quem vai à festa em uma lista própria, sem depender de mensagens soltas.
                </p>

                <button
                  class="btn btn-ghost"
                  type="button"
                  data-special-example="confirmation"
                >
                  Ver como funciona
                </button>
              </div>

              <div class="addon-control">
                <div class="addon-price">
                  + ${money(state.catalog.addons.confirmation)}
                </div>

                <label class="toggle-control">
                  <input
                    type="checkbox"
                    id="addonConfirmation"
                    ${
                      selection.addons.confirmation
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
              <div class="addon-icon">
                ✦
              </div>

              <div class="addon-copy">
                <strong>
                  Filtro personalizado da festa
                </strong>

                <p>
                  Um filtro criado para os convidados usarem nas fotos do evento.
                </p>

                <button
                  class="btn btn-ghost"
                  type="button"
                  data-special-example="filter"
                >
                  Ver exemplo
                </button>
              </div>

              <div class="addon-control">
                <div class="addon-price">
                  + ${money(state.catalog.addons.filter)}
                </div>

                <label class="toggle-control">
                  <input
                    type="checkbox"
                    id="addonFilter"
                    ${
                      selection.addons.filter
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
              <div class="addon-icon">
                ＋
              </div>

              <div class="addon-copy">
                <strong>
                  Cena extra
                </strong>

                <p>
                  Acrescente mais uma cena à experiência escolhida.
                </p>
              </div>

              <div class="addon-control">
                <div class="addon-price">
                  + ${money(state.catalog.addons.extraScene)} cada
                </div>

                <div
                  class="stepper"
                  aria-label="Quantidade de cenas extras"
                >
                  <button
                    type="button"
                    data-stepper="extraScene"
                    data-delta="-1"
                    aria-label="Diminuir cena extra"
                  >
                    −
                  </button>

                  <span>
                    ${selection.addons.extraScene || 0}
                  </span>

                  <button
                    type="button"
                    data-stepper="extraScene"
                    data-delta="1"
                    aria-label="Adicionar cena extra"
                  >
                    +
                  </button>
                </div>
              </div>
            </article>

            <article class="addon-card">
              <div class="addon-icon">
                ☺
              </div>

              <div class="addon-copy">
                <strong>
                  Outra criança ou pessoa
                </strong>

                <p>
                  Inclua mais uma pessoa na criação do convite.
                </p>
              </div>

              <div class="addon-control">
                <div class="addon-price">
                  + ${money(state.catalog.addons.extraPerson)} cada
                </div>

                <div
                  class="stepper"
                  aria-label="Quantidade de pessoas extras"
                >
                  <button
                    type="button"
                    data-stepper="extraPerson"
                    data-delta="-1"
                    aria-label="Diminuir pessoa extra"
                  >
                    −
                  </button>

                  <span>
                    ${selection.addons.extraPerson || 0}
                  </span>

                  <button
                    type="button"
                    data-stepper="extraPerson"
                    data-delta="1"
                    aria-label="Adicionar pessoa extra"
                  >
                    +
                  </button>
                </div>
              </div>
            </article>
          </div>

          <div class="notice notice-warning">
            <strong>
              Precisa receber antes de ${state.catalog.rules.deadlineBusinessDays} dias úteis?
            </strong>

            <br>

            A urgência depende da disponibilidade da Libri.
            Quando aprovada, acrescenta
            ${state.catalog.rules.urgencyPercent}%
            ao valor do pedido.

            <div>
              <a
                id="urgencyLink"
                target="_blank"
                rel="noopener"
              >
                Consultar urgência pelo WhatsApp
              </a>
            </div>
          </div>

          <div
            class="quote-card"
            id="quoteSummary"
          >
            <div class="quote-row total">
              <span>
                Total até agora
              </span>

              <strong>
                ${money(quote.totalCents)}
              </strong>
            </div>

            <div class="quote-row">
              <span>
                Entrada para começar (${quote.depositPercent}%)
              </span>

              <strong>
                ${money(quote.depositCents)}
              </strong>
            </div>

            <div class="quote-row">
              <span>
                Restante após aprovação
              </span>

              <strong>
                ${money(quote.balanceCents)}
              </strong>
            </div>
          </div>
        </section>
      `
          : ''
      }

      ${actionBar({
        back: false,
        nextLabel: 'Continuar para os detalhes',
        disabled: !showCommercial,
      })}
    </div>
  `;

  $$(
    'input[name="experience"]',
    stepCard,
  ).forEach((el) => {
    el.addEventListener(
      'change',
      async () => {
        selection.experience = el.value;
        selection.format = '';

        await renderProduct();

        scrollIntoViewSoon(
          'formatBlock',
        );
      },
    );
  });

  $$(
    'input[name="format"]',
    stepCard,
  ).forEach((el) => {
    el.addEventListener(
      'change',
      async () => {
        selection.format = el.value;

        await renderProduct();

        scrollIntoViewSoon(
          'commercialBlock',
        );
      },
    );
  });

  $$(
    '[data-example]',
    stepCard,
  ).forEach((button) => {
    button.addEventListener(
      'click',
      () => openExample(
        button.dataset.example,
      ),
    );
  });

  $('#formatExample', stepCard)
    ?.addEventListener(
      'click',
      () => openExample(
        exampleUrl(
          selection.experience,
          selection.format,
        ),
      ),
    );

  $$(
    '[data-special-example]',
    stepCard,
  ).forEach((button) => {
    button.addEventListener(
      'click',
      () => openExample(
        state.catalog.examples[
          button.dataset.specialExample
        ],
      ),
    );
  });

  $('#addonConfirmation', stepCard)
    ?.addEventListener(
      'change',
      async (event) => {
        selection.addons.confirmation =
          event.target.checked;

        await rerenderProductKeepingScroll();
      },
    );

  $('#addonFilter', stepCard)
    ?.addEventListener(
      'change',
      async (event) => {
        selection.addons.filter =
          event.target.checked;

        await rerenderProductKeepingScroll();
      },
    );

  $$(
    '[data-stepper]',
    stepCard,
  ).forEach((button) => {
    button.addEventListener(
      'click',
      async () => {
        const key =
          button.dataset.stepper;

        const delta =
          Number(button.dataset.delta);

        selection.addons[key] =
          Math.max(
            0,
            Math.min(
              10,
              Number(
                selection.addons[key] || 0,
              ) + delta,
            ),
          );

        await rerenderProductKeepingScroll();
      },
    );
  });

  const urgency =
    $('#urgencyLink', stepCard);

  if (urgency) {
    urgency.href =
      whatsappLink(
        state.catalog.contact.libriWhatsapp,
        'Oi! Estou montando meu pedido na Libri e preciso receber antes do prazo normal. Podemos verificar a possibilidade de urgência?',
      );
  }

  $('#nextBtn', stepCard)
    ?.addEventListener(
      'click',
      nextStep,
    );
}

function formValue(id) {
  return (
    $(id, stepCard)
      ?.value
      ?.trim()
    || ''
  );
}

function checkedValue(name) {
  return (
    $(
      `input[name="${name}"]:checked`,
      stepCard,
    )?.value
    || ''
  );
}

function renderParty() {
  const b = state.briefing;

  stepCard.innerHTML = `
    ${stepHeader(
      2,
      'Conte sobre a festa',
      'Agora entram os dados que fazem o convite ser realmente seu. Os campos com * são obrigatórios.',
    )}

    <div class="step-body">
      <div class="form-panel">
        <div class="form-panel-head">
          <span class="panel-icon">
            ♡
          </span>

          <div>
            <h3>
              Quem está comemorando
            </h3>

            <p>
              Você e a criança ou homenageado(a).
            </p>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="customerName">
              Seu nome
              <span class="required">*</span>
            </label>

            <input
              id="customerName"
              value="${esc(b.customerName)}"
              autocomplete="name"
            >
          </div>

          <div class="field">
            <label for="whatsapp">
              Seu WhatsApp
              <span class="required">*</span>
            </label>

            <input
              id="whatsapp"
              value="${esc(b.whatsapp)}"
              inputmode="tel"
              autocomplete="tel"
              placeholder="(00) 00000-0000"
            >
          </div>

          <div class="field">
            <label for="honoreeName">
              Nome da criança
              <span class="required">*</span>
            </label>

            <input
              id="honoreeName"
              value="${esc(b.honoreeName)}"
            >
          </div>

          <div class="field">
            <label for="age">
              Idade que vai fazer
              <span class="required">*</span>
            </label>

            <input
              id="age"
              value="${esc(b.age)}"
              type="number"
              min="0"
              max="120"
              inputmode="numeric"
            >
          </div>

          <div class="field full">
            <label for="displayName">
              Como você quer que o nome apareça?
            </label>

            <input
              id="displayName"
              value="${esc(b.displayName)}"
              placeholder="Se deixar vazio, usaremos o nome acima"
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

            <p>
              Data e horário da comemoração.
            </p>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="eventDate">
              Data da festa
              <span class="required">*</span>
            </label>

            <input
              id="eventDate"
              value="${esc(b.eventDate)}"
              type="date"
            >
          </div>

          <div class="field">
            <label for="eventTime">
              Horário
              <span class="required">*</span>
            </label>

            <input
              id="eventTime"
              value="${esc(b.eventTime)}"
              type="time"
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

            <p>
              O local que vai aparecer no convite.
            </p>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="venueName">
              Nome do local
              <span class="required">*</span>
            </label>

            <input
              id="venueName"
              value="${esc(b.venueName)}"
              placeholder="Ex.: Salão de festas"
            >
          </div>

          <div class="field">
            <label for="locationUrl">
              Link da localização
            </label>

            <input
              id="locationUrl"
              value="${esc(b.locationUrl)}"
              placeholder="Opcional"
            >
          </div>

          <div class="field full">
            <label for="venueAddress">
              Endereço
              <span class="required">*</span>
            </label>

            <input
              id="venueAddress"
              value="${esc(b.venueAddress)}"
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
              O universo da festa
            </h3>

            <p>
              Tema, personagens e detalhes importantes.
            </p>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="theme">
              Tema da festa
              <span class="required">*</span>
            </label>

            <input
              id="theme"
              value="${esc(b.theme)}"
              placeholder="Ex.: fundo do mar rosa"
            >
          </div>

          <div class="field">
            <label for="characterWanted">
              Tem algum personagem específico?
            </label>

            <input
              id="characterWanted"
              value="${esc(b.characterWanted)}"
              placeholder="Se não tiver, deixe em branco"
            >
          </div>

          <div class="field full">
            <label for="mustHave">
              O que não pode faltar?
            </label>

            <textarea
              id="mustHave"
              placeholder="Pode ser personagem, objeto, flor, animal, brinquedo, cor..."
            >${esc(b.mustHave)}</textarea>
          </div>

          <div class="field">
            <label for="avoid">
              Tem algo que você não quer?
            </label>

            <textarea
              id="avoid"
              placeholder="Opcional"
            >${esc(b.avoid)}</textarea>
          </div>

          <div class="field">
            <label for="specialInfo">
              Algum recado especial precisa aparecer?
            </label>

            <textarea
              id="specialInfo"
              placeholder="Ex.: traga sua bebida, use roupa confortável..."
            >${esc(b.specialInfo)}</textarea>
          </div>
        </div>
      </div>

      ${actionBar({
        nextLabel: 'Continuar',
      })}
    </div>
  `;

  const whatsappInput =
    $('#whatsapp', stepCard);

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
              formValue('#customerName'),

            whatsapp:
              formValue('#whatsapp'),

            honoreeName:
              formValue('#honoreeName'),

            displayName:
              formValue('#displayName'),

            age:
              formValue('#age'),

            eventDate:
              formValue('#eventDate'),

            eventTime:
              formValue('#eventTime'),

            venueName:
              formValue('#venueName'),

            venueAddress:
              formValue('#venueAddress'),

            locationUrl:
              formValue('#locationUrl'),

            theme:
              formValue('#theme'),

            characterWanted:
              formValue('#characterWanted'),

            mustHave:
              formValue('#mustHave'),

            avoid:
              formValue('#avoid'),

            specialInfo:
              formValue('#specialInfo'),
          },
        );

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
                b[key] || '',
              ).trim(),
          )
        ) {
          showError(
            'Preencha os campos marcados com * para continuar.',
          );
          return;
        }

        nextStep();
      },
    );
}

function renderChild() {
  const b = state.briefing;

  stepCard.innerHTML = `
    ${stepHeader(
      3,
      'Como você imagina a criança?',
      'As fotos serão enviadas pelo WhatsApp só no final. Aqui você escolhe apenas a direção que prefere.',
    )}

    <div class="step-body">
      <section class="section-block">
        <div class="section-title">
          <div>
            <span class="section-kicker">
              Aparência
            </span>

            <h3>
              Qual estilo você prefere?
            </h3>
          </div>
        </div>

        <div class="choice-grid three">
          ${choice({
            name: 'childStyle',
            value: 'drawing',
            icon: '✎',
            title: 'Desenho / bonequinho',
            desc: 'Um visual mais ilustrado, suave e com jeitinho de animação.',
            checked:
              b.childStyle === 'drawing',
          })}

          ${choice({
            name: 'childStyle',
            value: 'real',
            icon: '◉',
            title: 'Mais real e detalhado',
            desc: 'Mais detalhes naturais de pele, cabelo e traços.',
            checked:
              b.childStyle === 'real',
          })}

          ${choice({
            name: 'childStyle',
            value: 'libri',
            icon: '✦',
            title: 'A Libri escolhe',
            desc: 'Escolhemos o estilo que combinar melhor com o universo do convite.',
            checked:
              b.childStyle === 'libri',
          })}
        </div>

        <div class="notice">
          Usamos as fotos como referência para preservar as principais características da criança.

          <button
            id="mascotInfo"
            class="btn btn-ghost"
            type="button"
          >
            Entender melhor
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
              Como você quer o look?
            </h3>
          </div>
        </div>

        <div class="choice-grid three">
          ${choice({
            name: 'outfitChoice',
            value: 'party',
            icon: '♡',
            title: 'Parecida com a roupa da festa',
            desc: 'Você envia uma foto da roupa no WhatsApp ao finalizar.',
            checked:
              b.outfitChoice === 'party',
          })}

          ${choice({
            name: 'outfitChoice',
            value: 'specific',
            icon: '⌁',
            title: 'Tenho uma roupa específica',
            desc: 'Você envia a referência exata pelo WhatsApp no final.',
            checked:
              b.outfitChoice === 'specific',
          })}

          ${choice({
            name: 'outfitChoice',
            value: 'libri',
            icon: '✦',
            title: 'Quero que a Libri crie',
            desc: 'Criamos uma roupa pensada para combinar com o tema.',
            checked:
              b.outfitChoice === 'libri',
          })}
        </div>
      </section>

      <section class="section-block">
        <div class="form-panel">
          <div class="field">
            <label for="appearanceDetails">
              Tem algum detalhe da aparência que devemos manter com atenção?
            </label>

            <textarea
              id="appearanceDetails"
              placeholder="Ex.: cachinhos, franja, laço, óculos ou outro acessório especial."
            >${esc(b.appearanceDetails)}</textarea>

            <span class="hint">
              Opcional. Use este campo apenas para detalhes que são importantes para você.
            </span>
          </div>
        </div>
      </section>

      ${actionBar({
        nextLabel: 'Continuar',
      })}
    </div>
  `;

  $('#mascotInfo', stepCard)
    .addEventListener(
      'click',
      () => {
        modal(
          'Sobre o mascote',
          '<p>O mascote é uma recriação artística feita a partir das fotos enviadas. A Libri busca preservar rosto, cabelo, tom de pele, idade e características marcantes, mas não se trata de uma cópia exata da fotografia e podem existir pequenas diferenças. Antes de seguir com o convite, você poderá ver e aprovar.</p>',
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
          checkedValue('childStyle')
          || 'libri';

        b.outfitChoice =
          checkedValue('outfitChoice')
          || 'libri';

        b.appearanceDetails =
          formValue(
            '#appearanceDetails',
          );

        nextStep();
      },
    );
}

function renderStyle() {
  const b = state.briefing;

  stepCard.innerHTML = `
    ${stepHeader(
      4,
      'Agora, o seu gosto',
      'Se você não tiver preferência, tudo bem. A Libri pode assumir a direção criativa por você.',
    )}

    <div class="step-body">
      <div class="form-panel">
        <div class="form-panel-head">
          <span class="panel-icon">
            ◌
          </span>

          <div>
            <h3>
              Cores e referências
            </h3>

            <p>
              Só o que você realmente quiser orientar.
            </p>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="colors">
              Tem alguma cor que você quer ou não quer?
            </label>

            <textarea
              id="colors"
              placeholder="Opcional"
            >${esc(b.colors)}</textarea>
          </div>

          <div class="field">
            <label for="creativeIdea">
              Tem alguma ideia ou detalhe que gostaria de ver?
            </label>

            <textarea
              id="creativeIdea"
              placeholder="Opcional"
            >${esc(b.creativeIdea)}</textarea>

            <span class="hint">
              Se tiver imagens de referência, você enviará pelo WhatsApp no final.
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
              Como prefere decidir os textos falados?
            </h3>
          </div>
        </div>

        <div class="choice-grid three">
          ${choice({
            name: 'speechPreference',
            value: 'libri',
            icon: '✦',
            title: 'Pode deixar com a Libri',
            desc: 'Criamos as falas de acordo com o convite.',
            checked:
              b.speechPreference === 'libri',
          })}

          ${choice({
            name: 'speechPreference',
            value: 'approve',
            icon: '✓',
            title: 'Quero aprovar antes',
            desc: 'A Libri prepara e você confere antes da produção dessa parte.',
            checked:
              b.speechPreference === 'approve',
          })}

          ${choice({
            name: 'speechPreference',
            value: 'own',
            icon: '“”',
            title: 'Já tenho uma frase',
            desc: 'Você escreve exatamente o que gostaria de usar.',
            checked:
              b.speechPreference === 'own',
          })}
        </div>

        <div
          class="form-panel ${
            b.speechPreference === 'own'
              ? ''
              : 'hidden'
          }"
          id="ownSpeechWrap"
        >
          <div class="field">
            <label for="ownSpeech">
              Escreva a frase
            </label>

            <textarea
              id="ownSpeech"
              placeholder="Digite a frase exatamente como deseja."
            >${esc(b.ownSpeech)}</textarea>
          </div>
        </div>
      </section>

      ${actionBar({
        nextLabel: 'Continuar',
      })}
    </div>
  `;

  $$(
    'input[name="speechPreference"]',
    stepCard,
  ).forEach((el) => {
    el.addEventListener(
      'change',
      () => {
        $('#ownSpeechWrap', stepCard)
          .classList
          .toggle(
            'hidden',
            el.value !== 'own',
          );
      },
    );
  });

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
          formValue('#colors');

        b.creativeIdea =
          formValue('#creativeIdea');

        b.speechPreference =
          checkedValue(
            'speechPreference',
          )
          || 'libri';

        b.ownSpeech =
          b.speechPreference === 'own'
            ? formValue('#ownSpeech')
            : '';

        if (
          b.speechPreference === 'own'
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

function renderResources() {
  const b = state.briefing;

  const hasConfirmation =
    Boolean(
      state.selection
        .addons
        .confirmation,
    );

  stepCard.innerHTML = `
    ${stepHeader(
      5,
      'Últimos detalhes',
      'Aqui aparecem apenas as escolhas extras que realmente fazem parte do seu pedido.',
    )}

    <div class="step-body">
      ${
        hasConfirmation
          ? `
        <section class="section-block">
          <div class="section-title">
            <div>
              <span class="section-kicker">
                Confirmação Libri
              </span>

              <h3>
                Como você quer que funcione?
              </h3>
            </div>
          </div>

          <div class="choice-grid three">
            ${choice({
              name: 'confirmationMode',
              value: 'open',
              icon: '◎',
              title: 'Qualquer convidado pode confirmar',
              desc: 'Quem receber o link poderá preencher a confirmação.',
              checked:
                b.confirmationMode === 'open',
            })}

            ${choice({
              name: 'confirmationMode',
              value: 'list',
              icon: '☷',
              title: 'Quero usar lista de convidados',
              desc: 'Você poderá cadastrar e organizar os convidados no seu painel.',
              checked:
                b.confirmationMode === 'list',
            })}

            ${choice({
              name: 'confirmationMode',
              value: 'unsure',
              icon: '?',
              title: 'Ainda não sei',
              desc: 'Você poderá decidir isso depois com a Libri.',
              checked:
                b.confirmationMode === 'unsure',
            })}
          </div>
        </section>
      `
          : `
        <div
          class="notice notice-success"
          style="margin-top:0"
        >
          <strong>
            Tudo certo por aqui.
          </strong>

          <br>

          Seu pedido não tem nenhum recurso que precise de configuração extra.
          Pode seguir para a revisão.
        </div>
      `
      }

      ${actionBar({
        nextLabel: 'Revisar meu pedido',
      })}
    </div>
  `;

  $('#backBtn', stepCard)
    .addEventListener(
      'click',
      prevStep,
    );

  $('#nextBtn', stepCard)
    .addEventListener(
      'click',
      () => {
        if (hasConfirmation) {
          b.confirmationMode =
            checkedValue(
              'confirmationMode',
            )
            || 'unsure';
        }

        nextStep();
      },
    );
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
    drawing: 'Desenho / bonequinho',
    real: 'Mais real e detalhado',
    libri: 'A Libri escolhe',
  })[value]
    || 'A Libri escolhe';
}

function humanOutfit(value) {
  return ({
    party: 'Parecida com a roupa da festa',
    specific: 'Roupa específica',
    libri: 'A Libri cria',
  })[value]
    || 'A Libri cria';
}

function humanSpeech(value) {
  return ({
    libri: 'A Libri cria',
    approve: 'Quero aprovar antes',
    own: 'Frase própria',
  })[value]
    || 'A Libri cria';
}

function addonNames() {
  const addons = [];

  const selection =
    state.selection.addons;

  if (selection.confirmation) {
    addons.push(
      'Confirmação Libri',
    );
  }

  if (selection.filter) {
    addons.push(
      'Filtro personalizado',
    );
  }

  if (selection.extraScene) {
    addons.push(
      `${selection.extraScene} cena(s) extra`,
    );
  }

  if (selection.extraPerson) {
    addons.push(
      `${selection.extraPerson} pessoa(s) extra`,
    );
  }

  return addons;
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
      behavior: 'smooth',
    });
  } catch (error) {
    showError(
      error.message,
    );
  }
}

async function renderReview() {
  await refreshQuote();

  const b = state.briefing;
  const q = state.quote;
  const addons = addonNames();

  stepCard.innerHTML = `
    ${stepHeader(
      6,
      'Confira seu pedido',
      'Essa é a última etapa. Revise os dados, aceite as condições e finalize quando estiver tudo certo.',
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
              <dt>Nome</dt>

              <dd>
                ${esc(
                  b.displayName
                  || b.honoreeName,
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>Idade</dt>

              <dd>
                ${esc(b.age)} ano(s)
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Data e horário
              </dt>

              <dd>
                ${esc(
                  formatDate(
                    b.eventDate,
                  ),
                )}
                •
                ${esc(b.eventTime)}
              </dd>
            </div>

            <div class="review-line">
              <dt>Local</dt>

              <dd>
                ${esc(b.venueName)}
                <br>
                ${esc(b.venueAddress)}
              </dd>
            </div>

            <div class="review-line">
              <dt>Tema</dt>

              <dd>
                ${esc(b.theme)}
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
                  state.selection.experience,
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Formato
              </dt>

              <dd>
                ${humanFormat(
                  state.selection.format,
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
                        addons.join(', '),
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
                Detalhes
              </dt>

              <dd>
                ${esc(
                  b.appearanceDetails
                  || 'Nenhum detalhe extra informado',
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
                Cores
              </dt>

              <dd>
                ${esc(
                  b.colors
                  || 'Sem preferência informada',
                )}
              </dd>
            </div>

            <div class="review-line">
              <dt>
                Ideia extra
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
      </div>

      <div
        class="quote-card"
        style="margin-top:16px"
      >
        <div class="quote-row total">
          <span>
            Valor total
          </span>

          <strong>
            ${money(q.totalCents)}
          </strong>
        </div>

        <div class="quote-row">
          <span>
            Entrada para começar (${q.depositPercent}%)
          </span>

          <strong>
            ${money(q.depositCents)}
          </strong>
        </div>

        <div class="quote-row">
          <span>
            Restante após aprovação
          </span>

          <strong>
            ${money(q.balanceCents)}
          </strong>
        </div>
      </div>

      <div class="terms-box">
        <strong>
          Antes de finalizar
        </strong>

        <div
          class="notice"
          style="margin-top:10px"
        >
          Prazo normal:
          até ${state.catalog.rules.deadlineBusinessDays} dias úteis.

          A produção começa depois da entrada,
          do briefing completo
          e das fotos adequadas.

          Você poderá conferir
          e aprovar as etapas.
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
              Li e concordo com as condições do pedido.
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
              A Libri pode mostrar seu convite no portfólio e nas redes sociais?
            </h3>

            <p>
              Essa escolha é opcional e não interfere na produção.
            </p>
          </div>
        </div>

        <div class="choice-grid">
          ${choice({
            name: 'portfolioConsent',
            value: 'yes',
            icon: '♡',
            title: 'Sim, autorizo',
            desc: 'A Libri poderá divulgar o convite conforme as condições do pedido.',
            checked:
              state.portfolioConsent === true,
          })}

          ${choice({
            name: 'portfolioConsent',
            value: 'no',
            icon: '○',
            title: 'Não, prefiro que não seja divulgado',
            desc: 'Seu convite será produzido normalmente.',
            checked:
              state.portfolioConsent === false,
          })}
        </div>
      </section>

      ${actionBar({
        nextId: 'finishBtn',
        nextLabel: 'Finalizar pedido',
      })}
    </div>
  `;

  $('#readTerms', stepCard)
    .addEventListener(
      'click',
      () => {
        modal(
          `Condições do pedido • versão ${esc(state.terms.version)}`,
          `<pre>${esc(state.terms.body)}</pre>`,
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
  ).forEach((el) => {
    el.addEventListener(
      'change',
      () => {
        state.portfolioConsent =
          el.value === 'yes';
      },
    );
  });

  $$(
    '[data-go-step]',
    stepCard,
  ).forEach((button) => {
    button.addEventListener(
      'click',
      () => goToStep(
        button.dataset.goStep,
      ),
    );
  });

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

async function finishOrder() {
  state.termsAccepted =
    $('#termsAccepted', stepCard)
      ?.checked === true;

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

  if (!state.termsAccepted) {
    showError(
      'Marque que leu e concorda com as condições do pedido.',
    );
    return;
  }

  if (
    state.portfolioConsent === null
  ) {
    showError(
      'Escolha se autoriza ou não a divulgação do convite.',
    );
    return;
  }

  const button =
    $('#finishBtn', stepCard);

  button.disabled = true;
  button.textContent =
    'Salvando pedido...';

  try {
    const data =
      await api(
        '/api/orders',
        {
          method: 'POST',
          body: JSON.stringify({
            draftToken:
              state.draftToken,

            selection:
              state.selection,

            briefing:
              state.briefing,

            termsAccepted:
              true,

            portfolioConsent:
              state.portfolioConsent,
          }),
        },
      );

    localStorage.removeItem(
      'libriDraftToken',
    );

    flow.classList.add(
      'hidden',
    );

    await renderFinal(
      data.order,
    );

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  } catch (error) {
    button.disabled = false;

    button.textContent =
      'Finalizar pedido';

    const missing =
      error
        .data
        ?.details
        ?.missing;

    showError(
      missing?.length
        ? `Faltou conferir: ${missing.join(', ')}.`
        : error.message,
    );
  }
}

async function copyText(value) {
  if (!value) return;

  if (
    navigator
      .clipboard
      ?.writeText
  ) {
    await navigator
      .clipboard
      .writeText(value);

    return;
  }

  const area =
    document.createElement(
      'textarea',
    );

  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';

  document.body
    .appendChild(area);

  area.select();

  document.execCommand(
    'copy',
  );

  area.remove();
}

async function renderFinal(order) {
  const data =
    await api(
      `/api/orders/${order.publicToken}/final`,
    );

  const f = data.final;

  const hasPix =
    Boolean(f.pixKey);

  const hasWhatsapp =
    Boolean(f.libriWhatsapp);

  finalScreen.innerHTML = `
    <div class="final-hero">
      <div class="final-check">
        ✓
      </div>

      <h2>
        Pedido recebido 💛
      </h2>

      <p>
        Seu briefing já está organizado.
        Agora falta enviar as fotos,
        referências e o comprovante pelo WhatsApp.
      </p>

      <div class="final-code">
        ${esc(f.orderCode)}
      </div>
    </div>

    <div class="final-body">
      <div class="final-summary">
        <div class="quote-row total">
          <span>
            Valor total
          </span>

          <strong>
            ${money(f.totalCents)}
          </strong>
        </div>

        <div class="quote-row">
          <span>
            Entrada para começar
          </span>

          <strong>
            ${money(f.depositCents)}
          </strong>
        </div>

        <div class="quote-row">
          <span>
            Restante após aprovação
          </span>

          <strong>
            ${money(f.balanceCents)}
          </strong>
        </div>
      </div>

      <div class="pix-box">
        <div class="pix-title">
          <span>◇</span>
          Pagamento via Pix
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
                  f.pixRecipientName
                  || '',
                )}
              </strong>
            </div>

            <div>
              <span>
                Chave Pix
              </span>

              <strong id="pixKey">
                ${esc(f.pixKey)}
              </strong>
            </div>
          </div>

          <button
            id="copyPix"
            class="btn btn-secondary"
            type="button"
            style="margin-top:13px"
          >
            Copiar chave Pix
          </button>
        `
            : `
          <div
            class="notice notice-warning"
            style="margin-top:0"
          >
            Os dados do Pix ainda não foram configurados no portal.
            Fale com a Libri pelo WhatsApp antes de realizar o pagamento.
          </div>
        `
        }
      </div>

      <div class="send-list">
        <strong>
          Separe para enviar no WhatsApp:
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
            f.libriWhatsapp,
            `Oi! Finalizei meu pedido ${f.orderCode}. Vou enviar aqui as fotos, referências e o comprovante da entrada.`,
          )}"
          target="_blank"
          rel="noopener"
        >
          Finalizar e enviar tudo pelo WhatsApp
        </a>
      `
          : `
        <div class="notice notice-warning">
          O WhatsApp da Libri ainda não foi configurado no portal.
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
            f.pixKey,
          );

          $('#copyPix', finalScreen)
            .textContent =
              'Chave copiada ✓';
        } catch {
          modal(
            'Chave Pix',
            `<p>${esc(f.pixKey)}</p>`,
          );
        }
      },
    );

  finalScreen.classList.remove(
    'hidden',
  );
}

async function nextStep() {
  const previous = state.step;

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
      behavior: 'smooth',
    });
  } catch (error) {
    state.step = previous;

    showError(
      `Não conseguimos salvar esta etapa. ${error.message}`,
    );
  }
}

async function prevStep() {
  const previous = state.step;

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
      behavior: 'smooth',
    });
  } catch (error) {
    state.step = previous;

    showError(
      `Não conseguimos salvar esta etapa. ${error.message}`,
    );
  }
}

async function render() {
  progress();

  if (state.step === 0) {
    return renderProduct();
  }

  if (state.step === 1) {
    return renderParty();
  }

  if (state.step === 2) {
    return renderChild();
  }

  if (state.step === 3) {
    return renderStyle();
  }

  if (state.step === 4) {
    return renderResources();
  }

  return renderReview();
}

newOrderBtn
  .addEventListener(
    'click',
    async () => {
      newOrderBtn.disabled = true;

      try {
        await createDraft();

        startFlow();
      } catch (error) {
        newOrderBtn.disabled = false;

        showError(
          error.message,
        );
      }
    },
  );

continueBtn
  .addEventListener(
    'click',
    async () => {
      continueBtn.disabled = true;

      try {
        if (
          await loadDraft()
        ) {
          startFlow();
          return;
        }

        continueBtn
          .classList
          .add('hidden');

        modal(
          'Pedido não encontrado',
          '<p>Esse rascunho não está mais disponível. Você pode iniciar um novo pedido.</p>',
        );
      } finally {
        continueBtn.disabled = false;
      }
    },
  );

bootstrap()
  .catch((error) => {
    modal(
      'Não conseguimos carregar o portal',
      `<p>${esc(error.message)}</p><p>Tente recarregar a página. Se continuar, fale com a Libri.</p>`,
    );
  });
