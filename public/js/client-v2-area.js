import {
  api,
  app,
  dateBr,
  esc,
  loading,
  modal,
  money,
  randomId,
  setHelp,
  setSubtitle,
  showToast,
} from './client-v2-core.js';

import { uploadCustomerPhoto, planCustomerPhotoBatch } from './client-v2-upload.js?v=20261009-mobile-briefing-3';
import { captureFieldViewport, restoreFieldViewport } from './client-v2-viewport.js';

const HELPFUL_EXAMPLES = {
  theme_or_style: 'Exemplo: Jardim Encantado, cores lavanda e verde, estilo delicado.',
  venue_address: 'Escreva o nome do local, rua e bairro. O endereço completo não aparece no card final.',
  location_url: 'Abra o Google Maps, toque em Compartilhar e cole o link do local.',
  music_request: 'Exemplo: nome da música + artista, ou um link de referência.',
  exact_text: 'Use este campo apenas para frases que devem aparecer exatamente como foram escritas.',
  references_note: 'Conte o que gostou nas imagens: cores, iluminação, cenário ou roupa.',
};

export function inputHtml(
  definition,
  value,
) {
  const common =
    `data-field="${esc(definition.key)}"`;

  const label =
    `<label for="field-${esc(definition.key)}">${esc(definition.label)}${definition.required ? ' *' : ''}</label>`;

  const helpful = definition.help || HELPFUL_EXAMPLES[definition.key] || '';
  const help = helpful ? `<small class="field-help">${esc(helpful)}</small>` : '';

  if (
    definition.type
    === 'textarea'
  ) {
    return `
      <div class="field full">
        ${label}
        <textarea
          id="field-${esc(definition.key)}"
          class="textarea"
          ${common}
          ${definition.required ? 'required' : ''}
        >${esc(value || '')}</textarea>
        ${help}
      </div>
    `;
  }

  if (
    definition.type
    === 'choice'
  ) {
    // Use the original public images for children's style selection.
    const childStyle = definition.key === 'visual_style'
      && (definition.options || []).some(option => option.value === 'stylized_doll');
    const styleExamples = childStyle ? {
      stylized_doll: {
        image: '/images/exemplos/mascote-bonequinho.webp',
        alt: 'Exemplo de personagem infantil com estilo bonequinho',
        detail: 'Traços infantis mais desenhados e delicados.',
      },
      realistic_detailed: {
        image: '/images/exemplos/mascote-realista.webp',
        alt: 'Exemplo de personagem infantil mais realista e detalhado',
        detail: 'Traços e detalhes mais próximos de uma pessoa real.',
      },
    } : {};

    return `
      <div class="field full">
        <span class="field-label">
          ${esc(definition.label)}
          ${definition.required ? ' *' : ''}
        </span>

        <div class="grid two ${childStyle ? 'choice-grid-references' : ''}">
          ${(definition.options || []).map(
            (option) => `
              <label class="choice-card ${
                value === option.value
                  ? 'selected'
                  : ''
              } ${styleExamples[option.value] ? 'choice-card-reference' : ''} ${childStyle && option.value === 'libri_decides' ? 'choice-card-reference-other' : ''}">
                <input
                  type="radio"
                  name="field-${esc(definition.key)}"
                  value="${esc(option.value)}"
                  data-field="${esc(definition.key)}"
                  ${
                    value === option.value
                      ? 'checked'
                      : ''
                  }
                >

                <span class="choice-main">
                  ${styleExamples[option.value] ? `
                    <img class="choice-reference-image"
                      src="${styleExamples[option.value].image}"
                      alt="${esc(styleExamples[option.value].alt)}"
                      loading="lazy" decoding="async" width="320" height="400">
                  ` : ''}
                  <strong>${esc(option.label)}</strong>
                  ${styleExamples[option.value] ? `<small>${esc(styleExamples[option.value].detail)}</small>` : ''}
                </span>
              </label>
            `,
          ).join('')}
        </div>

        ${help}
      </div>
    `;
  }

  if (
    definition.type
    === 'multi_choice'
  ) {
    const selected =
      new Set(
        Array.isArray(value)
          ? value
          : [],
      );

    return `
      <div class="field full">
        <span class="field-label">
          ${esc(definition.label)}
          ${definition.required ? ' *' : ''}
        </span>

        <div class="grid two">
          ${(definition.options || []).map(
            (option) => `
              <label class="choice-card ${
                selected.has(option.value)
                  ? 'selected'
                  : ''
              }">
                <input
                  type="checkbox"
                  name="field-${esc(definition.key)}"
                  value="${esc(option.value)}"
                  data-field="${esc(definition.key)}"
                  data-multi="1"
                  ${
                    selected.has(option.value)
                      ? 'checked'
                      : ''
                  }
                >

                <span class="choice-main">
                  <strong>${esc(option.label)}</strong>
                </span>
              </label>
            `,
          ).join('')}
        </div>

        ${help}
      </div>
    `;
  }

  return `
    <div class="field ${
      definition.type === 'text'
      || definition.type === 'number'
      || definition.type === 'time'
      || definition.type === 'url'
        ? ''
        : 'full'
    }">
      ${label}

      <input
        id="field-${esc(definition.key)}"
        class="input"
        type="${
          definition.type
          === 'url'
            ? 'url'
            : definition.type
        }"
        value="${esc(value ?? '')}"
        ${common}
        ${
          definition.min !== null
            ? `min="${esc(definition.min)}"`
            : ''
        }
        ${
          definition.max !== null
            ? `max="${esc(definition.max)}"`
            : ''
        }
        ${definition.required ? 'required' : ''}
      >

      ${help}
    </div>
  `;
}

function uploadsForRule(
  area,
  rule,
) {
  return area.briefing.uploads
    .filter(
      (upload) =>
        upload.fieldKey
        === rule.fieldKey,
    );
}

function uploadRuleHtml(
  area,
  rule,
) {
  const uploads =
    uploadsForRule(
      area,
      rule,
    );

  return `
    <div class="upload-zone">
      <strong>${esc(rule.label)}</strong>
      <p class="help">${esc(rule.help || '')}</p>

      <div>
        <label class="btn btn-secondary">
          Selecionar fotos
          <input
            class="hidden"
            type="file"
            multiple
            accept="${esc(rule.accept.join(','))}"
            data-upload-field="${esc(rule.fieldKey)}"
            ${
              uploads.length >= rule.max
                ? 'disabled'
                : ''
            }
          >
        </label>

        <span class="help" style="margin-left:8px">
          ${uploads.length} de ${rule.max} fotos • ${Math.max(0, rule.max - uploads.length)} disponíveis
        </span>
      </div>
      <div class="photo-upload-progress hidden" data-upload-progress="${esc(rule.fieldKey)}"
        role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="photo-upload-progress-track"><span style="width:0%"></span></div>
        <small>Enviando 0%...</small>
      </div>

      <div class="upload-list">
        ${uploads.map(
          (upload) => `
            <article class="upload-card">
              <img
                class="upload-thumb"
                alt=""
                src="${esc(upload.contentPath)}"
              >

              <div class="upload-copy">
                <strong>${esc(upload.originalFilename)}</strong>
                <small>${esc(upload.note || '')}</small>
              </div>

              ${
                rule.notesPerFile
                  ? `
                    <div class="field full" style="grid-column:1/-1">
                      <label for="upload-note-${upload.id}">
                        Observação desta referência
                      </label>
                      <textarea
                        id="upload-note-${upload.id}"
                        class="textarea"
                        data-upload-note="${upload.id}"
                        placeholder="O que você gostou ou quer aproveitar como direção?"
                      >${esc(upload.note || '')}</textarea>
                    </div>
                  `
                  : ''
              }

              <button
                class="btn btn-danger"
                type="button"
                data-delete-upload="${upload.id}"
              >
                Remover
              </button>
            </article>
          `,
        ).join('')}
      </div>
    </div>
  `;
}

