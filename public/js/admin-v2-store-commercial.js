import {
  api,
  esc,
  modal,
  money,
  showToast,
} from './admin-v2-core.js';

function discountLabel(
  type,
  value,
) {
  return type === 'percent'
    ? `${Number(value || 0)}%`
    : money(
        Number(value || 0),
      );
}

function comboEditor(
  combo,
  config,
  reload,
) {
  const editing =
    Boolean(
      combo,
    );

  const currentItems =
    combo?.items
    || [];

  const preservedItems =
    currentItems
      .filter(
        (item) =>
          item.itemType
          !== 'addon',
      );

  const close =
    modal(
      editing
        ? `Editar ${combo.name}`
        : 'Novo combo',
      `
        <div class="form-grid">
          <div class="field">
            <label for="comboCode">Código</label>
            <input
              id="comboCode"
              class="input"
              value="${esc(combo?.code || '')}"
              ${editing ? 'readonly' : ''}
              placeholder="ex.: festa_completa"
            >
          </div>

          <div class="field">
            <label for="comboName">Nome</label>
            <input
              id="comboName"
              class="input"
              value="${esc(combo?.name || '')}"
            >
          </div>

          <div class="field full">
            <label for="comboDescription">Descrição</label>
            <textarea id="comboDescription" class="textarea">${esc(combo?.description || '')}</textarea>
          </div>

          <div class="field">
            <label for="comboDiscountType">Desconto</label>
            <select id="comboDiscountType" class="select">
              <option value="percent" ${combo?.discountType === 'percent' ? 'selected' : ''}>Percentual</option>
              <option value="fixed" ${combo?.discountType === 'fixed' ? 'selected' : ''}>Valor fixo em centavos</option>
            </select>
          </div>

          <div class="field">
            <label for="comboDiscountValue">Valor do desconto</label>
            <input
              id="comboDiscountValue"
              class="input"
              type="number"
              min="0"
              value="${esc(combo?.discountValue ?? 0)}"
            >
          </div>

          <div class="field">
            <label for="comboActive">Ativo</label>
            <select id="comboActive" class="select">
              <option value="1" ${combo?.active !== false ? 'selected' : ''}>Sim</option>
              <option value="0" ${combo?.active === false ? 'selected' : ''}>Não</option>
            </select>
          </div>
        </div>

        <div class="section-title" style="margin-top:16px">
          <h3>Adicionais incluídos</h3>
        </div>

        <div class="list">
          ${(config.addons || []).map(
            (addon) => {
              const checked =
                currentItems.some(
                  (item) =>
                    item.itemType === 'addon'
                    && item.itemCode === addon.code,
                );

              return `
                <label class="checkline">
                  <input
                    type="checkbox"
                    name="comboAddon"
                    value="${esc(addon.code)}"
                    ${checked ? 'checked' : ''}
                  >
                  <span>
                    <strong>${esc(addon.name)}</strong>
                    • ${money(addon.priceCents)}
                  </span>
                </label>
              `;
            },
          ).join('')}
        </div>

        <button
          id="saveCombo"
          class="btn btn-primary"
          type="button"
          style="margin-top:16px"
        >
          Salvar combo
        </button>
      `,
      {
        width:
          '720px',
      },
    );

  document
    .getElementById('saveCombo')
    .addEventListener(
      'click',
      async (event) => {
        const button =
          event.currentTarget;

        const code =
          document
            .getElementById('comboCode')
            .value
            .trim()
            .toLowerCase()
            .replace(
              /\s+/g,
              '_',
            );

        const name =
          document
            .getElementById('comboName')
            .value
            .trim();

        if (
          !code
          || !name
        ) {
          showToast('Preencha código e nome do combo.');
          return;
        }

        const addonItems =
          [
            ...document
              .querySelectorAll(
                '[name="comboAddon"]:checked',
              ),
          ]
            .map(
              (input) => ({
                itemType:
                  'addon',
                itemCode:
                  input.value,
                required:
                  true,
              }),
            );

        const items = [
          ...preservedItems,
          ...addonItems,
        ];

        if (!items.length) {
          showToast('Escolha ao menos um adicional.');
          return;
        }

        button.disabled =
          true;

        try {
          await api(
            `/api/admin/v2/store-config/combos/${encodeURIComponent(code)}`,
            {
              method:
                'PUT',
              body:
                JSON.stringify({
                  name,
                  description:
                    document
                      .getElementById('comboDescription')
                      .value
                      .trim(),
                  discountType:
                    document
                      .getElementById('comboDiscountType')
                      .value,
                  discountValue:
                    Number(
                      document
                        .getElementById('comboDiscountValue')
                        .value,
                    ),
                  active:
                    document
                      .getElementById('comboActive')
                      .value === '1',
                  items,
                }),
            },
          );

          close();
          showToast('Combo salvo ✓');
          await reload();
        } catch (error) {
          button.disabled =
            false;
          showToast(error.message);
        }
      },
    );
}

