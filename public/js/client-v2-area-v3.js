// V3 customer area is isolated from legacy single-product forms.
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.split('-').reverse().join('/'):'A confirmar';
const labels={shared:'Dados da comemoração',convite:'Convite digital',identidade_visual:'Libri Ateliê',retrospectiva:'Retrospectiva'};
const briefingLabels={locked:'Aguardando pagamento',available:'Aguardando preenchimento',in_progress:'Rascunho em andamento',completed:'Briefing enviado'};
const productionLabels={pending:'Aguardando briefing',ready:'Pronto para produção',in_production:'Em produção',waiting_customer:'Aguardando sua resposta',adjustments:'Em ajustes',approved:'Aprovado',delivered:'Entregue',cancelled:'Cancelado'};
function safeWhatsApp(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='wa.me'?u.href:null;}catch{return null;}}
function safePayment(value){try{const u=new URL(value);return u.protocol==='https:'&&/(^|\.)mercadopago\.com(\.br)?$/.test(u.hostname)?u.href:null;}catch{return null;}}
export function v3FieldHtml(f,value,{disabled=false}={}){
  const id='v3-f-'+esc(f.key), common=' data-v3-field="'+esc(f.key)+'" '+(disabled?'disabled':'');
  const required=f.required?' *':'';
  const label='<label for="'+id+'">'+esc(f.label)+required+'</label>';
  const help=(f.help||f.hint)?'<small class="field-help">'+esc(f.help||f.hint)+'</small>':'';
  if(f.type==='info')return '<p><strong>'+esc(f.label)+'</strong></p>'+help;
  if(f.type==='upload')return '<div class="field full">'+label+'<p class="field-help">O envio privado deste arquivo ainda está em preparação.</p>'+help+'</div>';
  let control='';
  if(f.type==='choice'||f.type==='multi_choice'){
    const multi=f.type==='multi_choice',selected=multi?(Array.isArray(value)?value:[]):[value];
    control='<div class="grid two">'+(f.options||[]).map((o,i)=>{
      const v=typeof o==='string'?o:o.value, name=typeof o==='string'?o:o.label;
      return '<label class="choice-card '+(selected.includes(v)?'selected':'')+'"><input type="'+(multi?'checkbox':'radio')+'" name="'+id+'" id="'+id+'-'+i+'" value="'+esc(v)+'"'+common+(selected.includes(v)?' checked':'')+'> <span>'+esc(name)+'</span></label>';
    }).join('')+'</div>';
  }else if(f.type==='textarea'){
    control='<textarea id="'+id+'" class="textarea"'+common+'>'+esc(value??'')+'</textarea>';
  }else{
    const type=['number','date','time','url','email','tel'].includes(f.type)?f.type:'text';
    control='<input id="'+id+'" class="input" type="'+type+'" value="'+esc(value??'')+'"'+common+
      (type==='number'&&f.min!=null?' min="'+esc(f.min)+'"':'')+(type==='number'&&f.max!=null?' max="'+esc(f.max)+'"':'')+' placeholder="'+esc(f.placeholder||'')+'">';
  }
  return '<div class="field full">'+label+control+help+'</div>';
}
export function renderV3Materials(module){
  const m=module.schema.materials;if(!m)return '';
  const wa=safeWhatsApp(m.whatsappUrl);
  return '<section class="card"><h3>Fotos e vídeos pelo WhatsApp</h3><p>Até '+esc(m.maxPhotos)+' fotos e '+esc(m.maxVideos)+' vídeos.'+
    (m.maxVideoSeconds?' Máximo de '+esc(m.maxVideoSeconds)+' segundos por vídeo.':'')+
    (m.maxTotalVideoSeconds!=null?' Limite total de '+esc(m.maxTotalVideoSeconds/60)+' minutos de vídeos.':'')+'</p>'+
    '<p>Organize as fotos na ordem desejada e envie os arquivos como documentos. O prazo começa após o pagamento, briefing completo e confirmação dos materiais pela Libri.</p>'+
    (wa?'<a class="btn secondary" href="'+esc(wa)+'" target="_blank" rel="noopener noreferrer">Enviar materiais pelo WhatsApp</a>':'<p>Solicite o canal de envio à Libri.</p>')+
    (module.receipt?'<p><strong>Recebimento registrado:</strong> '+esc(module.receipt.photoCount)+' fotos e '+esc(module.receipt.videoCount)+' vídeos. O registro não inicia a produção automaticamente.</p>':'<p>Aguardando conferência dos materiais pela Libri.</p>')+'</section>';
}
export async function startV3CustomerArea(root,{token,initial,api}){
  const endpoint='/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/briefing';
  let area=initial,active='summary',busy=false,error='',notice='',dirty=false,payment=null;
  function current(){return area.modules.find(m=>m.module===active);}
  function summary(){
    return '<section class="card"><h2>Seu pedido</h2><p>'+esc(area.event.honoreeName)+' · '+day(area.event.date)+'</p><p><strong>Total contratado:</strong> '+money(area.payment.totalCents)+'</p>'+
      '<p>Previsão inicial: '+day(area.deliveryWindow.start)+' a '+day(area.deliveryWindow.end)+'. '+(area.deliveryWindow.provisional?'O prazo será confirmado após o briefing e materiais necessários.':'')+'</p></section>'+
      area.services.map(s=>'<section class="card"><h3>'+esc(s.productName)+'</h3><p>'+esc(s.variantName)+'</p><p>'+esc(briefingLabels[s.briefingStatus]||'Em acompanhamento')+' · '+esc(productionLabels[s.productionStatus]||'Em acompanhamento')+'</p>'+
        '<p>'+money(s.totalCents)+'</p>'+s.extras.map(x=>'<p>'+esc(x.quantity)+' × '+esc(x.name)+'</p>').join('')+
        (!area.locked?'<button type="button" class="btn secondary" data-v3-tab="'+esc(s.family)+'">Ver briefing do serviço</button>':'')+'</section>').join('');
  }
  function paymentHtml(){
    if(!area.locked)return '';
    const url=payment?.state==='pending'?safePayment(payment.checkoutUrl):null;
    return '<section class="card"><h3>Pagamento</h3><p>'+esc(payment?.state==='paid'?'Pagamento confirmado. Atualize o pedido para conferir a liberação.':payment?.state==='expired'?'Cobrança anterior encerrada.':payment?.state==='review'?'Entre em contato com a Libri para revisar a cobrança.':'Confira a situação do pagamento para liberar os dados contratados.')+'</p>'+
      (url?'<a href="'+esc(url)+'" class="btn primary">Continuar pagamento</a>':'')+
      (payment?.canRenew?'<button type="button" class="btn primary" data-v3-action="renew">Gerar nova cobrança</button>':'')+
      '<button type="button" class="btn secondary" data-v3-action="payment">Verificar pagamento</button></section>';
  }
  function render(){
    const m=current();
    root.innerHTML='<section class="card"><h1>Meu pedido · '+esc(area.orderCode)+'</h1><p>Escolha o serviço que deseja acompanhar.</p><div class="grid two"><button type="button" class="btn secondary" data-v3-tab="summary">Resumo</button>'+
      (!area.locked?area.modules.map(x=>'<button type="button" class="btn secondary" data-v3-tab="'+esc(x.module)+'">'+esc(labels[x.module])+'</button>').join(''):'')+'</div></section>'+
      (error?'<p role="alert" class="card">'+esc(error)+'</p>':'')+(notice?'<p role="status" class="card">'+esc(notice)+'</p>':'')+
      (m?'<section class="card"><h2>'+esc(labels[m.module])+'</h2><p>'+(!m.editable?'Este briefing está disponível apenas para consulta.':'Preencha com calma. Salve as respostas para atualizar as próximas perguntas.')+'</p><form id="v3-module-form">'+m.schema.sections.map(s=>'<section><h3>'+esc(s.title)+'</h3>'+(s.description?'<p>'+esc(s.description)+'</p>':'')+s.fields.map(f=>v3FieldHtml(f,m.data[f.key],{disabled:busy||!m.editable})).join('')+'</section>').join('')+
        (m.editable?'<button type="submit" class="btn primary" '+(busy?'disabled':'')+'>Salvar rascunho</button>':'')+'</form><p class="field-help">O envio definitivo e os arquivos privados serão liberados na próxima etapa. Salvar não inicia a produção.</p></section>'+renderV3Materials(m):summary()+paymentHtml());
    root.setAttribute('aria-busy',String(busy));
    dirty=false;
  }
  function collect(m){
    const data={};
    for(const f of m.schema.sections.flatMap(s=>s.fields)){
      if(['info','upload'].includes(f.type))continue;
      const fields=Array.from(root.querySelectorAll('[data-v3-field]')).filter(el=>el.dataset.v3Field===f.key);
      if(f.type==='multi_choice')data[f.key]=fields.filter(el=>el.checked).map(el=>el.value);
      else if(f.type==='choice')data[f.key]=fields.find(el=>el.checked)?.value||'';
      else if(fields.length)data[f.key]=fields[0].value;
    }
    return data;
  }
  async function save(){
    const m=current();if(!m?.editable||busy)return false;
    const data=collect(m);busy=true;error='';notice='';
    const controls=Array.from(root.querySelectorAll('#v3-module-form input,#v3-module-form textarea,#v3-module-form button')).filter(el=>!el.disabled);
    controls.forEach(el=>{el.disabled=true;});
    try{
      const r=await api(endpoint+'/'+m.module,{method:'PATCH',body:JSON.stringify({revision:m.revision,data})});
      area=r.briefing;notice='Rascunho salvo. Confira se novas perguntas apareceram.';busy=false;render();return true;
    }catch(e){
      busy=false;error=e.message;controls.forEach(el=>{el.disabled=false;});
      // Keep unsaved form values in the DOM; never silently replace a draft.
      let alert=root.querySelector('[data-v3-save-error]');if(!alert){alert=document.createElement('p');alert.dataset.v3SaveError='';alert.setAttribute('role','alert');root.prepend(alert);}alert.textContent=error;
      return false;
    }
  }
  async function verify(renew=false){
    if(busy)return;busy=true;error='';render();
    try{
      payment=await api('/api/v3/cart/'+(renew?'renew':'recover'),{method:'POST',body:JSON.stringify({publicToken:token})});
      const r=await api(endpoint);area=r.briefing;
      if(!area.locked){active='summary';notice='Pagamento confirmado. Seus briefings estão disponíveis.';}
    }catch(e){error=e.message;}finally{busy=false;render();}
  }
  root.addEventListener('input',e=>{if(e.target.hasAttribute('data-v3-field'))dirty=true;});
  root.addEventListener('change',e=>{if(e.target.hasAttribute('data-v3-field'))dirty=true;});
  root.addEventListener('submit',e=>{if(e.target.id==='v3-module-form'){e.preventDefault();save();}});
  root.addEventListener('click',async e=>{
    const tab=e.target.closest('[data-v3-tab]')?.dataset.v3Tab;
    if(tab&&!busy){
      if(dirty&&current()?.editable&&!await save())return;
      active=tab;notice='';error='';render();return;
    }
    const action=e.target.closest('[data-v3-action]')?.dataset.v3Action;
    if(action==='payment')verify();
    if(action==='renew'&&payment?.canRenew)verify(true);
  });
  render();
  if(area.locked&&['awaiting_payment','configuring'].includes(area.orderStatus))await verify();
}
