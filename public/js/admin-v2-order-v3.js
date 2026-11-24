import {api,esc,money,modal,showToast} from './admin-v2-core.js';
const names={shared:'Dados da comemoração',convite:'Convite digital',identidade_visual:'Libri Ateliê',retrospectiva:'Retrospectiva'};
const value=(f,v)=>{const opts=f.options||[];const label=x=>opts.find(o=>typeof o==='object'&&o.value===x)?.label||x;return Array.isArray(v)?v.map(label).join(', '):label(v);};
export async function openV3AdminOrder(code,initial,onChanged){
 const base='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/briefing';
 const close=modal(code+' · '+initial.event.honoreeName,'<div id="v3AdminOrder"></div>');
 const host=document.getElementById('v3AdminOrder');let brief=initial,busy=false,error='';
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
 function render(){
 if(!host.isConnected)return;
 host.innerHTML='<section class="card"><h3>Pedido V3</h3><p>'+esc(brief.event.honoreeName)+' · '+esc(brief.event.date)+'</p><p>Total: '+money(brief.payment.totalCents)+'</p><p>'+ (brief.locked?'Aguardando confirmação de pagamento':'Pagamento confirmado')+'</p><button class="btn btn-secondary" data-v3-admin="refresh">Atualizar</button></section>'+
 (error?'<p role="alert" class="notice">'+esc(error)+'</p>':'')+
 brief.services.map(s=>'<section class="card"><h3>'+esc(s.productName)+'</h3><p>'+money(s.totalCents)+'</p><p>'+esc(s.briefingStatus==='completed'?'Briefing enviado':s.briefingStatus==='locked'?'Aguardando pagamento':'Aguardando respostas')+' · '+esc(s.reviewedAt?'Conferido pelo Admin':'Conferência pendente')+'</p>'+
 (s.complementNote?'<p>Complemento solicitado: '+esc(s.complementNote)+'</p>':'')+'</section>').join('')+
 brief.modules.map(m=>{const s=brief.services.find(x=>x.family===m.module);return '<details class="card" open><summary><strong>'+esc(names[m.module])+'</strong></summary>'+
 m.schema.sections.map(sec=>'<h4>'+esc(sec.title)+'</h4>'+sec.fields.filter(f=>m.data[f.key]!=null&&String(m.data[f.key]).trim()).map(f=>'<div class="order-answer-item"><strong>'+esc(f.label)+'</strong><p>'+esc(value(f,m.data[f.key]))+'</p></div>').join('')).join('')+
 (m.uploads||[]).map(u=>'<p>'+esc(u.originalFilename)+' · <a href="'+esc(u.contentPath)+'" target="_blank" rel="noopener noreferrer">Ver imagem privada</a></p>').join('')+
 materials(m)+(s?.briefingStatus==='completed'&&s.productionStatus==='pending'?'<div><button class="btn btn-primary" data-v3-admin="confirm" data-family="'+esc(m.module)+'">Confirmar briefing conferido</button><label>Complemento necessário <textarea maxlength="500" data-note="'+esc(m.module)+'"></textarea></label><button class="btn btn-secondary" data-v3-admin="reopen" data-family="'+esc(m.module)+'">Solicitar complemento</button></div>':'')+'</details>';}).join('')+
 '<p class="muted">Conferir não libera a produção automaticamente. A agenda será validada por serviço.</p>';
 host.querySelectorAll('button').forEach(b=>b.disabled=busy);
 }
 host.addEventListener('click',async e=>{
 const b=e.target.closest('[data-v3-admin]');if(!b||busy)return;
 const action=b.dataset.v3Admin,family=b.dataset.family;
 let path=base,payload=null;
 if(action==='receipt'){
   const get=k=>host.querySelector('[data-retro="'+k+'"]');
   const raw=get('durations').value.trim();
   payload={photoCount:Number(get('photoCount').value),videoCount:Number(get('videoCount').value),videoDurations:raw?raw.split(',').map(x=>Number(x.trim())):[],rawVideoSeconds:Number(get('rawVideoSeconds')?.value||0),complete:get('complete').checked};path+='/retro-materials';
 }else if(['confirm','reopen'].includes(action)){
   const m=brief.modules.find(x=>x.module===family);if(!m)return;
   payload={action,revision:m.revision,sharedRevision:brief.modules.find(x=>x.module==='shared')?.revision||0,note:host.querySelector('[data-note="'+family+'"]')?.value||''};path+='/'+family+'/review';
 }
 busy=true;error='';host.querySelectorAll('button').forEach(x=>x.disabled=true);
 try{const res=await api(path,payload?{method:'POST',body:JSON.stringify(payload)}:{});brief=res.briefing;if(payload){showToast('Atualizado.');if(onChanged)await onChanged();}}
 catch(err){error=err.message;}
 finally{busy=false;render();}
 });
 render();return close;
}
