import { api, esc, showToast, setViewMeta, viewRoot } from './admin-v2-core.js';
import { openBlackLibriDemo } from './black-libri-demo.js?v=20261110-1';

function count(n) { return new Intl.NumberFormat('pt-BR').format(Number(n||0)); }
function effectiveStock(prize) {
  return prize.available===null ? 'Sem limite' : count(prize.available);
}
function prizeGroup(prize) {
  if(prize.kind==='fixed'||prize.kind==='percent') return 'Desconto';
  if(['reminder_animated','thanks_video','mini_retrospective','character_birthday','child_birthday'].includes(prize.code)) return 'Especial';
  return 'Brinde digital';
}
function renderPrize(prize,locked) {
  return `
    <article class="black-admin-prize" data-black-prize="${esc(prize.code)}">
      <div class="black-admin-prize-head">
        <div><span class="black-admin-kind">${prizeGroup(prize)}</span>
          <h3>${esc(prize.label)}</h3></div>
        <strong class="black-admin-chance">${count(prize.chancePercent.toFixed(2))}%</strong>
      </div>
      <p class="black-admin-description">${esc(prize.description)}</p>
      <dl class="black-admin-numbers">
        <div><dt>Reservados</dt><dd>${count(prize.reserved)}</dd></div>
        <div><dt>Confirmados</dt><dd>${count(prize.redeemed)}</dd></div>
        <div><dt>Disponíveis</dt><dd>${effectiveStock(prize)}</dd></div>
      </dl>
      <div class="black-admin-fields">
        <label>Peso <input class="input" type="number" data-black-weight
          min="1" max="2000" step="1" value="${prize.weight}" ${locked?'disabled':''}></label>
        <label>Limite (vazio = sem limite)
          <input class="input" type="number" data-black-limit
            min="1" max="100000" step="1" value="${prize.maxClaims??''}" ${locked?'disabled':''}></label>
      </div>
      <label class="black-admin-toggle">
        <input type="checkbox" data-black-enabled ${prize.enabled?'checked':''} ${locked?'disabled':''}>
        Oferecer este prêmio em novos balões
      </label>
      <button class="btn btn-ghost" type="button" data-black-save-prize
        ${locked?'disabled':''}>Salvar prêmio</button>
    </article>`;
}

