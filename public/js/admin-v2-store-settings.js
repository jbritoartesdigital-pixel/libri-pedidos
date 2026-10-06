import {
  api,
  esc,
  modal,
  showToast,
} from './admin-v2-core.js';

export function renderStoreSettings(
  panel,
  config,
) {
  const s =
    config.settings;

  panel.innerHTML = `
    <section class="settings-card">
      <div class="section-title">
        <h2>Empresa e pagamentos</h2>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="companyName">Nome</label>
          <input id="companyName" class="input" value="${esc(s.company.name)}">
        </div>

        <div class="field">
          <label for="companyWhatsapp">WhatsApp</label>
          <input id="companyWhatsapp" class="input" value="${esc(s.company.whatsapp)}">
        </div>

        <div class="field">
          <label for="companyEmail">E-mail público</label>
          <input id="companyEmail" class="input" type="email" value="${esc(s.company.email)}">
        </div>

        <div class="field">
          <label for="companyInstagram">Instagram</label>
          <input id="companyInstagram" class="input" value="${esc(s.company.instagram)}">
        </div>

        <div class="field">
          <label for="companyLegalName">Nome legal</label>
          <input id="companyLegalName" class="input" value="${esc(s.company.legalName)}">
        </div>

        <div class="field">
          <label for="companyDocument">Documento</label>
          <input id="companyDocument" class="input" value="${esc(s.company.document)}">
        </div>

        <div class="field full">
          <label for="companyAddress">Endereço comercial</label>
          <input id="companyAddress" class="input" value="${esc(s.company.address)}">
        </div>

        <div class="field">
          <label for="companyCity">Cidade</label>
          <input id="companyCity" class="input" value="${esc(s.company.city)}">
        </div>

        <div class="field">
          <label for="companyState">Estado</label>
          <input id="companyState" class="input" maxlength="2" value="${esc(s.company.state)}">
        </div>

        <div class="field">
          <label for="balancePixKey">Chave Pix do saldo</label>
          <input id="balancePixKey" class="input" value="${esc(s.payments.balancePixKey)}">
        </div>

        <div class="field">
          <label for="balancePixName">Recebedor do Pix</label>
          <input id="balancePixName" class="input" value="${esc(s.payments.balancePixRecipientName)}">
        </div>
      </div>

      <div class="section-title" style="margin-top:20px">
        <h2>Agenda e experiência</h2>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="sellableUnits">Capacidade vendável/dia</label>
          <input id="sellableUnits" class="input" type="number" value="${esc(s.agenda.sellableUnitsPerDay)}">
        </div>

        <div class="field">
          <label for="bufferUnits">Buffer interno/dia</label>
          <input id="bufferUnits" class="input" type="number" value="${esc(s.agenda.internalBufferUnitsPerDay)}">
        </div>

        <div class="field">
          <label for="recommendedDays">Dias recomendados antes da festa</label>
          <input id="recommendedDays" class="input" type="number" value="${esc(s.agenda.recommendedDeliveryDaysBeforeEvent)}">
        </div>

        <div class="field">
          <label for="urgencyPercent">Urgência %</label>
          <input id="urgencyPercent" class="input" type="number" value="30" readonly>
        </div>

        <div class="field">
          <label for="previewHours">Validade da prévia em horas</label>
          <input id="previewHours" class="input" type="number" value="${esc(s.experience.previewExpiryHours)}">
        </div>

        <div class="field">
          <label for="holdMinutes">Reserva do checkout em minutos</label>
          <input id="holdMinutes" class="input" type="number" value="${esc(s.agenda.checkoutHoldMinutes)}">
        </div>
      </div>

      <div class="section-title" style="margin-top:20px">
        <h2>Mensagens rápidas do WhatsApp</h2>
      </div>

      <div class="notice info" style="margin-bottom:14px">
        Você pode usar: <strong>{cliente}</strong>, <strong>{homenageado}</strong>,
        <strong>{pedido}</strong>, <strong>{link}</strong> e <strong>{saldo}</strong>.
      </div>

      <div class="form-grid">
        <div class="field full">
          <label for="whatsappBriefingTemplate">Cobrar briefing</label>
          <textarea id="whatsappBriefingTemplate" class="textarea">${esc(s.whatsappTemplates.briefing)}</textarea>
        </div>

        <div class="field full">
          <label for="whatsappPreviewTemplate">Prévia disponível</label>
          <textarea id="whatsappPreviewTemplate" class="textarea">${esc(s.whatsappTemplates.preview)}</textarea>
        </div>

        <div class="field full">
          <label for="whatsappBalanceTemplate">Saldo pendente</label>
          <textarea id="whatsappBalanceTemplate" class="textarea">${esc(s.whatsappTemplates.balance)}</textarea>
        </div>

        <div class="field full">
          <label for="whatsappFinalizedTemplate">Pedido finalizado</label>
          <textarea id="whatsappFinalizedTemplate" class="textarea">${esc(s.whatsappTemplates.finalized)}</textarea>
        </div>
      </div>

      <button
        id="saveSettings"
        class="btn btn-primary"
        type="button"
        style="margin-top:14px"
      >
        Salvar configurações
      </button>
    </section>
  `;

  document
    .getElementById(
      'saveSettings',
    )
    .addEventListener(
      'click',
      async () => {
        await api(
          '/api/admin/v2/store-config/settings',
          {
            method:
              'PATCH',
            body:
              JSON.stringify({
                values: {
                  company_name:
                    document
                      .getElementById('companyName')
                      .value
                      .trim(),
                  libri_whatsapp:
                    document
                      .getElementById('companyWhatsapp')
                      .value
                      .trim(),
                  company_email:
                    document
                      .getElementById('companyEmail')
                      .value
                      .trim(),
                  company_instagram:
                    document
                      .getElementById('companyInstagram')
                      .value
                      .trim(),
                  company_legal_name:
                    document
                      .getElementById('companyLegalName')
                      .value
                      .trim(),
                  company_document:
                    document
                      .getElementById('companyDocument')
                      .value
                      .trim(),
                  company_address:
                    document
                      .getElementById('companyAddress')
                      .value
                      .trim(),
                  company_city:
                    document
                      .getElementById('companyCity')
                      .value
                      .trim(),
                  company_state:
                    document
                      .getElementById('companyState')
                      .value
                      .trim()
                      .toUpperCase(),
                  balance_pix_key:
                    document
                      .getElementById('balancePixKey')
                      .value
                      .trim(),
                  balance_pix_recipient_name:
                    document
                      .getElementById('balancePixName')
                      .value
                      .trim(),
                  default_sellable_points_per_day_units:
                    document
                      .getElementById('sellableUnits')
                      .value,
                  default_internal_buffer_points_per_day_units:
                    document
                      .getElementById('bufferUnits')
                      .value,
                  recommended_delivery_days_before_event:
                    document
                      .getElementById('recommendedDays')
                      .value,
                  urgency_percent:
                    document
                      .getElementById('urgencyPercent')
                      .value,
                  preview_expiry_hours:
                    document
                      .getElementById('previewHours')
                      .value,
                  checkout_hold_minutes:
                    document
                      .getElementById('holdMinutes')
                      .value,
                  whatsapp_template_briefing:
                    document
                      .getElementById('whatsappBriefingTemplate')
                      .value
                      .trim(),
                  whatsapp_template_preview:
                    document
                      .getElementById('whatsappPreviewTemplate')
                      .value
                      .trim(),
                  whatsapp_template_balance:
                    document
                      .getElementById('whatsappBalanceTemplate')
                      .value
                      .trim(),
                  whatsapp_template_finalized:
                    document
                      .getElementById('whatsappFinalizedTemplate')
                      .value
                      .trim(),
                },
              }),
          },
        );

        showToast(
          'Configurações salvas ✓',
        );
      },
    );
}

