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

function whatsappHref(number, message) {
  const digits = String(number || '').replace(/\D/g, '');
  return digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    : '#';
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

function briefingBlock(detail) {
  const entries =
    Object.entries(
      detail.briefing.data
      || {},
    );

  return `
    <section class="card">
      <div class="section-title">
        <h3>Briefing</h3>
        <span class="status">
          ${detail.briefing.completionPercent}%
        </span>
      </div>

      ${
        entries.length
          ? `
            <table class="simple-table">
              <tbody>
                ${entries.map(
                  ([key, value]) => `
                    <tr>
                      <th>${esc(key.replace(/_/g, ' '))}</th>
                      <td>${esc(Array.isArray(value) ? value.join(', ') : value)}</td>
                    </tr>
                  `,
                ).join('')}
              </tbody>
            </table>
          `
          : '<div class="empty">Sem briefing preenchido.</div>'
      }

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button
          id="copyProduction"
          class="btn btn-secondary"
          type="button"
        >
          Copiar briefing
        </button>

        <button
          id="copyFull"
          class="btn btn-ghost"
          type="button"
        >
          Copiar ficha completa
        </button>
      </div>
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

  const detail =
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

  const close =
    modal(
      `${detail.order.code} • ${detail.order.honoreeName}`,
      `
        <div class="section-grid">
          <section class="card">
            <span class="status ${statusClass(detail.order.status)}">
              ${esc(detail.order.statusLabel)}
            </span>

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
              <a
                class="btn btn-secondary"
                href="https://wa.me/${esc(String(detail.order.whatsapp || '').replace(/\D/g,''))}"
                target="_blank"
                rel="noopener"
              >
                WhatsApp
              </a>

              <a
                class="btn btn-ghost"
                href="/api/admin/v2/orders/${esc(detail.order.code)}/download-folder"
              >
                Baixar pasta ZIP
              </a>

              <a
                class="btn btn-ghost"
                href="${esc(detail.order.customerAreaPath || '#')}"
                target="_blank"
                rel="noopener"
              >
                Área da cliente
              </a>
            </div>
          </section>

          ${paymentBlock(detail)}
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

        <div class="section-grid">
          ${briefingBlock(detail)}

          <section class="card">
            <div class="section-title">
              <h3>Ações</h3>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${(detail.allowedActions || []).map(
                (action) => `
                  <button
                    class="btn ${
                      action === 'finalize'
                        ? 'btn-success'
                        : action === 'balance_received'
                          ? 'btn-warning'
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
          </section>
        </div>

        <div class="section-grid">
          <section class="card">
            <div class="section-title">
              <h3>Prévia</h3>
              <span class="status">${(detail.previews || []).length}</span>
            </div>

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
      `,
      {
        width: '1100px',
      },
    );

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
              && !confirm(
                'Finalizar este pedido? A capacidade liberada entra no fluxo de antecipação em cascata.',
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
        showToast('Briefing copiado ✓');
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

