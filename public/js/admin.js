const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  orders: [],
  overviewOrders: [],
  current: null,
  settings: null,
  terms: null,
};

let searchTimer = null;
let toastTimer = null;

/* ==================================================
   HELPERS
================================================== */

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function money(cents = 0) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format((Number(cents) || 0) / 100);
}

function formatDate(value) {
  if (!value) return 'Não informado';

  const [year, month, day] = String(value).split('-');

  return year && month && day
    ? `${day}/${month}/${year}`
    : String(value);
}

function formatDateTime(value) {
  if (!value) return 'Não informado';

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function daysUntil(dateValue) {
  if (!dateValue) return null;

  const [year, month, day] = String(dateValue).split('-').map(Number);

  if (!year || !month || !day) return null;

  const target = new Date(year, month - 1, day);
  const today = new Date();

  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  return Math.round(
    (target.getTime() - today.getTime()) / 86400000,
  );
}

function whatsappLink(number, text) {
  let digits = String(number || '').replace(/\D/g, '');

  if (
    (digits.length === 10 || digits.length === 11)
    && !digits.startsWith('55')
  ) {
    digits = `55${digits}`;
  }

  return digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : '#';
}

function statusLabel(status) {
  return ({
    new: 'Novo pedido',
    ready: 'Pronto para produção',
    producing: 'Em produção',
    waiting_client: 'Aguardando cliente',
    revisions: 'Ajustes',
    waiting_balance: 'Aguardando saldo',
    finished: 'Finalizado',
    cancelled: 'Cancelado',
  })[status] || status || 'Não informado';
}

function statusBadgeClass(status) {
  if (status === 'ready' || status === 'finished') {
    return 'green';
  }

  if (
    status === 'waiting_client'
    || status === 'waiting_balance'
  ) {
    return 'yellow';
  }

  if (status === 'revisions') {
    return 'purple';
  }

  if (status === 'cancelled') {
    return 'red';
  }

  if (status === 'producing') {
    return 'blue';
  }

  return 'neutral';
}

function productLabel(order) {
  const experience =
    order.experience === 'reduced'
      ? 'Reduzido'
      : 'Completo';

  const format =
    order.format === 'interactive'
      ? 'Interativo'
      : 'Vídeo';

  return `${format} ${experience}`;
}

function childStyleLabel(value) {
  return ({
    drawing: 'Desenho / bonequinho',
    real: 'Mais real e detalhado',
    libri: 'A Libri escolhe',
  })[value] || value || 'Não informado';
}

function outfitLabel(value) {
  return ({
    party: 'Parecida com a roupa da festa',
    specific: 'Roupa específica',
    libri: 'A Libri cria',
  })[value] || value || 'Não informado';
}

function speechLabel(value) {
  return ({
    libri: 'A Libri cria',
    approve: 'Cliente quer aprovar antes',
    own: 'Cliente enviou frase própria',
  })[value] || value || 'Não informado';
}

function confirmationModeLabel(value) {
  return ({
    open: 'Livre',
    list: 'Lista de convidados',
    unsure: 'Ainda não definido',
  })[value] || value || 'Não informado';
}

function valueOr(
  value,
  fallback = 'Não informado',
) {
  const text =
    String(value ?? '').trim();

  return text || fallback;
}

function toast(
  message,
  type = 'success',
) {
  const element =
    $('#adminToast');

  clearTimeout(
    toastTimer,
  );

  element.textContent =
    message;

  element.className =
    `admin-toast ${type}`;

  toastTimer =
    setTimeout(
      () => {
        element
          .classList
          .add('hidden');
      },
      2600,
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
      .writeText(value);

    return;
  }

  const area =
    document.createElement(
      'textarea',
    );

  area.value = value;

  area.style.position =
    'fixed';

  area.style.opacity =
    '0';

  document.body
    .appendChild(area);

  area.select();

  document.execCommand(
    'copy',
  );

  area.remove();
}

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
      .catch(() => ({}));

  if (!response.ok) {
    throw Object.assign(
      new Error(
        data.error
        || 'Erro ao concluir a ação.',
      ),
      {
        data,
        status: response.status,
      },
    );
  }

  return data;
}

/* ==================================================
   MODAL AUXILIAR
================================================== */

function openInfoModal(
  title,
  html,
) {
  $('#infoModalTitle')
    .textContent = title;

  $('#infoModalBody')
    .innerHTML = html;

  $('#infoModal')
    .classList
    .remove('hidden');
}

function closeInfoModal() {
  $('#infoModal')
    .classList
    .add('hidden');
}

function closeOrderModal() {
  $('#adminModal')
    .classList
    .add('hidden');

  state.current = null;
}

$('#closeInfoModal')
  .addEventListener(
    'click',
    closeInfoModal,
  );

$('#closeAdminModal')
  .addEventListener(
    'click',
    closeOrderModal,
  );

$('#infoModal')
  .addEventListener(
    'click',
    (event) => {
      if (
        event.target.id
        === 'infoModal'
      ) {
        closeInfoModal();
      }
    },
  );

$('#adminModal')
  .addEventListener(
    'click',
    (event) => {
      if (
        event.target.id
        === 'adminModal'
      ) {
        closeOrderModal();
      }
    },
  );

document
  .addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !== 'Escape'
      ) {
        return;
      }

      if (
        !$('#infoModal')
          .classList
          .contains('hidden')
      ) {
        closeInfoModal();
        return;
      }

      if (
        !$('#adminModal')
          .classList
          .contains('hidden')
      ) {
        closeOrderModal();
      }
    },
  );

/* ==================================================
   PEDIDOS | LISTA + KPIs
================================================== */

async function loadOrders() {
  const search =
    $('#search')
      .value
      .trim();

  const status =
    $('#statusFilter')
      .value;

  const params =
    new URLSearchParams();

  if (search) {
    params.set(
      'search',
      search,
    );
  }

  if (status) {
    params.set(
      'status',
      status,
    );
  }

  const query =
    params.toString();

  const listPath =
    `/api/admin/orders${query ? `?${query}` : ''}`;

  try {
    if (query) {
      const [
        filteredData,
        overviewData,
      ] =
        await Promise.all([
          api(listPath),
          api('/api/admin/orders'),
        ]);

      state.orders =
        filteredData.orders
        || [];

      state.overviewOrders =
        overviewData.orders
        || [];
    } else {
      const data =
        await api(
          '/api/admin/orders',
        );

      state.orders =
        data.orders
        || [];

      state.overviewOrders =
        data.orders
        || [];
    }

    renderKpis();
    renderOrders();
  } catch (error) {
    $('#ordersList')
      .innerHTML = `
        <div class="empty-state">
          <strong>
            Não foi possível carregar os pedidos.
          </strong>

          <br>

          ${esc(error.message)}
        </div>
      `;

    toast(
      'Falha ao carregar pedidos.',
      'error',
    );
  }
}

