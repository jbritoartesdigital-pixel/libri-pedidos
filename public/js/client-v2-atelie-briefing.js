import { api, esc, showToast } from './client-v2-core.js';
import { uploadCustomerPhoto } from './client-v2-upload.js';

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
    if(field.type==='upload') {
      const fileList=(briefing.uploads||[]).filter(x=>x.fieldKey===field.key);
      const limit=Number(briefing.uploadLimits?.[field.key]||0);
      const list=fileList.map(item=>'<div class="row-card" style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">'+
        (['image/jpeg','image/png','image/webp'].includes(item.mimeType)
          ? '<img loading="lazy" alt="Arquivo de referência" src="'+esc(item.contentPath)+'" style="width:72px;height:72px;object-fit:cover;border-radius:8px">'
          : '')+
        '<div style="flex:1;min-width:100px"><strong>'+esc(item.originalFilename)+'</strong>'+
        '<small style="display:block">'+(Math.ceil(Number(item.sizeBytes||0)/1024))+' KB</small>'+
        '<a href="'+esc(item.contentPath)+'" target="_blank" rel="noopener noreferrer">Ver imagem</a></div>'+
        (!frozen?'<button type="button" class="btn btn-danger btn-small" data-atelie-delete="'+Number(item.id)+'">Remover</button>':'')+
        '</div>').join('');
      return '<div class="field full"><strong>'+esc(field.label)+'</strong>'+
        '<p class="field-help">'+fileList.length+' de '+limit+' imagens · até 15 MB cada. Acesso privado ao seu pedido.</p>'+
        (list?'<div class="upload-list">'+list+'</div>':'')+
        (!frozen && limit>fileList.length?'<label class="btn btn-secondary" style="display:inline-block;margin-top:9px">'+
          'Adicionar imagens<input type="file" class="hidden" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" data-atelie-upload="'+
          esc(field.key)+'"></label>':'')+
        '<p class="field-help" role="status" data-atelie-upload-status="'+esc(field.key)+'"></p>'+
        (field.key==='childPhotos'?'<small class="field-help">Fotos de crianças serão utilizadas apenas para criar as artes contratadas. Publicação exige autorização separada.</small>':'')+
        '</div>';
    }
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
    (index===sections.length-1?'<div class="notice info">A conclusão final do briefing será habilitada após a ativação comercial do Ateliê. Suas respostas e imagens são guardadas no pedido.</div>':'')+
    '</section>';
}
export function bindAtelieBriefing(container,token,briefing,onSaved) {
  if(!container||!briefing||briefing.locked||!briefing.editable)return;
  const section=(briefing.schema.sections||[]).find(x=>x.id===briefing.currentSection);
  if(!section)return;
  let busy=false;
  const fileBusy=()=>busy;
  const uploadEndpoint='/api/v2/customer-area/'+encodeURIComponent(token)+'/atelie/briefing/uploads';
  container.querySelectorAll('[data-atelie-upload]').forEach(input=>input.addEventListener('change',async()=>{
    if(fileBusy())return;
    const key=input.dataset.atelieUpload, files=Array.from(input.files||[]);
    if(!files.length)return;
    const max=Number(briefing.uploadLimits?.[key]||0);
    const existing=(briefing.uploads||[]).filter(x=>x.fieldKey===key).length;
    if(files.length>max-existing){showToast('Você pode enviar mais '+(max-existing)+' imagem(ns) neste campo.');return;}
    const allowed=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
    if(files.some(f=>!allowed.has(f.type)||f.size<=0||f.size>15*1024*1024)){
      showToast('Envie JPG, PNG, WebP, HEIC ou HEIF com até 15 MB por imagem.');return;
    }
    busy=true;
    const status=container.querySelector('[data-atelie-upload-status="'+key+'"]');
    container.querySelectorAll('[data-atelie-nav],[data-atelie-delete],[data-atelie-upload]').forEach(x=>x.disabled=true);
    let completed=0, failed=false;
    try{
      for(const file of files){
        const form=new FormData();form.append('fieldKey',key);form.append('file',file);
        await uploadCustomerPhoto(uploadEndpoint,form,p=>{
          if(status)status.textContent='Enviando '+(completed+1)+' de '+files.length+' · '+p+'%';
        });
        completed++;
      }
    }catch(e){failed=true;showToast(e.message||'Não foi possível enviar todas as imagens.');}
    if(status)status.textContent=failed?'Conferindo os arquivos recebidos…':'Imagens enviadas ✓';
    try{
      await onSaved();
    }catch(e){showToast('Atualize a página para conferir os arquivos recebidos.');}
    finally{busy=false;}
  }));
  container.querySelectorAll('[data-atelie-delete]').forEach(button=>button.addEventListener('click',async()=>{
    if(fileBusy())return;
    const id=Number(button.dataset.atelieDelete);
    if(!Number.isSafeInteger(id))return;
    busy=true;button.disabled=true;
    try{
      await api(uploadEndpoint+'/'+id,{method:'DELETE'});
      await onSaved();
      showToast('Imagem removida do pedido.');
    }catch(e){showToast(e.message||'Não foi possível remover a imagem.');button.disabled=false;}
    finally{busy=false;}
  }));
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
