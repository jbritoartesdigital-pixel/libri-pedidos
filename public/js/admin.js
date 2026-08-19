const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = { orders: [], current: null, settings: null };

function esc(v = '') {
  return String(v).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}
function money(cents = 0) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
}
function formatDate(v) {
  if (!v) return 'Não informado';
  const [y,m,d] = String(v).split('-');
  return y && m && d ? `${d}/${m}/${y}` : v;
}
function formatDateTime(v) {
  if (!v) return 'Não informado';
  try { return new Intl.DateTimeFormat('pt-BR', { dateStyle:'short', timeStyle:'short' }).format(new Date(v)); } catch { return v; }
}
function whatsappLink(number, text) {
  let digits = String(number || '').replace(/\D/g, '');
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) digits = `55${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
function todayISO() {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function statusLabel(s) {
  return ({ new:'Novo', ready:'Pronto para produção', producing:'Em produção', waiting_client:'Aguardando cliente', revisions:'Ajustes', waiting_balance:'Aguardando saldo', finished:'Finalizado', cancelled:'Cancelado' })[s] || s;
}
function productLabel(order) {
  const exp = order.experience === 'reduced' ? 'Reduzido' : 'Completo';
  const format = order.format === 'interactive' ? 'Interativo' : 'Vídeo';
  return `${format} ${exp}`;
}
function badgeClass(status) {
  if (['finished','ready'].includes(status)) return 'green';
  if (['waiting_client','waiting_balance'].includes(status)) return 'yellow';
  if (status === 'cancelled') return 'red';
  if (status === 'revisions') return 'purple';
  return '';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type':'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Erro ao concluir a ação.'), { data, status: response.status });
  return data;
}

async function loadOrders() {
  const search = $('#search').value.trim();
  const status = $('#statusFilter').value;
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (status) qs.set('status', status);
  const data = await api(`/api/admin/orders?${qs.toString()}`);
  state.orders = data.orders || [];
  renderKpis();
  renderOrders();
}

function renderKpis() {
  const today = todayISO();
  const countToday = state.orders.filter(o => o.eventDate === today).length;
  const producing = state.orders.filter(o => o.status === 'producing').length;
  const waiting = state.orders.filter(o => o.status === 'waiting_client').length;
  const balance = state.orders.filter(o => o.status === 'waiting_balance').length;
  $('#kpis').innerHTML = [
    ['🎂 Festas hoje', countToday],
    ['🟢 Em produção', producing],
    ['🟡 Aguardando cliente', waiting],
    ['💰 Aguardando saldo', balance],
  ].map(([label,count]) => `<div class="kpi"><span class="muted small">${label}</span><strong>${count}</strong></div>`).join('');
}

function renderOrders() {
  if (!state.orders.length) {
    $('#ordersList').innerHTML = '<div class="card"><p class="muted">Nenhum pedido encontrado.</p></div>';
    return;
  }
  const today = todayISO();
  $('#ordersList').innerHTML = state.orders.map((o) => {
    const festaHoje = o.eventDate === today;
    return `<article class="order-card">
      <div>
        <div class="order-title">${esc(o.orderCode)} | ${esc(o.displayName || o.honoreeName)}${o.age ? ` • ${esc(o.age)} ano(s)` : ''}</div>
        <div class="order-meta"><strong>Tema:</strong> ${esc(o.theme || 'Não informado')}<br><strong>Festa:</strong> ${formatDate(o.eventDate)}${o.eventTime ? ` • ${esc(o.eventTime)}` : ''}<br><strong>Tipo:</strong> ${esc(productLabel(o))}</div>
        <div class="badges">
          <span class="badge ${badgeClass(o.status)}">${esc(statusLabel(o.status))}</span>
          ${o.urgencyEnabled ? '<span class="badge red">⚡ Urgente</span>' : ''}
          ${festaHoje ? '<span class="badge purple">🎂 Festa hoje</span>' : ''}
          ${o.photosStatus === 'needs_new' ? '<span class="badge yellow">📸 Novas fotos</span>' : ''}
        </div>
        <div class="muted small" style="margin-top:9px"><strong>Próxima ação:</strong> ${esc(o.nextAction || '')}</div>
      </div>
      <div class="stack">
        <button class="btn btn-primary btn-small" data-open="${o.id}">Abrir pedido</button>
        <a class="btn btn-secondary btn-small" style="text-align:center;text-decoration:none" href="${whatsappLink(o.whatsapp, `Oi! Estou entrando em contato sobre o seu pedido ${o.orderCode} na Libri Convites. 💛`)}" target="_blank" rel="noopener">WhatsApp</a>
        ${festaHoje ? `<a class="btn btn-secondary btn-small" style="text-align:center;text-decoration:none" href="${whatsappLink(o.whatsapp, 'Oi! Passando para desejar um dia lindo para vocês e uma comemoração muito especial! 💛 Que seja um momento cheio de carinho e boas lembranças. Um beijo, Libri Convites ✨')}" target="_blank" rel="noopener">🎉 Parabenizar</a>` : ''}
      </div>
    </article>`;
  }).join('');
  $$('[data-open]').forEach((b) => b.onclick = () => openOrder(Number(b.dataset.open)));
}

async function openOrder(id) {
  const data = await api(`/api/admin/orders/${id}`);
  state.current = data.order;
  renderDetail();
  $('#adminModal').classList.remove('hidden');
}

function detailLine(label, value) { return `<div class="statline"><span class="muted">${label}</span><strong>${value}</strong></div>`; }
function selectHtml(id, value, options) {
  return `<select id="${id}">${options.map(([v,l]) => `<option value="${v}" ${value===v?'selected':''}>${l}</option>`).join('')}</select>`;
}
function safeJson(obj) { return esc(JSON.stringify(obj || {}, null, 2)); }

function renderDetail() {
  const o = state.current;
  if (!o) return;
  $('#detailTitle').textContent = `${o.order_code} | ${o.display_name || o.honoree_name}`;
  const b = o.briefing || {};
  const addons = o.addons || {};
  const today = todayISO();
  const festaHoje = o.event_date === today;

  const summary = `${o.display_name || o.honoree_name}, ${o.age || ''} ano(s). Tema ${o.theme || 'não informado'}. ${productLabel({experience:o.experience,format:o.format})}. Estilo da criança: ${b.childStyle || 'não informado'}. Roupa: ${b.outfitChoice || 'não informado'}. Falas: ${b.speechPreference || 'não informado'}.`;

  $('#detailBody').innerHTML = `
    <div class="notice notice-success"><strong>Próxima ação:</strong> ${esc(o.nextAction || '')}</div>
    <div class="row" style="margin:14px 0">
      <a class="btn btn-primary btn-small" href="${whatsappLink(o.whatsapp, `Oi! Estou entrando em contato sobre o seu pedido ${o.order_code} na Libri Convites. 💛`)}" target="_blank" rel="noopener">📲 Chamar cliente</a>
      <a class="btn btn-secondary btn-small" href="${whatsappLink(o.whatsapp, `Oi! Sobre o pedido ${o.order_code}: preciso de novas fotos para conseguirmos seguir com a criação. Vou te orientar por aqui. 💛`)}" target="_blank" rel="noopener">Pedir novas fotos</a>
      <a class="btn btn-secondary btn-small" href="${whatsappLink(o.whatsapp, `Oi! Passando para lembrar que estou aguardando seu retorno sobre o pedido ${o.order_code}. 💛`)}" target="_blank" rel="noopener">Cobrar retorno</a>
      <a class="btn btn-secondary btn-small" href="${whatsappLink(o.whatsapp, `Oi! Seu convite do pedido ${o.order_code} foi aprovado. Agora falta apenas o saldo final para eu liberar a entrega. 💛`)}" target="_blank" rel="noopener">Cobrar saldo</a>
      ${festaHoje ? `<a class="btn btn-secondary btn-small" href="${whatsappLink(o.whatsapp, 'Oi! Passando para desejar um dia lindo para vocês e uma comemoração muito especial! 💛 Que seja um momento cheio de carinho e boas lembranças. Um beijo, Libri Convites ✨')}" target="_blank" rel="noopener">🎉 Parabenizar</a>` : ''}
    </div>

    <div class="detail-grid">
      <section class="detail-card">
        <h3>Pedido</h3>
        ${detailLine('Tema', esc(o.theme || 'Não informado'))}
        ${detailLine('Festa', `${formatDate(o.event_date)}${o.event_time ? ` • ${esc(o.event_time)}` : ''}`)}
        ${detailLine('Tipo', esc(productLabel({experience:o.experience,format:o.format})))}
        ${detailLine('Status', esc(statusLabel(o.status)))}
        ${detailLine('Prazo', esc(o.deadline_override_at || o.production_deadline_at ? formatDateTime(o.deadline_override_at || o.production_deadline_at) : 'Ainda não iniciado'))}
      </section>

      <section class="detail-card">
        <h3>Valores</h3>
        ${detailLine('Total', money(o.total_cents))}
        ${detailLine('Entrada', `${money(o.deposit_cents)} • ${o.entry_status === 'confirmed' ? '✅ confirmada' : '⏳ aguardando'}`)}
        ${detailLine('Saldo', `${money(o.balance_cents)} • ${o.balance_status === 'confirmed' ? '✅ confirmado' : '⏳ aguardando'}`)}
        ${detailLine('Urgência', o.urgency_enabled ? `⚡ +${o.urgency_percent}%` : 'Não')}
        <label class="checkline"><input id="urgencyToggle" type="checkbox" ${o.urgency_enabled ? 'checked':''}><span>Urgência aprovada</span></label>
      </section>

      <section class="detail-card full">
        <h3>Briefing para produção</h3>
        <div class="prewrap">${esc(summary)}</div>
        <div class="row" style="margin-top:10px"><button class="btn btn-secondary btn-small" id="copyBriefing">Copiar resumo</button><button class="btn btn-secondary btn-small" id="fullBriefing">Ver respostas completas</button></div>
      </section>

      <section class="detail-card">
        <h3>Fotos e pagamento</h3>
        <div class="status-row"><span>Fotos</span>${selectHtml('photosStatus', o.photos_status, [['waiting','Aguardando'],['received','Recebidas'],['approved','Aprovadas'],['needs_new','Precisa de novas fotos']])}</div>
        <div class="field"><label>Motivo / observação das fotos</label><input id="photosNote" value="${esc(o.photos_note || '')}" placeholder="Ex.: precisa de foto de frente"></div>
        <div class="status-row"><span>Entrada</span>${selectHtml('entryStatus', o.entry_status, [['waiting','Aguardando'],['confirmed','Confirmada']])}</div>
        <div class="status-row"><span>Saldo</span>${selectHtml('balanceStatus', o.balance_status, [['waiting','Aguardando'],['confirmed','Confirmado']])}</div>
        <button class="btn btn-primary btn-small" id="saveStatuses">Salvar status</button>
      </section>

      <section class="detail-card">
        <h3>Produção</h3>
        <div class="status-row"><span>Mascote</span>${selectHtml('mascotStatus', o.mascot_status, [['waiting','Aguardando'],['sent','Enviado'],['approved','Aprovado']])}</div>
        <div class="muted small">Ajustes: ${o.mascot_revisions}/2</div>
        <div class="row"><button class="btn btn-secondary btn-small" data-revision="mascot">Registrar ajuste</button><button class="btn btn-secondary btn-small" data-approve="mascot">Aprovar mascote</button></div>
        <div class="status-row"><span>Falas</span>${selectHtml('speechStatus', o.speech_status, [['not_required','Sem aprovação'],['waiting','Aguardando'],['sent','Enviadas'],['approved','Aprovadas']])}</div>
        <div class="muted small">Ajustes: ${o.speech_revisions}/1</div>
        <div class="row"><button class="btn btn-secondary btn-small" data-revision="speech">Registrar ajuste</button><button class="btn btn-secondary btn-small" data-approve="speech">Aprovar falas</button></div>
        <div class="status-row"><span>Convite</span>${selectHtml('invitationStatus', o.invitation_status, [['waiting','Aguardando'],['producing','Em produção'],['sent','Enviado'],['approved','Aprovado']])}</div>
        <div class="muted small">Ajustes: ${o.invitation_revisions}/2</div>
        <div class="row"><button class="btn btn-secondary btn-small" data-revision="invitation">Registrar ajuste</button><button class="btn btn-secondary btn-small" data-approve="invitation">Aprovar convite</button></div>
      </section>

      <section class="detail-card">
        <h3>Prazo</h3>
        ${detailLine('Início', formatDateTime(o.production_started_at))}
        ${detailLine('Pausado em', formatDateTime(o.production_paused_at))}
        ${detailLine('Previsão', formatDateTime(o.deadline_override_at || o.production_deadline_at))}
        <div class="row" style="margin-top:10px">
          <button class="btn btn-primary btn-small" id="startProduction" ${o.production_started_at ? 'disabled':''}>Iniciar produção</button>
          <button class="btn btn-secondary btn-small" id="pauseProduction" ${!o.production_started_at || o.production_paused_at ? 'disabled':''}>Pausar</button>
          <button class="btn btn-secondary btn-small" id="resumeProduction" ${!o.production_paused_at ? 'disabled':''}>Retomar</button>
        </div>
        <button class="btn btn-secondary btn-small" id="finishOrder" style="margin-top:10px">Finalizar pedido</button>
      </section>

      <section class="detail-card">
        <h3>Recursos contratados</h3>
        ${detailLine('Confirmação Libri', addons.confirmation ? '✅ Sim' : 'Não')}
        ${detailLine('Filtro', addons.filter ? '✅ Sim' : 'Não')}
        ${detailLine('Cena extra', esc(addons.extraScene || 0))}
        ${detailLine('Pessoa extra', esc(addons.extraPerson || 0))}
      </section>

      <section class="detail-card">
        <h3>Termos</h3>
        ${detailLine('Versão', esc(o.terms_version))}
        ${detailLine('Aceite', formatDateTime(o.terms_accepted_at))}
        ${detailLine('Divulgação', o.portfolio_consent ? '✅ Autorizada' : '🚫 Não autorizada')}
      </section>

      <section class="detail-card full">
        <h3>Observações da Libri</h3>
        <div class="field"><textarea id="newNote" placeholder="Escreva uma observação interna"></textarea></div>
        <button class="btn btn-secondary btn-small" id="addNote">Adicionar observação</button>
        <div class="history" style="margin-top:12px">${(o.notes || []).map(n => `<div class="history-item">${esc(n.note)}<time>${formatDateTime(n.created_at)}</time></div>`).join('') || '<span class="muted small">Nenhuma observação.</span>'}</div>
      </section>

      <section class="detail-card full">
        <h3>Histórico</h3>
        <div class="history">${(o.history || []).map(h => `<div class="history-item">${esc(h.description)}<time>${formatDateTime(h.created_at)}</time></div>`).join('') || '<span class="muted small">Sem histórico.</span>'}</div>
      </section>
    </div>`;

  $('#copyBriefing').onclick = async () => { await navigator.clipboard.writeText(summary); $('#copyBriefing').textContent = 'Copiado ✓'; };
  $('#fullBriefing').onclick = () => alert(JSON.stringify(b, null, 2));
  $('#urgencyToggle').onchange = async (e) => { await patchCurrent({ urgency_enabled:e.target.checked }); };
  $('#saveStatuses').onclick = async () => patchCurrent({ photos_status:$('#photosStatus').value, photos_note:$('#photosNote').value, entry_status:$('#entryStatus').value, balance_status:$('#balanceStatus').value, mascot_status:$('#mascotStatus').value, speech_status:$('#speechStatus').value, invitation_status:$('#invitationStatus').value });
  $$('[data-revision]').forEach(btn => btn.onclick = () => actionCurrent('revision', { stage:btn.dataset.revision }));
  $$('[data-approve]').forEach(btn => btn.onclick = () => actionCurrent('approve', { stage:btn.dataset.approve }));
  $('#startProduction').onclick = () => actionCurrent('start-production', {});
  $('#pauseProduction').onclick = () => actionCurrent('pause', { reason:'Aguardando cliente' });
  $('#resumeProduction').onclick = () => actionCurrent('resume', {});
  $('#finishOrder').onclick = () => actionCurrent('finish', {});
  $('#addNote').onclick = async () => {
    const note = $('#newNote').value.trim();
    if (!note) return;
    await api(`/api/admin/orders/${o.id}/notes`, { method:'POST', body:JSON.stringify({note}) });
    await reopenCurrent();
  };
}

async function patchCurrent(payload) {
  try {
    const data = await api(`/api/admin/orders/${state.current.id}`, { method:'PATCH', body:JSON.stringify(payload) });
    state.current = data.order;
    renderDetail();
    await loadOrders();
  } catch (e) { alert(e.message); }
}
async function actionCurrent(action, payload) {
  try {
    await api(`/api/admin/orders/${state.current.id}/${action}`, { method:'POST', body:JSON.stringify(payload || {}) });
    await reopenCurrent();
    await loadOrders();
  } catch (e) {
    const extra = e.data?.details?.blockers ? `\n${e.data.details.blockers.join('\n')}` : '';
    alert(`${e.message}${extra}`);
  }
}
async function reopenCurrent() {
  const data = await api(`/api/admin/orders/${state.current.id}`);
  state.current = data.order;
  renderDetail();
}

async function loadSettings() {
  const data = await api('/api/admin/settings');
  state.settings = data.settings;
  renderSettings();
}
function reaisFromCents(v) { return ((Number(v)||0)/100).toFixed(2).replace('.',','); }
function centsFromReais(v) { return Math.round(Number(String(v).replace('.','').replace(',','.')) * 100) || 0; }
function field(label, key, value, type='text', hint='') {
  return `<div class="field"><label>${label}</label><input data-setting="${key}" type="${type}" value="${esc(value)}">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
}
function renderSettings() {
  const s = state.settings || {};
  $('#settingsForm').innerHTML = `
    <div class="settings-section"><h3>Produtos</h3><div class="settings-grid">
      ${field('Vídeo Completo','price_video_full_cents',reaisFromCents(s.price_video_full_cents))}
      ${field('Vídeo Reduzido','price_video_reduced_cents',reaisFromCents(s.price_video_reduced_cents))}
      ${field('Interativo Completo','price_interactive_full_cents',reaisFromCents(s.price_interactive_full_cents))}
      ${field('Interativo Reduzido','price_interactive_reduced_cents',reaisFromCents(s.price_interactive_reduced_cents))}
    </div></div>
    <div class="settings-section"><h3>Adicionais</h3><div class="settings-grid">
      ${field('Confirmação Libri','addon_confirmation_cents',reaisFromCents(s.addon_confirmation_cents))}
      ${field('Filtro','addon_filter_cents',reaisFromCents(s.addon_filter_cents))}
      ${field('Cena extra','addon_extra_scene_cents',reaisFromCents(s.addon_extra_scene_cents))}
      ${field('Pessoa extra','addon_extra_person_cents',reaisFromCents(s.addon_extra_person_cents))}
    </div></div>
    <div class="settings-section"><h3>Regras</h3><div class="settings-grid">
      ${field('Entrada (%)','deposit_percent',s.deposit_percent,'number')}
      ${field('Urgência (%)','urgency_percent',s.urgency_percent,'number')}
      ${field('Prazo padrão (dias úteis)','deadline_business_days',s.deadline_business_days,'number')}
    </div></div>
    <div class="settings-section"><h3>Pagamento e contato</h3><div class="settings-grid">
      ${field('Chave Pix','pix_key',s.pix_key || '')}
      ${field('Nome do recebedor','pix_recipient_name',s.pix_recipient_name || '')}
      ${field('WhatsApp da Libri','libri_whatsapp',s.libri_whatsapp || '','text','Use DDI + DDD + número, somente números se preferir.')}
    </div></div>
    <div class="settings-section"><h3>Exemplos</h3><div class="settings-grid">
      ${field('Interativo Completo','example_interactive_full_url',s.example_interactive_full_url || '')}
      ${field('Interativo Reduzido','example_interactive_reduced_url',s.example_interactive_reduced_url || '')}
      ${field('Vídeo Completo','example_video_full_url',s.example_video_full_url || '')}
      ${field('Vídeo Reduzido','example_video_reduced_url',s.example_video_reduced_url || '')}
      ${field('Exemplo confirmação','example_confirmation_url',s.example_confirmation_url || '')}
      ${field('Exemplo filtro','example_filter_url',s.example_filter_url || '')}
    </div></div>
    <button class="btn btn-primary" type="submit">Salvar configurações</button>`;
}

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = {};
  $$('[data-setting]', e.currentTarget).forEach(inp => {
    const k = inp.dataset.setting;
    out[k] = k.endsWith('_cents') ? centsFromReais(inp.value) : inp.value;
  });
  await api('/api/admin/settings', { method:'PUT', body:JSON.stringify({settings:out}) });
  alert('Configurações salvas.');
  await loadSettings();
});

$$('[data-tab]').forEach(btn => btn.onclick = async () => {
  const tab = btn.dataset.tab;
  $('#ordersTab').classList.toggle('hidden', tab !== 'orders');
  $('#settingsTab').classList.toggle('hidden', tab !== 'settings');
  $$('[data-tab]').forEach(b => b.className = `btn ${b.dataset.tab===tab?'btn-primary':'btn-secondary'} btn-small`);
  if (tab === 'settings' && !state.settings) await loadSettings();
});

$('#refreshOrders').onclick = loadOrders;
$('#statusFilter').onchange = loadOrders;
let searchTimer;
$('#search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadOrders, 300); };
$('#closeAdminModal').onclick = () => $('#adminModal').classList.add('hidden');
$('#adminModal').onclick = (e) => { if (e.target.id === 'adminModal') e.currentTarget.classList.add('hidden'); };

loadOrders().catch((e) => {
  $('#ordersList').innerHTML = `<div class="card"><strong>Não foi possível carregar o painel.</strong><p class="muted">${esc(e.message)}</p><p class="muted small">Em produção, confirme que /admin/* e /api/admin/* estão protegidos pelo Cloudflare Access.</p></div>`;
});
