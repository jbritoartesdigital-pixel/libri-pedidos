import {api,esc,money,modal,showToast} from './admin-v2-core.js';
const names={shared:'Dados da comemoração',convite:'Convite digital',identidade_visual:'Libri Ateliê',retrospectiva:'Retrospectiva'};
const value=(f,v)=>{const opts=f.options||[];const label=x=>opts.find(o=>typeof o==='object'&&o.value===x)?.label||x;return Array.isArray(v)?v.map(label).join(', '):label(v);};
export async function openV3AdminOrder(code,initial,onChanged){
 const base='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/briefing';
 const close=modal(code+' · '+initial.event.honoreeName,'<div id="v3AdminOrder"></div>');
 const host=document.getElementById('v3AdminOrder');let brief=initial,busy=false,error='',agenda={},supplementDrafts={};
 function materials(m){
  const r=m.receipt||{},s=m.schema.materials;
  if(!s)return '';
  const ds=JSON.parse(r.videoDurationsJson||'[]');
  return '<section class="card"><h4>Materiais pelo WhatsApp</h4><p>Contratado: '+esc(s.maxPhotos)+' fotos, '+esc(s.maxVideos)+' vídeos. '+esc(s.maxVideoSeconds||60)+'s por vídeo.</p>'+
  '<label>Fotos recebidas <input type="number" min="0" max="'+esc(s.maxPhotos)+'" data-retro="photoCount" value="'+esc(r.photoCount||0)+'"></label>'+
  '<label>Vídeos recebidos <input type="number" min="0" max="'+esc(s.maxVideos)+'" data-retro="videoCount" value="'+esc(r.videoCount||0)+'"></label>'+
  '<label>Duração de cada vídeo em segundos (separada por vírgula) <input data-retro="durations" value="'+esc(ds.join(', '))+'"></label>'+
  (s.rawVideoSeconds?'<label>Material bruto em segundos <input type="number" min="0" max="'+esc(s.rawVideoSeconds)+'" data-retro="rawVideoSeconds" value="'+esc(r.rawVideoSeconds||0)+'"></label>':'')+
  '<label><input type="checkbox" data-retro="complete" '+(r.completeAt?'checked':'')+'> Todos os materiais necessários foram recebidos e conferidos</label>'+
  '<p>'+ (r.completeAt?'Recebimento completo confirmado.':'Recebimento ainda não confirmado como completo.')+'</p><button class="btn btn-secondary" data-v3-admin="receipt">Registrar recebimento</button></section>';
 }
 function agendaHtml(s){
 if(s.deliveryWindow)return '<p>Entrega confirmada: '+esc(s.deliveryWindow.start)+' a '+esc(s.deliveryWindow.end)+'</p><p>Serviço programado para produção.</p>';
 if(!s.reviewedAt||s.productionStatus!=='pending')return '';
 const a=agenda[s.family],dependent=s.family==='convite'&&brief.services.some(x=>x.family==='identidade_visual');
 return '<div class="notice"><h4>Programar produção</h4>'+
 (dependent?'<label>O convite depende da identidade do Ateliê? <select data-dependency="'+esc(s.family)+'"><option value="">Selecione</option><option value="yes" '+(a?.depends===true?'selected':'')+'>Sim</option><option value="no" '+(a?.depends===false?'selected':'')+'>Não</option></select></label>':'')+
 '<button class="btn btn-secondary" data-v3-admin="agenda" data-family="'+esc(s.family)+'">Consultar agenda</button>'+
 (a?.options?.length?'<label>Janela de entrega <select data-window="'+esc(s.family)+'">'+a.options.map((o,i)=>'<option value="'+i+'">'+esc(o.start)+' a '+esc(o.end)+'</option>').join('')+'</select></label><button class="btn btn-primary" data-v3-admin="schedule" data-family="'+esc(s.family)+'">Confirmar e liberar serviço</button>':a?'<p>Não há janela disponível. Revise a agenda antes de prometer uma data.</p>':'')+'</div>';
 }
 function deliveryHtml(s){
 const d=s.delivery;if(!d||!['approved','delivered'].includes(s.productionStatus))return '';
 const family=esc(s.family),base='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/delivery/'+family;
 const files=d.files.map(f=>'<p>'+esc(f.filename)+' · '+esc(Math.ceil(f.sizeBytes/1024))+' KB '+(f.available?'<a href="'+esc(base+'/files/'+f.id)+'">Baixar</a>':'Expirado')+
 (!d.delivered?'<button class="btn btn-secondary" data-v3-admin="remove-final" data-family="'+family+'" data-file-id="'+esc(f.id)+'">Remover</button>':'')+'</p>').join('');
 return '<div class="notice"><h4>Entrega final</h4>'+files+(d.delivered?
 '<p>Entregue em '+esc(d.deliveredAt.slice(0,10))+' · Download até '+esc(d.downloadUntil.slice(0,10))+'</p><p>Originais disponíveis até '+esc(d.originalsUntil.slice(0,10))+'</p>'+(d.warning?'<p>'+esc(d.warning)+'</p>':'')+(d.interactiveUrl?'<a href="'+esc(d.interactiveUrl)+'" target="_blank" rel="noopener noreferrer">Abrir convite interativo</a>':''):
 '<label>Arquivo final sem marca d’água (até 80 MB)<input type="file" accept="video/mp4,video/webm,image/jpeg,image/png,image/webp,application/pdf,.zip" data-final-file="'+family+'"></label><button class="btn btn-secondary" data-v3-admin="stage-final" data-family="'+family+'">Adicionar arquivo</button>'+
 (d.interactiveRequired?'<label>Link publicado do convite <input type="url" data-interactive-url="'+family+'" placeholder="https://...libriconvites.com.br/..."></label><p>A validade do convite interativo não muda com o prazo de download.</p>':'')+
 '<button class="btn btn-primary" data-v3-admin="deliver" data-family="'+family+'">Confirmar entrega definitiva</button>')+'</div>';
 }
 function productionHtml(s){
 const p=s.progress;if(!p)return '';
 const family=esc(s.family),preview=p.preview;
 const statuses={ready:'Pronto para produção',in_production:'Em produção',waiting_customer:'Aguardando aprovação',adjustments:'Ajustes solicitados',approved:'Aprovado',delivered:'Entregue'};
 const button=(action,label)=>'<button class="btn btn-secondary" data-v3-admin="'+action+'" data-family="'+family+'">'+label+'</button>';
 const url='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/production/'+family+'/preview/'+preview?.id;
 return '<div class="notice"><h4>Produção · '+esc(statuses[s.productionStatus]||'Aguardando programação')+'</h4><p>Rodadas utilizadas: '+esc(p.revisionsUsed)+' / '+esc(p.revisionsIncluded??'conforme contrato')+'</p>'+
 (preview&&preview.available!==false?'<p><a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Ver prévia '+esc(preview.version)+'</a> · Ajustes até '+esc(preview.adjustmentDeadline.slice(0,10))+'</p>':'')+
 (s.productionStatus==='ready'?button('start','Iniciar produção'):'')+
 (s.productionStatus==='in_production'?'<label>Prévia protegida (até 60 MB)<input type="file" accept="video/mp4,video/webm,image/jpeg,image/png,image/webp,application/pdf" data-preview-file="'+family+'"></label><label><input type="checkbox" data-watermark="'+family+'"> O arquivo já contém marca d’água</label>'+button('publish','Publicar prévia'):'')+
 (s.productionStatus==='adjustments'?'<p>Solicitação: '+esc(p.events.find(e=>e.action==='adjustments_requested')?.note||'')+'</p><label>Observação da conferência<textarea maxlength="2000" data-production-note="'+family+'"></textarea></label>'+
 (p.revisionsIncluded!==null&&p.revisionsUsed<p.revisionsIncluded?button('included_revision','Usar rodada incluída'):'')+button('libri_correction','Corrigir erro da Libri sem consumir rodada')+button('extra_quote','Registrar necessidade de orçamento')+button('return_preview','Retornar para aprovação'):'')+
 '<details><summary>Histórico de produção</summary>'+p.events.map(e=>'<p>'+esc(e.created_at)+' · '+esc(({started:'Produção iniciada',preview_published:'Prévia publicada',approved:'Aprovada pela cliente',adjustments_requested:'Ajustes solicitados',included_revision:'Rodada utilizada',libri_correction:'Correção da Libri',extra_quote:'Orçamento necessário',return_preview:'Retorno à aprovação'})[e.action]||e.action)+(e.note?' · '+esc(e.note):'')+'</p>').join('')+'</details></div>';
 }
 function supplementHtml(s){
 const family=esc(s.family),offers=(brief.supplements||[]).filter(x=>x.family===s.family),draft=supplementDrafts[s.family];
 const status={offered:'Aguardando cliente',accepted:'Aceita · cobrança ainda indisponível',declined:'Recusada',cancelled:'Cancelada',payment_pending:'Pagamento pendente',paid:'Pago',review:'Em revisão'};
 const open=offers.some(x=>['offered','accepted','payment_pending','review'].includes(x.status));
 return '<details class="notice"><summary>Adicionais após contratação</summary>'+offers.map(x=>'<p><strong>'+money(x.totalCents)+'</strong> · '+esc(status[x.status])+'</p>'+x.items.map(i=>'<p>'+esc(i.quantity)+' × '+esc(i.name)+'</p>').join('')+(x.note?'<p>'+esc(x.note)+'</p>':'')+(['offered','accepted'].includes(x.status)?'<button class="btn btn-secondary" data-v3-admin="supplement-cancel" data-family="'+family+'" data-supplement-id="'+x.id+'">Cancelar proposta</button>':'')).join('')+
 (!open&&s.supplementCatalog?.length?'<p>Selecione os adicionais. A proposta não modifica o pedido original.</p>'+s.supplementCatalog.map(x=>'<label class="field">'+esc(x.name)+' · '+money(x.priceCents)+'<input type="number" min="0" max="'+esc(x.maxQuantity)+'" value="'+esc(draft?.input.items.find(i=>i.code===x.code)?.quantity||0)+'" data-supplement-family="'+family+'" data-extra-code="'+esc(x.code)+'"></label>').join('')+
 '<label>Pagamento <select data-supplement-method="'+family+'"><option value="pix">Pix integral</option><option value="card" '+(draft?.input.paymentMethod==='card'?'selected':'')+'>Cartão integral</option></select></label><label>Observação para cliente <textarea maxlength="500" data-supplement-note="'+family+'">'+esc(draft?.input.note||'')+'</textarea></label>'+
 '<button class="btn btn-secondary" data-v3-admin="supplement-preview" data-family="'+family+'">Calcular proposta</button>'+
 (draft?'<p>Total complementar: <strong>'+money(draft.quote.totalCents)+'</strong> · '+(draft.quote.pointsUnits/100)+' pontos adicionais</p><button class="btn btn-primary" data-v3-admin="supplement-create" data-family="'+family+'">Enviar proposta para aceite</button>':''):'')+'</details>';
 }
 function render(){
 if(!host.isConnected)return;
 host.innerHTML='<section class="card"><h3>Pedido V3</h3>'+(brief.aggregate?'<p><strong>'+esc(brief.aggregate.label)+'</strong> · '+esc(brief.aggregate.deliveredServices)+' de '+esc(brief.aggregate.totalServices)+' serviços entregues</p>':'')+'<p>'+esc(brief.event.honoreeName)+' · '+esc(brief.event.date)+'</p><p>Total: '+money(brief.payment.totalCents)+'</p><p>'+ (brief.locked?'Aguardando confirmação de pagamento':'Pagamento confirmado')+'</p><button class="btn btn-secondary" data-v3-admin="refresh">Atualizar</button></section>'+
 (error?'<p role="alert" class="notice">'+esc(error)+'</p>':'')+
 brief.services.map(s=>'<section class="card"><h3>'+esc(s.productName)+'</h3><p>'+money(s.totalCents)+'</p><p>'+esc(s.briefingStatus==='completed'?'Briefing enviado':s.briefingStatus==='locked'?'Aguardando pagamento':'Aguardando respostas')+' · '+esc(s.reviewedAt?'Conferido pelo Admin':'Conferência pendente')+'</p>'+
 (s.complementNote?'<p>Complemento solicitado: '+esc(s.complementNote)+'</p>':'')+agendaHtml(s)+productionHtml(s)+deliveryHtml(s)+supplementHtml(s)+'</section>').join('')+
 brief.modules.map(m=>{const s=brief.services.find(x=>x.family===m.module);return '<details class="card" open><summary><strong>'+esc(names[m.module])+'</strong></summary>'+
 m.schema.sections.map(sec=>'<h4>'+esc(sec.title)+'</h4>'+sec.fields.filter(f=>m.data[f.key]!=null&&String(m.data[f.key]).trim()).map(f=>'<div class="order-answer-item"><strong>'+esc(f.label)+'</strong><p>'+esc(value(f,m.data[f.key]))+'</p></div>').join('')).join('')+
 (m.uploads||[]).map(u=>'<p>'+esc(u.originalFilename)+' · <a href="'+esc(u.contentPath)+'" target="_blank" rel="noopener noreferrer">Ver imagem privada</a></p>').join('')+
 materials(m)+(m.schema.sections.some(sec=>sec.fields.some(f=>f.key==='black_gift_media_sent'))?'<label><input type="checkbox" data-gift-media="'+esc(m.module)+'"> Conferi as fotos, a autorização e o escopo do presente Black Libri</label>':'')+(s?.briefingStatus==='completed'&&s.productionStatus==='pending'?'<div><button class="btn btn-primary" data-v3-admin="confirm" data-family="'+esc(m.module)+'">Confirmar briefing conferido</button><label>Complemento necessário <textarea maxlength="500" data-note="'+esc(m.module)+'"></textarea></label><button class="btn btn-secondary" data-v3-admin="reopen" data-family="'+esc(m.module)+'">Solicitar complemento</button></div>':'')+'</details>';}).join('')+
 (brief.history?.length?'<details class="card"><summary>Histórico geral do pedido</summary>'+brief.history.map(e=>'<p>'+esc(e.created_at)+' · '+(e.family?esc(names[e.family]||e.family)+' · ':'')+esc(e.description||e.action)+(e.note?' · '+esc(e.note):'')+'</p>').join('')+'</details>':'')+
 '<p class="muted">Conferir não libera a produção automaticamente. A agenda será validada por serviço.</p>';
 host.querySelectorAll('button').forEach(b=>b.disabled=busy);
 }
 host.addEventListener('click',async e=>{
 const b=e.target.closest('[data-v3-admin]');if(!b||busy)return;
 const action=b.dataset.v3Admin,family=b.dataset.family;
 let path=base,payload=null,method='POST';
 if(action.startsWith('supplement-')){
   path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/supplements/'+family;
   if(action==='supplement-cancel'){
     if(!confirm('Cancelar esta proposta complementar?'))return;
     path+='/'+encodeURIComponent(b.dataset.supplementId)+'/cancel';payload={};
   }else{
     const items=Array.from(host.querySelectorAll('[data-supplement-family="'+family+'"]')).map(el=>({code:el.dataset.extraCode,quantity:Number(el.value)})).filter(i=>i.quantity>0);
     const input={items,paymentMethod:host.querySelector('[data-supplement-method="'+family+'"]').value,note:host.querySelector('[data-supplement-note="'+family+'"]').value};
     if(!items.length){showToast('Selecione pelo menos um adicional.');return;}
     if(action==='supplement-preview'){path+='/preview';payload=input;}
     else{
       const draft=supplementDrafts[family];
       if(!draft||JSON.stringify(draft.input)!==JSON.stringify(input)){showToast('Calcule novamente após alterar os itens.');return;}
       if(!confirm('Enviar proposta de '+money(draft.quote.totalCents)+' para aceite da cliente?'))return;
       path+='/create';payload={...input,expectedTotalCents:draft.quote.totalCents,requestKey:draft.key};
     }
   }
 }else if(['stage-final','remove-final','deliver'].includes(action)){
   const s=brief.services.find(x=>x.family===family);if(!s?.progress)return;
   path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/delivery/'+family;
   payload={version:s.progress.version};
   if(action==='stage-final'){
     const file=host.querySelector('[data-final-file="'+family+'"]')?.files?.[0];if(!file){showToast('Selecione um arquivo final.');return;}
     const form=new FormData();form.append('file',file);form.append('version',String(s.progress.version));payload=form;path+='/files';
   }else if(action==='remove-final'){
     if(!confirm('Remover este arquivo da preparação da entrega?'))return;
     method='DELETE';path+='/files/'+encodeURIComponent(b.dataset.fileId);
   }else{
     if(!confirm('Confirma que os arquivos finais estão completos e conferidos? A entrega iniciará os prazos de retenção.'))return;
     path+='/publish';payload={...payload,confirmed:true,interactiveUrl:host.querySelector('[data-interactive-url="'+family+'"]')?.value.trim()||''};
   }
 }else if(['start','publish','included_revision','libri_correction','extra_quote','return_preview'].includes(action)){
   const s=brief.services.find(x=>x.family===family);if(!s?.progress)return;
   path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/production/'+family;
   payload={action,version:s.progress.version,note:host.querySelector('[data-production-note="'+family+'"]')?.value||''};
   if(action==='publish'){
     const file=host.querySelector('[data-preview-file="'+family+'"]')?.files?.[0];
     if(!file||!host.querySelector('[data-watermark="'+family+'"]')?.checked){showToast('Selecione a prévia e confirme a marca d’água.');return;}
     const form=new FormData();form.append('file',file);form.append('version',String(s.progress.version));form.append('watermarkConfirmed','true');payload=form;path+='/preview';
   }
 }else if(action==='agenda'||action==='schedule'){
   const dep=host.querySelector('[data-dependency="'+family+'"]');
   if(dep&&!dep.value){showToast('Informe a dependência da identidade visual.');return;}
   const depends=dep?dep.value==='yes':undefined;
   path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/agenda/'+family+'/'+(action==='agenda'?'preview':'schedule');
   payload={dependsOnIdentity:depends};
   if(action==='schedule'){
     const a=agenda[family],o=a?.options[Number(host.querySelector('[data-window="'+family+'"]')?.value)];
     if(!o||a.depends!==depends){showToast('Consulte novamente a agenda.');return;}
     if(!confirm('Confirmar esta janela para o serviço? Confira a previsão com a cliente se houve alteração.'))return;
     payload={...payload,start:o.start,end:o.end,confirmed:true};
   }
 }else if(action==='receipt'){
   const get=k=>host.querySelector('[data-retro="'+k+'"]');
   const raw=get('durations').value.trim();
   payload={photoCount:Number(get('photoCount').value),videoCount:Number(get('videoCount').value),videoDurations:raw?raw.split(',').map(x=>Number(x.trim())):[],rawVideoSeconds:Number(get('rawVideoSeconds')?.value||0),complete:get('complete').checked};path+='/retro-materials';
 }else if(['confirm','reopen'].includes(action)){
   const m=brief.modules.find(x=>x.module===family);if(!m)return;
   payload={action,giftMediaConfirmed:!!host.querySelector('[data-gift-media="'+family+'"]')?.checked,revision:m.revision,sharedRevision:brief.modules.find(x=>x.module==='shared')?.revision||0,note:host.querySelector('[data-note="'+family+'"]')?.value||''};path+='/'+family+'/review';
 }
 busy=true;error='';host.querySelectorAll('button').forEach(x=>x.disabled=true);
 try{const res=await api(path,payload?{method,body:payload instanceof FormData?payload:JSON.stringify(payload)}:{});brief=res.briefing;if(action==='supplement-preview'){supplementDrafts[family]={input:payload,quote:res.result,key:Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('')};}else if(action==='agenda'){agenda[family]={options:res.result.options,depends:payload.dependsOnIdentity};}else if(payload){agenda={};supplementDrafts={};showToast('Atualizado.');if(onChanged)await onChanged();}}
 catch(err){error=err.message;}
 finally{busy=false;render();}
 });
 render();return close;
}