function nextStepCard(
  area,
) {
  const status =
    area.order.status;

  let title =
    area.order.nextAction
    || 'Acompanhe seu pedido';

  let body =
    'Seu pedido está seguindo normalmente.';

  let tab = '';
  let buttonLabel = '';

  if (
    [
      'awaiting_payment',
      'urgency_approved',
    ].includes(
      status,
    )
  ) {
    title =
      'Concluir o pagamento';
    body =
      'O próximo passo é confirmar o pagamento para liberar o andamento do pedido.';
    tab =
      'summary';
    buttonLabel =
      'Ver pagamento';
  } else if (
    status
    === 'briefing_pending'
    && !area.briefing.completed
  ) {
    title =
      'Preencher os dados do convite';
    body =
      'Conte os detalhes da festa e envie as fotos. A produção começa quando os dados estiverem completos.';
    tab =
      'briefing';
    buttonLabel =
      'Preencher dados';
  } else if (
    status
    === 'waiting_customer'
    || status
      === 'adjustments'
  ) {
    if (
      area.modules.previews
        .available
    ) {
      title =
        status
        === 'adjustments'
          ? 'Revisar os ajustes'
          : 'Revisar sua prévia';
      body =
        'Sua prévia está disponível. Confira com atenção antes de aprovar ou pedir um ajuste pontual.';
      tab =
        'preview';
      buttonLabel =
        'Abrir prévia';
    }
  } else if (
    status
    === 'balance_pending'
  ) {
    title =
      'Quitar o saldo';
    body =
      'O convite já avançou para a etapa final. Confira abaixo os dados do saldo pendente.';
    tab =
      'summary';
    buttonLabel =
      'Ver saldo';
  } else if (
    status
    === 'ready_for_delivery'
  ) {
    title =
      'Entrega pronta';
    body =
      'Seu pedido está pronto para a etapa de entrega. A Libri fará a liberação final.';
  } else if (
    status
    === 'finalized'
  ) {
    title =
      'Pedido finalizado';
    body =
      'Tudo concluído por aqui. Você ainda pode consultar os detalhes do pedido nesta área.';
  } else if (
    status
    === 'in_production'
    || status
      === 'ready_for_production'
  ) {
    title =
      'Produção em andamento';
    body =
      'Neste momento, você não precisa enviar nada. A Libri está cuidando da produção do seu convite.';
  } else if (
    area.modules.contracts
      .available
  ) {
    title =
      'Conferir contrato';
    body =
      'Há um contrato disponível nesta etapa do pedido.';
    tab =
      'contract';
    buttonLabel =
      'Abrir contrato';
  }

  return `
    <section class="next-step-card">
      <span class="eyebrow">Seu próximo passo</span>
      <h2>${esc(title)}</h2>
      <p>${esc(body)}</p>

      ${
        tab
        && buttonLabel
          ? `
            <button
              class="btn btn-primary"
              type="button"
              data-next-tab="${esc(tab)}"
            >
              ${esc(buttonLabel)}
            </button>
          `
          : ''
      }
    </section>
  `;
}

function statusSidebar(
  area,
) {
  return `
    <aside class="customer-sidebar">
      <section class="status-card">
        <span class="eyebrow">${esc(area.order.code)}</span>
        <h2>${esc(area.order.honoreeName)}</h2>

        <span class="tag">
          ${esc(area.order.statusLabel)}
        </span>

        <div class="status-list">
          <div class="status-line">
            <span>Evento</span>
            <strong>${esc(area.order.eventDateLabel)}</strong>
          </div>

          <div class="status-line">
            <span>Convite</span>
            <strong>${esc(area.product.name)}</strong>
          </div>

          <div class="status-line">
            <span>Total</span>
            <strong>${esc(area.payment.totalLabel)}</strong>
          </div>

          <div class="status-line">
            <span>Próximo passo</span>
            <strong>${esc(area.order.nextAction || '')}</strong>
          </div>
        </div>
      </section>
    </aside>
  `;
}

function tabButtons(
  area,
  active,
) {
  const tabs = [
    {
      id:
        'summary',
      label:
        'Resumo',
      visible:
        true,
    },
    {
      id:
        'briefing',
      label:
        'Preencher dados',
      visible:
        true,
    },
    {
      id:
        'preview',
      label:
        'Prévia',
      visible:
        area.modules.previews.available,
    },
    {
      id:
        'contract',
      label:
        'Contrato',
      visible:
        area.modules.contracts.available,
    },
  ];

  return `
    <nav class="customer-tabs">
      ${tabs
        .filter(
          (tab) =>
            tab.visible,
        )
        .map(
          (tab) => `
            <button
              class="customer-tab ${
                active === tab.id
                  ? 'active'
                  : ''
              }"
              type="button"
              data-tab="${tab.id}"
            >
              ${esc(tab.label)}
            </button>
          `,
        )
        .join('')}
    </nav>
  `;
}