function renderKpis() {
  const today =
    todayISO();

  const orders =
    state.overviewOrders;

  const data = [
    {
      icon: '🎂',
      label: 'Festas hoje',

      count:
        orders.filter(
          (order) =>
            order.eventDate === today,
        ).length,
    },

    {
      icon: '●',
      label: 'Em produção',

      count:
        orders.filter(
          (order) =>
            order.status === 'producing',
        ).length,
    },

    {
      icon: '◷',
      label: 'Aguardando cliente',

      count:
        orders.filter(
          (order) =>
            order.status
            === 'waiting_client',
        ).length,
    },

    {
      icon: 'R$',
      label: 'Aguardando saldo',

      count:
        orders.filter(
          (order) =>
            order.status
            === 'waiting_balance',
        ).length,
    },
  ];

  $('#kpis')
    .innerHTML =
      data
        .map(
          (item) => `
            <article class="kpi">
              <span class="kpi-icon">
                ${item.icon}
              </span>

              <div>
                <span class="kpi-label">
                  ${item.label}
                </span>

                <strong>
                  ${item.count}
                </strong>
              </div>
            </article>
          `,
        )
        .join('');
}

function renderOrders() {
  if (!state.orders.length) {
    $('#ordersList')
      .innerHTML = `
        <div class="empty-state">
          Nenhum pedido encontrado.
        </div>
      `;

    return;
  }

  const today =
    todayISO();

  $('#ordersList')
    .innerHTML =
      state.orders
        .map(
          (order) => {
            const partyToday =
              order.eventDate
              === today;

            const distance =
              daysUntil(
                order.eventDate,
              );

            const veryClose =
              distance !== null
              && distance >= 1
              && distance <= 3;

            const cardClasses = [
              'order-card',

              partyToday
                ? 'party-today'
                : '',

              order.urgencyEnabled
                ? 'urgent'
                : '',
            ]
              .filter(Boolean)
              .join(' ');

            const badges = [
              `
                <span
                  class="badge ${statusBadgeClass(order.status)}"
                >
                  ${esc(
                    statusLabel(
                      order.status,
                    ),
                  )}
                </span>
              `,

              order.urgencyEnabled
                ? `
                  <span class="badge red">
                    ⚡ Urgente
                  </span>
                `
                : '',

              partyToday
                ? `
                  <span class="badge purple">
                    🎂 Festa hoje
                  </span>
                `
                : '',

              veryClose
                ? `
                  <span class="badge red">
                    🔴 Festa muito próxima
                  </span>
                `
                : '',

              order.status
              === 'waiting_client'
                ? `
                  <span class="badge yellow">
                    🟡 Aguardando cliente
                  </span>
                `
                : '',

              order.status
              === 'waiting_balance'
                ? `
                  <span class="badge yellow">
                    💰 Aguardando saldo
                  </span>
                `
                : '',

              order.photosStatus
              === 'needs_new'
                ? `
                  <span class="badge yellow">
                    📸 Precisa de novas fotos
                  </span>
                `
                : '',
            ]
              .filter(Boolean)
              .join('');

            return `
              <article class="${cardClasses}">
                <div class="order-card-main">
                  <div class="order-topline">
                    <div>
                      <div class="order-code">
                        ${esc(
                          order.orderCode,
                        )}
                      </div>

                      <div class="order-title">
                        ${esc(
                          order.displayName
                          || order.honoreeName,
                        )}

                        ${
                          order.age
                            ? ` • ${esc(order.age)} ano(s)`
                            : ''
                        }
                      </div>

                      <div class="order-theme">
                        <strong>
                          Tema:
                        </strong>

                        ${esc(
                          order.theme
                          || 'Não informado',
                        )}

                        &nbsp;•&nbsp;

                        ${esc(
                          productLabel(
                            order,
                          ),
                        )}
                      </div>
                    </div>

                    <div class="order-event">
                      <strong>
                        ${formatDate(
                          order.eventDate,
                        )}
                      </strong>

                      <span>
                        ${esc(
                          order.eventTime
                          || 'Horário não informado',
                        )}
                      </span>
                    </div>
                  </div>

                  <div class="order-meta-row badges">
                    ${badges}
                  </div>

                  <div class="order-next-action">
                    <strong>
                      Próxima ação:
                    </strong>

                    ${esc(
                      order.nextAction
                      || 'Abrir pedido',
                    )}
                  </div>
                </div>

                <div class="order-actions">
                  <button
                    class="btn btn-primary btn-small"
                    type="button"
                    data-open-order="${order.id}"
                  >
                    Abrir pedido
                  </button>

                  <a
                    class="btn btn-secondary btn-small"
                    href="${whatsappLink(
                      order.whatsapp,
                      `Oi! Estou entrando em contato sobre o seu pedido ${order.orderCode} na Libri Convites. 💛`,
                    )}"
                    target="_blank"
                    rel="noopener"
                  >
                    WhatsApp
                  </a>

                  ${
                    partyToday
                      ? `
                        <a
                          class="btn btn-secondary btn-small"
                          href="${whatsappLink(
                            order.whatsapp,
                            'Oi! Passando para desejar um dia lindo para vocês e uma comemoração muito especial! 💛 Que seja um momento cheio de carinho e boas lembranças. Um beijo, Libri Convites ✨',
                          )}"
                          target="_blank"
                          rel="noopener"
                        >
                          🎉 Parabenizar
                        </a>
                      `
                      : ''
                  }
                </div>
              </article>
            `;
          },
        )
        .join('');

  $$(
    '[data-open-order]',
  ).forEach(
    (button) => {
      button.addEventListener(
        'click',
        () => {
          openOrder(
            Number(
              button.dataset
                .openOrder,
            ),
          );
        },
      );
    },
  );
}

/* ==================================================
   PEDIDO | DETALHE
================================================== */

async function openOrder(id) {
  try {
    const data =
      await api(
        `/api/admin/orders/${id}`,
      );

    state.current =
      data.order;

    renderDetail();

    $('#adminModal')
      .classList
      .remove('hidden');
  } catch (error) {
    toast(
      error.message,
      'error',
    );
  }
}

async function reopenCurrent() {
  if (!state.current?.id) {
    return;
  }

  const data =
    await api(
      `/api/admin/orders/${state.current.id}`,
    );

  state.current =
    data.order;

  renderDetail();
}

function detailLine(
  label,
  value,
) {
  return `
    <div class="statline">
      <span>
        ${label}
      </span>

      <strong>
        ${value}
      </strong>
    </div>
  `;
}

function selectHtml(
  id,
  value,
  options,
) {
  return `
    <select id="${id}">
      ${
        options
          .map(
            ([optionValue, label]) => `
              <option
                value="${optionValue}"
                ${
                  value === optionValue
                    ? 'selected'
                    : ''
                }
              >
                ${label}
              </option>
            `,
          )
          .join('')
      }
    </select>
  `;
}

