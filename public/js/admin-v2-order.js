import {
  api,
  dateBr,
  dateTimeBr,
  esc,
  modal,
  money,
  showToast,
  statusClass,
} from './admin-v2-core.js';

function whatsappBr(value) {
  const digits =
    String(value || '')
      .replace(/\D/g, '');

  const local =
    digits.startsWith('55')
      ? digits.slice(2)
      : digits;

  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }

  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }

  return String(value || '');
}

function deliveryLabel(detail) {
  const start =
    detail.order
      ?.deliveryWindow
      ?.start;

  const end =
    detail.order
      ?.deliveryWindow
      ?.end;

  if (start && end) {
    return `${dateBr(start)} a ${dateBr(end)}`;
  }

  if (
    detail.urgency
    && detail.order.status === 'awaiting_urgency_decision'
  ) {
    return 'Em análise';
  }

  return 'A definir';
}

const ACTION_LABELS = {
  start_production:
    'Iniciar produção',
  waiting_customer:
    'Aguardar cliente',
  adjustments:
    'Mover para ajustes',
  approve:
    'Marcar aprovado',
  balance_received:
    'Saldo recebido',
  finalize:
    'Finalizar pedido',
  archive:
    'Arquivar pedido',
  unarchive:
    'Restaurar pedido',
};

function finalizeChecklistHtml(
  detail,
) {
  const checklist =
    detail.finalizeChecklist
    || {
      ready:
        false,
      items: [],
      manualConfirmationLabel:
        'Arquivo ou link final conferido e pronto para entrega',
    };

  const canReceiveBalance =
    (
      detail.allowedActions
      || []
    )
      .includes(
        'balance_received',
      );

  return `
    <div class="finalize-checklist">
      ${checklist.items.map(
        (item) => `
          <div class="finalize-check ${item.ok ? 'ok' : 'missing'}">
            <span>${item.ok ? '✓' : '!'}</span>

            <div class="finalize-check-copy">
              <strong>${esc(item.label)}</strong>

              ${
                !item.ok
                && item.code
                  === 'preview'
                  ? `
                    <small>
                      Se ela aprovou fora da área da cliente, registre a aprovação aqui.
                    </small>
                    <button
                      class="btn btn-secondary btn-small"
                      type="button"
                      data-checklist-preview-whatsapp
                    >
                      Marcar aprovada no WhatsApp
                    </button>
                  `
                  : ''
              }

              ${
                !item.ok
                && item.code
                  === 'payment'
                && canReceiveBalance
                  ? `
                    <small>
                      Se você já recebeu o restante por Pix, dê baixa sem sair desta tela.
                    </small>
                    <button
                      class="btn btn-secondary btn-small"
                      type="button"
                      data-checklist-balance-received
                    >
                      Marcar saldo recebido
                    </button>
                  `
                  : ''
              }
            </div>
          </div>
        `,
      ).join('')}
    </div>

    ${
      checklist.ready
        ? `
          <label class="checkline" style="margin-top:14px">
            <input
              id="finalDeliveryConfirmed"
              type="checkbox"
            >
            <span>
              ${esc(checklist.manualConfirmationLabel)}
            </span>
          </label>

          <div class="notice info" style="margin-top:12px">
            O sistema confirma automaticamente briefing, aprovação, saldo e prazo.
            Como o arquivo/link final não é armazenado como um item separado, esta última conferência é manual.
          </div>
        `
        : `
          <div class="notice info" style="margin-top:12px">
            Resolva as pendências acima. As que podem ser confirmadas pelo Admin já têm ação aqui mesmo.
          </div>
        `
    }

    <div class="action-row">
      <span></span>
      <button
        id="confirmFinalizeOrder"
        class="btn btn-success"
        type="button"
        ${checklist.ready ? '' : 'disabled'}
      >
        Finalizar pedido
      </button>
    </div>
  `;
}

function contractedBlock(
  detail,
) {
  const summary =
    detail.contractedSummary
    || {};

  const product =
    summary.product;

  const addons =
    summary.addons
    || [];

  return `
    <section class="card contracted-card">
      <div class="section-title">
        <div>
          <span class="eyebrow">Contratado</span>
          <h3 style="margin:4px 0 0">O que a cliente comprou</h3>
        </div>
      </div>

      ${
        product
          ? `
            <div class="contracted-main">
              <strong>${esc(product.name)}</strong>
              ${
                product.sceneCount
                  ? `<span>${Number(product.sceneCount)} cena(s)</span>`
                  : ''
              }
              <span>${money(product.priceCents)}</span>
            </div>
          `
          : '<div class="empty">Produto principal não identificado.</div>'
      }

      <div class="contracted-detail">
        <strong>Adicionais</strong>

        ${
          addons.length
            ? `
              <div class="contracted-tags">
                ${addons.map(
                  (addon) => `
                    <span>
                      ${esc(addon.name)}
                      <small>+${money(addon.priceCents)}</small>
                    </span>
                  `,
                ).join('')}
              </div>
            `
            : '<small>Nenhum adicional contratado.</small>'
        }
      </div>

      <div class="contracted-summary-grid">
        <div>
          <small>Combo</small>
          <strong>${esc(summary.combo?.name || 'Nenhum')}</strong>
        </div>

        <div>
          <small>Pagamento</small>
          <strong>${esc(summary.paymentMethod === 'card' ? 'Cartão' : 'Pix')}</strong>
        </div>

        <div>
          <small>Total</small>
          <strong>${money(detail.pricing.totalCents)}</strong>
        </div>
      </div>

      ${
        Number(detail.pricing.comboDiscountCents || 0) > 0
        || Number(detail.pricing.couponDiscountCents || 0) > 0
          ? `
            <small class="contracted-discount">
              Descontos:
              combo ${money(detail.pricing.comboDiscountCents || 0)}
              ${Number(detail.pricing.couponDiscountCents || 0) > 0
                ? ` • cupom ${money(detail.pricing.couponDiscountCents)}`
                : ''}
            </small>
          `
          : ''
      }
    </section>
  `;
}

