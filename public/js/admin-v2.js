import {
  bindNav,
  api,
  esc,
  loading,
  setBellCount,
  showToast,
  state,
} from './admin-v2-core.js';

import { initAdminDiagnostics } from './admin-v2-diagnostics.js';
import { initAdminFeatureFinder } from './admin-v2-find.js?v=20261124-admin-v3-86';

import {
  ensureAuth,
  logout,
} from './admin-v2-auth.js';

import {
  renderCentral,
} from './admin-v2-central.js?v=20261124-admin-v3-90';

import {
  renderProduction,
} from './admin-v2-production.js?v=20261124-admin-v3-87';

import {
  renderManualOrder,
} from './admin-v2-manual.js?v=108';

import {
  openOrder,
} from './admin-v2-order.js?v=20261124-admin-v3-83&detail=90';

import {
  renderAgenda,
} from './admin-v2-agenda.js?v=20261124-admin-v3-88';

import {
  renderFinance,
} from './admin-v2-finance.js?v=20261124-admin-v3-82&visual=88';

import {
  renderArchived,
} from './admin-v2-archived.js';

import {
  renderStore,
} from './admin-v2-config.js?v=20261124-v96';

import {
  refreshBell,
  renderNotifications,
} from './admin-v2-notifications.js';

import {
  renderSecurity,
} from './admin-v2-security.js';

const ADMIN_VIEWS =
  new Set([
    'central',
    'orders',
    'manual',
    'production',
    'agenda',
    'finance',
    'archived',
    'store',
    'notifications',
    'security',
  ]);

// Session-only view memory. Never persist client names, phones or free-text searches.
const viewMemory=new Map();let mountedView=null;
const rememberedControls={orders:['advOrderStatus','advOrderFamily','advOrderProduct','advOrderScenes','advOrderArchived','advOrderDate','advOrderFrom','advOrderTo'],production:['productionStatus','productionWhen'],finance:['financePreset','financeStart','financeEnd']};
function rememberView(){if(!mountedView||mountedView==='manual')return;const url=new URL(location.href),values={};for(const id of rememberedControls[mountedView]||[]){const el=document.getElementById(id);if(el)values[id]=el.value;}viewMemory.set(mountedView,{values,scroll:scrollY,params:Object.fromEntries(['storeTab','financeTab','service','artStage'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))});}
function restoreQuery(view,url){const saved=viewMemory.get(view);for(const key of ['storeTab','financeTab','service','artStage'])url.searchParams.delete(key);for(const [k,v] of Object.entries(saved?.params||{}))url.searchParams.set(k,v);}
function restoreView(view){const saved=viewMemory.get(view);if(!saved)return;const changed=[];for(const [id,value] of Object.entries(saved.values)){const el=document.getElementById(id);if(el&&el.value!==value){el.value=value;changed.push(el);}}for(const el of changed)el.dispatchEvent(new Event('change',{bubbles:true}));requestAnimationFrame(()=>{if(mountedView===view)scrollTo(0,saved.scroll);});}
function syncNavActive() {
  const more = document.getElementById('adminMoreMenu');
  const secondary = ['archived', 'notifications', 'security'].includes(state.view);
  if (more) {
    more.classList.toggle('has-active', secondary);
    if (secondary) more.open = true;
  }
  document
    .querySelectorAll('[data-view]')
    .forEach(
      (button) =>
        button.classList.toggle(
          'active',
          button.dataset.view
          === state.view,
        ),
    );
}

function applyInitialView() {
  const requested =
    new URLSearchParams(
      window.location.search,
    )
      .get(
        'view',
      );

  if (
    requested
    && ADMIN_VIEWS
      .has(
        requested,
      )
  ) {
    state.view =
      requested;
  }

  syncNavActive();
}

function syncViewQuery() {
  const url =
    new URL(
      window.location.href,
    );

  if (
    state.view
    && state.view
      !== 'central'
  ) {
    url.searchParams
      .set(
        'view',
        state.view,
      );
  } else {
    url.searchParams
      .delete(
        'view',
      );
  }

  if (state.view !== 'store') url.searchParams.delete('storeTab');
  if (state.view !== 'finance') url.searchParams.delete('financeTab');
  if (state.view !== 'production') {
    url.searchParams.delete('service');
    url.searchParams.delete('artStage');
  }

  history.replaceState(
    {},
    '',
    `${
      url.pathname
    }${
      url.search
    }${
      url.hash
    }`,
  );
}