function gateHtml({
  ok,
  icon,
  title,
  text,
}) {
  return `
    <div
      class="gate ${ok ? 'ok' : 'waiting'}"
    >
      <span class="gate-icon">
        ${ok ? '✓' : icon}
      </span>

      <div class="gate-copy">
        <strong>
          ${title}
        </strong>

        <span>
          ${text}
        </span>
      </div>
    </div>
  `;
}

/* ==================================================
   RESUMO DE BRIEFING
================================================== */

function buildBriefingSummary(
  order,
) {
  const b =
    order.briefing || {};

  const addons =
    order.addons || {};

  const lines = [
    `${order.order_code} | ${valueOr(order.display_name || order.honoree_name)}`,

    '',

    `CLIENTE: ${valueOr(order.customer_name)} | WhatsApp: ${valueOr(order.whatsapp)}`,

    `EVENTO: ${formatDate(order.event_date)} às ${valueOr(order.event_time)} | ${valueOr(order.venue_name)} | ${valueOr(order.venue_address)}`,

    `PRODUTO: ${productLabel({
      experience: order.experience,
      format: order.format,
    })}`,

    `TEMA: ${valueOr(order.theme)}`,

    `PERSONAGEM ESPECÍFICO: ${valueOr(
      b.characterWanted,
      'Nenhum informado',
    )}`,

    `NÃO PODE FALTAR: ${valueOr(
      b.mustHave,
      'Nada específico informado',
    )}`,

    `NÃO QUER: ${valueOr(
      b.avoid,
      'Nada específico informado',
    )}`,

    `INFORMAÇÕES ESPECIAIS: ${valueOr(
      b.specialInfo,
      'Nenhuma',
    )}`,

    '',

    `CRIANÇA | ESTILO: ${childStyleLabel(
      b.childStyle,
    )}`,

    `CRIANÇA | ROUPA: ${outfitLabel(
      b.outfitChoice,
    )}`,

    `CRIANÇA | DETALHES: ${valueOr(
      b.appearanceDetails,
      'Nenhum detalhe extra informado',
    )}`,

    '',

    `CORES / DIREÇÃO: ${valueOr(
      b.colors,
      'Sem preferência informada',
    )}`,

    `IDEIA / REFERÊNCIA: ${valueOr(
      b.creativeIdea,
      'Nenhuma ideia extra informada',
    )}`,

    `FALAS: ${speechLabel(
      b.speechPreference,
    )}`,
  ];

  if (
    b.speechPreference === 'own'
    && b.ownSpeech
  ) {
    lines.push(
      `FRASE ENVIADA: ${b.ownSpeech}`,
    );
  }

  const extras = [];

  if (addons.confirmation) {
    extras.push(
      `Confirmação Libri (${confirmationModeLabel(b.confirmationMode)})`,
    );
  }

  if (addons.filter) {
    extras.push(
      'Filtro personalizado',
    );
  }

  if (
    Number(
      addons.extraScene || 0,
    ) > 0
  ) {
    extras.push(
      `${addons.extraScene} cena(s) extra`,
    );
  }

  if (
    Number(
      addons.extraPerson || 0,
    ) > 0
  ) {
    extras.push(
      `${addons.extraPerson} pessoa(s) extra`,
    );
  }

  lines.push('');

  lines.push(
    `RECURSOS CONTRATADOS: ${
      extras.length
        ? extras.join(' | ')
        : 'Nenhum adicional'
    }`,
  );

  return lines.join('\n');
}

function answerItem(
  label,
  value,
  fallback = 'Não informado',
) {
  return `
    <div class="answer-item">
      <span class="answer-label">
        ${label}
      </span>

      <span class="answer-value">
        ${esc(
          valueOr(
            value,
            fallback,
          ),
        )}
      </span>
    </div>
  `;
}

function fullBriefingHtml(order) {
  const b =
    order.briefing || {};

  return `
    <div class="answer-groups">
      <section class="answer-group">
        <h4>
          Cliente e festa
        </h4>

        <div class="answer-list">
          ${answerItem(
            'Cliente',
            order.customer_name,
          )}

          ${answerItem(
            'WhatsApp',
            order.whatsapp,
          )}

          ${answerItem(
            'Nome',
            order.honoree_name,
          )}

          ${answerItem(
            'Como aparece',
            order.display_name
            || order.honoree_name,
          )}

          ${answerItem(
            'Idade',
            order.age,
          )}

          ${answerItem(
            'Data',
            formatDate(
              order.event_date,
            ),
          )}

          ${answerItem(
            'Horário',
            order.event_time,
          )}

          ${answerItem(
            'Local',
            order.venue_name,
          )}

          ${answerItem(
            'Endereço',
            order.venue_address,
          )}

          ${answerItem(
            'Link de localização',
            b.locationUrl,
            'Não informado',
          )}
        </div>
      </section>

      <section class="answer-group">
        <h4>
          Tema e conteúdo
        </h4>

        <div class="answer-list">
          ${answerItem(
            'Tema',
            order.theme,
          )}

          ${answerItem(
            'Personagem específico',
            b.characterWanted,
            'Nenhum informado',
          )}

          ${answerItem(
            'Não pode faltar',
            b.mustHave,
            'Nada informado',
          )}

          ${answerItem(
            'Não quer',
            b.avoid,
            'Nada informado',
          )}

          ${answerItem(
            'Recado especial',
            b.specialInfo,
            'Nenhum',
          )}
        </div>
      </section>

      <section class="answer-group">
        <h4>
          Criança
        </h4>

        <div class="answer-list">
          ${answerItem(
            'Estilo',
            childStyleLabel(
              b.childStyle,
            ),
          )}

          ${answerItem(
            'Roupa',
            outfitLabel(
              b.outfitChoice,
            ),
          )}

          ${answerItem(
            'Detalhes da aparência',
            b.appearanceDetails,
            'Nenhum',
          )}
        </div>
      </section>

      <section class="answer-group">
        <h4>
          Direção criativa
        </h4>

        <div class="answer-list">
          ${answerItem(
            'Cores',
            b.colors,
            'Sem preferência',
          )}

          ${answerItem(
            'Ideia / detalhe',
            b.creativeIdea,
            'Nenhum',
          )}

          ${answerItem(
            'Falas',
            speechLabel(
              b.speechPreference,
            ),
          )}

          ${answerItem(
            'Frase própria',
            b.ownSpeech,
            'Não se aplica',
          )}
        </div>
      </section>

      ${
        order.addons?.confirmation
          ? `
            <section class="answer-group">
              <h4>
                Confirmação Libri
              </h4>

              <div class="answer-list">
                ${answerItem(
                  'Modo escolhido',
                  confirmationModeLabel(
                    b.confirmationMode,
                  ),
                )}
              </div>
            </section>
          `
          : ''
      }
    </div>
  `;
}

/* ==================================================
   RENDER DETALHE
================================================== */