function summaryHtml(
  area,
) {
  const termsAlreadyAccepted = area.payment?.termsAccepted === true;
  const urgencyPercent = Number(area.urgency?.percent || 0);
  const isPix = area.payment.method === 'pix';
  const totalCents = Number(area.payment.totalCents || 0);
  const pixTotalCents = Number(area.payment.baseTotalCents ?? totalCents);
  const cardTotalCents = Number(area.payment.cardTotalCents ?? totalCents);
  const cardExtraCents = Math.max(0, cardTotalCents - pixTotalCents);
  const pixDueCents = Math.round(pixTotalCents * 0.5);
  const pixBalanceCents = Math.max(0, pixTotalCents - pixDueCents);
  const dueNowCents = isPix
    ? pixDueCents
    : totalCents;
  const paidCents = Number(area.payment.paidCents || 0);
  const remainingCents = Number(area.payment.remainingCents ?? Math.max(0, totalCents - paidCents));
  const hasPaid = paidCents > 0;
  const capacityReview = area.payment?.capacityReview === true;
  const unpaidArchived = area.order.archived === true && !hasPaid;
  const deadlineTime = Date.parse(area.payment?.deadlineAt || '');
  const deadlineLabel = Number.isFinite(deadlineTime)
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(deadlineTime))
    : '';
  const awaitingInitialPayment =
    ['urgency_approved', 'awaiting_payment'].includes(area.order.status)
    && !capacityReview
    && !unpaidArchived;
  const awaitingBalance = area.order.status === 'balance_pending';
  const deliveryStart = area.order.deliveryWindow.start || '';
  const deliveryEnd = area.order.deliveryWindow.end || '';
  const deliveryLabel =
    deliveryStart && deliveryEnd
      ? `${dateBr(deliveryStart)} a ${dateBr(deliveryEnd)}`
      : area.urgency?.status === 'pending'
        ? 'Em análise'
        : area.urgency?.status === 'rejected'
          ? 'Encaixe não aprovado'
          : 'A definir';

  return `
    <section class="page-card">
      <div class="page-head ${awaitingInitialPayment || awaitingBalance || capacityReview ? 'payment-head' : ''}">
        <span class="eyebrow">Seu pedido</span>
        <h1 class="page-title">
          ${unpaidArchived
            ? 'Prazo de pagamento encerrado'
            : capacityReview
            ? 'Pagamento confirmado'
            : awaitingInitialPayment
              ? 'Pagamento pendente'
              : awaitingBalance
                ? 'Saldo pendente'
                : `Oi, ${esc(area.customer.name)} 💛`}
        </h1>
        <p class="page-subtitle">
          ${unpaidArchived
            ? 'Seu pedido está salvo, mas as 24 horas para pagamento terminaram. Entre em contato com a Libri para reativá-lo.'
            : capacityReview
            ? 'A Libri está revisando sua janela de entrega. Nenhum novo pagamento é necessário.'
            : awaitingInitialPayment
              ? 'Finalize o pagamento para liberar o próximo passo do seu pedido.'
              : awaitingBalance
                ? 'Sua prévia foi aprovada. Falta apenas o saldo final para liberar a entrega.'
                : 'Aqui você acompanha seus dados, prévias e documentos.'}
        </p>
      </div>

      ${area.payment?.returnState === 'confirmed' ? '<div class="notice success">Pagamento confirmado ✓ O próximo passo já foi liberado.</div>' : ''}
      ${capacityReview || area.payment?.returnState === 'capacity_review' ? '<div class="notice info">Pagamento confirmado ✓ A Libri está revisando sua janela de entrega antes de liberar o próximo passo. Não é necessário pagar novamente.</div>' : ''}
      ${area.payment?.returnState === 'checking' ? '<div class="notice info">Pagamento enviado. Estamos confirmando com o Mercado Pago.</div>' : ''}
      ${area.payment?.returnState === 'pending' ? '<div class="notice info">Pagamento ainda pendente no Mercado Pago. Você pode atualizar o status em alguns instantes.</div>' : ''}
      ${area.payment?.returnState === 'failure' ? '<div class="notice info">O pagamento não foi concluído. Você pode tentar novamente sem criar outro pedido.</div>' : ''}
      ${area.urgency?.status === 'pending' ? '<div class="notice info">Seu encaixe está em análise. Nenhum pagamento é solicitado antes da aprovação.</div>' : ''}
      ${area.urgency?.status === 'rejected' ? `<div class="notice info">Encaixe não aprovado. ${esc(area.urgency.note || '')}</div>` : ''}
      ${unpaidArchived ? `<div class="notice info">
        <strong>Seu pedido não foi excluído.</strong> O prazo de 24 horas terminou, mas guardamos as informações.
        ${area.support?.whatsappUrl ? `<a class="btn btn-primary" href="${esc(area.support.whatsappUrl)}" target="_blank" rel="noopener">Solicitar reativação do pedido</a>` : ''}
      </div>` : ''}
      ${awaitingInitialPayment ? `
        <section class="card payment-priority">
          <div class="payment-priority-top">
            <div>
              <span class="eyebrow">${area.urgency ? 'Encaixe aprovado' : 'Pagamento agora'}</span>
              <strong
                id="paymentDueNow"
                class="payment-priority-total"
                data-pix="${pixDueCents}"
                data-card="${cardTotalCents}"
              >${money(dueNowCents)}</strong>
            </div>
            <small id="paymentDueLabel">${isPix ? 'Pix • entrada de 50%' : 'Cartão • pagamento integral'}</small>
          </div>

          <p
            id="paymentBreakdown"
            class="muted"
            data-total="${pixTotalCents}"
            data-balance="${pixBalanceCents}"
            data-card-total="${cardTotalCents}"
            data-card-extra="${cardExtraCents}"
          >${isPix
            ? `Total do pedido: ${money(pixTotalCents)} • saldo após a entrada: ${money(pixBalanceCents)}`
            : `Total do pedido: ${money(cardTotalCents)}${cardExtraCents > 0 ? ` • acréscimo do cartão (taxa 4,97%): ${money(cardExtraCents)}` : ''}`}</p>

          <p class="muted"><strong>Escolha como deseja pagar.</strong> Se não conseguiu com um meio, pode trocar sem refazer o pedido.</p>
          <div
            id="paymentMethodChooser"
            class="payment-methods"
          >
            <label><input type="radio" name="resumeMethod" value="pix" ${isPix ? 'checked' : ''}> Pix • entrada de 50%</label>
            <label><input type="radio" name="resumeMethod" value="card" ${!isPix ? 'checked' : ''}> Cartão • ${money(cardTotalCents)}${cardExtraCents > 0 ? ' (inclui acréscimo para taxa 4,97%)' : ''}</label>
          </div>

          <div class="notice info compact-notice hidden" id="paymentRetryNotice">Não foi possível concluir essa tentativa. Escolha outra forma acima ou tente novamente. Seu pedido permanece salvo.</div>
          ${deadlineLabel ? `<p class="muted">Prazo para pagar: até ${esc(deadlineLabel)}. A reserva da agenda é temporária e será conferida novamente antes de um novo pagamento.</p>` : ''}
          ${area.urgency ? `<p class="muted">O adicional de ${urgencyPercent}% já está incluído no total.</p>` : ''}

          ${termsAlreadyAccepted ? '<div class="notice success compact-notice">Condições já aceitas ✓</div>' : `<label class="checkline"><input type="checkbox" id="resumeTerms"> Li e aceito as condições do pedido.</label><button class="btn btn-ghost" id="resumeReadTerms">Ler condições</button>`}

          <button class="btn btn-primary payment-main-cta" id="resumePayment">Continuar para pagamento</button>
        </section>` : ''}

      ${area.order.status === 'balance_pending' && isPix && remainingCents > 0 ? `
        <section class="card payment-priority" id="balancePixCard">
          <div class="payment-priority-top">
            <div>
              <span class="eyebrow">Saldo final</span>
              <strong class="payment-priority-total">${money(remainingCents)}</strong>
            </div>
            <small>Pix direto para a Libri</small>
          </div>

          ${area.payment.balancePix?.recipient ? `<p class="muted">Recebedor: <strong>${esc(area.payment.balancePix.recipient)}</strong></p>` : ""}
          ${area.payment.balancePix?.key ? `
            <div class="notice info compact-notice">
              <strong>Chave Pix</strong><br>
              <span>${esc(area.payment.balancePix.key)}</span>
            </div>
            <button
              class="btn btn-primary payment-main-cta"
              id="copyBalancePix"
              type="button"
              data-pix-key="${esc(area.payment.balancePix.key)}"
            >Copiar chave Pix</button>
            ${area.support?.whatsappUrl ? `
              <a
                class="btn btn-ghost"
                href="${esc(area.support.whatsappUrl)}"
                target="_blank"
                rel="noopener"
                style="margin-top:8px"
              >Já paguei • avisar a Libri</a>
            ` : ''}
            <p class="muted">Depois do Pix, avise a Libri para a confirmação do saldo e liberação da entrega.</p>
          ` : `<div class="notice info">Entre em contato com a Libri para receber os dados do saldo.</div>`}
        </section>
      ` : ""}

      <dl class="review-list">
        <div class="review-line">
          <dt>Status</dt>
          <dd>${esc(area.order.statusLabel)}</dd>
        </div>

        <div class="review-line">
          <dt>Janela de entrega</dt>
          <dd>${esc(deliveryLabel)}</dd>
        </div>

        <div class="review-line">
          <dt>Produto</dt>
          <dd>${esc(area.product.name)}</dd>
        </div>

        <div class="review-line">
          <dt>Adicionais</dt>
          <dd>
            ${
              area.product.addons.length
                ? area.product.addons.map(
                  (addon) =>
                    esc(addon.name),
                ).join(', ')
                : 'Nenhum'
            }
          </dd>
        </div>

        <div class="review-line">
          <dt>Pagamento</dt>
          <dd id="paymentReviewLine">
            ${
              isPix
                ? (hasPaid
                    ? `Pix • pago ${money(paidCents)} • saldo ${money(remainingCents)}`
                    : `Pix • entrada ${money(pixDueCents)} • saldo ${money(pixBalanceCents)}`)
                : (hasPaid
                    ? `Cartão • pago ${money(paidCents)}`
                    : `Cartão • ${money(totalCents)}`)
            }
          </dd>
        </div>
      </dl>

      ${
        area.briefing.locked
          ? `
            <div class="notice info section-block">
              ${capacityReview
                ? 'Seu pagamento foi confirmado. A Libri está revisando a data de entrega antes de liberar o formulário.'
                : 'Você poderá preencher os dados do convite assim que o pagamento for confirmado. Se acabou de pagar, atualize esta página em alguns instantes.'}
            </div>
          `
          : area.briefing.completed
            ? `
              <div class="notice success section-block">
                Dados enviados ✓
              </div>
            `
            : `
              <div class="notice section-block">
                Seus dados estão ${area.briefing.progress}% preenchidos.
              </div>
            `
      }
    </section>
  `;
}

