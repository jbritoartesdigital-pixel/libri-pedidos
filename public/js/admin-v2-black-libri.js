import { api, esc, setViewMeta, viewRoot, showToast } from './admin-v2-core.js';

export async function renderBlackLibri() {
  setViewMeta('Black Libri','Campanha e prêmios');
  viewRoot.innerHTML='<section class="card"><p>Carregando os prêmios...</p></section>';
  let data;
  try { data=await api('/api/admin/v2/black-libri'); }
  catch(error) {
    viewRoot.innerHTML=`<section class="card"><h2>Campanha não disponível</h2>
      <p>${esc(error.message)}</p><p>A migration 0029 precisa existir no banco de homologação.</p></section>`;
    return;
  }
  const counts=data.counts||{};
  const locked=data.enabled===true;
  viewRoot.innerHTML=`
    <section class="card" style="margin-bottom:18px">
      <span class="eyebrow">Black Libri • Balão premiado</span>
      <h2>${locked?'Campanha ativa':'Campanha desativada'}</h2>
      <p>Ativação protegida pelas variáveis do Cloudflare. Este painel não publica a campanha.</p>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:14px">
        <span class="badge">Reservados: ${Number(counts.reserved||0)}</span>
        <span class="badge">Vinculados: ${Number(counts.attached||0)}</span>
        <span class="badge">Confirmados: ${Number(counts.redeemed||0)}</span>
        <span class="badge">Expirados: ${Number(counts.expired||0)}</span>
      </div>
    </section>
    <section class="card">
      <h2>Prêmios e probabilidades</h2>
      <p>As chances são recalculadas quando um prêmio esgota. Pesos e estoques só podem ser alterados com a campanha desativada.</p>
      <div style="overflow-x:auto">
        <table style="width:100%;min-width:690px;border-collapse:separate;border-spacing:0 10px">
          <thead><tr><th>Prêmio</th><th>Peso</th><th>Chance atual</th><th>Estoque máximo</th><th>Ocupados</th><th>Ativo</th><th></th></tr></thead>
          <tbody>${data.prizes.map(p=>`<tr data-prize="${esc(p.code)}">
            <td><strong>${esc(p.label)}</strong><br><small>${esc(p.code)}</small></td>
            <td><input aria-label="Peso de ${esc(p.label)}" data-field="weight" type="number" min="1" max="10000" step="1" value="${Number(p.weight)}" style="width:75px" ${locked?'disabled':''}></td>
            <td>${(100*Number(p.probability||0)).toFixed(2).replace('.',',')}%</td>
            <td><input aria-label="Estoque de ${esc(p.label)}" data-field="maxClaims" type="number" min="1" max="100000" step="1" value="${p.max_claims===null?'':Number(p.max_claims)}" placeholder="Sem limite" style="width:100px" ${locked?'disabled':''}></td>
            <td>${Number(p.occupied)}${p.remaining===null?'':' • '+Number(p.remaining)+' restantes'}</td>
            <td><input aria-label="Ativar ${esc(p.label)}" data-field="enabled" type="checkbox" ${Number(p.enabled)?'checked':''} ${locked?'disabled':''}></td>
            <td><button type="button" class="btn btn-secondary" data-save-prize ${locked?'disabled':''}>Salvar</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <p><small>Estoque ocupado considera prêmios confirmados e reservas de 24h ainda válidas. Um prêmio expirado continua registrado para impedir nova tentativa da mesma cliente.</small></p>
    </section>`;
  viewRoot.querySelectorAll('[data-save-prize]').forEach(button=>button.addEventListener('click',async()=>{
    const row=button.closest('[data-prize]');
    const code=row?.dataset.prize;
    const weight=Number(row.querySelector('[data-field="weight"]').value);
    const raw=row.querySelector('[data-field="maxClaims"]').value.trim();
    const maxClaims=raw===''?null:Number(raw);
    const enabled=row.querySelector('[data-field="enabled"]').checked;
    if (!Number.isSafeInteger(weight)||weight<1||weight>10000||
        (maxClaims!==null&&(!Number.isSafeInteger(maxClaims)||maxClaims<1||maxClaims>100000))) {
      showToast('Confira peso e estoque.');return;
    }
    button.disabled=true;
    try {
      await api('/api/admin/v2/black-libri/prizes/'+encodeURIComponent(code),{
        method:'PATCH',body:JSON.stringify({weight,maxClaims,enabled})
      });
      showToast('Prêmio atualizado.');
      await renderBlackLibri();
    } catch(error) {
      button.disabled=false;
      showToast(error.message);
    }
  }));
}