function renderDetail() {
  const order =
    state.current;

  if (!order) {
    return;
  }

  const b =
    order.briefing || {};

  const addons =
    order.addons || {};

  const partyToday =
    order.event_date
    === todayISO();

  const summary =
    buildBriefingSummary(
      order,
    );

  const briefingOk =
    Boolean(
      order.order_code
      && order.briefing_json
      && order.terms_accepted_at,
    );

  const photosOk =
    order.photos_status
    === 'approved';

  const entryOk =
    order.entry_status
    === 'confirmed';

  const termsOk =
    Boolean(
      order.terms_accepted_at,
    );

  const canStart =
    briefingOk
    && photosOk
    && entryOk
    && termsOk;

  $('#detailTitle')
    .textContent =
      `${order.order_code} | ${order.display_name || order.honoree_name}`;

  $('#detailBody')
    .innerHTML = `
      <section class="order-detail-hero">
        <div class="order-detail-main">
          <div>
            <span class="order-code">
              ${esc(
                order.order_code,
              )}
            </span>

            <div class="order-detail-name">
              ${esc(
                order.display_name
                || order.honoree_name,
              )}

              ${
                order.age
                  ? ` • ${esc(order.age)} ano(s)`
                  : ''
              }
            </div>

            <div class="order-detail-theme">
              ${esc(
                order.theme
                || 'Tema não informado',
              )}

              &nbsp;•&nbsp;

              ${esc(
                productLabel({
                  experience:
                    order.experience,

                  format:
                    order.format,
                }),
              )}
            </div>
          </div>

          <div class="order-detail-event">
            <strong>
              ${formatDate(
                order.event_date,
              )}

              ${
                order.event_time
                  ? ` • ${esc(order.event_time)}`
                  : ''
              }
            </strong>

            <span>
              ${esc(
                order.venue_name
                || 'Local não informado',
              )}
            </span>
          </div>
        </div>

        <div class="order-detail-bottom">
          <div class="badges">
            <span
              class="badge ${statusBadgeClass(order.status)}"
            >
              ${esc(
                statusLabel(
                  order.status,
                ),
              )}
            </span>

            ${
              order.urgency_enabled
                ? `
                  <span class="badge red">
                    ⚡ Urgente
                  </span>
                `
                : ''
            }

            ${
              partyToday
                ? `
                  <span class="badge purple">
                    🎂 Festa hoje
                  </span>
                `
                : ''
            }
          </div>

          <div class="next-action-highlight">
            <strong>
              Próxima ação:
            </strong>

            ${esc(
              order.nextAction
              || 'Abrir pedido',
            )}
          </div>
        </div>
      </section>

      <div class="quick-actions">
        <a
          class="btn btn-primary btn-small"
          href="${whatsappLink(
            order.whatsapp,
            `Oi! Estou entrando em contato sobre o seu pedido ${order.order_code} na Libri Convites. 💛`,
          )}"
          target="_blank"
          rel="noopener"
        >
          📲 Chamar cliente
        </a>

        <a
          class="btn btn-secondary btn-small"
          href="${whatsappLink(
            order.whatsapp,
            `Oi! Sobre o pedido ${order.order_code}: preciso de novas fotos para conseguirmos seguir com a criação. Vou te orientar por aqui. 💛`,
          )}"
          target="_blank"
          rel="noopener"
        >
          Pedir novas fotos
        </a>

        <a
          class="btn btn-secondary btn-small"
          href="${whatsappLink(
            order.whatsapp,
            `Oi! O mascote do pedido ${order.order_code} está pronto para sua aprovação. Quando puder, me diga se está tudo certo para seguirmos. 💛`,
          )}"
          target="_blank"
          rel="noopener"
        >
          Aprovar mascote
        </a>

        <a
          class="btn btn-secondary btn-small"
          href="${whatsappLink(
            order.whatsapp,
            `Oi! Passando para lembrar que estou aguardando seu retorno sobre o pedido ${order.order_code}. Assim que você me responder, seguimos por aqui. 💛`,
          )}"
          target="_blank"
          rel="noopener"
        >
          Cobrar retorno
        </a>

        <a
          class="btn btn-secondary btn-small"
          href="${whatsappLink(
            order.whatsapp,
            `Oi! Seu convite do pedido ${order.order_code} está pronto. 💛 Vou te enviar para conferência por aqui.`,
          )}"
          target="_blank"
          rel="noopener"
        >
          Avisar que está pronto
        </a>

        <a
          class="btn btn-secondary btn-small"
          href="${whatsappLink(
            order.whatsapp,
            `Oi! Seu convite do pedido ${order.order_code} foi aprovado. Agora falta apenas o saldo final para eu liberar a entrega. 💛`,
          )}"
          target="_blank"
          rel="noopener"
        >
          Cobrar saldo
        </a>

        ${
          partyToday
            ? `
              <a
                class="btn btn-secondary btn-small"
                href="${whatsappLink(
                  order.whatsapp,
                  'Oi! Passando para desejar um dia lindo para vocês e uma comemoração muito especial! 💛 Que seja um momento cheio de carinho e boas lembranças. Um beijo, Libri Convites ✨',
                )}"
                target="_blank"
                rel="noopener"
              >
                🎉 Parabenizar cliente
              </a>
            `
            : ''
        }
      </div>

      <div class="production-gates">
        ${gateHtml({
          ok:
            briefingOk,

          icon:
            '1',

          title:
            'Briefing',

          text:
            briefingOk
              ? 'Completo'
              : 'Pendente',
        })}

        ${gateHtml({
          ok:
            photosOk,

          icon:
            '2',

          title:
            'Fotos',

          text:
            photosOk
              ? 'Aprovadas'

              : order.photos_status
                === 'needs_new'
                ? 'Novas fotos necessárias'

                : 'Aguardando aprovação',
        })}

        ${gateHtml({
          ok:
            entryOk,

          icon:
            '3',

          title:
            'Entrada',

          text:
            entryOk
              ? 'Confirmada'
              : 'Aguardando',
        })}

        ${gateHtml({
          ok:
            termsOk,

          icon:
            '4',

          title:
            'Termos',

          text:
            termsOk
              ? `Aceitos • ${valueOr(order.terms_version)}`
              : 'Pendente',
        })}
      </div>

      <div class="detail-grid">
        <section class="detail-card full">
          <h3>
            Briefing para produção
          </h3>

          <p class="detail-card-subtitle">
            Resumo fiel ao que a cliente informou.
            Sem decisões técnicas inventadas.
          </p>

          <div class="briefing-summary">
            ${esc(summary)}
          </div>

          <div class="briefing-actions">
            <button
              id="copyBriefing"
              class="btn btn-secondary btn-small"
              type="button"
            >
              Copiar resumo do briefing
            </button>

            <button
              id="fullBriefing"
              class="btn btn-secondary btn-small"
              type="button"
            >
              Ver respostas completas
            </button>
          </div>
        </section>

        <section class="detail-card">
          <h3>
            Pedido e valores
          </h3>

          ${detailLine(
            'Tipo',
            esc(
              productLabel({
                experience:
                  order.experience,

                format:
                  order.format,
              }),
            ),
          )}

          ${detailLine(
            'Total',
            money(
              order.total_cents,
            ),
          )}

          ${detailLine(
            'Entrada',
            `${money(order.deposit_cents)} • ${
              order.entry_status === 'confirmed'
                ? 'confirmada'
                : 'aguardando'
            }`,
          )}

          ${detailLine(
            'Saldo',
            `${money(order.balance_cents)} • ${
              order.balance_status === 'confirmed'
                ? 'confirmado'
                : 'aguardando'
            }`,
          )}

          ${detailLine(
            'Urgência',
            order.urgency_enabled
              ? `Sim • +${esc(order.urgency_percent)}%`
              : 'Não',
          )}

          <label class="checkline">
            <input
              id="urgencyToggle"
              type="checkbox"
              ${
                order.urgency_enabled
                  ? 'checked'
                  : ''
              }
            >

            <span>
              Urgência aprovada pela Libri
            </span>
          </label>
        </section>

        <section class="detail-card">
          <h3>
            Status geral
          </h3>

          <p class="detail-card-subtitle">
            Use somente quando precisar corrigir o fluxo manualmente.
          </p>

          <div class="manual-status">
            ${selectHtml(
              'manualStatus',
              order.status,
              [
                [
                  'new',
                  'Novo pedido',
                ],

                [
                  'ready',
                  'Pronto para produção',
                ],

                [
                  'producing',
                  'Em produção',
                ],

                [
                  'waiting_client',
                  'Aguardando cliente',
                ],

                [
                  'revisions',
                  'Ajustes',
                ],

                [
                  'waiting_balance',
                  'Aguardando saldo',
                ],

                [
                  'finished',
                  'Finalizado',
                ],

                [
                  'cancelled',
                  'Cancelado',
                ],
              ],
            )}

            <button
              id="saveManualStatus"
              class="btn btn-secondary btn-small"
              type="button"
            >
              Salvar
            </button>
          </div>
        </section>

        <section class="detail-card">
          <h3>
            Fotos e pagamento
          </h3>

          <div class="status-row">
            <span>
              Fotos
            </span>

            ${selectHtml(
              'photosStatus',
              order.photos_status,
              [
                [
                  'waiting',
                  'Aguardando',
                ],

                [
                  'received',
                  'Recebidas',
                ],

                [
                  'approved',
                  'Fotos aprovadas',
                ],

                [
                  'needs_new',
                  'Precisa de novas fotos',
                ],
              ],
            )}
          </div>

          <div class="field">
            <label for="photosNote">
              Motivo / observação
            </label>

            <input
              id="photosNote"
              value="${esc(order.photos_note || '')}"
              placeholder="Ex.: precisa de foto de frente"
            >
          </div>

          <div
            class="status-row"
            style="margin-top:10px"
          >
            <span>
              Entrada
            </span>

            ${selectHtml(
              'entryStatus',
              order.entry_status,
              [
                [
                  'waiting',
                  'Aguardando',
                ],

                [
                  'confirmed',
                  'Confirmada',
                ],
              ],
            )}
          </div>

          <div class="status-row">
            <span>
              Saldo
            </span>

            ${selectHtml(
              'balanceStatus',
              order.balance_status,
              [
                [
                  'waiting',
                  'Aguardando',
                ],

                [
                  'confirmed',
                  'Confirmado',
                ],
              ],
            )}
          </div>

          <button
            id="saveFinancialStatuses"
            class="btn btn-primary btn-small"
            type="button"
          >
            Salvar status
          </button>
        </section>

        <section class="detail-card">
          <h3>
            Produção
          </h3>

          <div class="stage">
            <div class="stage-head">
              <strong>
                Mascote
              </strong>

              <span class="revision-counter">
                Ajustes ${Number(order.mascot_revisions || 0)}/2
              </span>
            </div>

            <div class="status-row">
              <span>
                Status
              </span>

              ${selectHtml(
                'mascotStatus',
                order.mascot_status,
                [
                  [
                    'waiting',
                    'Aguardando',
                  ],

                  [
                    'sent',
                    'Enviado',
                  ],

                  [
                    'approved',
                    'Aprovado',
                  ],
                ],
              )}
            </div>

            <div class="stage-actions">
              <button
                class="btn btn-secondary btn-small"
                type="button"
                data-revision="mascot"
                ${
                  Number(
                    order.mascot_revisions
                    || 0,
                  ) >= 2
                    ? 'disabled'
                    : ''
                }
              >
                Registrar ajuste
              </button>

              <button
                class="btn btn-success btn-small"
                type="button"
                data-approve="mascot"
                ${
                  order.mascot_status
                  === 'approved'
                    ? 'disabled'
                    : ''
                }
              >
                Aprovar mascote
              </button>
            </div>
          </div>

          <div class="stage">
            <div class="stage-head">
              <strong>
                Falas
              </strong>

              <span class="revision-counter">
                Ajustes ${Number(order.speech_revisions || 0)}/1
              </span>
            </div>

            <div class="status-row">
              <span>
                Status
              </span>

              ${selectHtml(
                'speechStatus',
                order.speech_status,
                [
                  [
                    'not_required',
                    'Sem aprovação',
                  ],

                  [
                    'waiting',
                    'Aguardando',
                  ],

                  [
                    'sent',
                    'Enviadas',
                  ],

                  [
                    'approved',
                    'Aprovadas',
                  ],
                ],
              )}
            </div>

            <div class="stage-actions">
              <button
                class="btn btn-secondary btn-small"
                type="button"
                data-revision="speech"
                ${
                  order.speech_status
                  === 'not_required'
                  || Number(
                    order.speech_revisions
                    || 0,
                  ) >= 1
                    ? 'disabled'
                    : ''
                }
              >
                Registrar ajuste
              </button>

              <button
                class="btn btn-success btn-small"
                type="button"
                data-approve="speech"
                ${
                  order.speech_status
                  === 'not_required'
                  || order.speech_status
                  === 'approved'
                    ? 'disabled'
                    : ''
                }
              >
                Aprovar falas
              </button>
            </div>
          </div>

          <div class="stage">
            <div class="stage-head">
              <strong>
                Convite
              </strong>

              <span class="revision-counter">
                Ajustes ${Number(order.invitation_revisions || 0)}/2
              </span>
            </div>

            <div class="status-row">
              <span>
                Status
              </span>

              ${selectHtml(
                'invitationStatus',
                order.invitation_status,
                [
                  [
                    'waiting',
                    'Aguardando',
                  ],

                  [
                    'producing',
                    'Em produção',
                  ],

                  [
                    'sent',
                    'Enviado',
                  ],

                  [
                    'approved',
                    'Aprovado',
                  ],
                ],
              )}
            </div>

            <div class="stage-actions">
              <button
                class="btn btn-secondary btn-small"
                type="button"
                data-revision="invitation"
                ${
                  Number(
                    order.invitation_revisions
                    || 0,
                  ) >= 2
                    ? 'disabled'
                    : ''
                }
              >
                Registrar ajuste
              </button>

              <button
                class="btn btn-success btn-small"
                type="button"
                data-approve="invitation"
                ${
                  order.invitation_status
                  === 'approved'
                    ? 'disabled'
                    : ''
                }
              >
                Aprovar convite
              </button>
            </div>
          </div>

          <button
            id="saveProductionStatuses"
            class="btn btn-secondary btn-small"
            type="button"
            style="margin-top:10px"
          >
            Salvar status das etapas
          </button>
        </section>

        <section class="detail-card">
          <h3>
            Prazo
          </h3>

          <div class="deadline-box">
            <div class="deadline-main">
              <span>
                Previsão atual
              </span>

              <strong>
                ${formatDateTime(
                  order.deadline_override_at
                  || order.production_deadline_at,
                )}
              </strong>
            </div>

            <div class="statline">
              <span>
                Início
              </span>

              <strong>
                ${formatDateTime(
                  order.production_started_at,
                )}
              </strong>
            </div>

            <div class="statline">
              <span>
                Pausado em
              </span>

              <strong>
                ${formatDateTime(
                  order.production_paused_at,
                )}
              </strong>
            </div>

            <div class="deadline-actions">
              <button
                id="startProduction"
                class="btn btn-primary btn-small"
                type="button"
                ${
                  order.production_started_at
                  || !canStart
                    ? 'disabled'
                    : ''
                }
              >
                Iniciar produção
              </button>

              <button
                id="pauseProduction"
                class="btn btn-secondary btn-small"
                type="button"
                ${
                  !order.production_started_at
                  || order.production_paused_at
                    ? 'disabled'
                    : ''
                }
              >
                Pausar
              </button>

              <button
                id="resumeProduction"
                class="btn btn-secondary btn-small"
                type="button"
                ${
                  !order.production_paused_at
                    ? 'disabled'
                    : ''
                }
              >
                Retomar
              </button>
            </div>
          </div>

          ${
            !canStart
            && !order.production_started_at
              ? `
                <div
                  class="order-next-action"
                  style="margin-top:10px"
                >
                  <strong>
                    Aguardando liberação:
                  </strong>

                  a produção só começa quando briefing,
                  fotos, entrada e termos estiverem liberados.
                </div>
              `
              : ''
          }

          <button
            id="finishOrder"
            class="btn btn-success btn-small btn-full"
            type="button"
            style="margin-top:10px"
            ${
              order.status === 'finished'
                ? 'disabled'
                : ''
            }
          >
            Finalizar pedido
          </button>
        </section>

        <section class="detail-card">
          <h3>
            Recursos contratados
          </h3>

          ${detailLine(
            'Confirmação Libri',
            addons.confirmation
              ? 'Sim'
              : 'Não',
          )}

          ${detailLine(
            'Filtro',
            addons.filter
              ? 'Sim'
              : 'Não',
          )}

          ${detailLine(
            'Cena extra',
            esc(
              addons.extraScene
              || 0,
            ),
          )}

          ${detailLine(
            'Pessoa extra',
            esc(
              addons.extraPerson
              || 0,
            ),
          )}

          ${
            addons.confirmation
              ? detailLine(
                  'Modo da confirmação',
                  esc(
                    confirmationModeLabel(
                      b.confirmationMode,
                    ),
                  ),
                )
              : ''
          }
        </section>

        <section class="detail-card">
          <h3>
            Termos e divulgação
          </h3>

          ${detailLine(
            'Versão aceita',
            esc(
              valueOr(
                order.terms_version,
              ),
            ),
          )}

          ${detailLine(
            'Aceite',
            formatDateTime(
              order.terms_accepted_at,
            ),
          )}

          ${detailLine(
            'Divulgação',
            order.portfolio_consent
              ? 'Autorizada'
              : 'Não autorizada',
          )}
        </section>

        <section class="detail-card full">
          <h3>
            Observações da Libri
          </h3>

          <div class="note-form">
            <textarea
              id="newNote"
              placeholder="Escreva uma observação interna..."
            ></textarea>

            <div>
              <button
                id="addNote"
                class="btn btn-secondary btn-small"
                type="button"
              >
                Adicionar observação
              </button>
            </div>
          </div>

          <div
            class="history"
            style="margin-top:11px"
          >
            ${
              (order.notes || []).length
                ? order.notes
                    .map(
                      (note) => `
                        <div class="history-item">
                          ${esc(note.note)}

                          <time>
                            ${formatDateTime(
                              note.created_at,
                            )}
                          </time>
                        </div>
                      `,
                    )
                    .join('')

                : `
                  <span class="muted small">
                    Nenhuma observação interna.
                  </span>
                `
            }
          </div>
        </section>

        <section class="detail-card full">
          <h3>
            Histórico
          </h3>

          <div class="history">
            ${
              (order.history || []).length
                ? order.history
                    .map(
                      (item) => `
                        <div class="history-item">
                          ${esc(
                            item.description,
                          )}

                          <time>
                            ${formatDateTime(
                              item.created_at,
                            )}
                          </time>
                        </div>
                      `,
                    )
                    .join('')

                : `
                  <span class="muted small">
                    Sem histórico.
                  </span>
                `
            }
          </div>
        </section>
      </div>
    `;

  bindDetailEvents(
    summary,
  );
}