function briefingValueFilled(
  value,
) {
  if (
    Array.isArray(value)
  ) {
    return value.length > 0;
  }

  return value !== null
    && value !== undefined
    && String(value).trim() !== '';
}

function missingBriefingItems(
  area,
  section,
) {
  const missing =
    (section.fields || [])
      .filter(
        (definition) =>
          definition.required
          && !briefingValueFilled(
            area.briefing.data[
              definition.key
            ],
          ),
      )
      .map(
        (definition) => ({
          type:
            'field',
          key:
            definition.key,
          message:
            definition.label,
        }),
      );

  const uploadKeys = {
    appearance:
      new Set([
        'person_photos',
        'outfit_photos',
      ]),
    references:
      new Set([
        'reference_files',
      ]),
  }[
    section.id
  ]
  || new Set();

  for (
    const rule
    of area.briefing.schema
      .uploadRules
      .filter(
        (item) =>
          item.min > 0
          && uploadKeys.has(
            item.fieldKey,
          ),
      )
  ) {
    const count =
      area.briefing.uploads
        .filter(
          (upload) =>
            upload.fieldKey
            === rule.fieldKey,
        )
        .length;

    if (
      count < rule.min
    ) {
      missing.push({
        type:
          'upload',
        key:
          rule.fieldKey,
        message:
          `${rule.label}: envie pelo menos ${rule.min}.`,
      });
    }
  }

  return missing;
}

function showBriefingMissing(missing) {
  const summary = app.querySelector('#briefingErrors');
  if (!summary) return;

  // Clear previous flags, then highlight each missing field in place.
  app.querySelectorAll('.briefing-field-invalid').forEach(box => {
    box.classList.remove('briefing-field-invalid');
  });
  app.querySelectorAll('[aria-invalid="true"]').forEach(control =>
    control.removeAttribute('aria-invalid'));
  app.querySelectorAll('.briefing-inline-error').forEach(message => message.remove());

  const visible = [];
  let first = null;
  for (const item of missing) {
    const key = CSS.escape(String(item.key || ''));
    const control = item.type === 'upload'
      ? app.querySelector('[data-upload-field="' + key + '"]')
      : app.querySelector('[data-field="' + key + '"]');
    if (!control) continue;
    const box = item.type === 'upload' ? control.closest('.upload-zone')
      : control.closest('.field');
    if (!box) continue;
    box.classList.add('briefing-field-invalid');
    control.setAttribute('aria-invalid', 'true');
    const text = document.createElement('small');
    text.className = 'briefing-inline-error';
    text.textContent = item.message;
    box.appendChild(text);
    if (!first) first = box;
    visible.push(item.message);
  }

  summary.classList.remove('hidden');
  summary.innerHTML = '<strong>Falta preencher nesta etapa. Confira os campos destacados:</strong>' +
    '<ul>' + (visible.length ? visible : missing.map(item => item.message))
      .map(message => '<li>' + esc(message) + '</li>').join('') + '</ul>';
  summary.setAttribute('role', 'alert');
  const focusTarget = first || summary;
  if (first) first.setAttribute('tabindex', '-1');
  focusTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
  focusTarget.focus({ preventScroll: true });
}


function briefingHtml(
  area,
) {
  if (
    area.briefing.locked
  ) {
    const capacityReview =
      area.payment?.capacityReview === true;

    return `
      <section class="page-card">
        <div class="page-head">
          <span class="eyebrow">Dados do convite</span>
          <h1 class="page-title">${capacityReview ? 'Pagamento confirmado' : 'Aguardando pagamento'}</h1>
          <p class="page-subtitle">
            ${capacityReview
              ? 'A Libri está revisando sua data de entrega. O formulário será liberado assim que a revisão terminar.'
              : 'Assim que o pagamento for confirmado, você poderá preencher os dados do convite aqui.'}
          </p>
        </div>

        <button
          id="refreshArea"
          class="btn btn-primary"
          type="button"
        >
          Atualizar status
        </button>
      </section>
    `;
  }

  const schema =
    area.briefing.schema;

  const activeSection =
    schema.sections.find(
      (section) =>
        section.id
        === area.briefing.currentSection,
    )
    || schema.sections[0];

  const index =
    schema.sections.indexOf(
      activeSection,
    );

  const sectionUploads =
    schema.uploadRules.filter(
      (rule) => {
        if (
          activeSection.id
          === 'appearance'
        ) {
          return [
            'person_photos',
            'outfit_photos',
          ].includes(
            rule.fieldKey,
          );
        }

        if (
          activeSection.id
          === 'references'
        ) {
          return rule.fieldKey
            === 'reference_files';
        }

        return false;
      },
    );

  return `
    <section class="page-card briefing-form">
      <p class="briefing-save-note">
        <span>Salvamento automático. Evite dispositivos compartilhados.</span>
        <span id="briefingSaveStatus" role="status" aria-live="polite">Salvamento automático</span>
      </p>
      <div class="progress-shell">
        <div class="progress-top">
          <strong>${esc(activeSection.title)}</strong>
          <span class="progress-label">
            ${area.briefing.progress}%
          </span>
        </div>

        <div class="progress-track">
          <span style="width:${area.briefing.progress}%"></span>
        </div>
      </div>

      <div class="page-head">
        <span class="eyebrow">
          Etapa ${index + 1} de ${schema.sections.length}
        </span>

        <h1 class="page-title">
          ${esc(activeSection.title)}
        </h1>

        ${
          activeSection.description
            ? `
              <p class="page-subtitle">
                ${esc(activeSection.description)}
              </p>
            `
            : ''
        }
      </div>

      <div id="briefingErrors" class="notice error hidden" tabindex="-1"></div>
      <div class="form-grid">
        ${activeSection.fields.map(
          (definition) =>
            inputHtml(
              definition,
              area.briefing.data[
                definition.key
              ],
            ),
        ).join('')}
      </div>

      ${
        sectionUploads.length
          ? `
            <div class="briefing-section section-block">
              ${sectionUploads.map(
                (rule) =>
                  uploadRuleHtml(
                    area,
                    rule,
                  ),
              ).join('')}
            </div>
          `
          : ''
      }

      <div class="action-row">
        <button
          id="briefingPrev"
          class="btn btn-ghost"
          type="button"
          ${
            index <= 0
              ? 'disabled'
              : ''
          }
        >
          Voltar
        </button>

        ${
          area.briefing.completed
            ? `
              <span class="tag">Enviado ✓</span>
            `
            : index
              >= schema.sections.length - 1
                ? `
                  <button
                    id="briefingSubmit"
                    class="btn btn-primary btn-large"
                    type="button"
                  >
                    Enviar dados
                  </button>
                `
                : `
                  <button
                    id="briefingNext"
                    class="btn btn-primary btn-large"
                    type="button"
                  >
                    Continuar
                  </button>
                `
        }
      </div>
    </section>
  `;
}

async function previewHtml(
  token,
) {
  const data =
    await api(
      `/api/v2/customer-area/${token}/previews`,
    );

  const preview =
    data.preview;

  if (!preview) {
    return `
      <section class="page-card">
        <div class="empty-state">
          Sua prévia ainda não foi publicada.
        </div>
      </section>
    `;
  }

  const available =
    [
      'active',
      'approved',
    ].includes(
      preview.status,
    );

  return `
    <section class="page-card">
      <div class="page-head">
        <span class="eyebrow">Prévia v${preview.version}</span>
        <h1 class="page-title">Confira com carinho ✨</h1>
        <p class="page-subtitle">
          ${
            preview.status === 'approved'
              ? 'Esta versão já foi aprovada.'
              : 'Se estiver tudo certo, aprove por aqui. Se precisar falar de um ajuste, abra o WhatsApp.'
          }
        </p>
      </div>

      <article class="preview-card">
        ${
          available
            ? preview.mediaType === 'video'
              ? `
                <video
                  class="preview-media"
                  controls
                  controlslist="nodownload noremoteplayback"
                  disablepictureinpicture
                  playsinline
                  preload="metadata"
                  draggable="false"
                  src="${esc(preview.contentPath)}"
                ></video>
              `
              : `
                <img
                  class="preview-media"
                  src="${esc(preview.contentPath)}"
                  alt="Prévia do convite"
                  draggable="false"
                >
              `
            : `
              <div class="notice info">
                Esta prévia não está disponível no momento.
              </div>
            `
        }

        <div class="preview-actions">
          ${
            preview.status === 'active'
              ? `
                <button
                  id="approvePreview"
                  class="btn btn-primary"
                  type="button"
                  data-preview-id="${preview.id}"
                >
                  Está aprovado ✓
                </button>
              `
              : ''
          }

          ${
            data.adjustmentWhatsappUrl
              ? `
                <a
                  class="btn btn-ghost"
                  href="${esc(data.adjustmentWhatsappUrl)}"
                  target="_blank"
                  rel="noopener"
                >
                  Quero falar de um ajuste
                </a>
              `
              : ''
          }
        </div>
      </article>
    </section>
  `;
}

