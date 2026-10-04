import {
  api,
  esc,
  money,
  modal,
  showToast,
} from './admin-v2-core.js';

function productCard(
  product,
) {
  return `
    <div class="row-card">
      <strong>${esc(product.name)}</strong>
      <small>
        ${esc(product.code)}
        • ${product.active ? 'ativo' : 'inativo'}
      </small>

      <div class="list" style="margin-top:9px">
        ${(product.variants || []).map(
          (variant) => `
            <div class="row-card">
              <strong>${esc(variant.label)}</strong>
              <small>
                ${money(variant.priceCents)}
                • ${(variant.pointsUnits / 100).toFixed(1)} pt
                ${variant.sceneCount ? ` • ${variant.sceneCount} cena(s)` : ''}
              </small>

              <button
                class="btn btn-ghost"
                type="button"
                data-edit-variant="${esc(variant.code)}"
              >
                Editar
              </button>
            </div>
          `,
        ).join('')}
      </div>
    </div>
  `;
}

export function renderStoreProducts(
  panel,
  config,
  reload,
) {
  panel.innerHTML = `
    <div class="list">
      ${config.products.map(
        productCard,
      ).join('')}
    </div>
  `;

  panel
    .querySelectorAll(
      '[data-edit-variant]',
    )
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          () => {
            const variant =
              config.products
                .flatMap(
                  (product) =>
                    product.variants,
                )
                .find(
                  (item) =>
                    item.code
                    === button.dataset.editVariant,
                );

            const close =
              modal(
                `Editar ${variant.label}`,
                `
                  <div class="form-grid">
                    <div class="field">
                      <label for="variantLabel">Nome</label>
                      <input id="variantLabel" class="input" value="${esc(variant.label)}">
                    </div>

                    <div class="field">
                      <label for="variantPrice">Preço em centavos</label>
                      <input id="variantPrice" class="input" type="number" value="${esc(variant.priceCents)}">
                    </div>

                    <div class="field">
                      <label for="variantPoints">Pontos em unidades</label>
                      <input id="variantPoints" class="input" type="number" value="${esc(variant.pointsUnits)}">
                    </div>

                    <div class="field">
                      <label for="variantActive">Ativo</label>
                      <select id="variantActive" class="select">
                        <option value="1" ${variant.active ? 'selected' : ''}>Sim</option>
                        <option value="0" ${variant.active ? '' : 'selected'}>Não</option>
                      </select>
                    </div>
                  </div>

                  <button
                    id="saveVariant"
                    class="btn btn-primary"
                    type="button"
                    style="margin-top:14px"
                  >
                    Salvar
                  </button>
                `,
                {
                  width:
                    '600px',
                },
              );

            document
              .getElementById(
                'saveVariant',
              )
              .addEventListener(
                'click',
                async () => {
                  await api(
                    `/api/admin/v2/store-config/variants/${variant.code}`,
                    {
                      method:
                        'PATCH',
                      body:
                        JSON.stringify({
                          label:
                            document
                              .getElementById('variantLabel')
                              .value
                              .trim(),
                          priceCents:
                            Number(
                              document
                                .getElementById('variantPrice')
                                .value,
                            ),
                          pointsUnits:
                            Number(
                              document
                                .getElementById('variantPoints')
                                .value,
                            ),
                          active:
                            document
                              .getElementById('variantActive')
                              .value
                            === '1',
                        }),
                    },
                  );

                  close();
                  showToast(
                    'Configuração salva ✓',
                  );

                  await reload();
                },
              );
          },
        ),
    );
}

export function renderStoreAddons(
  panel,
  config,
  reload,
) {
  panel.innerHTML = `
    <div class="list">
      ${config.addons.map(
        (addon) => `
          <div class="row-card">
            <strong>${esc(addon.name)}</strong>
            <small>
              ${esc(addon.code)}
              • ${money(addon.priceCents)}
              • ${(addon.pointsUnits / 100).toFixed(1)} pt
            </small>

            <button
              class="btn btn-ghost"
              type="button"
              data-edit-addon="${esc(addon.code)}"
            >
              Editar
            </button>
          </div>
        `,
      ).join('')}
    </div>
  `;

  panel
    .querySelectorAll(
      '[data-edit-addon]',
    )
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          () => {
            const addon =
              config.addons
                .find(
                  (item) =>
                    item.code
                    === button.dataset.editAddon,
                );

            const close =
              modal(
                `Editar ${addon.name}`,
                `
                  <div class="form-grid">
                    <div class="field">
                      <label for="addonName">Nome</label>
                      <input id="addonName" class="input" value="${esc(addon.name)}">
                    </div>

                    <div class="field">
                      <label for="addonPrice">Preço em centavos</label>
                      <input id="addonPrice" class="input" type="number" value="${esc(addon.priceCents)}">
                    </div>

                    <div class="field">
                      <label for="addonPoints">Pontos em unidades</label>
                      <input id="addonPoints" class="input" type="number" value="${esc(addon.pointsUnits)}">
                    </div>

                    <div class="field">
                      <label for="addonActive">Ativo</label>
                      <select id="addonActive" class="select">
                        <option value="1" ${addon.active ? 'selected' : ''}>Sim</option>
                        <option value="0" ${addon.active ? '' : 'selected'}>Não</option>
                      </select>
                    </div>
                  </div>

                  <button
                    id="saveAddon"
                    class="btn btn-primary"
                    type="button"
                    style="margin-top:14px"
                  >
                    Salvar
                  </button>
                `,
                {
                  width:
                    '600px',
                },
              );

            document
              .getElementById(
                'saveAddon',
              )
              .addEventListener(
                'click',
                async () => {
                  await api(
                    `/api/admin/v2/store-config/addons/${addon.code}`,
                    {
                      method:
                        'PATCH',
                      body:
                        JSON.stringify({
                          name:
                            document
                              .getElementById('addonName')
                              .value
                              .trim(),
                          priceCents:
                            Number(
                              document
                                .getElementById('addonPrice')
                                .value,
                            ),
                          pointsUnits:
                            Number(
                              document
                                .getElementById('addonPoints')
                                .value,
                            ),
                          active:
                            document
                              .getElementById('addonActive')
                              .value
                            === '1',
                        }),
                    },
                  );

                  close();
                  showToast(
                    'Adicional salvo ✓',
                  );

                  await reload();
                },
              );
          },
        ),
    );
}