/* ==================================================
   EVENTOS DO DETALHE
================================================== */

function bindDetailEvents(summary) {
  const order =
    state.current;

  $('#copyBriefing')
    .addEventListener(
      'click',
      async () => {
        try {
          await copyText(
            summary,
          );

          toast(
            'Resumo do briefing copiado.',
          );
        } catch {
          toast(
            'Não foi possível copiar.',
            'error',
          );
        }
      },
    );

  $('#fullBriefing')
    .addEventListener(
      'click',
      () => {
        openInfoModal(
          'Respostas completas',
          fullBriefingHtml(
            order,
          ),
        );
      },
    );

  $('#urgencyToggle')
    .addEventListener(
      'change',
      async (event) => {
        await patchCurrent({
          urgency_enabled:
            event.target.checked,
        });
      },
    );

  $('#saveManualStatus')
    .addEventListener(
      'click',
      async () => {
        await patchCurrent({
          status:
            $('#manualStatus')
              .value,
        });
      },
    );

  $('#saveFinancialStatuses')
    .addEventListener(
      'click',
      async () => {
        await patchCurrent({
          photos_status:
            $('#photosStatus')
              .value,

          photos_note:
            $('#photosNote')
              .value,

          entry_status:
            $('#entryStatus')
              .value,

          balance_status:
            $('#balanceStatus')
              .value,
        });
      },
    );

  $('#saveProductionStatuses')
    .addEventListener(
      'click',
      async () => {
        await patchCurrent({
          mascot_status:
            $('#mascotStatus')
              .value,

          speech_status:
            $('#speechStatus')
              .value,

          invitation_status:
            $('#invitationStatus')
              .value,
        });
      },
    );

  $$(
    '[data-revision]',
    $('#detailBody'),
  ).forEach(
    (button) => {
      button.addEventListener(
        'click',
        async () => {
          await actionCurrent(
            'revision',
            {
              stage:
                button.dataset
                  .revision,
            },
          );
        },
      );
    },
  );

  $$(
    '[data-approve]',
    $('#detailBody'),
  ).forEach(
    (button) => {
      button.addEventListener(
        'click',
        async () => {
          await actionCurrent(
            'approve',
            {
              stage:
                button.dataset
                  .approve,
            },
          );
        },
      );
    },
  );

  $('#startProduction')
    .addEventListener(
      'click',
      async () => {
        await actionCurrent(
          'start-production',
          {},
        );
      },
    );

  $('#pauseProduction')
    .addEventListener(
      'click',
      async () => {
        await actionCurrent(
          'pause',
          {
            reason:
              'Aguardando cliente',
          },
        );
      },
    );

  $('#resumeProduction')
    .addEventListener(
      'click',
      async () => {
        await actionCurrent(
          'resume',
          {},
        );
      },
    );

  $('#finishOrder')
    .addEventListener(
      'click',
      async () => {
        await actionCurrent(
          'finish',
          {},
        );
      },
    );

  $('#addNote')
    .addEventListener(
      'click',
      async () => {
        const note =
          $('#newNote')
            .value
            .trim();

        if (!note) {
          toast(
            'Escreva a observação antes de salvar.',
            'error',
          );

          return;
        }

        try {
          await api(
            `/api/admin/orders/${order.id}/notes`,
            {
              method:
                'POST',

              body:
                JSON.stringify({
                  note,
                }),
            },
          );

          await reopenCurrent();
          await loadOrders();

          toast(
            'Observação adicionada.',
          );
        } catch (error) {
          toast(
            error.message,
            'error',
          );
        }
      },
    );
}