async function contractHtml(
  token,
) {
  const data =
    await api(
      `/api/v2/customer-area/${token}/contracts`,
    );

  const contracts =
    data.result?.contracts
    || [];

  if (!contracts.length) {
    return `
      <section class="page-card">
        <div class="empty-state">
          Nenhum contrato disponível.
        </div>
      </section>
    `;
  }

  const contract =
    contracts[0];

  return `
    <section class="page-card">
      <div class="page-head">
        <span class="eyebrow">
          Contrato • versão ${contract.version}
        </span>

        <h1 class="page-title">
          ${
            contract.status === 'signed'
              ? 'Contrato assinado ✓'
              : 'Leia antes de assinar'
          }
        </h1>
      </div>

      <article class="contract-card">
        <div class="contract-body">
          ${esc(contract.body)}
        </div>

        <div class="contract-actions">
          ${
            contract.status === 'waiting_customer'
              ? `
                <div class="field" style="min-width:min(100%,320px)">
                  <label for="contractSigner">
                    Nome de quem está assinando
                  </label>

                  <input
                    id="contractSigner"
                    class="input"
                    value="${esc(data.result.order.customerName || '')}"
                  >
                </div>

                <button
                  id="signContract"
                  class="btn btn-primary"
                  type="button"
                  data-contract-id="${contract.id}"
                >
                  Assinar contrato
                </button>
              `
              : ''
          }

          ${
            contract.hasFinalPdf
              ? `
                <a
                  class="btn btn-secondary"
                  href="/api/v2/customer-area/${token}/contracts/${contract.id}/pdf"
                >
                  Baixar PDF assinado
                </a>
              `
              : ''
          }
        </div>
      </article>
    </section>
  `;
}

