import { api, esc, showToast } from './client-v2-core.js';

// Dentro da Área da Cliente já existente. Sem persistência local de fotos ou dados.
export function atelieBriefingHtml(briefing) {
  if(briefing.locked) {
    return '<section class="page-card"><div class="page-head">'+
      '<span class="eyebrow">Libri Ateliê</span><h1 class="page-title">Briefing criativo</h1>'+
      '<p class="page-subtitle">'+esc(briefing.reason||'Aguardando pagamento.')+'</p></div></section>';
  }
  const sections=briefing.schema?.sections||[];
  const index=Math.max(0,sections.findIndex(x=>x.id===briefing.currentSection));
  const section=sections[index];
  if(!section)return '<section class="page-card">Nenhuma pergunta disponível.</section>';
  const frozen=!briefing.editable;
  const fieldHtml=field=>{
    const val=briefing.data?.[field.key]??field.prefill??'';
    const label='<label for="atelie-'+esc(field.key)+'">'+esc(field.label)+(field.required?' *':'')+'</label>';
    const hint=field.hint?'<small class="field-help">'+esc(field.hint)+'</small>':'';
    if(field.type==='upload')return '<div class="field full"><strong>'+esc(field.label)+'</strong>'+
      '<div class="notice info">O envio protegido de imagens será habilitado depois da validação dos arquivos e permissões. Não envie fotos por esta tela ainda.</div></div>';
    const common=' data-atelie-field="'+esc(field.key)+'" '+(frozen?'disabled ':'');
    let input='';
    if(field.type==='choice') {
      input='<select class="select" id="atelie-'+esc(field.key)+'"'+common+'>'+
        '<option value="">Escolha uma opção</option>'+
        (field.options||[]).map(v=>'<option value="'+esc(v)+'" '+(val===v?'selected':'')+'>'+esc(v)+'</option>').join('')+
        '</select>';
    }else if(field.type==='textarea') {
      input='<textarea rows="3" class="textarea" id="atelie-'+esc(field.key)+'" maxlength="2000"'+common+'>'+
        esc(val)+'</textarea>';
    }else{
      const type=field.type==='date'?'date':'text';
      input='<input class="input" id="atelie-'+esc(field.key)+'" type="'+type+'" maxlength="2000" value="'+esc(val)+'"'+common+'>';
    }
    return '<div class="field">'+label+input+hint+'</div>';
  };
  return '<section class="page-card"><div class="page-head">'+
    '<span class="eyebrow">Identidade Visual · Libri Ateliê</span>'+
    '<h1 class="page-title">Vamos imaginar sua festa?</h1>'+
    '<p class="page-subtitle">Responda no seu ritmo. Seus dados já informados aparecem preenchidos, e você pode salvar cada parte.</p></div>'+
    '<div class="notice section-block">Etapa '+(index+1)+' de '+sections.length+
    ' · '+Number(briefing.progress||0)+'% das respostas obrigatórias preenchidas</div>'+
    '<h2>'+esc(section.title)+'</h2>'+
    '<div class="form-grid">'+section.fields.map(fieldHtml).join('')+'</div>'+
    '<div class="notice info">'+esc(briefing.notice||'Estas informações não serão publicadas automaticamente.')+
    '</div>' +
    (frozen?'<p>Este pedido está encerrado para edição.</p>':
      '<p class="field-help" id="atelieSaveFeedback" role="status">As alterações são salvas quando você toca em um dos botões abaixo.</p>')+
    '<div class="action-row" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between">'+
    (index>0?'<button type="button" class="btn btn-ghost" data-atelie-nav="'+(index-1)+'" '+(frozen?'disabled':'')+'>Voltar</button>':'<span></span>')+
    (!frozen?'<button type="button" class="btn btn-primary" data-atelie-nav="'+Math.min(index+1,sections.length-1)+'">'+
      (index===sections.length-1?'Salvar esta etapa':'Salvar e continuar')+'</button>':'')+
    '</div>'+
    (index===sections.length-1?'<div class="notice info">A conclusão do briefing e o envio de arquivos ficarão disponíveis após a ativação comercial do Ateliê. Suas respostas podem ser guardadas como rascunho.</div>':'')+
    '</section>';
}
export function bindAtelieBriefing(container,token,briefing,onSaved) {
  if(!container||!briefing||briefing.locked||!briefing.editable)return;
  const section=(briefing.schema.sections||[]).find(x=>x.id===briefing.currentSection);
  if(!section)return;
  let busy=false;
  const url='/api/v2/customer-area/'+encodeURIComponent(token)+'/atelie/briefing';
  container.querySelectorAll('[data-atelie-nav]').forEach(button=>
    button.addEventListener('click',async()=>{
      if(busy)return;
      const fields={};
      for(const f of section.fields){
        if(f.type==='upload')continue;
        const input=container.querySelector('[data-atelie-field="'+f.key+'"]');
        if(input)fields[f.key]=input.value;
      }
      const next=briefing.schema.sections[Number(button.dataset.atelieNav)]?.id;
      if(!next)return;
      busy=true;
      const status=container.querySelector('#atelieSaveFeedback');
      container.querySelectorAll('[data-atelie-nav]').forEach(x=>x.disabled=true);
      if(status)status.textContent='Salvando suas respostas…';
      try{
        const saved=await api(url,{method:'PATCH',
          body:JSON.stringify({revision:briefing.revision,currentSection:next,data:fields})});
        if(status)status.textContent='Respostas salvas ✓';
        await onSaved(saved.briefing);
      }catch(e){
        if(status)status.textContent='Não foi possível salvar. Suas respostas continuam nesta tela.';
        showToast(e.message||'Não foi possível salvar suas respostas.');
        container.querySelectorAll('[data-atelie-nav]').forEach(x=>x.disabled=false);
      }finally{busy=false;}
    }));
}