/* ==================================================
   ALTERAÇÕES DO PEDIDO
================================================== */

async function patchCurrent(
  payload,
) {
  try {
    const data =
      await api(
        `/api/admin/orders/${state.current.id}`,
        {
          method:
            'PATCH',

          body:
            JSON.stringify(
              payload,
            ),
        },
      );

    state.current =
      data.order;

    renderDetail();

    await loadOrders();

    toast(
      'Pedido atualizado.',
    );
  } catch (error) {
    toast(
      error.message,
      'error',
    );
  }
}

async function actionCurrent(
  action,
  payload = {},
) {
  try {
    await api(
      `/api/admin/orders/${state.current.id}/${action}`,
      {
        method:
          'POST',

        body:
          JSON.stringify(
            payload,
          ),
      },
    );

    await reopenCurrent();

    await loadOrders();

    toast(
      'Ação registrada.',
    );
  } catch (error) {
    const blockers =
      error
        .data
        ?.details
        ?.blockers
      || [];

    if (blockers.length) {
      openInfoModal(
        'Ainda não é possível seguir',
        `
          <div class="answer-group">
            <h4>
              Antes de iniciar:
            </h4>

            <div class="answer-list">
              ${
                blockers
                  .map(
                    (item) => `
                      <div class="answer-item">
                        <span class="answer-value">
                          • ${esc(item)}
                        </span>
                      </div>
                    `,
                  )
                  .join('')
              }
            </div>
          </div>
        `,
      );

      return;
    }

    openInfoModal(
      'Ação não concluída',
      `<p>${esc(error.message)}</p>`,
    );
  }
}