export async function startCustomerArea(
  token,
) {
  setSubtitle(
    'Meu pedido',
  );

  let activeTab =
    new URLSearchParams(
      window.location.search,
    )
      .get(
        'tab',
      )
    || 'summary';

  const loadArea =
    async () => {
      const data =
        await api(
          `/api/v2/customer-area/${token}`,
        );

      return data.area;
    };

  let area =
    await loadArea();

  const draftKey = 'libri-v2-draft:' + token;
  function storedDraft() {
    try {
      const stored = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (!stored?.updatedAt || Date.now() - stored.updatedAt > 7 * 86400000) {
        localStorage.removeItem(draftKey);
        return {};
      }
      return stored.data && typeof stored.data === 'object' ? stored.data : {};
    } catch { return {}; }
  }
  function rememberDraft(patch) {
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        updatedAt: Date.now(), data: { ...storedDraft(), ...patch },
      }));
    } catch {}
  }
  function confirmSavedDraft(patch) {
    try {
      const current = storedDraft();
      for (const [key, value] of Object.entries(patch || {})) {
        if (JSON.stringify(current[key]) === JSON.stringify(value)) delete current[key];
      }
      if (Object.keys(current).length) {
        localStorage.setItem(draftKey, JSON.stringify({ updatedAt: Date.now(), data: current }));
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {}
  }
  if (!area.briefing.locked && !area.briefing.completed && Object.keys(storedDraft()).length) {
    if (confirm('Encontramos informações não enviadas neste dispositivo. Quer recuperá-las?')) {
      const patch = storedDraft();
      area.briefing.data = { ...area.briefing.data, ...patch };
      try {
        const data = await api('/api/v2/customer-area/' + token + '/briefing', {
          method: 'PATCH',
          body: JSON.stringify({
            currentSection: area.briefing.currentSection,
            data: patch,
          }),
        });
        area.briefing.data = data.result.data;
        area.briefing.schema = data.result.schema;
        area.briefing.progress = data.result.progress;
        confirmSavedDraft(patch);
      } catch {
        showToast('Rascunho recuperado. Confira e tente salvar quando a conexão voltar.');
      }
    }
  }

  const returnUrl =
    new URL(
      window.location.href,
    );

  const paymentReturn =
    returnUrl.searchParams.get(
      'payment',
    );

  if (
    [
      'success',
      'pending',
      'failure',
    ].includes(
      paymentReturn,
    )
  ) {
    if (
      paymentReturn
      === 'failure'
    ) {
      area.payment.returnState =
        'failure';
    } else if (
      area.briefing.locked
    ) {
      try {
        const result =
          await api(
            `/api/v2/customer-area/${token}/payment`,
            {
              method:
                'POST',
              body:
                JSON.stringify({
                  clientRequestId:
                    randomId(),
                  paymentMethod:
                    area.payment.method,
                }),
            },
          );

        if (
          result.alreadyPaid
        ) {
          area =
            await loadArea();

          area.payment.returnState =
            result.capacityReview
              ? 'capacity_review'
              : 'confirmed';
        } else {
          area.payment.returnState =
            paymentReturn
            === 'success'
              ? 'checking'
              : 'pending';
        }
      } catch {
        area.payment.returnState =
          paymentReturn
          === 'success'
            ? 'checking'
            : 'pending';
      }
    } else {
      area.payment.returnState =
        'confirmed';
    }

    returnUrl.searchParams.delete(
      'payment',
    );

    history.replaceState(
      null,
      '',
      returnUrl,
    );
  }

  setHelp(
    area.support.whatsappUrl,
  );

  let briefingSaveFeedback = 'Salvamento automático';
  let briefingSaveFeedbackState = 'idle';
  let briefingSaveRevision = 0;
  let briefingUploadsRunning = false;
  let briefingUploadNeedsRefresh = false;

  function setBriefingSaveFeedback(label, state = 'idle') {
    briefingSaveFeedback = label;
    briefingSaveFeedbackState = state;
    const indicator = app.querySelector('#briefingSaveStatus');
    if (indicator) {
      indicator.textContent = label;
      indicator.dataset.state = state;
    }
  }

  async function render(viewport = null) {
    if (
      activeTab === 'preview'
      && !area.modules.previews.available
    ) {
      activeTab =
        'summary';
    }

    if (
      activeTab === 'contract'
      && !area.modules.contracts.available
    ) {
      activeTab =
        'summary';
    }

    let body;

    if (
      activeTab === 'briefing'
    ) {
      body =
        briefingHtml(area);
    } else if (
      activeTab === 'preview'
    ) {
      loading(
        'Abrindo sua prévia...',
      );
      body =
        await previewHtml(token);
    } else if (
      activeTab === 'contract'
    ) {
      loading(
        'Abrindo contrato...',
      );
      body =
        await contractHtml(token);
    } else {
      body =
        summaryHtml(area);
    }

    const paymentFirst =
      activeTab === 'summary'
      && ['urgency_approved', 'awaiting_payment']
        .includes(area.order.status);

    app.innerHTML = `
      <div class="customer-layout ${paymentFirst ? 'payment-first' : ''}">
        ${statusSidebar(area)}

        <div>
          ${nextStepCard(area)}
          ${tabButtons(area, activeTab)}
          <div id="customerMain">
            ${body}
          </div>
        </div>
      </div>
    `;

    restoreFieldViewport(viewport, app);
    if (activeTab === 'briefing') {
      setBriefingSaveFeedback(briefingSaveFeedback, briefingSaveFeedbackState);
    }
    setHelp(
      area.support.whatsappUrl,
    );

    app
      .querySelectorAll(
        '[data-next-tab]',
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            async () => {
              activeTab =
                button.dataset.nextTab;

              const url =
                new URL(
                  window.location.href,
                );

              url.searchParams.set(
                'tab',
                activeTab,
              );

              history.replaceState(
                null,
                '',
                url,
              );

              await render();
            },
          );
        },
      );

    app
      .querySelectorAll(
        '[data-tab]',
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            async () => {
              activeTab =
                button.dataset.tab;

              const url =
                new URL(
                  window.location.href,
                );

              url.searchParams.set(
                'tab',
                activeTab,
              );

              history.replaceState(
                null,
                '',
                url,
              );

              await render();
            },
          );
        },
      );

    document.getElementById('copyBalancePix')?.addEventListener('click', async (event) => {
      const key = event.currentTarget.dataset.pixKey || '';
      if (!key) return;
      try {
        await navigator.clipboard.writeText(key);
        showToast('Chave Pix copiada ✓');
      } catch {
        showToast('Não foi possível copiar. Toque e segure a chave Pix para copiar.');
      }
    });

    app
      .querySelectorAll(
        '[name="resumeMethod"]',
      )
      .forEach(
        (control) => {
          control.addEventListener(
            'change',
            () => {
              const total =
                document.getElementById(
                  'paymentDueNow',
                );

              const label =
                document.getElementById(
                  'paymentDueLabel',
                );

              const breakdown =
                document.getElementById(
                  'paymentBreakdown',
                );

              const reviewLine =
                document.getElementById(
                  'paymentReviewLine',
                );

              if (
                !total
                || !label
              ) {
                return;
              }

              const method =
                control.value;

              total.textContent =
                money(
                  Number(
                    method === 'pix'
                      ? total.dataset.pix
                      : total.dataset.card,
                  ),
                );

              label.textContent =
                method === 'pix'
                  ? 'Pix • entrada de 50%'
                  : 'Cartão • pagamento integral';

              if (breakdown) {
                const orderTotal =
                  money(
                    Number(
                      breakdown.dataset.total,
                    ),
                  );

                const balance =
                  money(
                    Number(
                      breakdown.dataset.balance,
                    ),
                  );

                const cardTotal = money(Number(breakdown.dataset.cardTotal));
                const cardFee = Number(breakdown.dataset.cardExtra || 0);
                breakdown.textContent =
                  method === 'pix'
                    ? `Total do pedido: ${orderTotal} • saldo após a entrada: ${balance}`
                    : `Total do pedido: ${cardTotal}${cardFee > 0 ? ` • acréscimo do cartão (taxa 4,97%): ${money(cardFee)}` : ''}`;
              }

              if (reviewLine) {
                reviewLine.textContent =
                  method === 'pix'
                    ? `Pix • entrada ${money(Number(total.dataset.pix))} • saldo ${money(Number(breakdown?.dataset.balance || 0))}`
                    : `Cartão • ${money(Number(total.dataset.card))}`;
              }
            },
          );
        },
      );

    let paymentTerms = null;
    const loadTerms = async () => paymentTerms || (paymentTerms = (await api('/api/v2/terms/current')).terms);
    document.getElementById('resumeReadTerms')?.addEventListener('click', async () => {
      try { const terms = await loadTerms(); modal(`Condições • ${terms.version}`, `<pre>${esc(terms.body)}</pre>`); }
      catch (error) { showToast(error.message); }
    });
    const continuePayment = async (confirmedDeliveryWindow = null) => {
      const needsTerms = area.payment?.termsAccepted !== true;
      const termsControl = document.getElementById('resumeTerms');
      if (needsTerms && !termsControl?.checked) {
        showToast('Leia e aceite as condições.');
        return;
      }
      const button = document.getElementById('resumePayment');
      if (button) button.disabled = true;
      try {
        const payload = {
          clientRequestId: randomId(),
          paymentMethod: document.querySelector('[name="resumeMethod"]:checked')?.value || area.payment.method,
        };
        if (confirmedDeliveryWindow) payload.confirmedDeliveryWindow = confirmedDeliveryWindow;
        if (needsTerms) {
          const terms = await loadTerms();
          payload.termsAccepted = true;
          payload.termsVersion = terms.version;
        }
        const result = await api(`/api/v2/customer-area/${token}/payment`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (result.alreadyPaid) {
          area = await loadArea();
          await render();
          showToast(result.capacityReview
            ? 'Pagamento recebido. A Libri está revisando sua janela.'
            : 'Pagamento confirmado.');
        } else if (result.payment?.checkoutUrl) {
          window.location.href = result.payment.checkoutUrl;
        } else {
          throw new Error('Pagamento indisponível. Atualize o pedido.');
        }
      } catch (error) {
        if (button) button.disabled = false;
        const info = error.data?.details;
        const windowChange = info?.code === 'delivery_window_shifted'
          ? info?.details : null;
        if (windowChange?.previous?.start && windowChange?.next?.start && windowChange?.next?.end) {
          const previous = `${dateBr(windowChange.previous.start)} a ${dateBr(windowChange.previous.end)}`;
          const next = `${dateBr(windowChange.next.start)} a ${dateBr(windowChange.next.end)}`;
          modal('Nova data de entrega', `
            <p>A primeira data de entrega passou. Encontramos uma nova janela disponível para seu pedido.</p>
            <p class="muted">Previsão anterior: <strong>${esc(previous)}</strong></p>
            <p>Nova previsão: <strong>${esc(next)}</strong></p>
            <p>Seu pedido e o valor contratado continuam os mesmos.</p>
            <button class="btn btn-primary" type="button" id="confirmNewDeliveryWindow">
              Entendi, continuar pagamento
            </button>
          `);
          document.getElementById('confirmNewDeliveryWindow')?.addEventListener('click', () => {
            document.querySelector('.modal-close')?.click();
            void continuePayment(windowChange.next);
          });
          return;
        }
        showToast(error.message);
        document.getElementById('paymentRetryNotice')?.classList.remove('hidden');
        if (info?.code === 'terms_changed' || error.data?.code === 'terms_changed') {
          paymentTerms = null;
          if (termsControl) termsControl.checked = false;
        }
      }
    };
    document.getElementById('resumePayment')?.addEventListener('click', () => {
      void continuePayment();
    });

    app
      .querySelectorAll(
        '.preview-media',
      )
      .forEach(
        (media) => {
          media.addEventListener(
            'contextmenu',
            (event) =>
              event.preventDefault(),
          );

          media.addEventListener(
            'dragstart',
            (event) =>
              event.preventDefault(),
          );
        },
      );

    bindBriefing();
    bindPreview();
    bindContract();

    document
      .getElementById(
        'refreshArea',
      )
      ?.addEventListener(
        'click',
        async () => {
          loading(
            'Atualizando status...',
          );

          area =
            await loadArea();

          await render();
        },
      );
  }

  let briefingSaveQueue =
    Promise.resolve();

  let pendingBriefingSection =
    '';

  let pendingBriefingPatch =
    {};

  let pendingBriefingTimer =
    null;

  let briefingChoiceRevision =
    0;

  function applyBriefingSaveResult(
    result,
  ) {
    area.briefing.data =
      result.data;

    area.briefing.progress =
      result.progress;

    area.briefing.schema =
      result.schema;

    area.briefing.currentSection =
      result.currentSection;
  }

  function enqueueBriefingSave(
    currentSection,
    patch,
  ) {
    const revision = ++briefingSaveRevision;
    setBriefingSaveFeedback('Salvando…', 'saving');
    const job =
      briefingSaveQueue
        .then(
          async () => {
            const data =
              await api(
                `/api/v2/customer-area/${token}/briefing`,
                {
                  method:
                    'PATCH',
                  body:
                    JSON.stringify({
                      currentSection,
                      data:
                        patch,
                    }),
                },
              );

            applyBriefingSaveResult(data.result);
            confirmSavedDraft(patch);
            if (revision === briefingSaveRevision
              && !Object.keys(pendingBriefingPatch).length) {
              setBriefingSaveFeedback('Salvo ✓', 'saved');
            }
            return data.result;
          },
        ).catch(error => {
          if (revision === briefingSaveRevision) {
            setBriefingSaveFeedback('Não salvo', 'error');
          }
          throw error;
        });

    briefingSaveQueue =
      job.catch(
        () => undefined,
      );

    return job;
  }

  function takePendingBriefing() {
    if (
      pendingBriefingTimer
    ) {
      window.clearTimeout(
        pendingBriefingTimer,
      );

      pendingBriefingTimer =
        null;
    }

    const keys =
      Object.keys(
        pendingBriefingPatch,
      );

    if (!keys.length) {
      return null;
    }

    const pending = {
      currentSection:
        pendingBriefingSection,
      patch: {
        ...pendingBriefingPatch,
      },
    };

    pendingBriefingSection =
      '';

    pendingBriefingPatch =
      {};

    return pending;
  }

  function flushPendingBriefing() {
    const pending =
      takePendingBriefing();

    if (!pending) {
      return briefingSaveQueue;
    }

    return enqueueBriefingSave(
      pending.currentSection,
      pending.patch,
    );
  }

  function scheduleBriefingSave(
    currentSection,
    patch,
  ) {
    if (
      pendingBriefingSection
      && pendingBriefingSection
      !== currentSection
    ) {
      flushPendingBriefing()
        .catch(
          (error) =>
            showToast(
              `Não foi possível salvar: ${error.message}`,
            ),
        );
    }

    rememberDraft(patch);
    ++briefingSaveRevision;
    setBriefingSaveFeedback('Salvando…', 'saving');
    pendingBriefingSection =
      currentSection;

    Object.assign(
      pendingBriefingPatch,
      patch,
    );

    if (
      pendingBriefingTimer
    ) {
      window.clearTimeout(
        pendingBriefingTimer,
      );
    }

    pendingBriefingTimer =
      window.setTimeout(
        () => {
          flushPendingBriefing()
            .catch(
              (error) =>
                showToast(
                  `Não foi possível salvar: ${error.message}`,
                ),
            );
        },
        450,
      );
  }

  async function saveBriefingNow(
    currentSection,
    patch,
  ) {
    if (Object.keys(patch || {}).length) rememberDraft(patch);
    const pending =
      takePendingBriefing();

    if (
      pending
      && pending.currentSection
      === currentSection
    ) {
      return enqueueBriefingSave(
        currentSection,
        {
          ...pending.patch,
          ...patch,
        },
      );
    }

    if (pending) {
      await enqueueBriefingSave(
        pending.currentSection,
        pending.patch,
      );
    }

    return enqueueBriefingSave(
      currentSection,
      patch,
    );
  }

  function bindBriefing() {
    if (
      activeTab !== 'briefing'
      || area.briefing.locked
      || area.briefing.completed
    ) {
      return;
    }

    const sectionId =
      area.briefing.currentSection
      || area.briefing.schema.sections[0]?.id;

    app
      .querySelectorAll(
        '[data-field]',
      )
      .forEach(
        (control) => {
          control.addEventListener(
            'change',
            async () => {
              const key =
                control.dataset.field;

              let value;

              if (
                control.dataset.multi
                === '1'
              ) {
                value =
                  [
                    ...app.querySelectorAll(
                      `[data-field="${CSS.escape(key)}"][data-multi="1"]:checked`,
                    ),
                  ]
                    .map(
                      (input) =>
                        input.value,
                    );
              } else if (
                control.type
                === 'radio'
              ) {
                value =
                  app.querySelector(
                    `[data-field="${CSS.escape(key)}"]:checked`,
                  )
                    ?.value
                || '';
              } else {
                value =
                  control.value;
              }

              area.briefing.data[key] =
                value;

              if (
                control.type
                === 'radio'
                || control.dataset.multi
                === '1'
              ) {
                const revision =
                  ++briefingChoiceRevision;

                try {
                  await saveBriefingNow(
                    sectionId,
                    {
                      [key]:
                        value,
                    },
                  );

                  if (
                    revision
                    === briefingChoiceRevision
                  ) {
                    await render(captureFieldViewport(control));
                  }
                } catch (error) {
                  showToast(
                    `Não foi possível salvar: ${error.message}`,
                  );

                  area =
                    await loadArea();

                  await render(captureFieldViewport(control));
                }

                return;
              }

              scheduleBriefingSave(
                sectionId,
                {
                  [key]:
                    value,
                },
              );
            },
          );
        },
      );

    app
      .querySelectorAll(
        '[data-field]:not([type="radio"]):not([type="checkbox"])',
      )
      .forEach(
        (control) => {
          control.addEventListener(
            'input',
            () => {
              area.briefing.data[
                control.dataset.field
              ] =
                control.value;

              scheduleBriefingSave(
                sectionId,
                {
                  [control.dataset.field]:
                    control.value,
                },
              );
            },
          );
        },
      );

    app.querySelectorAll('[data-upload-field]').forEach(input => {
      input.addEventListener('change', async () => {
        if (briefingUploadsRunning) return;
        if (briefingUploadNeedsRefresh) {
          showToast('Atualize o pedido para conferir os envios antes de selecionar novas fotos.');
          return;
        }
        const fieldKey = input.dataset.uploadField;
        const rule = area.briefing.schema.uploadRules.find(item => item.fieldKey === fieldKey);
        const existingCount = area.briefing.uploads
          .filter(item => item.fieldKey === fieldKey).length;
        const batch = planCustomerPhotoBatch(input.files, existingCount, rule);
        input.value = '';
        if (batch.error) {
          showToast(batch.error);
          return;
        }
        if (!batch.files.length) return;

        // One request per photo preserves backend limits, database consistency
        // and the existing R2 upload semantics. Never send concurrent uploads.
        briefingUploadsRunning = true;
        const uploadInputs = [...app.querySelectorAll('[data-upload-field]')];
        uploadInputs.forEach(control => { control.disabled = true; });
        const progress = app.querySelector('[data-upload-progress="' + fieldKey + '"]');
        const bar = progress?.querySelector('span');
        const label = progress?.querySelector('small');
        progress?.classList.remove('hidden');
        let completed = 0;
        let failure = '';
        let confirmationUnknown = false;
        try {
          for (const [index, file] of batch.files.entries()) {
            const seen = new Set(area.briefing.uploads.map(item => Number(item.id)));
            const form = new FormData();
            form.set('fieldKey', fieldKey);
            form.set('file', file);
            const updateProgress = percent => {
              const overall = Math.round((index + percent / 100) * 100 / batch.files.length);
              progress?.setAttribute('aria-valuenow', String(overall));
              if (bar) bar.style.width = overall + '%';
              if (label) label.textContent =
                `Enviando foto ${index + 1} de ${batch.files.length} • ${overall}%`;
            };
            updateProgress(0);
            try {
              await uploadCustomerPhoto(
                '/api/v2/customer-area/' + token + '/briefing/uploads',
                form, updateProgress,
              );
              area = await loadArea();
              completed += 1;
            } catch (error) {
              // After a dropped response, the photo may already exist in R2/D1.
              // Reconcile by a newly allocated database ID before moving on.
              let checked = false;
              let received = false;
              try {
                const latest = await loadArea();
                checked = true;
                received = latest.briefing.uploads.some(item =>
                  !seen.has(Number(item.id))
                  && item.fieldKey === fieldKey
                  && item.originalFilename === file.name
                  && Number(item.sizeBytes) === file.size);
                area = latest;
              } catch {}
              if (received) {
                completed += 1;
                continue;
              }
              confirmationUnknown = !checked;
              if (confirmationUnknown) briefingUploadNeedsRefresh = true;
              failure = error.message || 'Não foi possível enviar a foto.';
              break; // Never silently skip a failed photo.
            }
          }
          if (completed > 0) {
            await render();
          } else if (failure) {
            progress?.classList.add('hidden');
          }
          if (confirmationUnknown) {
            showToast('Não foi possível conferir se a última foto chegou. Atualize o pedido antes de tentar novamente.');
          } else if (failure) {
            showToast(`${completed} foto(s) enviadas. Outra foto falhou: ${failure}`);
          } else {
            showToast(`${completed} foto(s) enviadas com sucesso ✓`);
          }
        } catch (error) {
          showToast('Não foi possível atualizar as fotos. Confira o pedido antes de tentar novamente.');
        } finally {
          briefingUploadsRunning = false;
          // Re-render replaces the inputs on success; reset old ones on failure.
          app.querySelectorAll('[data-upload-field]').forEach(control => {
            control.disabled = briefingUploadNeedsRefresh
              || area.briefing.uploads.filter(item =>
                item.fieldKey === control.dataset.uploadField).length
                  >= (area.briefing.schema.uploadRules.find(item =>
                    item.fieldKey === control.dataset.uploadField)?.max || 0);
          });
        }
      });
    });

    app
      .querySelectorAll(
        '[data-upload-note]',
      )
      .forEach(
        (control) => {
          control.addEventListener(
            'change',
            async () => {
              try {
                await api(
                  `/api/v2/customer-area/${token}/briefing/uploads/${control.dataset.uploadNote}`,
                  {
                    method:
                      'PATCH',
                    body:
                      JSON.stringify({
                        note:
                          control.value
                            .trim(),
                      }),
                  },
                );

                const upload =
                  area.briefing.uploads
                    .find(
                      item =>
                        String(item.id)
                        === String(control.dataset.uploadNote),
                    );

                if (upload) {
                  upload.note =
                    control.value
                      .trim();
                }

                showToast(
                  'Observação salva ✓',
                );
              } catch (error) {
                showToast(
                  error.message,
                );
              }
            },
          );
        },
      );

    app
      .querySelectorAll(
        '[data-delete-upload]',
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            async () => {
              button.disabled =
                true;

              try {
                await api(
                  `/api/v2/customer-area/${token}/briefing/uploads/${button.dataset.deleteUpload}`,
                  {
                    method:
                      'DELETE',
                  },
                );

                area =
                  await loadArea();

                await render();
              } catch (error) {
                button.disabled =
                  false;

                showToast(
                  error.message,
                );
              }
            },
          );
        },
      );

    const sections =
      area.briefing.schema.sections;

    const index =
      sections.findIndex(
        (section) =>
          section.id
          === area.briefing.currentSection,
      );

    document
      .getElementById(
        'briefingPrev',
      )
      ?.addEventListener(
        'click',
        async () => {
          briefingChoiceRevision += 1;

          if (
            index <= 0
          ) {
            return;
          }

          const next =
            sections[index - 1];

          try {
            await saveBriefingNow(
              next.id,
              {},
            );

            await render();
          } catch (error) {
            showToast(
              `Não foi possível salvar: ${error.message}`,
            );
          }
        },
      );

    document
      .getElementById(
        'briefingNext',
      )
      ?.addEventListener(
        'click',
        async () => {
          briefingChoiceRevision += 1;

          const next =
            sections[index + 1];

          if (!next) {
            return;
          }

          try {
            await saveBriefingNow(
              sectionId,
              {},
            );

            const current =
              area.briefing.schema.sections
                .find(
                  (section) =>
                    section.id
                    === sectionId,
                );

            const missing =
              current
                ? missingBriefingItems(
                  area,
                  current,
                )
                : [];

            if (
              missing.length
            ) {
              showBriefingMissing(
                missing,
              );

              return;
            }

            await saveBriefingNow(
              next.id,
              {},
            );

            await render();
          } catch (error) {
            showToast(
              `Não foi possível salvar: ${error.message}`,
            );
          }
        },
      );

    document
      .getElementById(
        'briefingSubmit',
      )
      ?.addEventListener(
        'click',
        async () => {
          briefingChoiceRevision += 1;

          const button =
            document
              .getElementById(
                'briefingSubmit',
              );

          button.disabled =
            true;

          button.textContent =
            'Enviando...';

          try {
            await saveBriefingNow(
              sectionId,
              {},
            );

            const data =
              await api(
                `/api/v2/customer-area/${token}/briefing/submit`,
                {
                  method:
                    'POST',
                },
              );

            area =
              await loadArea();

            modal(
              data.result.success?.title
              || 'Tudo pronto! 💛',
              `
                <p>
                  ${esc(
                    data.result.success?.message
                    || 'Seu briefing foi enviado.',
                  )}
                </p>

                ${
                  data.result.success?.whatsappUrl
                    ? `
                      <a
                        class="btn btn-primary"
                        href="${esc(data.result.success.whatsappUrl)}"
                        target="_blank"
                        rel="noopener"
                      >
                        ${esc(data.result.success.whatsappButtonLabel || 'Avisar a Libri')}
                      </a>
                    `
                    : ''
                }
              `,
            );

            await render();
          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              'Enviar dados';

            const missing =
              error.data?.details?.fields
              || [];

            if (missing.length) {
              const firstSection = missing.find(item => item.section)?.section;
              if (firstSection && firstSection !== area.briefing.currentSection) {
                try {
                  await saveBriefingNow(firstSection, {});
                  await render();
                } catch {
                  showToast('Confira os campos obrigatórios das etapas anteriores.');
                }
              }
              showBriefingMissing(missing);
              return;
            }

            showToast(
              error.message,
            );
          }
        },
      );
  }

  function bindPreview() {
    if (
      activeTab !== 'preview'
    ) {
      return;
    }

    document
      .getElementById(
        'approvePreview',
      )
      ?.addEventListener(
        'click',
        async (event) => {
          const button =
            event.currentTarget;

          button.disabled =
            true;

          button.textContent =
            'Aprovando...';

          try {
            await api(
              `/api/v2/customer-area/${token}/previews/${button.dataset.previewId}/approve`,
              {
                method:
                  'POST',
              },
            );

            area =
              await loadArea();

            if (
              area.order.status
              === 'balance_pending'
            ) {
              activeTab =
                'summary';

              const url =
                new URL(
                  window.location.href,
                );

              url.searchParams.set(
                'tab',
                'summary',
              );

              history.replaceState(
                null,
                '',
                url,
              );
            }

            await render();

            showToast(
              area.order.status
              === 'balance_pending'
                ? 'Prévia aprovada ✓ Agora falta apenas o saldo final.'
                : 'Prévia aprovada ✓',
            );
          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              'Está aprovado ✓';

            showToast(
              error.message,
            );
          }
        },
      );
  }

  function bindContract() {
    if (
      activeTab !== 'contract'
    ) {
      return;
    }

    document
      .getElementById(
        'signContract',
      )
      ?.addEventListener(
        'click',
        async (event) => {
          const button =
            event.currentTarget;

          const signerName =
            document
              .getElementById(
                'contractSigner',
              )
              .value
              .trim();

          if (!signerName) {
            showToast(
              'Informe o nome de quem está assinando.',
            );

            return;
          }

          button.disabled =
            true;

          button.textContent =
            'Assinando...';

          try {
            await api(
              `/api/v2/customer-area/${token}/contracts/${button.dataset.contractId}/sign`,
              {
                method:
                  'POST',
                body:
                  JSON.stringify({
                    accepted:
                      true,
                    signerName,
                  }),
              },
            );

            area =
              await loadArea();

            await render();

            showToast(
              'Contrato assinado ✓',
            );
          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              'Assinar contrato';

            showToast(
              error.message,
            );
          }
        },
      );
  }

  await render();
}