export function renderStoreTerms(
  panel,
  config,
  reload,
) {
  panel.innerHTML = `
    <section class="settings-card">
      <div class="section-title">
        <h2>Publicar nova versão dos termos</h2>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="termsVersion">Versão</label>
          <input id="termsVersion" class="input" placeholder="2026.10">
        </div>

        <div class="field full">
          <label for="termsBody">Texto</label>
          <textarea id="termsBody" class="textarea" style="min-height:280px"></textarea>
        </div>
      </div>

      <button
        id="publishTerms"
        class="btn btn-primary"
        type="button"
        style="margin-top:14px"
      >
        Publicar versão
      </button>
    </section>

    <div class="list" style="margin-top:14px">
      ${config.terms.map(
        (item) => `
          <div class="row-card">
            <strong>Versão ${esc(item.version)}</strong>
            <small>
              ${item.active ? 'ATIVA • ' : ''}
              ${esc(item.publishedAt || '')}
            </small>
          </div>
        `,
      ).join('')}
    </div>
  `;

  document
    .getElementById(
      'publishTerms',
    )
    .addEventListener(
      'click',
      async () => {
        await api(
          '/api/admin/v2/store-config/terms/publish',
          {
            method:
              'POST',
            body:
              JSON.stringify({
                version:
                  document
                    .getElementById('termsVersion')
                    .value
                    .trim(),
                body:
                  document
                    .getElementById('termsBody')
                    .value
                    .trim(),
              }),
          },
        );

        showToast(
          'Termos publicados ✓',
        );

        await reload();
      },
    );
}