/* ==================================================
   CONFIGURAÇÕES
================================================== */

function reaisFromCents(value) {
  return (
    (Number(value) || 0)
    / 100
  )
    .toFixed(2)
    .replace('.', ',');
}

function centsFromReais(value) {
  const raw =
    String(value || '')
      .trim();

  if (!raw) {
    return 0;
  }

  const normalized =
    raw.includes(',')
      ? raw
          .replace(/\./g, '')
          .replace(',', '.')
      : raw;

  return Math.round(
    (Number(normalized) || 0)
    * 100,
  );
}

function settingField(
  label,
  key,
  value,
  type = 'text',
  hint = '',
) {
  return `
    <div class="field">
      <label>
        ${label}
      </label>

      <input
        data-setting="${key}"
        type="${type}"
        value="${esc(value)}"
      >

      ${
        hint
          ? `
            <span class="hint">
              ${hint}
            </span>
          `
          : ''
      }
    </div>
  `;
}

async function loadSettings() {
  try {
    const data =
      await api(
        '/api/admin/settings',
      );

    state.settings =
      data.settings;

    renderSettings();
  } catch (error) {
    $('#settingsForm')
      .innerHTML = `
        <div class="empty-state">
          Não foi possível carregar as configurações.

          <br>

          ${esc(error.message)}
        </div>
      `;
  }
}

function renderSettings() {
  const settings =
    state.settings || {};

  $('#settingsForm')
    .innerHTML = `
      <section class="settings-section">
        <h3>
          Produtos
        </h3>

        <div class="settings-grid">
          ${settingField(
            'Vídeo Completo',
            'price_video_full_cents',
            reaisFromCents(
              settings.price_video_full_cents,
            ),
          )}

          ${settingField(
            'Vídeo Reduzido',
            'price_video_reduced_cents',
            reaisFromCents(
              settings.price_video_reduced_cents,
            ),
          )}

          ${settingField(
            'Interativo Completo',
            'price_interactive_full_cents',
            reaisFromCents(
              settings.price_interactive_full_cents,
            ),
          )}

          ${settingField(
            'Interativo Reduzido',
            'price_interactive_reduced_cents',
            reaisFromCents(
              settings.price_interactive_reduced_cents,
            ),
          )}
        </div>
      </section>

      <section class="settings-section">
        <h3>
          Adicionais
        </h3>

        <div class="settings-grid">
          ${settingField(
            'Confirmação Libri',
            'addon_confirmation_cents',
            reaisFromCents(
              settings.addon_confirmation_cents,
            ),
          )}

          ${settingField(
            'Filtro personalizado',
            'addon_filter_cents',
            reaisFromCents(
              settings.addon_filter_cents,
            ),
          )}

          ${settingField(
            'Cena extra',
            'addon_extra_scene_cents',
            reaisFromCents(
              settings.addon_extra_scene_cents,
            ),
          )}

          ${settingField(
            'Pessoa extra',
            'addon_extra_person_cents',
            reaisFromCents(
              settings.addon_extra_person_cents,
            ),
          )}
        </div>
      </section>

      <section class="settings-section">
        <h3>
          Regras
        </h3>

        <div class="settings-grid">
          ${settingField(
            'Entrada (%)',
            'deposit_percent',
            settings.deposit_percent,
            'number',
          )}

          ${settingField(
            'Urgência (%)',
            'urgency_percent',
            settings.urgency_percent,
            'number',
          )}

          ${settingField(
            'Prazo padrão (dias úteis)',
            'deadline_business_days',
            settings.deadline_business_days,
            'number',
          )}
        </div>
      </section>

      <section class="settings-section">
        <h3>
          Pagamento e contato
        </h3>

        <div class="settings-grid">
          ${settingField(
            'Chave Pix',
            'pix_key',
            settings.pix_key
            || '',
          )}

          ${settingField(
            'Nome do recebedor',
            'pix_recipient_name',
            settings.pix_recipient_name
            || '',
          )}

          ${settingField(
            'WhatsApp da Libri',
            'libri_whatsapp',
            settings.libri_whatsapp
            || '',
            'text',
            'Use DDI + DDD + número. Ex.: 5561999999999',
          )}
        </div>
      </section>

      <section class="settings-section">
        <h3>
          Exemplos
        </h3>

        <div class="settings-grid">
          ${settingField(
            'Interativo Completo',
            'example_interactive_full_url',
            settings.example_interactive_full_url
            || '',
          )}

          ${settingField(
            'Interativo Reduzido',
            'example_interactive_reduced_url',
            settings.example_interactive_reduced_url
            || '',
          )}

          ${settingField(
            'Vídeo Completo',
            'example_video_full_url',
            settings.example_video_full_url
            || '',
          )}

          ${settingField(
            'Vídeo Reduzido',
            'example_video_reduced_url',
            settings.example_video_reduced_url
            || '',
          )}

          ${settingField(
            'Exemplo da confirmação',
            'example_confirmation_url',
            settings.example_confirmation_url
            || '',
          )}

          ${settingField(
            'Exemplo do filtro',
            'example_filter_url',
            settings.example_filter_url
            || '',
          )}
        </div>
      </section>

      <div class="form-actions">
        <button
          class="btn btn-primary"
          type="submit"
        >
          Salvar configurações
        </button>
      </div>
    `;
}

