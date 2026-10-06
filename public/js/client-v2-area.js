import {
  api,
  app,
  dateBr,
  debounce,
  esc,
  loading,
  modal,
  money,
  randomId,
  setHelp,
  setSubtitle,
  showToast,
} from './client-v2-core.js';

function inputHtml(
  definition,
  value,
) {
  const common =
    `data-field="${esc(definition.key)}"`;

  const label =
    `<label for="field-${esc(definition.key)}">${esc(definition.label)}${definition.required ? ' *' : ''}</label>`;

  const help =
    definition.help
      ? `<small>${esc(definition.help)}</small>`
      : '';

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
                value === option.value
                  ? 'selected'
                  : ''
              }">
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
          Adicionar foto
          <input
            class="hidden"
            type="file"
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
          ${uploads.length} de ${rule.max}
        </span>
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
        'Briefing',
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
  const pixDueCents = Math.round(totalCents * 0.5);
  const pixBalanceCents = Math.max(0, totalCents - pixDueCents);
  const dueNowCents = isPix
    ? pixDueCents
    : totalCents;
  const paidCents = Number(area.payment.paidCents || 0);
  const remainingCents = Number(area.payment.remainingCents ?? Math.max(0, totalCents - paidCents));
  const hasPaid = paidCents > 0;
  const capacityReview = area.payment?.capacityReview === true;
  const awaitingInitialPayment =
    ['urgency_approved', 'awaiting_payment'].includes(area.order.status)
    && !capacityReview;
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
          ${capacityReview
            ? 'Pagamento confirmado'
            : awaitingInitialPayment
              ? 'Pagamento pendente'
              : awaitingBalance
                ? 'Saldo pendente'
                : `Oi, ${esc(area.customer.name)} 💛`}
        </h1>
        <p class="page-subtitle">
          ${capacityReview
            ? 'A Libri está revisando sua janela de entrega. Nenhum novo pagamento é necessário.'
            : awaitingInitialPayment
              ? 'Finalize o pagamento para liberar o próximo passo do seu pedido.'
              : awaitingBalance
                ? 'Sua prévia foi aprovada. Falta apenas o saldo final para liberar a entrega.'
                : 'Aqui ficam seu briefing, prévias e documentos quando estiverem disponíveis.'}
        </p>
      </div>

      ${area.payment?.returnState === 'confirmed' ? '<div class="notice success">Pagamento confirmado ✓ O próximo passo já foi liberado.</div>' : ''}
      ${capacityReview || area.payment?.returnState === 'capacity_review' ? '<div class="notice info">Pagamento confirmado ✓ A Libri está revisando sua janela de entrega antes de liberar o próximo passo. Não é necessário pagar novamente.</div>' : ''}
      ${area.payment?.returnState === 'checking' ? '<div class="notice info">Pagamento enviado. Estamos confirmando com o Mercado Pago.</div>' : ''}
      ${area.payment?.returnState === 'pending' ? '<div class="notice info">Pagamento ainda pendente no Mercado Pago. Você pode atualizar o status em alguns instantes.</div>' : ''}
      ${area.payment?.returnState === 'failure' ? '<div class="notice info">O pagamento não foi concluído. Você pode tentar novamente sem criar outro pedido.</div>' : ''}
      ${area.urgency?.status === 'pending' ? '<div class="notice info">Seu encaixe está em análise. Nenhum pagamento é solicitado antes da aprovação.</div>' : ''}
      ${area.urgency?.status === 'rejected' ? `<div class="notice info">Encaixe não aprovado. ${esc(area.urgency.note || '')}</div>` : ''}
      ${awaitingInitialPayment ? `
        <section class="card payment-priority">
          <div class="payment-priority-top">
            <div>
              <span class="eyebrow">${area.urgency ? 'Encaixe aprovado' : 'Pagamento agora'}</span>
              <strong
                id="paymentDueNow"
                class="payment-priority-total"
                data-pix="${pixDueCents}"
                data-card="${totalCents}"
              >${money(dueNowCents)}</strong>
            </div>
            <small id="paymentDueLabel">${isPix ? 'Pix • entrada de 50%' : 'Cartão • pagamento integral'}</small>
          </div>

          <p
            id="paymentBreakdown"
            class="muted"
            data-total="${totalCents}"
            data-balance="${pixBalanceCents}"
          >${isPix
            ? `Total do pedido: ${money(totalCents)} • saldo após a entrada: ${money(pixBalanceCents)}`
            : `Total do pedido: ${money(totalCents)}`}</p>

          <button
            class="btn btn-ghost"
            id="togglePaymentMethod"
            type="button"
          >
            Trocar forma de pagamento
          </button>

          <div
            id="paymentMethodChooser"
            class="payment-methods hidden"
          >
            <label><input type="radio" name="resumeMethod" value="pix" ${isPix ? 'checked' : ''}> Pix • entrada de 50%</label>
            <label><input type="radio" name="resumeMethod" value="card" ${!isPix ? 'checked' : ''}> Cartão • 100%</label>
          </div>

          ${area.urgency ? `<p class="muted">O adicional de ${urgencyPercent}% já está incluído no total.</p>` : ''}

          ${termsAlreadyAccepted ? '<div class="notice success compact-notice">Condições já aceitas ✓</div>' : `<label class="checkline"><input type="checkbox" id="resumeTerms"> Li e aceito as condições do pedido.</label><button class="btn btn-ghost" id="resumeReadTerms">Ler condições</button>`}

          <button class="btn btn-primary payment-main-cta" id="resumePayment">Pagar agora</button>
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
                ? 'Seu pagamento já foi confirmado. A Libri está revisando a janela de entrega antes de liberar o briefing.'
                : 'O briefing será liberado assim que o pagamento for confirmado. Se você acabou de pagar, pode atualizar esta página em alguns instantes.'}
            </div>
          `
          : area.briefing.completed
            ? `
              <div class="notice success section-block">
                Briefing enviado ✓
              </div>
            `
            : `
              <div class="notice section-block">
                Seu briefing está ${area.briefing.progress}% preenchido.
              </div>
            `
      }
    </section>
  `;
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
          <span class="eyebrow">Briefing</span>
          <h1 class="page-title">${capacityReview ? 'Pagamento confirmado' : 'Aguardando pagamento'}</h1>
          <p class="page-subtitle">
            ${capacityReview
              ? 'A Libri está revisando sua janela de entrega. O briefing será liberado assim que essa revisão terminar.'
              : 'Assim que o pagamento for confirmado, o briefing criativo é liberado aqui.'}
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
    <section class="page-card">
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
                    Enviar briefing
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
                  playsinline
                  preload="metadata"
                  src="${esc(preview.contentPath)}"
                ></video>
              `
              : `
                <img
                  class="preview-media"
                  src="${esc(preview.contentPath)}"
                  alt="Prévia do convite"
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

  async function render() {
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
          ${tabButtons(area, activeTab)}
          <div id="customerMain">
            ${body}
          </div>
        </div>
      </div>
    `;

    setHelp(
      area.support.whatsappUrl,
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

    document
      .getElementById(
        'togglePaymentMethod',
      )
      ?.addEventListener(
        'click',
        () => {
          document
            .getElementById(
              'paymentMethodChooser',
            )
            ?.classList
            .toggle(
              'hidden',
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

                breakdown.textContent =
                  method === 'pix'
                    ? `Total do pedido: ${orderTotal} • saldo após a entrada: ${balance}`
                    : `Total do pedido: ${orderTotal}`;
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
    document.getElementById('resumePayment')?.addEventListener('click', async event => {
      const needsTerms = area.payment?.termsAccepted !== true;
      const termsControl = document.getElementById('resumeTerms');
      if (needsTerms && !termsControl?.checked) { showToast('Leia e aceite as condições.'); return; }
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const payload = { clientRequestId: randomId(),
          paymentMethod: document.querySelector('[name="resumeMethod"]:checked')?.value || area.payment.method };
        if (needsTerms) {
          const terms = await loadTerms();
          payload.termsAccepted = true;
          payload.termsVersion = terms.version;
        }
        const result = await api(`/api/v2/customer-area/${token}/payment`, {
          method: 'POST', body: JSON.stringify(payload),
        });
        if (result.alreadyPaid) {
          area = await loadArea(); await render();
          showToast(result.capacityReview ? 'Pagamento recebido. A Libri está revisando sua janela.' : 'Pagamento confirmado.');
        } else if (result.payment?.checkoutUrl) window.location.href = result.payment.checkoutUrl;
        else throw new Error('Pagamento indisponível. Atualize o pedido.');
      } catch (error) {
        button.disabled = false; showToast(error.message);
        if (error.data?.code === 'terms_changed') { paymentTerms = null; if (termsControl) termsControl.checked = false; }
      }
    });

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

  const autosave =
    debounce(
      async (
        currentSection,
        patch,
      ) => {
        try {
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

          area.briefing.data =
            data.result.data;

          area.briefing.progress =
            data.result.progress;

          area.briefing.schema =
            data.result.schema;

          area.briefing.currentSection =
            data.result.currentSection;
        } catch (error) {
          showToast(
            `Não foi possível salvar: ${error.message}`,
          );
        }
      },
      450,
    );

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

              await autosave(
                sectionId,
                {
                  [key]:
                    value,
                },
              );

              if (
                control.type
                === 'radio'
                || control.dataset.multi
                === '1'
              ) {
                area =
                  await loadArea();

                await render();
              }
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

              autosave(
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

    app
      .querySelectorAll(
        '[data-upload-field]',
      )
      .forEach(
        (input) => {
          input.addEventListener(
            'change',
            async () => {
              const file =
                input.files?.[0];

              if (!file) {
                return;
              }

              const form =
                new FormData();

              form.set(
                'fieldKey',
                input.dataset.uploadField,
              );

              form.set(
                'file',
                file,
              );

              input.disabled =
                true;

              showToast(
                'Enviando foto...',
              );

              try {
                await api(
                  `/api/v2/customer-area/${token}/briefing/uploads`,
                  {
                    method:
                      'POST',
                    body:
                      form,
                  },
                );

                area =
                  await loadArea();

                await render();

                showToast(
                  'Foto enviada ✓',
                );
              } catch (error) {
                input.disabled =
                  false;

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
          if (
            index <= 0
          ) {
            return;
          }

          const next =
            sections[index - 1];

          await api(
            `/api/v2/customer-area/${token}/briefing`,
            {
              method:
                'PATCH',
              body:
                JSON.stringify({
                  currentSection:
                    next.id,
                  data:
                    {},
                }),
            },
          );

          area =
            await loadArea();

          await render();
        },
      );

    document
      .getElementById(
        'briefingNext',
      )
      ?.addEventListener(
        'click',
        async () => {
          const next =
            sections[index + 1];

          if (!next) {
            return;
          }

          await api(
            `/api/v2/customer-area/${token}/briefing`,
            {
              method:
                'PATCH',
              body:
                JSON.stringify({
                  currentSection:
                    next.id,
                  data:
                    {},
                }),
            },
          );

          area =
            await loadArea();

          await render();
        },
      );

    document
      .getElementById(
        'briefingSubmit',
      )
      ?.addEventListener(
        'click',
        async () => {
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
              'Enviar briefing';

            const missing =
              error.data?.details?.fields
              || [];

            if (
              missing.length
            ) {
              modal(
                'Ainda falta um pouquinho',
                `
                  <div class="notice error">
                    ${missing.map(
                      (item) =>
                        `<div>• ${esc(item.message)}</div>`,
                    ).join('')}
                  </div>
                `,
              );

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

