import { api, esc, showToast } from './admin-v2-core.js';

const ART_CODES=new Set(['atelie_essencia','atelie_encanto','atelie_universo']);
export function isAtelieOrderDetail(detail) {
  const product=(detail?.items||[]).find(x=>x.itemType==='product');
  // Verificar o produto principal efetivo, não apenas o título do pedido.
  return ART_CODES.has(product?.configuration?.productCode);
}
const ACTION_LABELS={
  change_stage:'Etapa alterada',
  revision_used:'Revisão utilizada',
  extra_quote_requested:'Orçamento de extra solicitado'
};
function nameFor(progress,code) {
  return progress.stages.find(x=>x.code===code)?.label||code||'';
}
export async function mountAtelieProduction(container,orderCode) {
  if(!container)return;
  const base='/api/admin/v2/atelie/orders/'+encodeURIComponent(orderCode)+'/production';
  let progress;
  async function load() {
    container.innerHTML='<div class="card"><p>Conferindo etapas artísticas…</p></div>';
    try{
      const result=await api(base);
      progress=result.progress;
    }catch(e){
      if(container.isConnected)container.innerHTML=
        '<div class="card empty">Não foi possível abrir as etapas do Ateliê. '+esc(e.message)+'</div>';
      return;
    }
    render();
  }
  function render(){
    if(!container.isConnected||!progress)return;
    const stages=progress.stages||[];
    const next=stages.filter(s=>progress.nextStages?.includes(s.code));
    const disabled=!progress.canEdit;
    const max=progress.revisionsIncluded===null?'Pendente de conferência':String(progress.revisionsIncluded);
    container.innerHTML=
      '<section class="card" id="atelieArtWorkflow" style="margin-top:15px">'+
      '<div class="section-title"><div><span class="eyebrow">Identidade Visual · Libri Ateliê</span>'+
      '<h3>Etapas artísticas</h3></div><span class="status">'+esc(nameFor(progress,progress.stage))+'</span></div>'+
      '<p class="muted">Este acompanhamento é interno. Não altera o pagamento, a agenda ou o status geral do pedido.</p>'+
      '<div class="notice info">'+
        (progress.stage==='briefing'
          ? 'Briefing '+(progress.briefingSubmitted?'enviado ✓':'ainda não enviado')+
            ' · Agenda '+(progress.agendaConfirmed?'reservada ✓':'sem reserva confirmada')+
            '. A direção de arte só começa quando ambos estiverem prontos.'
          : progress.stage==='approval'
            ? 'A versão mais recente da prévia '+(progress.previewApproved?'foi aprovada pela cliente ✓':'ainda precisa de aprovação da cliente')+
              '. A entrega só pode avançar depois da aprovação.'
            : 'Aprovação de arte usa as prévias e o aceite já existentes no Libri Pedidos. Alterar esta etapa não substitui a aprovação da cliente.')+
      '</div>'+
      '<div class="kpi-grid"><div class="kpi"><span>Etapa atual</span><strong>'+esc(nameFor(progress,progress.stage))+'</strong></div>'+
      '<div class="kpi"><span>Revisões usadas</span><strong>'+progress.revisionsUsed+' / '+esc(max)+'</strong></div></div>'+
      (disabled?'<div class="notice info">Os registros de produção ficam bloqueados enquanto não houver pagamento confirmado ou o pedido estiver encerrado.</div>':
      '<div class="form-grid" style="margin-top:16px">'+
        '<div class="field"><label for="atelieNextStage">Avançar ou retomar etapa</label>'+
        '<select class="select" id="atelieNextStage"><option value="">Escolha a etapa</option>'+
        next.map(s=>'<option value="'+esc(s.code)+'">'+esc(s.label)+'</option>').join('')+'</select></div>'+
        '<div class="field full"><label for="atelieArtNote">Observação (opcional para mudança de etapa)</label>'+
        '<textarea class="textarea" id="atelieArtNote" rows="3" maxlength="1000" placeholder="O que foi combinado ou alterado?"></textarea></div></div>'+
        '<div class="order-quick-actions" style="display:flex;flex-wrap:wrap;gap:8px">'+
        '<button class="btn btn-primary" type="button" data-art-action="stage" '+(next.length?'':'disabled')+'>Salvar etapa</button>'+
        '<button class="btn btn-secondary" type="button" data-art-action="revision">Registrar revisão usada</button>'+
        '<button class="btn btn-ghost" type="button" data-art-action="extra_quote">Registrar pedido de orçamento extra</button></div>'+
        '<p class="muted" style="font-size:12px;margin-top:9px">Registrar um orçamento não gera cobrança. Revisões só são contadas dentro do limite contratado.</p>')+
      '<details style="margin-top:15px"><summary>Histórico artístico ('+progress.history.length+')</summary>'+
      (progress.history.length?'<div class="list" style="margin-top:10px">'+progress.history.map(item=>
        '<div class="row-card"><strong>'+esc(ACTION_LABELS[item.action]||item.action)+'</strong>'+
        '<small>'+esc(item.from_stage?nameFor(progress,item.from_stage):'')+
        (item.to_stage?' → '+esc(nameFor(progress,item.to_stage)):'')+
        ' · '+esc(item.created_at||'')+'</small>'+
        (item.note?'<p>'+esc(item.note)+'</p>':'')+'</div>').join('')+'</div>':
        '<p class="muted">Nenhuma movimentação artística registrada.</p>')+'</details></section>';
    container.querySelectorAll('[data-art-action]').forEach(button=>button.addEventListener('click',async()=>{
      const action=button.dataset.artAction;
      const note=container.querySelector('#atelieArtNote')?.value.trim()||'';
      const nextStage=container.querySelector('#atelieNextStage')?.value||'';
      if(action==='stage'&&!nextStage){showToast('Selecione a etapa.');return;}
      if(action==='revision'&&note.length<5){showToast('Descreva a revisão em pelo menos 5 caracteres.');return;}
      if(action==='extra_quote'&&note.length<10){showToast('Descreva o extra que precisa de orçamento.');return;}
      button.disabled=true;
      try{
        const result=await api(base,{method:'PATCH',
          body:JSON.stringify({action,nextStage,note,version:progress.version})});
        progress=result.progress;
        showToast(action==='extra_quote'?'Solicitação registrada. Nenhuma cobrança criada.':'Etapa artística atualizada.');
        render();
      }catch(e){showToast(e.message);button.disabled=false;}
    }));
  }
  await load();
}