function paymentBlock(detail) {
  const p =
    detail.payment;

  return `
    <section class="card">
      <div class="section-title">
        <h3>Pagamento</h3>
      </div>

      <div class="kpi-grid payment-kpi-grid">
        <div class="kpi">
          <span>Total</span>
          <strong>${money(detail.pricing.totalCents)}</strong>
        </div>

        <div class="kpi">
          <span>Pago</span>
          <strong>${money(p.paidCents)}</strong>
        </div>

        <div class="kpi">
          <span>Saldo</span>
          <strong>${money(p.remainingBalanceCents)}</strong>
        </div>
      </div>

      ${
        detail.pricing.paymentMethod === 'pix'
        && Number(p.paidCents || 0) > 0
        && Number(p.remainingBalanceCents || 0) > 0
          ? `<p class="muted" style="font-size:12px;margin-top:10px">
              Entrada recebida. A segunda parcela é cobrada por Pix no WhatsApp;
              registre o saldo no Financeiro somente depois de confirmar o crédito.
              Enviar a chave Pix não registra um pagamento.
            </p>`
          : ''
      }

      <div class="list" style="margin-top:12px">
        ${(p.payments || []).map(
          (item) => `
            <div class="row-card">
              <strong>
                ${esc(item.method || item.provider)}
                • ${money(item.amount_cents ?? item.amountCents)}
              </strong>

              <small>
                ${esc(item.status)}
                ${item.paid_at || item.paidAt ? ` • ${dateTimeBr(item.paid_at || item.paidAt)}` : ''}
              </small>
            </div>
          `,
        ).join('')}
      </div>
    </section>
  `;
}


function readableAnswer(value, definition) {
  const options = new Map((definition?.options || []).map(option => [option.value, option.label]));
  const defaults = { yes: 'Sim', no: 'Não', libri_decides: 'Deixo a Libri decidir' };
  const translate = item => options.get(item) || defaults[item] || String(item);
  if (Array.isArray(value)) return value.map(translate).join(', ');
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : translate(value);
}

