import {
  api,
  esc,
  money,
  modal,
  showToast,
} from './admin-v2-core.js';
import { sceneLinkUrl } from './v2-scene-links.js?v=20261026-scene-links-1';

async function copyProductUrl(url, successMessage) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(url);
  } catch {
    // Android browsers without clipboard permission keep the copy fallback.
    const area = document.createElement('textarea');
    area.value = url;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) {
      showToast('Não foi possível copiar. Verifique as permissões do navegador.');
      return;
    }
  }
  showToast(successMessage);
}


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

      ${product.active && product.slug ? `
        <button
          class="btn btn-secondary"
          type="button"
          data-copy-product-link="${esc(product.slug)}"
          style="margin-top:8px"
        >
          Copiar link deste formato
        </button>
      ` : ''}

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

              ${product.active && product.slug
                && product.pricingMode === 'scene_count'
                && variant.active && Number(variant.sceneCount) > 0 ? `
                <button
                  class="btn btn-secondary"
                  type="button"
                  data-copy-scene-link="${esc(product.slug)}"
                  data-scene-count="${Number(variant.sceneCount)}"
                  aria-label="Copiar link do ${esc(product.name)} com ${Number(variant.sceneCount)} cenas"
                >
                  Copiar link de ${Number(variant.sceneCount)} cena${Number(variant.sceneCount) === 1 ? '' : 's'}
                </button>
              ` : ''}

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

  panel.querySelectorAll('[data-copy-product-link]').forEach(button => {
    button.addEventListener('click', () => {
      const url = new URL(
        `/pedido/${button.dataset.copyProductLink}`, window.location.origin
      ).toString();
      copyProductUrl(url, 'Link do formato copiado ✓');
    });
  });

  panel.querySelectorAll('[data-copy-scene-link]').forEach(button => {
    button.addEventListener('click', () => {
      const scenes = Number(button.dataset.sceneCount);
      const url = sceneLinkUrl(
        window.location.origin, button.dataset.copySceneLink, scenes
      );
      copyProductUrl(url, `Link de ${scenes} cena${scenes === 1 ? '' : 's'} copiado ✓`);
    });
  });

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
