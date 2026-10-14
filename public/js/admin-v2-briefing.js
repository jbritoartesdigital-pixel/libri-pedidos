import { api, esc, showToast } from './admin-v2-core.js';

// Single compact editor inside "Abrir briefing". No customer impersonation,
// automatic consent, automatic WhatsApp connection, or local draft storage.
const protectedField = key =>
  /(?:^|_)(?:confirmed|approved|accepted|consent|declaration|signature)(?:$|_)/i.test(key);

const filled = value => Array.isArray(value)
  ? value.length > 0 : value !== null && value !== undefined && String(value).trim() !== '';

const normalize = text => String(text || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function control(field, value, origin) {
  const key = esc(field.key), label = esc(field.label);
  const protectedAnswer = protectedField(field.key);
  const title = `<label for="admin-bf-${key}">${label}${field.required ? ' *' : ''}</label>`;
  const source = origin ? '<small class="admin-bf-origin">Registrado pelo WhatsApp</small>' : '';
  const help = field.help ? `<small class="admin-bf-help">${esc(field.help)}</small>` : '';
  const hasValue = filled(value);
  if (protectedAnswer) return `
    <div class="field full admin-bf-field">
      <strong>${label}${field.required ? ' *' : ''}</strong>
      <small class="admin-bf-help">Confirmação exclusiva da cliente. Não pode ser marcada pela administradora.</small>
      <span class="admin-bf-readonly">${hasValue ? esc(String(value)) : 'Ainda não confirmada'}</span>
    </div>`;
  let input = '';
  if (field.type === 'choice') {
    input = `<select class="select" id="admin-bf-${key}" data-admin-bf="${key}">
      <option value="">Selecione</option>
      ${(field.options || []).map(opt => `<option value="${esc(opt.value)}"
        ${opt.value === value ? 'selected' : ''}>${esc(opt.label)}</option>`).join('')}
    </select>`;
  } else if (field.type === 'multi_choice') {
    const values = Array.isArray(value) ? value : [];
    input = `<div class="admin-bf-options" data-admin-bf-multi="${key}">
      ${(field.options || []).map(opt => `<label class="admin-bf-check">
        <input type="checkbox" value="${esc(opt.value)}" ${values.includes(opt.value) ? 'checked' : ''}>
        <span>${esc(opt.label)}</span></label>`).join('')}
    </div>`;
  } else if (field.type === 'textarea') {
    input = `<textarea class="textarea" id="admin-bf-${key}"
      data-admin-bf="${key}" rows="3">${esc(value ?? '')}</textarea>`;
  } else {
    const type = ['text', 'number', 'time', 'url', 'date'].includes(field.type) ? field.type : 'text';
    input = `<input class="input" id="admin-bf-${key}" data-admin-bf="${key}"
      type="${type}" value="${esc(value ?? '')}"
      ${field.min != null ? `min="${Number(field.min)}"` : ''}
      ${field.max != null ? `max="${Number(field.max)}"` : ''}>`;
  }
  return `<div class="field full admin-bf-field">${title}${input}${source}${help}</div>`;
}

function missingHtml(state) {
  if (!state.missing.length) return '<p class="admin-bf-ok">✓ Todos os campos obrigatórios estão completos.</p>';
  return `<details class="admin-bf-missing"><summary>
    ${state.missing.length} ${state.missing.length === 1 ? 'pendência' : 'pendências'} para concluir
  </summary><ul>${state.missing.map(item => `<li>${esc(item.message)}</li>`).join('')}</ul></details>`;
}

function uploadHtml(state, section) {
  const rules = state.schema.uploadRules.filter(rule =>
    (section.id === 'appearance' && ['person_photos', 'outfit_photos'].includes(rule.fieldKey))
    || (section.id === 'references' && rule.fieldKey === 'reference_files'));
  if (!rules.length) return '';
  return `<div class="admin-bf-uploads">${rules.map(rule => {
    const existing = state.uploads.filter(file => file.fieldKey === rule.fieldKey);
    return `<section class="admin-bf-upload">
      <strong>${esc(rule.label)}</strong>
      <small>${esc(rule.help || '')} • ${existing.length}/${rule.max}</small>
      ${existing.map(file => `<div class="admin-bf-file">
        <a href="${esc(file.contentPath)}?download=1" target="_blank" rel="noopener">
          ${esc(file.originalFilename)}</a>
        <input class="input" data-admin-file-note="${Number(file.id)}"
          aria-label="Observação do arquivo" value="${esc(file.note || '')}"
          placeholder="Observação da referência">
        <button class="btn btn-ghost btn-small" data-admin-save-file-note="${Number(file.id)}"
          type="button">Salvar observação</button>
      </div>`).join('')}
      ${existing.length < rule.max ? `
        <label class="btn btn-secondary btn-small admin-bf-upload-button">
          Anexar do WhatsApp
          <input type="file" multiple hidden data-admin-upload="${esc(rule.fieldKey)}"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf">
        </label>` : ''}
    </section>`;
  }).join('')}</div>`;
}

export function bindAdminWhatsAppBriefing(code, onChanged = null) {
  const toggle = document.getElementById('editOrderBriefing');
  const host = document.getElementById('adminBriefingEditor');
  if (!toggle || !host) return;
  let state = null, sectionIndex = 0, busy = false, dirty = false;
  const base = '/api/admin/v2/orders/' + encodeURIComponent(code) + '/briefing';

  function collect(section) {
    const patch = {};
    for (const field of section.fields) {
      if (protectedField(field.key)) continue;
      if (field.type === 'multi_choice') {
        const parent = host.querySelector('[data-admin-bf-multi="' + field.key + '"]');
        if (parent) patch[field.key] = [...parent.querySelectorAll('input:checked')]
          .map(item => item.value);
      } else {
        const input = host.querySelector('[data-admin-bf="' + field.key + '"]');
        if (input) patch[field.key] = input.value;
      }
    }
    return patch;
  }

  async function refresh() {
    const result = await api(base);
    state = result.briefing;
    sectionIndex = Math.min(sectionIndex, Math.max(0, state.schema.sections.length - 1));
    dirty = false;
    render();
  }

  function render() {
    const blocked = state.status === 'locked'
      || ['cancelled', 'finalized'].includes(state.orderStatus);
    const completed = state.status === 'completed';
    const section = state.schema.sections[sectionIndex];
    if (!section) { host.textContent = 'Nenhuma pergunta disponível neste pedido.'; return; }
    const sections = state.schema.sections;
    host.innerHTML = `
      <div class="admin-bf-heading">
        <div><h4>Preencher briefing pela cliente</h4>
          <small>Origem: WhatsApp • alterações com histórico no pedido</small></div>
        <span class="status">${Number(state.progress || 0)}% completo</span>
      </div>
      ${blocked ? `<p class="notice info"> ${state.status === 'locked'
        ? 'Aguardando confirmação do pagamento exigido. O preenchimento continua bloqueado.'
        : 'Pedido encerrado. Edição administrativa indisponível.'}</p>` : ''}
      ${completed ? '<p class="admin-bf-ok">Briefing concluído. Correções posteriores são registradas sem reabrir a produção.</p>' : ''}
      ${missingHtml(state)}
      ${!blocked && !completed ? `
        <details class="admin-bf-paste">
          <summary>Colar mensagem recebida no WhatsApp</summary>
          <textarea class="textarea" id="adminWhatsAppPaste" rows="4"
            placeholder="Cole as respostas. Linhas no formato Pergunta: resposta podem gerar sugestões."></textarea>
          <button class="btn btn-secondary btn-small" type="button" id="adminBriefingSuggest">Sugerir campos</button>
          <p id="adminBriefingSuggestions" class="admin-bf-help" aria-live="polite">
            As sugestões não são salvas automaticamente e nunca preenchem consentimentos.</p>
        </details>` : ''}
      <div class="admin-bf-steps" role="tablist" aria-label="Etapas do briefing">
        ${sections.map((step, i) => `<button type="button" role="tab"
          class="admin-bf-step ${i === sectionIndex ? 'active' : ''}" data-admin-bf-step="${i}"
          aria-selected="${i === sectionIndex}">${i + 1}. ${esc(step.title)}</button>`).join('')}
      </div>
      <h4>${esc(section.title)}</h4>
      ${section.description ? `<p class="admin-bf-help">${esc(section.description)}</p>` : ''}
      <div class="admin-bf-fields">
        ${section.fields.map(field => control(field, state.data[field.key], state.fieldOrigins[field.key])).join('')}
      </div>
      ${uploadHtml(state, section)}
      <div class="admin-bf-actions">
        <button class="btn btn-primary" id="adminBriefingSave" type="button"
          ${blocked ? 'disabled' : ''}>Salvar alterações</button>
        ${!blocked && !completed && !state.missing.length ? `
          <button class="btn btn-secondary" id="adminBriefingComplete" type="button">
            Concluir briefing</button>` : ''}
        <small id="adminBriefingStatus" aria-live="polite">Salvamento manual, sem alterar pagamentos.</small>
      </div>`;
    host.querySelectorAll('[data-admin-bf], [data-admin-bf-multi] input').forEach(input => {
      input.addEventListener('input', () => { dirty = true; });
      input.addEventListener('change', () => { dirty = true; });
    });
    host.querySelectorAll('[data-admin-bf-step]').forEach(button =>
      button.addEventListener('click', () => {
        if (dirty && !confirm('Há alterações não salvas. Trocar de etapa sem salvar?')) return;
        sectionIndex = Number(button.dataset.adminBfStep);
        dirty = false;
        render();
      }));
    host.querySelector('#adminBriefingSave')?.addEventListener('click', save);
    host.querySelector('#adminBriefingComplete')?.addEventListener('click', complete);
    host.querySelector('#adminBriefingSuggest')?.addEventListener('click', suggest);
    host.querySelectorAll('[data-admin-upload]').forEach(input =>
      input.addEventListener('change', () => upload(input)));
    host.querySelectorAll('[data-admin-save-file-note]').forEach(button =>
      button.addEventListener('click', () => saveNote(button)));
  }

  async function save() {
    if (busy || !state) return;
    busy = true;
    const button = host.querySelector('#adminBriefingSave');
    if (button) button.disabled = true;
    try {
      await api(base, { method: 'PATCH', body: JSON.stringify({
        data: collect(state.schema.sections[sectionIndex]),
        currentSection: state.schema.sections[sectionIndex].id,
        expectedUpdatedAt: state.updatedAt,
      }) });
      await refresh();
      showToast('Respostas do WhatsApp salvas no pedido ✓');
      if (onChanged) await onChanged();
    } catch (error) {
      showToast(error.message);
      if (button) button.disabled = false;
    } finally { busy = false; }
  }

  function suggest() {
    const raw = host.querySelector('#adminWhatsAppPaste')?.value || '';
    const candidateFields = state.schema.sections.flatMap(section => section.fields)
      .filter(field => !protectedField(field.key) && field.type !== 'multi_choice');
    const suggestions = [];
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([^:=]{3,120})\s*[:=]\s*(.{1,1000})\s*$/);
      if (!match) continue;
      const label = normalize(match[1]);
      const field = candidateFields.find(item => normalize(item.label) === label);
      if (!field || filled(state.data[field.key])) continue;
      let value = match[2].trim();
      if (field.type === 'choice') {
        const option = (field.options || []).find(opt =>
          normalize(opt.label) === normalize(value) || normalize(opt.value) === normalize(value));
        if (!option) continue;
        value = option.value;
      }
      if (field.type === 'number' && !/^\d+$/.test(value)) continue;
      suggestions.push({ field, value });
    }
    const box = host.querySelector('#adminBriefingSuggestions');
    if (!suggestions.length) {
      box.textContent = 'Não encontrei pares exatos de pergunta e resposta ainda vazios. Preencha manualmente os campos.';
      return;
    }
    box.innerHTML = suggestions.map(item => `<div>${esc(item.field.label)}: <strong>${esc(item.value)}</strong></div>`).join('')
      + '<button type="button" id="adminBriefingApplySuggest" class="btn btn-ghost btn-small">Aplicar na etapa atual (revisar antes de salvar)</button>';
    box.querySelector('#adminBriefingApplySuggest').addEventListener('click', () => {
      let count = 0;
      for (const { field, value } of suggestions) {
        const input = host.querySelector('[data-admin-bf="' + field.key + '"]');
        if (!input || filled(input.value)) continue;
        input.value = value;
        count += 1;
      }
      dirty = dirty || count > 0;
      box.textContent = count
        ? count + ' sugestão(ões) aplicada(s) nesta etapa. Revise os campos e toque em Salvar alterações.'
        : 'Abra a etapa correspondente para preencher as outras sugestões manualmente.';
    });
  }

  async function upload(input) {
    if (busy || !input.files?.length) return;
    const files = [...input.files];
    busy = true;
    input.disabled = true;
    try {
      for (const file of files) {
        if (file.size > 30 * 1024 * 1024) throw Error('Cada arquivo deve ter no máximo 30 MB.');
        const form = new FormData();
        form.append('fieldKey', input.dataset.adminUpload);
        form.append('file', file);
        const response = await fetch(base + '/uploads', {
          method: 'POST', credentials: 'same-origin', body: form,
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw Error(data.error || 'Falha ao anexar arquivo.');
      }
      await refresh();
      showToast(files.length + ' arquivo(s) anexado(s) ao briefing ✓');
    } catch (error) { showToast(error.message); input.disabled = false; }
    finally { busy = false; }
  }

  async function saveNote(button) {
    if (busy) return;
    const id = Number(button.dataset.adminSaveFileNote);
    const input = host.querySelector('[data-admin-file-note="' + id + '"]');
    busy = true;
    button.disabled = true;
    try {
      await api(base + '/uploads/' + id, { method: 'PATCH',
        body: JSON.stringify({ note: input.value }) });
      await refresh();
      showToast('Observação atualizada ✓');
    } catch (error) { showToast(error.message); button.disabled = false; }
    finally { busy = false; }
  }

  async function complete() {
    if (busy || !confirm('Concluir o briefing deste pedido com as informações recebidas pelo WhatsApp?')) return;
    busy = true;
    try {
      await api(base + '/submit', { method: 'POST', body: '{}' });
      await refresh();
      if (onChanged) await onChanged();
      showToast('Briefing concluído. Pedido liberado para produção ✓');
    } catch (error) { showToast(error.message); }
    finally { busy = false; }
  }

  toggle.addEventListener('click', async () => {
    if (host.classList.contains('hidden')) {
      host.classList.remove('hidden');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.textContent = 'Fechar preenchimento';
      host.textContent = 'Abrindo perguntas do pedido…';
      try { await refresh(); } catch (error) { host.textContent = error.message; }
      host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      if (dirty && !confirm('Há alterações não salvas. Fechar o preenchimento?')) return;
      host.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Preencher briefing pela cliente';
    }
  });
}
