import { api, esc } from './admin-v2-core.js';

// Exibe respostas artísticas sem exigir token da Área da Cliente ou reutilizar perguntas de convite.
export async function mountAtelieCreativeBriefing(container,code) {
  if(!container)return;
  const load=async()=>{
    container.innerHTML='<div class="card">Conferindo o briefing criativo…</div>';
    try {
      const reply=await api('/api/admin/v2/atelie/orders/'+encodeURIComponent(code)+'/briefing');
      const briefing=reply.briefing;
      if(!container.isConnected)return;
      const data=briefing.data||{};
      const rows=(briefing.schema?.sections||[]).map(section=>{
        const items=section.fields.filter(f=>f.type!=='upload')
          .filter(f=>String(data[f.key]??'').trim())
          .map(f=>'<div class="order-answer-item"><strong>'+esc(f.label)+'</strong><p>'+
            esc(data[f.key])+'</p></div>').join('');
        return items?'<div class="order-answer-group"><h4>'+esc(section.title)+'</h4>'+
          '<div class="order-answer-grid">'+items+'</div></div>':'';
      }).join('');
      const uploads=briefing.uploads||[];
      const fileCards=uploads.map(item=>'<div class="row-card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">'+
        (['image/jpeg','image/png','image/webp'].includes(item.mimeType)?
          '<img loading="lazy" alt="Arquivo privado de referência" src="'+esc(item.contentPath)+'" style="width:76px;height:76px;border-radius:8px;object-fit:cover">':'')+
        '<div style="flex:1"><strong>'+esc(item.originalFilename)+'</strong><small>'+
        (item.fieldKey==='childPhotos'?'Foto da criança · Uso privado':'Imagem de inspiração')+
        '</small><p><a href="'+esc(item.contentPath)+'" target="_blank" rel="noopener noreferrer">Visualizar no Admin</a></p></div></div>').join('');
      const count=Object.keys(data).filter(k=>data[k]!==null&&String(data[k]).trim()).length;
      container.innerHTML='<section class="card" id="atelieCreativeBriefingRead">'+
        '<div class="section-title"><div><span class="eyebrow">Libri Ateliê</span>'+
        '<h3>Briefing criativo</h3></div><span class="status">'+
        (briefing.submitted?'Enviado ✓':'Rascunho')+' · '+count+' respostas</span></div>'+
        (briefing.submitted?
          '<div class="notice success">Recebido em '+esc(briefing.submittedAt||'data registrada')+'. Revise o escopo e a agenda antes da direção de arte.</div>':
          '<div class="notice info">A cliente ainda está preenchendo as respostas. Não inicie a criação antes do envio e da confirmação da agenda.</div>')+
        (rows||'<p class="muted">A cliente ainda não preencheu o briefing artístico.</p>')+
        '<h4 style="margin-top:16px">Imagens e referências privadas ('+uploads.length+')</h4>'+
        (fileCards||'<p class="muted">Nenhuma imagem enviada ainda.</p>')+
        '<div class="notice info">Somente leitura. As respostas e imagens são privadas do pedido. '+
        'Não utilize fotos de crianças ou imagens de inspiração em publicações sem autorização específica.</div>'+
        (briefing.submitted?
          '<div class="field"><label for="atelieReopenNote">Solicitar complemento do briefing</label>'+
          '<textarea class="textarea" rows="2" maxlength="500" id="atelieReopenNote" placeholder="Descreva quais informações precisam ser complementadas"></textarea>'+
          '<button type="button" class="btn btn-secondary" id="atelieReopenBriefing">Reabrir para complementos</button>'+
          '<p class="muted">A cliente poderá editar as respostas novamente. Para reabrir, a produção artística deve estar na etapa Briefing.</p></div>':'')+
        '<div class="order-quick-actions"><button class="btn btn-secondary btn-small" type="button" id="atelieRefreshBriefing">Atualizar respostas</button></div></section>';
      container.querySelector('#atelieRefreshBriefing')?.addEventListener('click',()=>void load());
      container.querySelector('#atelieReopenBriefing')?.addEventListener('click',async event=>{
        const note=container.querySelector('#atelieReopenNote')?.value.trim()||'';
        if(note.length<10){const el=container.querySelector('#atelieReopenNote');el?.focus();return;}
        event.currentTarget.disabled=true;
        try {
          await api('/api/admin/v2/atelie/orders/'+encodeURIComponent(code)+'/briefing/reopen',{
            method:'POST',body:JSON.stringify({note})
          });
          await load();
        }catch(e){
          event.currentTarget.disabled=false;
          const box=container.querySelector('#atelieReopenNote');
          if(box)box.setCustomValidity(e.message||'Não foi possível reabrir.');
          box?.reportValidity();
        }
      });
    }catch(error){
      if(container.isConnected)container.innerHTML=
        '<div class="card empty">Não foi possível abrir o briefing criativo: '+esc(error.message)+'</div>';
    }
  };
  await load();
}