export function renderStoreContracts(
  panel,
  config,
  reload,
) {
  panel.innerHTML = `
    <section class="settings-card">
      <div class="section-title">
        <h2>Publicar modelo de contrato</h2>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="contractVersion">Versão</label>
          <input id="contractVersion" class="input" type="number">
        </div>

        <div class="field">
          <label for="contractTitle">Título</label>
          <input id="contractTitle" class="input">
        </div>

        <div class="field full">
          <label for="contractBody">Texto com placeholders</label>
          <textarea id="contractBody" class="textarea" style="min-height:300px"></textarea>
        </div>
      </div>

      <button
        id="publishContract"
        class="btn btn-primary"
        type="button"
        style="margin-top:14px"
      >
        Publicar modelo
      </button>
    </section>

    <div class="list" style="margin-top:14px">
      ${(config.contractTemplates || []).map(
        (item) => `
          <div class="row-card">
            <strong>
              v${esc(item.version)} • ${esc(item.title)}
            </strong>
            <small>${item.active ? 'ATIVO' : ''}</small>
          </div>
        `,
      ).join('')}
    </div>
  `;

  document
    .getElementById(
      'publishContract',
    )
    .addEventListener(
      'click',
      async () => {
        await api(
          '/api/admin/v2/store-config/contract-templates/publish',
          {
            method:
              'POST',
            body:
              JSON.stringify({
                version:
                  Number(
                    document
                      .getElementById('contractVersion')
                      .value,
                  ),
                title:
                  document
                    .getElementById('contractTitle')
                    .value
                    .trim(),
                body:
                  document
                    .getElementById('contractBody')
                    .value
                    .trim(),
              }),
          },
        );

        showToast(
          'Modelo publicado ✓',
        );

        await reload();
      },
    );
}

