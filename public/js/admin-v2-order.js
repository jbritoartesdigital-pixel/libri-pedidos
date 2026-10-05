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
};

function paymentBlock(detail) {
  const p =
    detail.payment;

  return `
    <section class="card">
      <div class="section-title">
        <h3>Pagamento</h3>
      </div>

      <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
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
          Copiar resumo de produção
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
              WhatsApp: ${esc(detail.order.whatsapp)}<br>
              Festa: ${dateBr(detail.order.eventDate)}<br>
              Entrega: ${dateBr(detail.order.deliveryWindow.start)} a ${dateBr(detail.order.deliveryWindow.end)}<br>
              Próximo: ${esc(detail.order.nextAction || '')}
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
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
            </div>
          </section>

          ${paymentBlock(detail)}
        </div>

        ${detail.order.status === 'awaiting_urgency_decision' ? `
          <section class="card">
            <h3>Análise de encaixe urgente</h3>
            <p>Adicional de 30% após os descontos. A capacidade será conferida novamente no pagamento.</p>
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
            </div>

            <div class="list">
              ${(detail.previews || []).map(
                (preview) => `
                  <div class="row-card">
                    <strong>
                      v${preview.version} • ${esc(preview.status)}
                    </strong>

                    <small>
                      ${esc(preview.mediaType)}
                      ${preview.approvedAt ? ` • aprovada ${dateTimeBr(preview.approvedAt)}` : ''}
                    </small>
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
    .getElementById('deleteOrder')
    ?.addEventListener(
      'click',
      async (event) => {
        if (
          !confirm(
            `Excluir ${detail.order.code} definitivamente? O checkout pendente também será cancelado.`,
          )
        ) {
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
        showToast('Resumo copiado ✓');
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