$('#settingsForm')
  .addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      const settings = {};

      $$(
        '[data-setting]',
        event.currentTarget,
      ).forEach(
        (input) => {
          const key =
            input.dataset.setting;

          settings[key] =
            key.endsWith(
              '_cents',
            )
              ? centsFromReais(
                  input.value,
                )
              : input.value;
        },
      );

      try {
        const data =
          await api(
            '/api/admin/settings',
            {
              method:
                'PUT',

              body:
                JSON.stringify({
                  settings,
                }),
            },
          );

        state.settings =
          data.settings;

        renderSettings();

        toast(
          'Configurações salvas.',
        );
      } catch (error) {
        toast(
          error.message,
          'error',
        );
      }
    },
  );

/* ==================================================
   TERMOS
================================================== */

async function loadTerms() {
  try {
    const data =
      await api(
        '/api/admin/terms',
      );

    state.terms =
      data.terms || [];

    renderTerms();
  } catch (error) {
    $('#termsList')
      .innerHTML = `
        <div class="empty-state">
          Não foi possível carregar os termos.

          <br>

          ${esc(error.message)}
        </div>
      `;
  }
}

function renderTerms() {
  if (!state.terms?.length) {
    $('#termsList')
      .innerHTML = `
        <div class="empty-state">
          Nenhuma versão encontrada.
        </div>
      `;

    return;
  }

  $('#termsList')
    .innerHTML =
      state.terms
        .map(
          (term) => `
            <article
              class="term-version ${
                Number(term.active)
                === 1
                  ? 'active'
                  : ''
              }"
            >
              <div class="term-version-head">
                <div>
                  <strong>
                    Versão ${esc(term.version)}
                  </strong>

                  ${
                    Number(term.active)
                    === 1
                      ? `
                        <span
                          class="badge green"
                          style="margin-left:5px"
                        >
                          Ativa
                        </span>
                      `
                      : ''
                  }
                </div>

                <time>
                  ${formatDateTime(
                    term.created_at,
                  )}
                </time>
              </div>

              <div class="term-preview">
                ${esc(
                  term.body
                  || '',
                )}
              </div>

              <button
                class="btn btn-secondary btn-small"
                type="button"
                data-view-term="${esc(term.version)}"
                style="margin-top:9px"
              >
                Ver texto completo
              </button>
            </article>
          `,
        )
        .join('');

  $$(
    '[data-view-term]',
  ).forEach(
    (button) => {
      button.addEventListener(
        'click',
        () => {
          const term =
            state.terms.find(
              (item) =>
                item.version
                === button.dataset
                  .viewTerm,
            );

          if (!term) {
            return;
          }

          openInfoModal(
            `Termos • versão ${term.version}`,
            `
              <div class="prewrap">
                ${esc(
                  term.body
                  || '',
                )}
              </div>
            `,
          );
        },
      );
    },
  );
}

$('#termsForm')
  .addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      const version =
        $('#termsVersion')
          .value
          .trim();

      const body =
        $('#termsBody')
          .value
          .trim();

      if (
        !version
        || !body
      ) {
        toast(
          'Informe a versão e o texto completo.',
          'error',
        );

        return;
      }

      const button =
        $('#publishTerms');

      button.disabled =
        true;

      button.textContent =
        'Publicando...';

      try {
        await api(
          '/api/admin/terms',
          {
            method:
              'POST',

            body:
              JSON.stringify({
                version,
                body,
              }),
          },
        );

        $('#termsVersion')
          .value = '';

        $('#termsBody')
          .value = '';

        await loadTerms();

        toast(
          'Nova versão dos termos publicada.',
        );
      } catch (error) {
        toast(
          error.message,
          'error',
        );
      } finally {
        button.disabled =
          false;

        button.textContent =
          'Publicar nova versão';
      }
    },
  );

$('#refreshTerms')
  .addEventListener(
    'click',
    loadTerms,
  );

/* ==================================================
   ABAS
================================================== */

async function activateTab(tab) {
  $('#ordersTab')
    .classList
    .toggle(
      'hidden',
      tab !== 'orders',
    );

  $('#settingsTab')
    .classList
    .toggle(
      'hidden',
      tab !== 'settings',
    );

  $('#termsTab')
    .classList
    .toggle(
      'hidden',
      tab !== 'terms',
    );

  $$(
    '[data-tab]',
  ).forEach(
    (button) => {
      button
        .classList
        .toggle(
          'active',
          button.dataset.tab
          === tab,
        );
    },
  );

  if (
    tab === 'settings'
    && !state.settings
  ) {
    await loadSettings();
  }

  if (
    tab === 'terms'
    && !state.terms
  ) {
    await loadTerms();
  }
}

$$(
  '[data-tab]',
).forEach(
  (button) => {
    button.addEventListener(
      'click',
      () => {
        activateTab(
          button.dataset.tab,
        );
      },
    );
  },
);

/* ==================================================
   FILTROS
================================================== */

$('#refreshOrders')
  .addEventListener(
    'click',
    loadOrders,
  );

$('#statusFilter')
  .addEventListener(
    'change',
    loadOrders,
  );

$('#search')
  .addEventListener(
    'input',
    () => {
      clearTimeout(
        searchTimer,
      );

      searchTimer =
        setTimeout(
          loadOrders,
          280,
        );
    },
  );

/* ==================================================
   START
================================================== */

loadOrders();