function musicPreferenceBlock(detail) {
  const requested = String(detail.briefing?.data?.music_request || '').trim();
  if (detail.briefing?.data?.music_choice !== 'yes' || !requested) return '';
  const match = requested.match(/https?:\/\/[^\s<>"']+/i);
  let link = '';
  if (match) {
    try {
      const url = new URL(match[0]);
      if (url.protocol === 'https:' || url.protocol === 'http:') link = url.href;
    } catch {}
  }
  return `
    <div class="order-music-request">
      <strong>Música escolhida pela cliente</strong>
      <p>${esc(requested)}</p>
      ${link ? `<a class="btn btn-secondary btn-small" target="_blank" rel="noopener noreferrer"
        referrerpolicy="no-referrer" href="${esc(link)}">Abrir música ↗</a>` : ''}
    </div>
  `;
}

function productionQuickBlock(detail) {
  const product = detail.contractedSummary?.product || {};
  const data = detail.briefing?.data || {};
  const uploads = detail.uploads?.uploads || [];
  const count = field => uploads.filter(upload => upload.fieldKey === field).length;
  const selected = Array.isArray(data.interactive_resources) ? data.interactive_resources : [];
  const extra = [];
  if (data.gift_page_video === 'yes') extra.push('Página extra de presentes após o vídeo');
  else if (selected.includes('gifts')) extra.push('Presentes no convite interativo');
  if (selected.includes('location')) extra.push('Localização');
  if (selected.includes('simple_rsvp')) extra.push('Confirmação simples');
  const speech = {
    libri_writes: 'Libri cria as falas',
    customer_text: 'Fala enviada pela cliente',
    no_speech: 'Sem falas',
  }[data.speech_preference] || 'Não se aplica';
  const music = {
    yes: data.music_request ? 'Escolhida pela cliente: ' + data.music_request : 'Sim, Libri escolhe',
    no: 'Sem música',
    libri_decides: 'Libri decide',
  }[data.music_choice] || 'Não informada';
  const items = [
    ['Formato', product.name || 'Não identificado'],
    ['Cenas', Number(product.sceneCount) > 0 ? String(product.sceneCount) : 'Não se aplica'],
    ['Falas', speech],
    ['Música', music],
    ['Fotos da pessoa', String(count('person_photos'))],
    ['Fotos de roupas', String(count('outfit_photos'))],
    ['Referências', String(count('reference_files'))],
    ['Páginas e opções extras', extra.join(' • ') || 'Nenhuma selecionada'],
  ];
  return `
    <section class="card" id="orderProductionQuick">
      <div class="section-title">
        <div>
          <span class="eyebrow">Produção em um olhar</span>
          <h3>Resumo para criar o convite</h3>
        </div>
        <span class="status">${Number(detail.briefing?.completionPercent || 0)}% dos dados</span>
      </div>
      <div class="production-quick-grid">
        ${items.map(([label, value]) => `
          <div class="production-quick-cell">
            <small>${esc(label)}</small>
            <strong>${esc(value)}</strong>
          </div>`).join('')}
      </div>
    </section>
  `;
}

function briefingBlock(detail) {
  const definitions = new Map((detail.briefing.fields || []).map(item => [item.key, item]));
  const fallbackLabels = {
    avoid_colors: 'Cores que a cliente não quer',
    must_avoid: 'O que evitar no convite',
    must_have: 'O que não pode faltar',
  };
  const groups = new Map();
  for (const [key, value] of Object.entries(detail.briefing.data || {})) {
    if (value === null || value === undefined || value === ''
      || (Array.isArray(value) && value.length === 0)) continue;
    const definition = definitions.get(key);
    const section = definition?.section || 'Outras informações';
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push({
      label: definition?.label || fallbackLabels[key] || key.replaceAll('_', ' '),
      text: readableAnswer(value, definition),
    });
  }

  return `
    <section class="card">
      <div class="section-title">
        <h3>Dados enviados pela cliente</h3>
        <span class="status">${detail.briefing.completionPercent}% preenchido</span>
      </div>
      ${groups.size ? [...groups.entries()].map(([section, items]) => `
        <div class="order-answer-group">
          <h4>${esc(section)}</h4>
          <div class="order-answer-grid">
            ${items.map(item => `
              <div class="order-answer-item">
                <strong>${esc(item.label)}</strong>
                <p>${esc(item.text)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('') : '<div class="empty">A cliente ainda não preencheu os dados do convite.</div>'}
      ${musicPreferenceBlock(detail)}
      <div class="order-quick-actions">
        <button id="copyProduction" class="btn btn-secondary" type="button">
          Copiar dados do pedido
        </button>
        <button id="copyFull" class="btn btn-ghost" type="button">
          Copiar ficha completa
        </button>
      </div>
    </section>
  `;
}

function orderUploadsBlock(detail) {
  const files = detail.uploads?.uploads || [];
  const labels = {
    person: 'Fotos da pessoa',
    outfit: 'Fotos da roupa',
    reference: 'Inspirações e referências',
  };
  const contentPath = file =>
    '/api/admin/v2/orders/' + encodeURIComponent(detail.order.code)
      + '/uploads/' + Number(file.id) + '/content';
  const supported = file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType);

  return `
    <section class="card" id="adminOrderPhotos">
      <div class="section-title">
        <div>
          <h3>Fotos e referências recebidas</h3>
          <small class="order-gallery-hint">Abra cada imagem sem precisar baixar a pasta.</small>
        </div>
        <span class="status">${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}</span>
      </div>
      ${files.length ? `
        <div class="order-photo-grid">
          ${files.map((file, index) => `
            <article class="order-photo-card">
              <button type="button" class="order-photo-open" data-order-photo="${index}"
                aria-label="Ver arquivo ${esc(file.originalFilename)}">
                ${supported(file) ? `
                  <img src="${esc(contentPath(file))}" loading="lazy"
                    alt="${esc(file.fieldLabel || labels[file.category] || 'Foto enviada')}"
                    decoding="async">
                ` : '<span class="order-photo-fallback">Arquivo de imagem</span>'}
              </button>
              <div class="order-photo-details">
                <small>${esc(file.fieldLabel || labels[file.category] || 'Imagem enviada')}</small>
                <strong title="${esc(file.originalFilename)}">${esc(file.originalFilename)}</strong>
                ${file.note ? `<p>${esc(file.note)}</p>` : ''}
                <a class="btn btn-ghost btn-small" href="${esc(contentPath(file))}?download=1">
                  Baixar original
                </a>
              </div>
            </article>
          `).join('')}
        </div>
      ` : '<div class="empty">A cliente ainda não enviou fotos ou referências.</div>'}
      <dialog class="order-photo-viewer" id="orderPhotoViewer" aria-label="Visualização da foto">
        <div class="order-photo-viewer-head">
          <strong id="orderPhotoViewerTitle">Foto enviada</strong>
          <button class="btn btn-ghost" type="button" id="orderPhotoViewerClose">Fechar</button>
        </div>
        <div class="order-photo-viewer-scroll" id="orderPhotoViewerScroll">
          <img id="orderPhotoViewerImg" alt="Foto anexada pela cliente">
        </div>
        <p id="orderPhotoViewerNote"></p>
        <div class="order-photo-viewer-controls">
          <button class="btn btn-ghost" id="orderPhotoPrev" type="button">← Anterior</button>
          <span id="orderPhotoViewerCount" aria-live="polite"></span>
          <button class="btn btn-ghost" id="orderPhotoNext" type="button">Próxima →</button>
          <button class="btn btn-ghost" id="orderPhotoZoom" type="button"
            aria-pressed="false">Ampliar</button>
          <a class="btn btn-secondary" id="orderPhotoViewerDownload" href="#">Baixar original</a>
        </div>
      </dialog>
    </section>
  `;
}

function historyBlock(detail) {
  return `
    <section class="card">
      <div class="section-title">
        <h3>Histórico</h3>
      </div>

      <div class="list">
        ${(detail.history || []).slice(0, 30).map(
          (item) => `
            <div class="row-card">
              <strong>${esc(item.description)}</strong>
              <small>
                ${dateTimeBr(item.createdAt)}
                • ${esc(item.actionCode)}
              </small>
            </div>
          `,
        ).join('')}
      </div>
    </section>
  `;
}

async function writeClipboard(value) {
  if (
    navigator.clipboard
      ?.writeText
  ) {
    await navigator.clipboard.writeText(
      value,
    );

    return;
  }

  const area =
    document.createElement('textarea');

  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';

  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

export async function openOrder(code, onChanged = null) {
  const data =
    await api(
      `/api/admin/v2/orders/${code}`,
    );

  let detail =
    data.detail;

  const canDelete =
    Number(
      detail.payment?.paidCents
      || 0,
    ) === 0
    && [
      'awaiting_urgency_decision',
      'urgency_approved',
      'awaiting_payment',
      'cancelled',
    ].includes(
      detail.order.status,
    );

  const quickMessages =
    detail.whatsappActions
    || [];

  const close =
    modal(
      `${detail.order.code} • ${detail.order.honoreeName}`,
      `
        <div class="section-grid">
          <section class="card">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <span class="status ${statusClass(detail.order.status)}">
                ${esc(detail.order.statusLabel)}
              </span>

              ${
                detail.order.risk
                  ? `
                    <span class="risk-badge risk-${esc(detail.order.risk.level)}">
                      Prazo: ${esc(detail.order.risk.label)}
                    </span>
                  `
                  : ''
              }
            </div>

            ${
              detail.order.risk?.reason
                ? `<small class="risk-reason">${esc(detail.order.risk.reason)}</small>`
                : ''
            }

            <h2 style="margin:10px 0 5px">
              ${esc(detail.order.honoreeName)}
            </h2>

            <div class="order-meta">
              Cliente: ${esc(detail.order.customerName)}<br>
              WhatsApp: ${esc(whatsappBr(detail.order.whatsapp))}<br>
              Festa: ${dateBr(detail.order.eventDate)}<br>
              Entrega: ${esc(deliveryLabel(detail))}<br>
              Próximo: ${esc(detail.order.nextAction || 'A definir')}
            </div>

            <div class="order-quick-actions">
              <button id="toggleOrderBriefing" class="btn btn-primary" type="button"
                aria-controls="orderBriefingPanel" aria-expanded="false">
                Abrir briefing
              </button>
              ${(detail.allowedActions || []).includes('finalize') ? `
                <button type="button" class="btn btn-success" data-order-action="finalize">
                  Finalizar pedido
                </button>
              ` : ''}
              <a
                class="btn btn-secondary"
                href="https://wa.me/${esc(String(detail.order.whatsapp || '').replace(/\D/g,''))}"
                target="_blank"
                rel="noopener"
              >
                WhatsApp
              </a>

              <button type="button" class="btn btn-ghost"
                id="toggleOrderPreview">Ver prévia</button>
            </div>

            ${
              quickMessages.length
                ? `
                  <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
                    <strong style="display:block;margin-bottom:8px">
                      Mensagens rápidas
                    </strong>

                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                      ${quickMessages.map(
                        (item) => `
                          <a
                            class="btn btn-ghost btn-small"
                            href="${esc(item.url || '#')}"
                            target="_blank"
                            rel="noopener"
                          >
                            ${esc(item.label)}
                          </a>
                        `,
                      ).join('')}
                    </div>
                  </div>
                `
                : ''
            }
          </section>

          ${productionQuickBlock(detail)}

          <details class="order-optional card">
            <summary>Ver contratação e pagamentos</summary>
            <div class="section-grid">
              ${contractedBlock(detail)}
              ${paymentBlock(detail)}
            </div>
            <div class="order-quick-actions">
              <a class="btn btn-ghost"
                href="/api/admin/v2/orders/${esc(detail.order.code)}/download-folder">
                Baixar pasta ZIP
              </a>
              <a class="btn btn-ghost" href="${esc(detail.order.customerAreaPath || '#')}"
                target="_blank" rel="noopener">Área da cliente</a>
            </div>
          </details>
        </div>

        ${detail.order.status === 'awaiting_urgency_decision' ? `
          <section class="card">
            <h3>Análise de encaixe urgente</h3>
            <p>Adicional de ${detail.pricing.urgencyPercent || 30}% após os descontos. A capacidade será conferida novamente no pagamento.</p>
            <label>Início da entrega <input class="input" id="urgencyStart" type="date"></label>
            <label>Fim da entrega <input class="input" id="urgencyEnd" type="date"></label>
            <label>Observação / motivo da rejeição <textarea class="textarea" id="urgencyNote"></textarea></label>
            <button class="btn btn-primary" data-urgency-decision="approve">Aprovar encaixe</button>
            <button class="btn btn-danger" data-urgency-decision="reject">Rejeitar encaixe</button>
          </section>` : ''}

        <section id="orderBriefingPanel" class="order-briefing-panel hidden"
          aria-label="Dados enviados pela cliente">
          ${orderUploadsBlock(detail)}
          <div class="section-grid">
            ${briefingBlock(detail)}
          </div>
        </section>

        <div class="section-grid">
          <section class="card">
            <details class="order-optional">
              <summary>Outras ações e observações</summary>
            <div class="section-title">
              <h3>Ações</h3>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${(detail.allowedActions || [])
                .filter(action => !['finalize','balance_received'].includes(action))
                .map(
                (action) => `
                  <button
                    class="btn ${
                      action === 'finalize'
                        ? 'btn-success'
                        : action === 'balance_received'
                          ? 'btn-warning'
                          : action === 'archive'
                            || action === 'unarchive'
                            ? 'btn-ghost'
                            : 'btn-primary'
                    }"
                    type="button"
                    data-order-action="${esc(action)}"
                  >
                    ${esc(ACTION_LABELS[action] || action)}
                  </button>
                `,
              ).join('')}
            </div>

            ${canDelete ? `
              <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">
                <button
                  id="deleteOrder"
                  class="btn btn-danger"
                  type="button"
                >
                  Excluir pedido
                </button>
                <small style="display:block;margin-top:7px">
                  Disponível somente antes de qualquer pagamento confirmado.
                </small>
              </div>
            ` : ''}

            ${!['cancelled','finalized'].includes(detail.order.status) ? `
              <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">
                <strong>Cancelar pedido</strong>
                <div class="form-grid" style="margin-top:9px">
                  <div class="field">
                    <label for="cancelReason">Motivo</label>
                    <select id="cancelReason" class="select">
                      <option value="">Selecione</option>
                      <option value="Não realizou pagamento">Não realizou pagamento</option>
                      <option value="Cliente desistiu">Cliente desistiu</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="cancelNote">Observação</label>
                    <input
                      id="cancelNote"
                      class="input"
                      placeholder="Obrigatória somente em Outro"
                    >
                  </div>
                </div>
                <button
                  id="cancelOrder"
                  class="btn btn-danger"
                  type="button"
                >
                  Cancelar pedido
                </button>
                <small style="display:block;margin-top:7px">
                  A vaga é liberada e checkouts pendentes são cancelados. Pagamentos já aprovados não são estornados automaticamente.
                </small>
              </div>
            ` : ''}

            <div class="field" style="margin-top:16px">
              <label for="internalNote">
                Observação interna
              </label>
              <textarea
                id="internalNote"
                class="textarea"
                placeholder="Só você vê isso."
              ></textarea>

              <button
                id="saveInternalNote"
                class="btn btn-ghost"
                type="button"
              >
                Salvar observação
              </button>
            </div>

            <div class="list" style="margin-top:12px">
              ${(detail.notes || []).map(
                (note) => `
                  <div class="row-card">
                    <strong>${esc(note.note)}</strong>
                    <small>${dateTimeBr(note.createdAt)}</small>
                  </div>
                `,
              ).join('')}
            </div>
            </details>
          </section>
        </div>

        <details class="order-optional card" id="orderPreviewDetails">
          <summary>Prévia, contratos e histórico</summary>
          <div class="section-grid">
          <section class="card">
            <div class="section-title">
              <h3>Prévia</h3>
              <span class="status">${(detail.previews || []).length}</span>
              <button type="button" class="btn btn-ghost btn-small" id="downloadProjectBible" title="Baixar histórico das prévias aprovadas">Project Bible</button>

            </div>
              <details class="order-optional" id="driveFolderOptions" style="width:100%;margin-top:10px">
                <summary>Google Drive · pasta deste pedido</summary>
                <div class="field" style="margin-top:12px">
                  <label for="orderDriveFolderId">Link da pasta da cliente</label>
                  <input class="input" id="orderDriveFolderId" autocomplete="off" placeholder="Cole o link completo da pasta no Drive">
                </div>
                <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                  <button type="button" class="btn btn-secondary btn-small" id="saveOrderDriveFolder">Vincular pasta</button>
                  <button type="button" class="btn btn-ghost btn-small" id="createOrderDriveFolder">Criar pasta no meu Drive</button>
                  <button type="button" class="btn btn-ghost btn-small" id="syncApprovedPreview">Enviar última prévia aprovada</button>
                  <button type="button" class="btn btn-ghost btn-small" id="connectOrderDrive">Conectar Google Drive</button>
                </div>
                <label id="driveAutoSyncControl" class="checkline" style="margin-top:9px" hidden>
                  <input id="driveAutoSyncEnabled" type="checkbox">
                  <span>Sincronizar novas prévias aprovadas automaticamente</span>
                </label>
                <small id="orderDriveStatus" aria-live="polite">Verificando conexão…</small>
                <div class="notice info" style="margin-top:9px">
                  A pasta fica exclusiva deste pedido. O vínculo não envia arquivos:
                  a transferência só será ativada quando o Google autorizar e a mídia aprovada estiver identificada.
                </div>
              </details>

            ${['in_production','adjustments','waiting_customer'].includes(detail.order.status) ? `
            <div class="field">
              <label for="previewFile">Arquivo da prévia</label>
              <input
                id="previewFile"
                class="input"
                type="file"
                accept="video/mp4,video/webm,image/jpeg,image/png,image/webp"
              >
            </div>

            <div class="field" style="margin-top:10px">
              <label for="previewWatermark">Texto da marca d'água</label>
              <input
                id="previewWatermark"
                class="input"
                value="PRÉVIA • ${esc(detail.order.code)}"
              >
            </div>

            <label class="checkline" style="margin-top:10px">
              <input id="previewProtected" type="checkbox">
              <span>Confirmei que este arquivo é a cópia de prévia, já comprimida e com marca d'água.</span>
            </label>

            <button
              id="publishPreview"
              class="btn btn-primary"
              type="button"
              style="margin-top:10px"
            >
              Publicar prévia
            </button>
            ` : `
              <div class="notice info">
                A publicação de prévia é liberada quando o pedido estiver em produção ou ajustes.
              </div>
            `}

            ${
              !detail.finalizeChecklist
                ?.items
                ?.find(
                  item =>
                    item.code
                    === 'preview',
                )
                ?.ok
                ? `
                  <div class="notice info" style="margin-top:12px">
                    A cliente aprovou pelo WhatsApp?
                    <button
                      class="btn btn-secondary btn-small"
                      type="button"
                      data-preview-approve-whatsapp
                      style="margin-top:8px"
                    >
                      Registrar aprovação no WhatsApp
                    </button>
                  </div>
                `
                : ''
            }

            <div class="list" style="margin-top:14px">
              ${(detail.previews || []).map(
                (preview) => `
                  <div class="row-card">
                    <strong>
                      v${preview.version} • ${esc({
                        active: 'Ativa',
                        approved: 'Aprovada',
                        expired: 'Expirada',
                        replaced: 'Substituída',
                        revoked: 'Revogada',
                      }[preview.status] || preview.status)}
                    </strong>

                    <small>
                      ${esc(preview.mediaType)}
                      ${preview.expiresAt ? ` • expira ${dateTimeBr(preview.expiresAt)}` : ''}
                      ${preview.approvedAt ? ` • aprovada ${dateTimeBr(preview.approvedAt)}` : ''}
                    </small>

                    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px">
                      ${preview.status === 'expired' ? `
                        <button
                          class="btn btn-secondary"
                          type="button"
                          data-preview-reactivate="${preview.id}"
                        >
                          Reativar
                        </button>
                      ` : ''}

                      ${['active','expired'].includes(preview.status) ? `
                        <button
                          class="btn btn-ghost"
                          type="button"
                          data-preview-revoke="${preview.id}"
                        >
                          Retirar prévia
                        </button>
                      ` : ''}
                    </div>
                  </div>
                `,
              ).join('') || '<div class="empty">Nenhuma prévia publicada.</div>'}
            </div>
          </section>

          <section class="card">
            <div class="section-title">
              <h3>Contratos</h3>
            </div>

            <div id="contractArea"></div>

            <button
              id="generateContract"
              class="btn btn-secondary"
              type="button"
              style="margin-top:10px"
            >
              Gerar contrato
            </button>
          </section>
        </div>

        <div style="margin-top:14px">
          ${historyBlock(detail)}
        </div>
        </details>
      `,
      {
        width: '1100px',
      },
    );

  const driveFolderPanel=document.getElementById('driveFolderOptions');
  const driveLinkInput=document.getElementById('orderDriveFolderId');
  const driveStatus=document.getElementById('orderDriveStatus');
  const connectDriveButton=document.getElementById('connectOrderDrive');
  const createFolderButton=document.getElementById('createOrderDriveFolder');
  const syncPreviewButton=document.getElementById('syncApprovedPreview');
  const autoSyncToggle=document.getElementById('driveAutoSyncEnabled');
  const autoSyncControl=document.getElementById('driveAutoSyncControl');
  driveFolderPanel?.addEventListener('toggle',async ()=>{
    if(!driveFolderPanel.open)return;
    try{
      const [folder,account,sync]=await Promise.all([
        api('/api/admin/v2/orders/'+encodeURIComponent(detail.order.code)+'/drive-folder'),
        api('/api/admin/v2/drive/status'),
        api('/api/admin/v2/drive/sync')
      ]);
      if(folder?.drive?.folderId)driveLinkInput.value=
        'https://drive.google.com/drive/folders/'+folder.drive.folderId;
      const info=account?.drive||{};
      driveStatus.textContent=info.connected?'Google Drive autorizado. Vincule uma pasta exclusiva.':
        info.configured?'Google Drive disponível, mas falta autorizar sua conta.':
        'Integração OAuth ainda não configurada no Worker.';
      connectDriveButton.hidden=!info.configured||info.connected;
      createFolderButton.hidden=!info.connected;
      syncPreviewButton.hidden=!info.connected;
      syncPreviewButton.disabled=!(detail.previews||[]).some(preview=>preview.status==='approved');
      autoSyncControl.hidden=!info.connected;
      autoSyncToggle.checked=Boolean(sync?.sync?.enabled);
    }catch(error){driveStatus.textContent=error.message||'Erro ao consultar vínculo.';}
  });
  document.getElementById('saveOrderDriveFolder')?.addEventListener('click',async event=>{
    const button=event.currentTarget;
    button.disabled=true;
    try{
      const result=await api('/api/admin/v2/orders/'+encodeURIComponent(detail.order.code)+'/drive-folder',{
        method:'PUT',body:JSON.stringify({folderId:driveLinkInput.value})
      });
      driveStatus.textContent='Pasta vinculada ao pedido. Envio ainda não ativado.';
      showToast('Pasta do Drive vinculada com segurança.');
    }catch(error){showToast(error.message||'Não foi possível vincular pasta.');}
    finally{button.disabled=false;}
  });
  autoSyncToggle?.addEventListener('change',async()=>{
    const enabled=autoSyncToggle.checked;
    if(enabled&&!confirm('Ativar envio automático de NOVAS prévias aprovadas para as pastas vinculadas? Não inclui arquivos antigos nem cenas aprovadas fora do Pedidos.')){
      autoSyncToggle.checked=false;
      return;
    }
    autoSyncToggle.disabled=true;
    try{
      const result=await api('/api/admin/v2/drive/sync',{
        method:'PUT',body:JSON.stringify({enabled})
      });
      autoSyncToggle.checked=Boolean(result?.sync?.enabled);
      driveStatus.textContent=autoSyncToggle.checked?
        'Automação ativada: novas prévias aprovadas serão enviadas em ciclos seguros.':
        'Envio automático desativado.';
      showToast(autoSyncToggle.checked?'Sincronização Drive ativada.':'Sincronização Drive desativada.');
    }catch(error){
      autoSyncToggle.checked=!enabled;
      showToast(error.message||'Não foi possível atualizar a sincronização.');
    }finally{autoSyncToggle.disabled=false;}
  });
  createFolderButton?.addEventListener('click',async()=>{
    createFolderButton.disabled=true;
    try{
      const data=await api('/api/admin/v2/orders/'+encodeURIComponent(detail.order.code)+'/drive/create-folder',{
        method:'POST',body:JSON.stringify({})
      });
      const id=data?.folder?.folderId;
      if(!id)throw Error('Drive não retornou pasta.');
      driveLinkInput.value='https://drive.google.com/drive/folders/'+id;
      driveStatus.textContent='Pasta pronta. Arquivos só serão enviados após aprovação.';
      showToast('Pasta criada e vinculada no Drive.');
    }catch(error){showToast(error.message||'Não foi possível criar a pasta.');}
    finally{createFolderButton.disabled=false;}
  });
  syncPreviewButton?.addEventListener('click',async()=>{
    const approved=(detail.previews||[]).filter(p=>p.status==='approved');
    const last=approved.sort((a,b)=>Number(b.version)-Number(a.version))[0];
    if(!last){showToast('Ainda não há prévia aprovada para enviar.');return;}
    syncPreviewButton.disabled=true;
    try{
      const data=await api('/api/admin/v2/orders/'+encodeURIComponent(detail.order.code)+'/drive/upload-approved-preview',{
        method:'POST',body:JSON.stringify({previewId:Number(last.id)})
      });
      if(!data?.upload?.fileId)throw Error('Drive não confirmou envio.');
      driveStatus.textContent='Prévia v'+last.version+' confirmada no Google Drive.';
      showToast(data.upload.alreadyUploaded?'Prévia já estava salva no Drive.':
        'Prévia aprovada enviada ao Drive ✓');
    }catch(error){showToast(error.message||'Falha ao enviar ao Drive.');}
    finally{syncPreviewButton.disabled=false;}
  });
  connectDriveButton?.addEventListener('click',async()=>{
    connectDriveButton.disabled=true;
    try{
      const response=await api('/api/admin/v2/drive/oauth/start',{
        method:'POST',body:JSON.stringify({})
      });
      const u=new URL(response.authorizationUrl);
      if(u.protocol!=='https:'||u.hostname!=='accounts.google.com')throw Error('Endereço de autorização inválido.');
      window.location.assign(u.href);
    }catch(error){
      driveStatus.textContent=error.message||'Não foi possível conectar o Google Drive.';
      connectDriveButton.disabled=false;
    }
  });

  document.getElementById('downloadProjectBible')?.addEventListener('click',async event=>{
    const button=event.currentTarget;
    button.disabled=true;
    try{
      const result=await api('/api/admin/v2/orders/'+encodeURIComponent(detail.order.code)+'/project-bible');
      const data=result?.projectBible;
      if(!data)throw Error('Histórico ainda não disponível.');
      const blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;
      link.download='Project_Bible_'+detail.order.code+'.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
      showToast('Project Bible exportado com as prévias aprovadas.');
    }catch(error){showToast(error.message||'Não foi possível exportar Project Bible.');}
    finally{button.disabled=false;}
  });

  const briefingToggle = document.getElementById('toggleOrderBriefing');
  briefingToggle?.addEventListener('click', () => {
    const panel = document.getElementById('orderBriefingPanel');
    if (!panel) return;
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    briefingToggle.setAttribute('aria-expanded', String(opening));
    briefingToggle.textContent = opening ? 'Fechar briefing' : 'Abrir briefing';
    if (opening) panel.scrollIntoView({behavior: 'smooth', block: 'start'});
  });
  document.getElementById('toggleOrderPreview')?.addEventListener('click', () => {
    const panel = document.getElementById('orderPreviewDetails');
    if (!panel) return;
    panel.open = true;
    panel.scrollIntoView({behavior: 'smooth', block: 'start'});
  });

  const photos = detail.uploads?.uploads || [];
  const photoViewer = document.getElementById('orderPhotoViewer');
  const displayable = file => ['image/jpeg', 'image/png', 'image/webp'].includes(file?.mimeType);
  const galleryIndices = photos.map((file, i) => displayable(file) ? i : -1).filter(i => i >= 0);
  const mediaUrl = file => '/api/admin/v2/orders/' + encodeURIComponent(detail.order.code)
    + '/uploads/' + Number(file.id) + '/content';
  let activeGalleryPosition = 0;
  const image = document.getElementById('orderPhotoViewerImg');
  const zoom = document.getElementById('orderPhotoZoom');
  const scroll = document.getElementById('orderPhotoViewerScroll');

  const setZoom = enabled => {
    scroll?.classList.toggle('is-zoomed', enabled);
    zoom?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    if (zoom) zoom.textContent = enabled ? 'Ajustar à tela' : 'Ampliar';
    if (scroll) scroll.scrollTop = scroll.scrollLeft = 0;
  };
  const displayPhoto = position => {
    if (!galleryIndices.length) return;
    activeGalleryPosition = (position + galleryIndices.length) % galleryIndices.length;
    const file = photos[galleryIndices[activeGalleryPosition]];
    const path = mediaUrl(file);
    setZoom(false);
    image.src = path;
    image.alt = file.fieldLabel || file.originalFilename || 'Foto enviada';
    document.getElementById('orderPhotoViewerTitle').textContent = file.originalFilename;
    document.getElementById('orderPhotoViewerNote').textContent = file.note || '';
    document.getElementById('orderPhotoViewerDownload').href = path + '?download=1';
    document.getElementById('orderPhotoViewerCount').textContent =
      (activeGalleryPosition + 1) + ' de ' + galleryIndices.length;
    document.getElementById('orderPhotoPrev').disabled = galleryIndices.length < 2;
    document.getElementById('orderPhotoNext').disabled = galleryIndices.length < 2;
  };
  const movePhoto = step => displayPhoto(activeGalleryPosition + step);

  document.querySelectorAll('[data-order-photo]').forEach(button => {
    button.addEventListener('click', () => {
      const file = photos[Number(button.dataset.orderPhoto)];
      if (!file) return;
      if (!displayable(file) || !photoViewer?.showModal) {
        window.open(mediaUrl(file), '_blank', 'noopener');
        return;
      }
      displayPhoto(galleryIndices.indexOf(Number(button.dataset.orderPhoto)));
      photoViewer.showModal();
    });
  });
  document.getElementById('orderPhotoPrev')?.addEventListener('click', () => movePhoto(-1));
  document.getElementById('orderPhotoNext')?.addEventListener('click', () => movePhoto(1));
  zoom?.addEventListener('click', () => setZoom(!scroll.classList.contains('is-zoomed')));
  document.getElementById('orderPhotoViewerClose')?.addEventListener('click', () => photoViewer?.close());
  photoViewer?.addEventListener('click', event => {
    if (event.target === photoViewer) photoViewer.close();
  });
  photoViewer?.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      movePhoto(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  let touchStart = null;
  scroll?.addEventListener('touchstart', event => {
    if (event.touches.length === 1) {
      touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
  }, { passive: true });
  scroll?.addEventListener('touchend', event => {
    if (!touchStart || scroll.classList.contains('is-zoomed')) return;
    const dx = event.changedTouches[0].clientX - touchStart.x;
    const dy = event.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5) movePhoto(dx < 0 ? 1 : -1);
  }, { passive: true });
  photoViewer?.addEventListener('close', () => {
    setZoom(false);
    if (image) image.removeAttribute('src');
  });

  document.querySelectorAll('[data-urgency-decision]').forEach(button => {
    button.addEventListener('click', async () => {
      const buttons = [...document.querySelectorAll('[data-urgency-decision]')];
      buttons.forEach(x => { x.disabled = true; });
      try {
        await api(`/api/admin/v2/orders/${code}/urgency`, { method: 'POST', body: JSON.stringify({
          decision: button.dataset.urgencyDecision,
          deliveryStart: document.getElementById('urgencyStart').value,
          deliveryEnd: document.getElementById('urgencyEnd').value,
          note: document.getElementById('urgencyNote').value,
        }) });
        close();
        if (onChanged) await onChanged();
        await openOrder(code, onChanged);
        showToast('Decisão de encaixe registrada.');
      } catch (error) { showToast(error.message); buttons.forEach(x => { x.disabled = false; }); }
    });
  });

  document
    .getElementById('publishPreview')
    ?.addEventListener(
      'click',
      async (event) => {
        const file =
          document
            .getElementById('previewFile')
            ?.files
            ?.[0];

        if (!file) {
          showToast('Selecione a prévia.');
          return;
        }

        if (
          !document
            .getElementById('previewProtected')
            ?.checked
        ) {
          showToast('Confirme a cópia com marca d’água.');
          return;
        }

        const button =
          event.currentTarget;

        button.disabled = true;
        button.textContent = 'Publicando...';

        try {
          const form =
            new FormData();

          form.append(
            'file',
            file,
          );

          form.append(
            'watermarkConfirmed',
            'true',
          );

          form.append(
            'watermarkLabel',
            document
              .getElementById('previewWatermark')
              .value
              .trim(),
          );

          const result =
            await api(
              `/api/admin/v2/orders/${detail.order.code}/previews`,
              {
                method: 'POST',
                body: form,
              },
            );

          showToast('Prévia publicada ✓');

          if (
            result.client
              ?.whatsappUrl
            && confirm(
              'Prévia publicada. Abrir o WhatsApp para enviar o link à cliente?',
            )
          ) {
            window.open(
              result.client.whatsappUrl,
              '_blank',
              'noopener',
            );
          }

          close();

          if (onChanged) {
            await onChanged();
          }

          await openOrder(
            detail.order.code,
            onChanged,
          );
        } catch (error) {
          button.disabled = false;
          button.textContent = 'Publicar prévia';
          showToast(error.message);
        }
      },
    );

  document
    .querySelectorAll('[data-preview-reactivate]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            button.disabled = true;

            try {
              await api(
                `/api/admin/v2/previews/${button.dataset.previewReactivate}/reactivate`,
                {
                  method: 'POST',
                  body: '{}',
                },
              );

              close();

              if (onChanged) {
                await onChanged();
              }

              await openOrder(
                detail.order.code,
                onChanged,
              );

              showToast('Prévia reativada ✓');
            } catch (error) {
              button.disabled = false;
              showToast(error.message);
            }
          },
        ),
    );

  document
    .querySelectorAll('[data-preview-revoke]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            if (
              !confirm(
                'Retirar esta prévia da área da cliente?',
              )
            ) {
              return;
            }

            button.disabled = true;

            try {
              await api(
                `/api/admin/v2/previews/${button.dataset.previewRevoke}/revoke`,
                {
                  method: 'POST',
                  body: '{}',
                },
              );

              close();

              if (onChanged) {
                await onChanged();
              }

              await openOrder(
                detail.order.code,
                onChanged,
              );

              showToast('Prévia retirada.');
            } catch (error) {
              button.disabled = false;
              showToast(error.message);
            }
          },
        ),
    );

  const registerWhatsappApproval =
    async (
      button,
    ) => {
      if (
        !confirm(
          'Confirmar que a cliente aprovou a prévia pelo WhatsApp?',
        )
      ) {
        return false;
      }

      button.disabled =
        true;

      try {
        await api(
          `/api/admin/v2/orders/${detail.order.code}/preview-approval`,
          {
            method:
              'POST',
            body:
              JSON.stringify({
                channel:
                  'whatsapp',
              }),
          },
        );

        showToast(
          'Aprovação pelo WhatsApp registrada ✓',
        );

        return true;
      } catch (error) {
        button.disabled =
          false;
        showToast(
          error.message,
        );

        return false;
      }
    };

  document
    .querySelectorAll(
      '[data-preview-approve-whatsapp]',
    )
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            if (
              !await registerWhatsappApproval(
                button,
              )
            ) {
              return;
            }

            close();

            if (onChanged) {
              await onChanged();
            }

            await openOrder(
              detail.order.code,
              onChanged,
            );
          },
        ),
    );

  const refreshContracts =
    async () => {
      const area =
        document.getElementById(
          'contractArea',
        );

      const result =
        await api(
          `/api/admin/v2/orders/${detail.order.code}/contracts`,
        );

      const contracts =
        result.result
          ?.contracts
        || [];

      area.innerHTML =
        contracts.length
          ? contracts.map(
            (contract) => `
              <div class="row-card">
                <strong>
                  v${contract.version}
                  • ${esc(contract.status)}
                </strong>

                <small>
                  ${contract.signedAt ? `Assinado ${dateTimeBr(contract.signedAt)}` : ''}
                </small>

                <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px">
                  ${
                    contract.status === 'waiting_libri'
                      ? `
                        <button
                          class="btn btn-primary"
                          type="button"
                          data-sign-libri="${contract.id}"
                        >
                          Assinar e enviar
                        </button>
                      `
                      : ''
                  }

                  ${
                    contract.hasPdf
                      ? `
                        <a
                          class="btn btn-secondary"
                          href="/api/admin/v2/contracts/${contract.id}/pdf"
                        >
                          PDF
                        </a>
                      `
                      : ''
                  }
                </div>
              </div>
            `,
          ).join('')
          : '<div class="empty">Nenhum contrato.</div>';

      area
        .querySelectorAll('[data-sign-libri]')
        .forEach(
          (button) =>
            button.addEventListener(
              'click',
              async () => {
                button.disabled = true;

                try {
                  const response =
                    await api(
                      `/api/admin/v2/contracts/${button.dataset.signLibri}/sign-libri`,
                      {
                        method: 'POST',
                        body: '{}',
                      },
                    );

                  const url =
                    response.result
                      ?.customer
                      ?.whatsappUrl;

                  if (url) {
                    window.open(
                      url,
                      '_blank',
                      'noopener',
                    );
                  }

                  await refreshContracts();
                } catch (error) {
                  button.disabled = false;
                  showToast(error.message);
                }
              },
            ),
        );
    };

  await refreshContracts();

  document
    .getElementById('generateContract')
    .addEventListener(
      'click',
      async (event) => {
        const button =
          event.currentTarget;

        button.disabled = true;

        try {
          await api(
            `/api/admin/v2/orders/${detail.order.code}/contracts`,
            {
              method: 'POST',
              body: '{}',
            },
          );

          await refreshContracts();
          showToast('Contrato gerado ✓');
        } catch (error) {
          showToast(error.message);
        } finally {
          button.disabled = false;
        }
      },
    );

  document
    .querySelectorAll('[data-order-action]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            const action =
              button.dataset.orderAction;

            if (
              action === 'finalize'
            ) {
              const closeFinalize = modal(
                'Concluir pedido',
                finalizeChecklistHtml(detail),
              );

              // Keep one checklist open and refresh only its missing items.
              // Previously approval/payment closed two dialogs, reopened the
              // entire order and made the user click Finalizar again.
              const refreshChecklist = async () => {
                const response = await api(
                  `/api/admin/v2/orders/${detail.order.code}`,
                );
                detail = response.detail;
                const body = document.querySelector('.modal-body');
                if (!body) return;
                body.innerHTML = finalizeChecklistHtml(detail);
                bindChecklistActions();
              };
              const bindChecklistActions = () => {
                document.querySelector('[data-checklist-preview-whatsapp]')
                  ?.addEventListener('click', async event => {
                    if (await registerWhatsappApproval(event.currentTarget)) {
                      try { await refreshChecklist(); }
                      catch (error) { showToast(error.message); }
                    }
                  });
                document.querySelector('[data-checklist-balance-received]')
                  ?.addEventListener('click', async event => {
                    const amount = Number(detail.payment?.remainingBalanceCents || 0);
                    if (amount <= 0) {
                      showToast('Este pedido já não tem saldo aberto.');
                      await refreshChecklist();
                      return;
                    }
                    if (!confirm(`Você realmente recebeu ${money(amount)} por Pix fora do sistema? Isso criará UM lançamento de recebimento.`)) return;
                    const btn = event.currentTarget;
                    btn.disabled = true;
                    try {
                      await api(`/api/admin/v2/orders/${detail.order.code}/action`, {
                        method: 'POST',
                        body: JSON.stringify({action: 'balance_received'}),
                      });
                      showToast('Saldo registrado ✓');
                      await refreshChecklist();
                    } catch (error) {
                      btn.disabled = false;
                      showToast(error.message);
                    }
                  });
                document.getElementById('confirmFinalizeOrder')
                  ?.addEventListener('click', async event => {
                    if (!document.getElementById('finalDeliveryConfirmed')?.checked) {
                      showToast('Confirme que o arquivo ou link final está pronto.');
                      return;
                    }
                    const btn = event.currentTarget;
                    btn.disabled = true;
                    try {
                      await api(`/api/admin/v2/orders/${detail.order.code}/action`, {
                        method: 'POST',
                        body: JSON.stringify({action: 'finalize', finalDeliveryConfirmed: true}),
                      });
                      closeFinalize();
                      close();
                      showToast('Pedido finalizado ✓');
                      if (onChanged) await onChanged();
                    } catch (error) {
                      btn.disabled = false;
                      showToast(error.message);
                    }
                  });
              };
              bindChecklistActions();
              return;
            }

            if (
              action === 'archive'
              && !confirm(
                'Arquivar este pedido? Ele sairá das telas operacionais e continuará disponível em Arquivados.',
              )
            ) {
              return;
            }

            if (
              action === 'unarchive'
              && !confirm(
                'Restaurar este pedido para fora dos Arquivados?',
              )
            ) {
              return;
            }

            button.disabled = true;

            try {
              await api(
                `/api/admin/v2/orders/${detail.order.code}/action`,
                {
                  method: 'POST',
                  body:
                    JSON.stringify({
                      action,
                    }),
                },
              );

              close();
              showToast('Pedido atualizado ✓');

              if (onChanged) {
                await onChanged();
              }
            } catch (error) {
              button.disabled = false;
              showToast(error.message);
            }
          },
        ),
    );

  document
    .getElementById('cancelOrder')
    ?.addEventListener(
      'click',
      async (event) => {
        const reason =
          document
            .getElementById('cancelReason')
            ?.value
          || '';

        const note =
          document
            .getElementById('cancelNote')
            ?.value
            .trim()
          || '';

        if (!reason) {
          showToast('Escolha o motivo do cancelamento.');
          return;
        }

        if (
          reason === 'Outro'
          && !note
        ) {
          showToast('Descreva o motivo do cancelamento.');
          return;
        }

        if (
          !confirm(
            `Cancelar ${detail.order.code}? A vaga será liberada. Pagamentos aprovados não serão estornados automaticamente.`,
          )
        ) {
          return;
        }

        const button =
          event.currentTarget;

        button.disabled =
          true;

        try {
          await api(
            `/api/admin/v2/orders/${detail.order.code}/cancel`,
            {
              method:
                'POST',
              body:
                JSON.stringify({
                  reason,
                  note,
                }),
            },
          );

          close();

          if (onChanged) {
            await onChanged();
          }

          showToast('Pedido cancelado.');
        } catch (error) {
          button.disabled =
            false;

          showToast(
            error.message,
          );
        }
      },
    );

  document
    .getElementById('deleteOrder')
    ?.addEventListener(
      'click',
      async (event) => {
        if (
          !confirm(
            `Excluir ${detail.order.code} definitivamente? Use isso somente para teste, duplicado ou pedido criado por engano.`,
          )
        ) {
          return;
        }

        const typed =
          prompt(
            `Para confirmar a exclusão permanente, digite ${detail.order.code}`,
          );

        if (
          String(
            typed
            || '',
          ).trim() !== detail.order.code
        ) {
          showToast('Exclusão cancelada.');
          return;
        }

        const button =
          event.currentTarget;

        button.disabled =
          true;

        button.textContent =
          'Excluindo...';

        try {
          await api(
            `/api/admin/v2/orders/${detail.order.code}`,
            {
              method:
                'DELETE',
            },
          );

          close();
          showToast(
            'Pedido excluído ✓',
          );

          if (onChanged) {
            await onChanged();
          }
        } catch (error) {
          button.disabled =
            false;

          button.textContent =
            'Excluir pedido';

          showToast(
            error.message,
          );
        }
      },
    );

  document
    .getElementById('saveInternalNote')
    .addEventListener(
      'click',
      async () => {
        const input =
          document
            .getElementById('internalNote');

        const note =
          input.value.trim();

        if (!note) {
          showToast('Escreva a observação.');
          return;
        }

        await api(
          `/api/admin/v2/orders/${detail.order.code}/notes`,
          {
            method: 'POST',
            body:
              JSON.stringify({
                note,
              }),
          },
        );

        input.value = '';
        showToast('Observação salva ✓');
      },
    );

  document
    .getElementById('copyProduction')
    .addEventListener(
      'click',
      async () => {
        await writeClipboard(
          detail.copy.production,
        );
        showToast('Dados copiados ✓');
      },
    );

  document
    .getElementById('copyFull')
    .addEventListener(
      'click',
      async () => {
        await writeClipboard(
          detail.copy.full,
        );
        showToast('Ficha copiada ✓');
      },
    );
}