export function renderStoreCombos(
  panel,
  config,
  reload,
) {
  panel.innerHTML = `
    <section class="settings-card">
      <div class="section-title">
        <h2>Combos</h2>
        <button
          id="newCombo"
          class="btn btn-primary"
          type="button"
        >
          Novo combo
        </button>
      </div>

      <div class="list">
        ${(config.combos || []).map(
          (combo) => `
            <div class="row-card">
              <strong>${esc(combo.name)}</strong>
              <small>
                ${esc(combo.code)}
                • desconto ${discountLabel(combo.discountType, combo.discountValue)}
                • ${combo.active ? 'ativo' : 'inativo'}
              </small>

              <button
                class="btn btn-ghost"
                type="button"
                data-edit-combo="${esc(combo.code)}"
                style="margin-top:8px"
              >
                Editar
              </button>
            </div>
          `,
        ).join('') || '<div class="empty">Nenhum combo cadastrado.</div>'}
      </div>
    </section>
  `;

  document
    .getElementById('newCombo')
    .addEventListener(
      'click',
      () =>
        comboEditor(
          null,
          config,
          reload,
        ),
    );

  panel
    .querySelectorAll('[data-edit-combo]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          () =>
            comboEditor(
              (config.combos || [])
                .find(
                  (item) =>
                    item.code
                    === button.dataset.editCombo,
                ),
              config,
              reload,
            ),
        ),
    );
}