export async function renderBlackLibri(panel=viewRoot) {
  if(panel===viewRoot) setViewMeta('Black Libri','Campanha e prêmios');
  if (!document.getElementById('blackLibriAdminStyles')) {
    const style=document.createElement('link');
    style.id='blackLibriAdminStyles';
    style.rel='stylesheet';
    style.href='/css/admin-v2-black-libri.css?v=20261110-2';
    document.head.appendChild(style);
  }
  panel.innerHTML='<section class="settings-card"><h2>Black Libri</h2><p>Carregando campanha...</p></section>';
  let data;
  try { data=await api('/api/admin/v2/black-libri'); }
  catch(error) {
    panel.innerHTML=`<section class="settings-card"><h2>Black Libri</h2>
      <p role="alert" class="notice danger">${esc(error.message)}</p></section>`;
    return;
  }
  if(data.migrationRequired) {
    panel.innerHTML=`<section class="settings-card">
      <h2>Black Libri ainda não foi preparada neste ambiente</h2>
      <p class="notice info">As migrations 0029 e 0030 precisam ser aplicadas
      primeiro. Nenhuma campanha está ativa; os pedidos normais continuam disponíveis.</p>
      <p class="muted">Não aplicar automaticamente no banco de produção.</p>
    </section>`;
    return;
  }
  const camp=data.campaign||{};
  const locked=camp.adminEnabled===true;
  const status=data.active?'EM VEICULAÇÃO':locked?'PROGRAMADA / FORA DO PERÍODO':'PAUSADA';
  const items=data.prizes||[];
  panel.innerHTML=`
    <section class="settings-card black-admin">
      <div class="black-admin-top">
        <div>
          <span class="eyebrow">Loja • Promoções</span>
          <h2>🎈 Black Libri | Balão Premiado</h2>
          <p class="muted">${items.length} benefícios, um balão por cliente e reserva imutável de 24 horas.</p>
        </div>
        <span class="black-admin-status" data-on="${data.active?'1':'0'}">${status}</span>
      </div>
      <div class="black-admin-stats">
        <div><strong>${count(data.summary.totalRevealed)}</strong><span>Revelados</span></div>
        <div><strong>${count(data.summary.reserved)}</strong><span>Reservados</span></div>
        <div><strong>${count(data.summary.redeemed)}</strong><span>Confirmados</span></div>
        <div><strong>${count(data.summary.availablePrizeTypes)}</strong><span>Tipos disponíveis</span></div>
      </div>
      <p class="muted">Escolha as datas como nos cupons. A campanha começa e termina automaticamente no período escolhido, sem configurar Cloudflare.</p>
      ${locked&&!data.active?'<p class="notice info"><strong>Campanha habilitada, mas fora do período.</strong> Os balões só aparecem em pedidos reais quando a data atual está dentro do intervalo. Use a prévia para testar a qualquer momento.</p>':''}
      <div class="black-admin-actions">
        <button class="btn btn-ghost" id="blackDemo" type="button">🎈 Testar balões sem gastar prêmio</button>
      </div>
      <div class="black-admin-fields">
        <label for="blackValidFrom">Início da Black Libri
          <input class="input" id="blackValidFrom" type="date" value="${esc(camp.validFrom||'')}">
        </label>
        <label for="blackValidUntil">Término da Black Libri
          <input class="input" id="blackValidUntil" type="date" value="${esc(camp.validUntil||'')}">
        </label>
      </div>
      <div class="section-title"><h3>Autorização e controle da campanha</h3></div>
      <div class="form-grid">
        <div class="field full">
          <label for="blackLegalReference">Referência da autorização aplicável</label>
          <input class="input" id="blackLegalReference" maxlength="160"
            value="${esc(camp.authorizationReference||'')}"
            placeholder="Informe somente após validação jurídica">
        </div>
        <div class="field full">
          <label for="blackAdminNote">Observações internas</label>
          <textarea class="textarea" id="blackAdminNote" rows="2"
          maxlength="600">${esc(camp.adminNote||'')}</textarea>
        </div>
      </div>
      <label class="black-admin-toggle">
        <input id="blackComplianceConfirmed" type="checkbox"
          ${camp.complianceConfirmed?'checked':''}>
        Confirmo que a promoção foi revisada e sua autorização aplicável está documentada.
      </label>
      <div class="black-admin-actions">
        <button class="btn btn-ghost" id="blackSavePaused" type="button">
          Salvar e manter pausada
        </button>
        ${locked
          ? '<button class="btn btn-ghost" id="blackPause" type="button">Pausar campanha</button>'
          : '<button class="btn btn-primary" id="blackEnable" type="button">Solicitar ativação</button>'}
      </div>
      <div class="section-title" style="margin-top:22px">
        <h3>Prêmios, estoques e probabilidades</h3>
      </div>
      <p class="muted">Os pesos correspondem às chances relativas dos prêmios disponíveis.
      Quando algum estoque acaba, os demais pesos são recalculados automaticamente.
      ${locked?'<strong>Pause a campanha para editar a distribuição.</strong>':
        'Valores dos descontos e nomes dos prêmios são permanentes; aqui você edita apenas distribuição futura.'}</p>
      <div class="black-admin-grid">
        ${items.map(prize=>renderPrize(prize,locked)).join('')}
      </div>
    </section>`;
  async function updateCampaign(enabled) {
    const buttonId=enabled?'blackEnable':'blackSavePaused';
    const button=panel.querySelector('#'+buttonId);
    if(button)button.disabled=true;
    if(enabled && !window.confirm(
      'Ativar a Black Libri nas datas escolhidas? Verifique os testes e a autorização aplicável antes de confirmar.')) {
      if(button)button.disabled=false;
      return;
    }
    const body={
      adminEnabled:enabled,
      validFrom:panel.querySelector('#blackValidFrom')?.value||'',
      validUntil:panel.querySelector('#blackValidUntil')?.value||'',
      authorizationReference:panel.querySelector('#blackLegalReference')?.value.trim()||'',
      complianceConfirmed:panel.querySelector('#blackComplianceConfirmed')?.checked||false,
      adminNote:panel.querySelector('#blackAdminNote')?.value.trim()||''
    };
    try {
      await api('/api/admin/v2/black-libri/campaign',{
        method:'PATCH',body:JSON.stringify(body)
      });
      showToast(enabled?'Campanha habilitada no painel.':'Campanha mantida pausada.');
      await renderBlackLibri(panel);
    } catch(error) {
      showToast(error.message);
      if(button)button.disabled=false;
    }
  }
  panel.querySelector('#blackDemo')?.addEventListener('click',()=>{
    openBlackLibriDemo().catch(error=>showToast(error.message||'Não foi possível abrir a prévia.'));
  });
  panel.querySelector('#blackSavePaused')?.addEventListener('click',()=>updateCampaign(false));
  panel.querySelector('#blackPause')?.addEventListener('click',()=>updateCampaign(false));
  panel.querySelector('#blackEnable')?.addEventListener('click',()=>updateCampaign(true));
  panel.querySelectorAll('[data-black-save-prize]').forEach(button=>{
    button.addEventListener('click',async()=>{
      const item=button.closest('[data-black-prize]');
      if(!item)return;
      const code=item.dataset.blackPrize;
      const weight=Number(item.querySelector('[data-black-weight]').value);
      const rawLimit=item.querySelector('[data-black-limit]').value.trim();
      const maxClaims=rawLimit===''?null:Number(rawLimit);
      const enabled=item.querySelector('[data-black-enabled]').checked;
      if(!Number.isInteger(weight)||weight<1||weight>2000
        ||(maxClaims!==null&&(!Number.isInteger(maxClaims)||maxClaims<1))) {
        showToast('Revise o peso e o limite do prêmio.');
        return;
      }
      button.disabled=true;
      try {
        await api('/api/admin/v2/black-libri/prizes/'+encodeURIComponent(code),{
          method:'PATCH',body:JSON.stringify({weight,maxClaims,enabled})
        });
        showToast('Distribuição atualizada.');
        await renderBlackLibri(panel);
      } catch(error) {
        showToast(error.message);
        button.disabled=false;
      }
    });
  });
}
