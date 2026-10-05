import {
  api,
  setViewMeta,
  viewRoot,
} from './admin-v2-core.js';

import {
  renderStoreProducts,
  renderStoreAddons,
} from './admin-v2-store-products.js';

import {
  renderStoreSettings,
  renderStoreTerms,
  renderStoreContracts,
  renderStoreGallery,
} from './admin-v2-store-settings.js';

import {
  renderStoreCombos,
  renderStoreCoupons,
} from './admin-v2-store-commercial.js';

export async function renderStore() {
  setViewMeta(
    'Loja',
    'Catálogo e configurações',
  );

  const data =
    await api(
      '/api/admin/v2/store-config',
    );

  const config =
    data.config;

  viewRoot.innerHTML = `
    <div class="settings-tabs">
      <button class="settings-tab active" data-store-tab="products">Produtos</button>
      <button class="settings-tab" data-store-tab="addons">Adicionais</button>
      <button class="settings-tab" data-store-tab="combos">Combos</button>
      <button class="settings-tab" data-store-tab="coupons">Cupons</button>
      <button class="settings-tab" data-store-tab="settings">Configurações</button>
      <button class="settings-tab" data-store-tab="terms">Termos</button>
      <button class="settings-tab" data-store-tab="contracts">Modelo de contrato</button>
      <button class="settings-tab" data-store-tab="gallery">Galeria</button>
    </div>

    <div id="storePanel"></div>
  `;

  const panel =
    document.getElementById(
      'storePanel',
    );

  const renderTab =
    (tab) => {
      document
        .querySelectorAll(
          '[data-store-tab]',
        )
        .forEach(
          (button) =>
            button.classList.toggle(
              'active',
              button.dataset.storeTab
              === tab,
            ),
        );

      if (
        tab === 'products'
      ) {
        renderStoreProducts(
          panel,
          config,
          renderStore,
        );
        return;
      }

      if (
        tab === 'addons'
      ) {
        renderStoreAddons(
          panel,
          config,
          renderStore,
        );
        return;
      }

      if (
        tab === 'combos'
      ) {
        renderStoreCombos(
          panel,
          config,
          renderStore,
        );
        return;
      }

      if (
        tab === 'coupons'
      ) {
        renderStoreCoupons(
          panel,
          config,
          renderStore,
        );
        return;
      }

      if (
        tab === 'settings'
      ) {
        renderStoreSettings(
          panel,
          config,
        );
        return;
      }

      if (
        tab === 'terms'
      ) {
        renderStoreTerms(
          panel,
          config,
          renderStore,
        );
        return;
      }

      if (
        tab === 'contracts'
      ) {
        renderStoreContracts(
          panel,
          config,
          renderStore,
        );
        return;
      }

      renderStoreGallery(
        panel,
        config,
        renderStore,
      );
    };

  document
    .querySelectorAll(
      '[data-store-tab]',
    )
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          () =>
            renderTab(
              button.dataset.storeTab,
            ),
        ),
    );

  renderTab(
    'products',
  );
}