let rendering=false;
async function renderCurrent() {
  if(rendering)return;rendering=true;
  const target=state.view;try{
  // Clear view-owned delegated handlers before mounting the next screen.
  const root=document.getElementById('viewRoot');root.onclick=null;root.onchange=null;
  loading();

  const open =
    async (code) =>
      openOrder(
        code,
        renderCurrent,
      );

  if (
    state.view === 'manual'
  ) {
    try {
      const {renderV3ManualOrder}=await import('./admin-v3-manual.js?v=108');
      await renderV3ManualOrder(renderManualOrder);
    } catch(error){
      root.innerHTML='<section class="card"><h2>Não foi possível preparar o novo pedido</h2><p>'+esc(error.message)+'</p><button type="button" class="btn btn-secondary" id="manualClassicFallback">Abrir pedido manual clássico</button></section>';
      root.querySelector('#manualClassicFallback').addEventListener('click',renderManualOrder);
    }
  } else if(state.view==='orders') {
    await renderCentral(open,{ordersOnly:true});
  } else if (
    state.view === 'production'
  ) {
    await renderProduction(open);
  } else if (
    state.view === 'agenda'
  ) {
    await renderAgenda(open);
  } else if (
    state.view === 'finance'
  ) {
    await renderFinance(open);
  } else if (
    state.view === 'archived'
  ) {
    await renderArchived(open);
  } else if (
    state.view === 'store'
  ) {
    await renderStore();
  } else if (
    state.view === 'notifications'
  ) {
    await renderNotifications();
  } else if (
    state.view === 'security'
  ) {
    await renderSecurity();
  } else {
    await renderCentral(open);
  }

  mountedView=target;restoreView(target);
  await refreshBell();
  }finally{rendering=false;}
}

async function navigateTo(view, storeTab, service) {
  if (!ADMIN_VIEWS.has(view)||rendering) return;
  rememberView();state.view = view;
  const more = document.getElementById('adminMoreMenu');
  if (more && !['archived', 'notifications', 'security'].includes(view)) more.open = false;
  const url = new URL(window.location.href);restoreQuery(view,url);
  if (view === 'production' && ['atelie','convites','retrospectivas'].includes(service)) {
    url.searchParams.set('service',service);
    url.searchParams.delete('artStage');
  }
  if (view === 'finance' && storeTab) url.searchParams.set('financeTab',storeTab);
  if (view === 'store' && storeTab) url.searchParams.set('storeTab', storeTab);
  else if (view !== 'store') url.searchParams.delete('storeTab');
  history.replaceState({}, '', url.pathname + url.search + url.hash);
  syncNavActive();
  syncViewQuery();
  scrollTo(0,0);await renderCurrent();
}

async function ready() {
  applyInitialView();

  bindNav(
    async (view) => {
      if(rendering){state.view=mountedView||state.view;syncNavActive();return;}
      try {
        await navigateTo(view);
      } catch (error) {
        document
          .getElementById('viewRoot')
          .innerHTML = `
            <div class="card empty">
              ${esc(error.message)}
            </div>
          `;
      }
    },
  );

  document
    .getElementById('refreshBtn')
    .addEventListener(
      'click',
      renderCurrent,
    );

  document.getElementById('notificationBell').addEventListener('click',
    () => navigateTo('notifications'));

  const rail=document.getElementById('adminRailToggle');let compact=false;try{compact=localStorage.getItem('libriAdminRail')==='compact';}catch{}
  function applyRail(){document.documentElement.classList.toggle('admin-rail-compact',compact);rail.setAttribute('aria-pressed',String(compact));rail.setAttribute('aria-label',compact?'Expandir menu':'Recolher menu');rail.title=rail.getAttribute('aria-label');}
  rail.addEventListener('click',()=>{compact=!compact;applyRail();try{localStorage.setItem('libriAdminRail',compact?'compact':'full');}catch{}});applyRail();
  initAdminFeatureFinder(navigateTo,{lookup:async q=>(await api('/api/admin/v2/orders/search?'+new URLSearchParams({q,archived:'all',limit:'6'}))).orders||[],openOrder:code=>openOrder(code,renderCurrent)});

  document
    .getElementById('logoutBtn')
    .addEventListener(
      'click',
      logout,
    );

  await renderCurrent();

  const orderCode =
    new URLSearchParams(
      window.location.search,
    )
      .get(
        'order',
      );

  if (
    orderCode
    && /^LIBRI-\d+$/
      .test(
        orderCode,
      )
  ) {
    try {
      await openOrder(
        orderCode,
        renderCurrent,
      );
    } finally {
      const cleanUrl =
        new URL(
          window.location.href,
        );

      cleanUrl.searchParams
        .delete(
          'order',
        );

      history.replaceState(
        {},
        '',
        `${
          cleanUrl.pathname
        }${
          cleanUrl.search
        }${
          cleanUrl.hash
        }`,
      );
    }
  }
}

window.addEventListener(
  'libri-admin-unauthorized',
  () => {
    setBellCount(0);
    location.reload();
  },
);

initAdminDiagnostics({ onCopied: () => showToast('Diagnóstico copiado. Cole aqui na conversa.') });

ensureAuth(ready)
  .catch(
    (error) => {
      document
        .getElementById('authGate')
        .classList
        .remove('hidden');

      document
        .getElementById('authGate')
        .innerHTML = `
          <section class="auth-card">
            <span class="eyebrow">Libri Gestão</span>
            <h1>Não foi possível abrir o painel</h1>
            <p>${esc(error.message)}</p>
          </section>
        `;
    },
  );
