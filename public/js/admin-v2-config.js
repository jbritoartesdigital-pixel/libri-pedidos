import {
  api,
  setViewMeta,
  viewRoot,
} from './admin-v2-core.js';

import {
  renderStoreProducts,
  renderStoreAddons,
} from './admin-v2-store-products.js?v=20261026-scene-links-1';

import {
  renderStoreSettings,
  renderStoreTerms,
  renderStoreContracts,
  renderStoreGallery,
} from './admin-v2-store-settings.js?v=20261008-growth-1';

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
    <div class="store-navigation" aria-label="Organização da loja">
      <div class="store-navigation-group">
        <span class="store-navigation-label">Catálogo</span>
        <div class="store-navigation-buttons">
          <button type="button" class="settings-tab active" data-store-tab="products">Produtos</button>
          <button type="button" class="settings-tab" data-store-tab="addons">Adicionais</button>
          <button type="button" class="settings-tab" data-store-tab="combos">Combos</button>
          <button type="button" class="settings-tab" data-store-tab="gallery">Galeria</button>
        </div>
      </div>
      <div class="store-navigation-group">
        <span class="store-navigation-label">Promoções</span>
        <div class="store-navigation-buttons">
          <button type="button" class="settings-tab" data-store-tab="coupons">Cupons</button>
        </div>
      </div>
      <div class="store-navigation-group">
        <span class="store-navigation-label">Administração</span>
        <div class="store-navigation-buttons">
          <button type="button" class="settings-tab" data-store-tab="settings">Configurações</button>
          <button type="button" class="settings-tab" data-store-tab="terms">Termos</button>
          <button type="button" class="settings-tab" data-store-tab="contracts">Contratos</button>
        </div>
      </div>
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

  const availableTabs = new Set([
    'products', 'addons', 'combos', 'gallery',
    'coupons', 'settings', 'terms', 'contracts',
  ]);
  document.querySelectorAll('[data-store-tab]').forEach(button =>
    button.addEventListener('click', () => {
      const tab = button.dataset.storeTab;
      if (!availableTabs.has(tab)) return;
      const url = new URL(window.location.href);
      url.searchParams.set('storeTab', tab);
      history.replaceState({}, '', url.pathname + url.search + url.hash);
      renderTab(tab);
    })
  );

  const initial = new URLSearchParams(window.location.search).get('storeTab');
  renderTab(availableTabs.has(initial) ? initial : 'products');
}