export function renderStoreGallery(
  panel,
  config,
  reload,
) {
  panel.innerHTML = `
    <section class="settings-card">
      <div class="section-title">
        <h2>Galeria de exemplos</h2>
        <span class="status">${(config.gallery || []).length}</span>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="galleryProduct">Formato</label>
          <select id="galleryProduct" class="select">
            ${(config.products || []).map(
              (product) => `
                <option value="${esc(product.code)}">
                  ${esc(product.name)}
                </option>
              `,
            ).join('')}
          </select>
        </div>

        <div class="field">
          <label for="galleryEventType">Tipo de evento</label>
          <input
            id="galleryEventType"
            class="input"
            placeholder="Ex.: birthday"
          >
        </div>

        <div class="field">
          <label for="galleryTheme">Tema / identificação</label>
          <input
            id="galleryTheme"
            class="input"
            placeholder="Ex.: Jardim Encantado"
          >
        </div>

        <div class="field">
          <label for="gallerySort">Ordem</label>
          <input
            id="gallerySort"
            class="input"
            type="number"
            min="0"
            value="0"
          >
        </div>

        <div class="field">
          <label for="galleryMedia">Mídia</label>
          <input
            id="galleryMedia"
            class="input"
            type="file"
            accept="video/*,image/*"
          >
        </div>

        <div class="field">
          <label for="galleryPreview">Capa <span class="muted">(opcional)</span></label>
          <input
            id="galleryPreview"
            class="input"
            type="file"
            accept="image/*"
          >
        </div>

        <div class="field full">
          <label for="galleryExternal">URL externa <span class="muted">(opcional, em vez de arquivo)</span></label>
          <input
            id="galleryExternal"
            class="input"
            type="url"
            placeholder="https://..."
          >
        </div>

        <div class="field full">
          <label for="galleryCaption">Legenda <span class="muted">(opcional)</span></label>
          <textarea id="galleryCaption" class="textarea"></textarea>
        </div>
      </div>

      <button
        id="uploadGallery"
        class="btn btn-primary"
        type="button"
        style="margin-top:14px"
      >
        Adicionar exemplo
      </button>
    </section>

    <div class="list" style="margin-top:14px">
      ${(config.gallery || []).map(
        (item) => `
          <div class="row-card">
            <strong>
              ${esc(item.themeLabel || 'Exemplo')}
            </strong>
            <small>
              ${esc(item.productCode || '')}
              • ${esc(item.eventType || 'evento geral')}
              • ${item.active ? 'ativo' : 'inativo'}
              ${item.originalFilename ? ` • ${esc(item.originalFilename)}` : ''}
            </small>

            <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px">
              ${item.hasPreview ? `
                <a
                  class="btn btn-ghost"
                  href="/api/admin/v2/store-config/gallery/${item.id}/preview"
                  target="_blank"
                  rel="noopener"
                >
                  Ver capa
                </a>
              ` : ''}

              ${item.hasMedia ? `
                <a
                  class="btn btn-secondary"
                  href="/api/admin/v2/store-config/gallery/${item.id}/media"
                  target="_blank"
                  rel="noopener"
                >
                  Ver mídia
                </a>
              ` : item.externalUrl ? `
                <a
                  class="btn btn-secondary"
                  href="${esc(item.externalUrl)}"
                  target="_blank"
                  rel="noopener"
                >
                  Abrir
                </a>
              ` : ''}

              <button
                class="btn btn-ghost"
                type="button"
                data-edit-gallery="${item.id}"
              >
                Editar
              </button>

              <button
                class="btn btn-danger"
                type="button"
                data-delete-gallery="${item.id}"
              >
                Excluir
              </button>
            </div>
          </div>
        `,
      ).join('') || '<div class="empty">Nenhum exemplo publicado.</div>'}
    </div>
  `;

  document
    .getElementById('uploadGallery')
    .addEventListener(
      'click',
      async (event) => {
        const button =
          event.currentTarget;

        const media =
          document
            .getElementById('galleryMedia')
            .files
            ?.[0];

        const externalUrl =
          document
            .getElementById('galleryExternal')
            .value
            .trim();

        if (
          !media
          && !externalUrl
        ) {
          showToast('Envie uma mídia ou informe uma URL.');
          return;
        }

        const form =
          new FormData();

        form.append(
          'productCode',
          document
            .getElementById('galleryProduct')
            .value,
        );

        form.append(
          'eventType',
          document
            .getElementById('galleryEventType')
            .value
            .trim(),
        );

        form.append(
          'themeLabel',
          document
            .getElementById('galleryTheme')
            .value
            .trim(),
        );

        form.append(
          'sortOrder',
          document
            .getElementById('gallerySort')
            .value
          || '0',
        );

        form.append(
          'caption',
          document
            .getElementById('galleryCaption')
            .value
            .trim(),
        );

        if (externalUrl) {
          form.append(
            'externalUrl',
            externalUrl,
          );
        }

        if (media) {
          form.append(
            'media',
            media,
          );
        }

        const preview =
          document
            .getElementById('galleryPreview')
            .files
            ?.[0];

        if (preview) {
          form.append(
            'preview',
            preview,
          );
        }

        button.disabled =
          true;

        button.textContent =
          'Enviando...';

        try {
          await api(
            '/api/admin/v2/store-config/gallery',
            {
              method: 'POST',
              body: form,
            },
          );

          showToast('Exemplo publicado ✓');
          await reload();
        } catch (error) {
          button.disabled =
            false;
          button.textContent =
            'Adicionar exemplo';
          showToast(error.message);
        }
      },
    );

  panel
    .querySelectorAll('[data-edit-gallery]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          () => {
            const item =
              (config.gallery || [])
                .find(
                  (current) =>
                    String(current.id)
                    === button.dataset.editGallery,
                );

            if (!item) {
              return;
            }

            const close =
              modal(
                `Editar ${item.themeLabel || 'exemplo'}`,
                `
                  <div class="form-grid">
                    <div class="field">
                      <label for="editGalleryTheme">Tema</label>
                      <input id="editGalleryTheme" class="input" value="${esc(item.themeLabel || '')}">
                    </div>

                    <div class="field">
                      <label for="editGalleryEvent">Evento</label>
                      <input id="editGalleryEvent" class="input" value="${esc(item.eventType || '')}">
                    </div>

                    <div class="field">
                      <label for="editGallerySort">Ordem</label>
                      <input id="editGallerySort" class="input" type="number" value="${esc(item.sortOrder || 0)}">
                    </div>

                    <div class="field">
                      <label for="editGalleryActive">Ativo</label>
                      <select id="editGalleryActive" class="select">
                        <option value="1" ${item.active ? 'selected' : ''}>Sim</option>
                        <option value="0" ${item.active ? '' : 'selected'}>Não</option>
                      </select>
                    </div>

                    <div class="field full">
                      <label for="editGalleryExternal">URL externa</label>
                      <input id="editGalleryExternal" class="input" value="${esc(item.externalUrl || '')}">
                    </div>

                    <div class="field full">
                      <label for="editGalleryCaption">Legenda</label>
                      <textarea id="editGalleryCaption" class="textarea">${esc(item.caption || '')}</textarea>
                    </div>
                  </div>

                  <button id="saveGalleryEdit" class="btn btn-primary" type="button">
                    Salvar
                  </button>
                `,
                {
                  width:
                    '680px',
                },
              );

            document
              .getElementById('saveGalleryEdit')
              .addEventListener(
                'click',
                async () => {
                  await api(
                    `/api/admin/v2/store-config/gallery/${item.id}`,
                    {
                      method: 'PATCH',
                      body:
                        JSON.stringify({
                          themeLabel:
                            document
                              .getElementById('editGalleryTheme')
                              .value
                              .trim(),
                          eventType:
                            document
                              .getElementById('editGalleryEvent')
                              .value
                              .trim(),
                          sortOrder:
                            Number(
                              document
                                .getElementById('editGallerySort')
                                .value
                              || 0,
                            ),
                          active:
                            document
                              .getElementById('editGalleryActive')
                              .value === '1',
                          externalUrl:
                            document
                              .getElementById('editGalleryExternal')
                              .value
                              .trim(),
                          caption:
                            document
                              .getElementById('editGalleryCaption')
                              .value
                              .trim(),
                        }),
                    },
                  );

                  close();
                  showToast('Exemplo atualizado ✓');
                  await reload();
                },
              );
          },
        ),
    );

  panel
    .querySelectorAll('[data-delete-gallery]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            if (
              !confirm(
                'Excluir este exemplo da galeria?',
              )
            ) {
              return;
            }

            button.disabled =
              true;

            try {
              await api(
                `/api/admin/v2/store-config/gallery/${button.dataset.deleteGallery}`,
                {
                  method:
                    'DELETE',
                },
              );

              showToast('Exemplo excluído.');
              await reload();
            } catch (error) {
              button.disabled =
                false;
              showToast(error.message);
            }
          },
        ),
    );
}