function couponEditor(
  coupon,
  reload,
) {
  const editing =
    Boolean(
      coupon,
    );

  const close =
    modal(
      editing
        ? `Editar ${coupon.code}`
        : 'Novo cupom',
      `
        <div class="form-grid">
          <div class="field">
            <label for="couponAdminCode">Código</label>
            <input
              id="couponAdminCode"
              class="input"
              value="${esc(coupon?.code || '')}"
              ${editing ? 'readonly' : ''}
              placeholder="EX.: CLIENTE10"
            >
          </div>

          <div class="field">
            <label for="couponAdminType">Tipo</label>
            <select id="couponAdminType" class="select">
              <option value="percent" ${coupon?.discountType === 'percent' ? 'selected' : ''}>Percentual</option>
              <option value="fixed" ${coupon?.discountType === 'fixed' ? 'selected' : ''}>Valor fixo em centavos</option>
            </select>
          </div>

          <div class="field">
            <label for="couponAdminValue">Valor</label>
            <input
              id="couponAdminValue"
              class="input"
              type="number"
              min="0"
              value="${esc(coupon?.discountValue ?? 0)}"
            >
          </div>

          <div class="field">
            <label for="couponAdminMin">Pedido mínimo em centavos</label>
            <input
              id="couponAdminMin"
              class="input"
              type="number"
              min="0"
              value="${esc(coupon?.minOrderCents ?? 0)}"
            >
          </div>

          <div class="field">
            <label for="couponAdminMax">Limite total de usos</label>
            <input
              id="couponAdminMax"
              class="input"
              type="number"
              min="1"
              value="${esc(coupon?.maxUses ?? '')}"
              placeholder="Sem limite"
            >
          </div>

          <div class="field">
            <label for="couponAdminPerCustomer">Limite por cliente</label>
            <input
              id="couponAdminPerCustomer"
              class="input"
              type="number"
              min="1"
              value="${esc(coupon?.maxUsesPerCustomer ?? '')}"
              placeholder="Sem limite"
            >
          </div>

          <div class="field">
            <label for="couponAdminFrom">Válido a partir de</label>
            <input
              id="couponAdminFrom"
              class="input"
              type="date"
              value="${esc((coupon?.validFrom || '').slice(0,10))}"
            >
          </div>

          <div class="field">
            <label for="couponAdminUntil">Válido até</label>
            <input
              id="couponAdminUntil"
              class="input"
              type="date"
              value="${esc((coupon?.validUntil || '').slice(0,10))}"
            >
          </div>

          <div class="field">
            <label for="couponAdminActive">Ativo</label>
            <select id="couponAdminActive" class="select">
              <option value="1" ${coupon?.active !== false ? 'selected' : ''}>Sim</option>
              <option value="0" ${coupon?.active === false ? 'selected' : ''}>Não</option>
            </select>
          </div>
        </div>

        <button
          id="saveCoupon"
          class="btn btn-primary"
          type="button"
          style="margin-top:16px"
        >
          Salvar cupom
        </button>
      `,
      {
        width:
          '720px',
      },
    );

  document
    .getElementById('saveCoupon')
    .addEventListener(
      'click',
      async (event) => {
        const button =
          event.currentTarget;

        const code =
          document
            .getElementById('couponAdminCode')
            .value
            .trim()
            .toUpperCase();

        if (!code) {
          showToast('Informe o código do cupom.');
          return;
        }

        const nullableNumber =
          (id) => {
            const value =
              document
                .getElementById(id)
                .value
                .trim();

            return value
              ? Number(value)
              : null;
          };

        button.disabled =
          true;

        try {
          await api(
            `/api/admin/v2/store-config/coupons/${encodeURIComponent(code)}`,
            {
              method:
                'PUT',
              body:
                JSON.stringify({
                  discountType:
                    document
                      .getElementById('couponAdminType')
                      .value,
                  discountValue:
                    Number(
                      document
                        .getElementById('couponAdminValue')
                        .value,
                    ),
                  minOrderCents:
                    Number(
                      document
                        .getElementById('couponAdminMin')
                        .value
                      || 0,
                    ),
                  maxUses:
                    nullableNumber('couponAdminMax'),
                  maxUsesPerCustomer:
                    nullableNumber('couponAdminPerCustomer'),
                  validFrom:
                    document
                      .getElementById('couponAdminFrom')
                      .value
                    || null,
                  validUntil:
                    document
                      .getElementById('couponAdminUntil')
                      .value
                    || null,
                  active:
                    document
                      .getElementById('couponAdminActive')
                      .value === '1',
                  restrictions:
                    coupon?.restrictions
                    || {},
                }),
            },
          );

          close();
          showToast('Cupom salvo ✓');
          await reload();
        } catch (error) {
          button.disabled =
            false;
          showToast(error.message);
        }
      },
    );
}

export function renderStoreCoupons(
  panel,
  config,
  reload,
) {
  panel.innerHTML = `
    <section class="settings-card">
      <div class="section-title">
        <h2>Cupons</h2>
        <button
          id="newCoupon"
          class="btn btn-primary"
          type="button"
        >
          Novo cupom
        </button>
      </div>

      <div class="list">
        ${(config.coupons || []).map(
          (coupon) => `
            <div class="row-card">
              <strong>${esc(coupon.code)}</strong>
              <small>
                ${discountLabel(coupon.discountType, coupon.discountValue)}
                • ${coupon.active ? 'ativo' : 'inativo'}
                • ${Number(coupon.useCount || 0)} uso(s)
              </small>

              <button
                class="btn btn-ghost"
                type="button"
                data-edit-coupon="${esc(coupon.code)}"
                style="margin-top:8px"
              >
                Editar
              </button>
            </div>
          `,
        ).join('') || '<div class="empty">Nenhum cupom cadastrado.</div>'}
      </div>
    </section>
  `;

  document
    .getElementById('newCoupon')
    .addEventListener(
      'click',
      () =>
        couponEditor(
          null,
          reload,
        ),
    );

  panel
    .querySelectorAll('[data-edit-coupon]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          () =>
            couponEditor(
              (config.coupons || [])
                .find(
                  (item) =>
                    item.code
                    === button.dataset.editCoupon,
                ),
              reload,
            ),
        ),
    );
}
