import {
  api,
  esc,
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
          <label for="companyLegalName">Nome legal</label>
          <input id="companyLegalName" class="input" value="${esc(s.company.legalName)}">
        </div>

        <div class="field">
          <label for="companyDocument">Documento</label>
          <input id="companyDocument" class="input" value="${esc(s.company.document)}">
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
          <input id="urgencyPercent" class="input" type="number" value="${esc(s.agenda.urgencyPercent)}">
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
) {
  panel.innerHTML = `
    <section class="settings-card">
      <div class="section-title">
        <h2>Galeria de exemplos</h2>
      </div>

      <div class="list">
        ${(config.gallery || []).map(
          (item) => `
            <div class="row-card">
              <strong>
                ${esc(item.themeLabel || 'Exemplo')}
              </strong>
              <small>
                ${esc(item.productCode || '')}
                • ${esc(item.eventType || '')}
                • ${item.active ? 'ativo' : 'inativo'}
              </small>
            </div>
          `,
        ).join('')}
      </div>

      <div class="notice" style="margin-top:12px">
        Upload e edição avançada entram no consolidado final depois de restaurar o módulo completo do repositório.
      </div>
    </section>
  `;
}
