import {buildV3ModuleSchema} from './briefing-schema-v3.v119.js?v=127';
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
    const childStyle=f.key==='visual_style'&&(f.options||[]).some(o=>o.value==='stylized_doll');
    const examples=childStyle?{stylized_doll:{src:'/images/exemplos/mascote-bonequinho.webp',alt:'Menina em estilo bonequinho',boy:'/images/exemplos/mascote-menino-bonequinho.webp',boyAlt:'Menino em estilo bonequinho'},realistic_detailed:{src:'/images/exemplos/mascote-realista.webp',alt:'Menina em estilo realista',boy:'/images/exemplos/mascote-menino-realista.webp',boyAlt:'Menino em estilo realista'}}:{};
    control='<div class="grid two'+(childStyle?' v3-style-examples':'')+'">'+(f.options||[]).map((o,i)=>{
      const v=typeof o==='string'?o:o.value, name=typeof o==='string'?o:o.label;
      const example=examples[v];
      return '<label class="choice-card '+(selected.includes(v)?'selected':'')+(example?' v3-style-example':'')+'"><input type="'+(multi?'checkbox':'radio')+'" name="'+id+'" id="'+id+'-'+i+'" value="'+esc(v)+'"'+common+(selected.includes(v)?' checked':'')+'> <span class="v3-style-label">'+(example?'<span class="libri-style-pair"><img class="v3-style-thumbnail" src="'+esc(example.src)+'" alt="'+esc(example.alt)+'" width="48" height="64" loading="lazy" decoding="async"><img class="v3-style-thumbnail" src="'+esc(example.boy)+'" alt="'+esc(example.boyAlt)+'" width="48" height="64" loading="lazy" decoding="async"></span>':'')+'<span>'+esc(name)+'</span></span></label>';
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
    (module.receipt?'<p><strong>Recebimento registrado:</strong> '+esc(module.receipt.photoCount)+' fotos e '+esc(module.receipt.videoCount)+' vídeos. '+(module.receipt.completeAt?'Materiais completos confirmados.':'Ainda falta confirmar o recebimento completo.')+' A produção depende da conferência e da agenda.</p>':'<p>Aguardando conferência dos materiais pela Libri.</p>')+'</section>';
}
// Upload progress measures bytes sent; 100% is only shown after the server confirms storage.
export function uploadV3WithProgress(url,body,onProgress){
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('POST',url);xhr.timeout=120000;
  xhr.upload.onprogress=e=>{if(e.lengthComputable&&e.total>0)onProgress(Math.min(1,e.loaded/e.total));};
  xhr.onload=()=>{let data;try{data=JSON.parse(xhr.responseText);}catch{}if(xhr.status>=200&&xhr.status<300&&data?.ok&&data.result?.id){resolve(data);return;}const e=new Error(data?.error||'Não foi possível confirmar o envio.');e.uncertain=xhr.status>=500||xhr.status===0||!data;reject(e);};
  const uncertain=()=>{const e=new Error('Conexão interrompida. Confira quais imagens foram salvas antes de tentar novamente.');e.uncertain=true;reject(e);};
  xhr.onerror=uncertain;xhr.ontimeout=uncertain;xhr.onabort=uncertain;xhr.send(body);
 });
}
export function renderV3Uploads(m,busy=false,uploadState=null){
 const files=m.uploads||[],rules=m.schema.uploadRules||[];
 if(!rules.length&&!files.length)return '';
 return '<section class="card"><h3>Imagens privadas</h3><p>JPG, PNG, WebP, HEIC ou HEIF, até 15 MB por imagem.</p>'+
 rules.map(r=>{const count=files.filter(x=>x.fieldKey===r.fieldKey).length,remaining=Math.max(0,r.max-count),state=uploadState?.fieldKey===r.fieldKey?uploadState:null;return '<div class="field full" data-v3-upload-field="'+esc(r.fieldKey)+'"><label>'+esc(r.label)+'</label><p>'+esc(r.help||('Até '+r.max+' imagens.'))+'</p>'+
 (r.requiresUploadAuthorization&&m.editable?'<small class="field-help">Ao enviar, você declara ter autorização da pessoa retratada ou de seu responsável legal para utilizar as imagens enviadas neste pedido.</small>':'')+(!r.authorized&&!r.requiresUploadAuthorization?'<p>Salve a autorização necessária antes do envio.</p>':m.editable?'<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-v3-upload="'+esc(r.fieldKey)+'" '+(busy||!remaining?'disabled':'')+'>':'')+'<small class="field-help">'+count+' de '+r.max+' imagens • '+remaining+' disponíveis</small>'+(state?'<div class="v3-upload-progress" data-v3-upload-progress><progress max="100" value="'+esc(state.percent)+'" aria-label="Progresso do envio das imagens"></progress><small data-v3-upload-status role="status">'+esc(state.message)+'</small></div>':'')+'</div>';}).join('')+
 files.map(x=>'<div class="field full"><span>'+esc(x.originalFilename)+'</span>'+
 (rules.some(r=>r.fieldKey===x.fieldKey&&r.authorized)?'<a href="'+esc(x.contentPath)+'" target="_blank" rel="noopener noreferrer">Ver imagem</a>':'<span>Imagem sem autorização ativa</span>')+
 (m.editable?'<button type="button" class="btn secondary" data-v3-delete="'+esc(x.id)+'" '+(busy?'disabled':'')+'>Remover</button>':'')+'</div>').join('')+'</section>';
}
export async function startV3CustomerArea(root,{token,initial,api}){
  if(initial.locked&&initial.revision?.kind==='manual'&&!initial.cancellation&&['configuring','awaiting_payment'].includes(initial.orderStatus)){
    const {startV3ManualCheckout}=await import('./client-v3-manual-checkout.js?v=115');
    return startV3ManualCheckout(root,{token,api});
  }
  root.classList.add('libri-v3-area');document.body.classList.add('libri-v3-area-body');
  const endpoint='/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/briefing';
  let area=initial,active='summary',busy=false,error='',notice='',payment=null,upsellSeen=false,acceptedUpsell=null,contracts=null,uploadState=null,uploadStarting=false;
  const contractEndpoint='/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/contracts';
  async function loadContracts(){try{contracts=(await api(contractEndpoint)).result;}catch(e){error=e.message;}if(active==='contracts')render();}
  function contractHtml(){return '<section class="card"><h2>Contratos</h2>'+(contracts?(contracts.contracts.length?contracts.contracts.map(c=>'<article class="contract-card"><h3>Versão '+esc(c.version)+'</h3><div class="contract-body" style="white-space:pre-wrap">'+esc(c.body)+'</div>'+(c.status==='waiting_customer'&&!area.locked?'<label>Nome de quem está assinando<input data-contract-name="'+esc(c.id)+'" value="'+esc(contracts.order.customerName||'')+'"></label><button data-v3-sign-contract="'+esc(c.id)+'" class="btn primary">Assinar contrato</button>':'')+(c.hasFinalPdf?'<a href="'+esc(contractEndpoint+'/'+c.id+'/pdf')+'" class="btn secondary">Baixar PDF assinado</a>':'')+'</article>').join(''):'<p>Nenhum contrato disponível.</p>'):'<p>Carregando contratos…</p>')+'</section>';}

  // Edits remain local until confirmed; a single serialized writer preserves server revisions.
  const pending=new Map();let writer=null,saveTimer=null,saveError='',saveNotice='';
  function current(){
    const m=area.modules.find(m=>m.module===active);if(!m)return null;
    const data={...m.data,...pending.get(m.module)};
    if(!area.schemaContext||!m.editable)return {...m,data};
    const drafts=Object.fromEntries(area.modules.map(x=>[x.module,{...x.data,...pending.get(x.module)}]));
    const {order,services}=area.schemaContext;
    try{
      const schema=buildV3ModuleSchema(order,services,m.module,drafts);
      if(schema.materials&&m.schema?.materials?.whatsappUrl)schema.materials.whatsappUrl=m.schema.materials.whatsappUrl;
      return {...m,data,schema};
    }catch{return {...m,data};}
  }
  function saveStatusHtml(){return !area.locked?'<div class="v3-draft-status" data-v3-draft-status role="status">'+draftStatusText()+'</div>':'';}
  function draftStatusText(){return saveError?'Não foi possível salvar. Suas respostas continuam nesta tela. <button type="button" class="btn secondary" data-v3-action="retry-draft">Tentar novamente</button>':pending.size||writer?'Salvando respostas…':saveNotice?'Respostas salvas ✓':'';}
  function refreshSaveStatus(){const el=root.querySelector('[data-v3-draft-status]');if(el)el.innerHTML=draftStatusText();}
  function rememberField(m,key,value){const patch=pending.get(m.module)||{};pending.set(m.module,{...patch,[key]:value});saveError='';saveNotice='';refreshSaveStatus();}
  function scheduleSave(immediate=false){clearTimeout(saveTimer);if(immediate){void flushDrafts();}else{saveTimer=setTimeout(()=>{void flushDrafts();},450);}}
  function schemaSignature(m){return JSON.stringify([m?.schema,m?.editable]);}
  function refreshAfterSchemaChange(){
    const focus=document.activeElement, id=root.contains(focus)?focus.id:'', top=id?focus.getBoundingClientRect().top:null;
    const selection=id&&typeof focus.selectionStart==='number'?[focus.selectionStart,focus.selectionEnd]:null;
    const y=window.scrollY;render();
    const el=id?document.getElementById(id):null;
    if(el){el.focus({preventScroll:true});if(selection&&typeof el.setSelectionRange==='function'){try{el.setSelectionRange(...selection);}catch{}}window.scrollBy(0,el.getBoundingClientRect().top-top);}
    else window.scrollTo(0,y);
  }
  async function flushDrafts(){
    clearTimeout(saveTimer);
    if(writer)return writer;
    if(!pending.size)return true;
    saveError='';
    writer=(async()=>{
      while(pending.size){
        const [module,patch]=pending.entries().next().value;
        const m=area.modules.find(m=>m.module===module);
        if(!m?.editable){saveError='Não é possível editar este serviço.';return false;}
        try{
          const r=await api(endpoint+'/'+module,{method:'PATCH',body:JSON.stringify({revision:m.revision,data:{...m.data,...patch}})});
          const before=schemaSignature(current());
          const remaining={...pending.get(module)};
          for(const key of Object.keys(patch))if(Object.is(remaining[key],patch[key]))delete remaining[key];
          if(Object.keys(remaining).length)pending.set(module,remaining);else pending.delete(module);
          area=r.briefing;saveNotice='saved';
          if(active!=='summary'&&before!==schemaSignature(current()))refreshAfterSchemaChange();
        }catch(e){saveError=e.message||'Falha de conexão';return false;}
      }
      return true;
    })();
    refreshSaveStatus();
    try{return await writer;}finally{writer=null;refreshSaveStatus();}
  }
  if(typeof window!=='undefined')window.addEventListener('beforeunload',e=>{if(pending.size||uploadStarting||uploadState?.running){e.preventDefault();e.returnValue='';}});
  function nextBriefing(){return area.modules.find(m=>m.module==='shared'&&m.editable&&(!m.revision||m.schema?.sections.flatMap(s=>s.fields).some(f=>f.required&&!['info','upload'].includes(f.type)&&!String(m.data?.[f.key]??'').trim())))||area.modules.find(m=>m.module!=='shared'&&m.editable)||area.modules.find(m=>m.editable);}
  function allDelivered(){return !area.locked&&!area.cancellation&&area.services.length>0&&area.services.every(s=>s.delivery?.delivered)&&!(area.supplements||[]).some(x=>['offered','accepted','payment_pending','review'].includes(x.status));}
  function completionNotice(){const url=safeWhatsApp(area.briefingWhatsappUrl);return !area.locked&&!area.services.some(s=>s.productionStatus!=='pending'&&s.productionStatus!=='ready')&&url?'<section class="card v3-client-completion"><h3>Tudo pronto! 💛</h3><p>Seus dados foram enviados. Avise a Libri pelo WhatsApp para facilitar o acompanhamento.</p><a class="btn primary" data-v3-briefing-whatsapp href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Avisar a Libri no WhatsApp 💛</a></section>':'';}
  function briefingHome(){
    const next=nextBriefing(),count=area.services.filter(s=>s.briefingStatus==='completed').length,total=area.services.length;
    if(area.locked||area.cancellation)return '';
    return '<section class="v3-client-next"><span class="v3-client-kicker">'+(area.payment.fullyPaid?'Pagamento confirmado':area.payment.receivedCents>0?'Entrada confirmada':'Meu pedido')+'</span><h2>'+(next?'Vamos começar?':count===total?'Dados enviados!':'Acompanhe seu pedido')+'</h2><p>'+(next?'Preencha os dados da comemoração e dos serviços contratados. Assim podemos preparar tudo para você.':count===total?'Recebemos seus dados. Acompanhe as próximas etapas por aqui.':'Consulte seus serviços e as atualizações do pedido.')+'</p>'+(next?'<button type="button" class="btn primary" data-v3-start="'+esc(next.module)+'">'+(next.revision?'Continuar preenchimento':'Preencher meus dados')+' <span aria-hidden="true">›</span></button>':'')+'<div class="v3-client-progress"><progress aria-label="Serviços com dados enviados" value="'+count+'" max="'+Math.max(total,1)+'"></progress><small>'+count+' de '+total+' '+(total===1?'serviço com dados enviados':'serviços com dados enviados')+'</small></div></section>';
  }
  function clientHeader(){
    return '<header class="v3-client-header"><span class="v3-client-kicker">'+esc(area.orderCode)+'</span><h1>Meu pedido</h1><p>'+esc(area.event.honoreeName)+' · '+day(area.event.date)+'</p></header><nav aria-label="Área do pedido" class="v3-client-nav"><button type="button" class="btn secondary" aria-current="'+(active==='summary'?'page':'false')+'" data-v3-tab="summary">Resumo</button>'+(!area.locked?area.modules.map(x=>'<button type="button" class="btn secondary" aria-current="'+(active===x.module?'page':'false')+'" data-v3-tab="'+esc(x.module)+'">'+esc(labels[x.module])+'</button>') .join(''):'')+'<button type="button" class="btn secondary" data-v3-tab="contracts" aria-current="'+(active==='contracts'?'page':'false')+'">Contratos</button></nav>';
  }
  function deliveryHtml(s){
    const d=s.delivery;if(!d?.delivered)return '';
    const base='/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/delivery/'+esc(s.family)+'/files/';
    return '<div class="v3-delivery-links" style="display:grid;gap:10px;margin-top:12px">'+
    (d.interactiveUrl?'<a class="btn primary" href="'+esc(d.interactiveUrl)+'" target="_blank" rel="noopener noreferrer">Abrir meu convite</a>':'')+
    (d.externalUrl?'<a class="btn '+(d.interactiveUrl?'secondary':'primary')+'" href="'+esc(d.externalUrl)+'" target="_blank" rel="noopener noreferrer">Baixar pelo Google Drive</a>':'')+
    (d.files||[]).filter(f=>f.available).map(f=>'<a class="btn secondary" href="'+esc(base+f.id)+'">Baixar '+esc(f.filename)+'</a>').join('')+
    (d.externalChannel==='whatsapp'?'<p>Seu arquivo foi enviado pelo WhatsApp.</p>':'')+'</div>';
  }
  function deliveredSummary(){
    return '<header class="v3-client-header"><span class="v3-client-kicker">'+esc(area.orderCode)+'</span><h1>Seu pedido está pronto! 💛</h1><p>'+esc(area.event.honoreeName)+' · '+day(area.event.date)+'</p></header>'+
    area.services.map(s=>'<section class="card v3-client-service"><h3>'+esc(s.productName)+'</h3>'+deliveryHtml(s)+'<details style="margin-top:16px"><summary>O que você contratou</summary><p>'+esc(s.variantName||'')+'</p>'+ (s.extras||[]).map(x=>'<p>'+esc(x.quantity)+' × '+esc(x.name)+'</p>').join('')+'<p>Valor: '+money(s.totalCents)+'</p><p>Entregue em '+day(s.delivery.deliveredAt.slice(0,10))+'</p></details></section>').join('')+
    '<section class="card"><a class="btn secondary" href="/pedido">Contratar novo serviço</a></section>';
  }
  function productionHtml(s){
    const p=s.progress;if(!p)return '';
    const preview=p.preview,family=esc(s.family);
    const url='/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/production/'+family+'/preview/'+preview?.id;
    const button=(action,label)=>'<button class="btn primary" type="button" data-v3-production="'+action+'" data-family="'+family+'" '+(busy?'disabled':'')+'>'+label+'</button>';
    return '<div class="card"><h4>'+esc(productionLabels[s.productionStatus]||'Em acompanhamento')+'</h4>'+
      (preview&&preview.available!==false?(preview.externalChannel==='whatsapp'?'<p>Prévia '+esc(preview.version)+' enviada pelo WhatsApp. Confira o vídeo na conversa com a Libri antes de aprovar.</p>':preview.externalChannel==='drive'?(preview.externalUrl?'<p><a class="btn secondary" href="'+esc(preview.externalUrl)+'" target="_blank" rel="noopener noreferrer">Ver prévia no Google Drive</a></p>':''):'<p><a class="btn secondary" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Ver prévia '+esc(preview.version)+'</a></p>'):'')+
      (p.revisionsIncluded!==null?'<p>Rodadas de ajustes utilizadas: '+esc(p.revisionsUsed)+' de '+esc(p.revisionsIncluded)+'</p>':'')+
      (s.productionStatus==='waiting_customer'&&preview?.status==='active'?'<p>Solicite ajustes até '+day(preview.adjustmentDeadline.slice(0,10))+'. A falta de resposta não aprova automaticamente a prévia.</p>'+button('approve','Aprovar prévia')+
      (Date.now()<=Date.parse(preview.adjustmentDeadline)?'<label for="v3-adjust-'+family+'">O que deseja ajustar?</label><textarea id="v3-adjust-'+family+'" class="textarea" maxlength="2000" data-adjust-note="'+family+'"></textarea>'+button('request_adjustments','Solicitar ajustes'):'<p>Prazo de ajustes encerrado. Fale com a Libri se precisar de ajuda.</p>'):'')+
      (s.productionStatus==='adjustments'?'<p>Solicitação registrada. A Libri irá conferir os ajustes e informar se estão dentro do escopo contratado.</p>':'')+
      (s.productionStatus==='approved'?'<p>Prévia aprovada. Aguardando os arquivos finais.</p>':'')+'</div>';
  }
  function supplementPaymentHtml(x){
    const url=safePayment(x.payment?.checkoutUrl);
    const button=(action,label)=>'<button type="button" class="btn '+(action==='verify'?'secondary':'primary')+'" data-v3-supplement="'+action+'" data-id="'+x.id+'" '+(busy?'disabled':'')+'>'+label+'</button>';
    if(x.status==='review')return '<p>Pagamento em conferência. Não faça outro pagamento.</p>';
    if(x.status==='paid')return '<p>Pagamento complementar confirmado.</p>';
    return (url?'<a class="btn primary" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Continuar pagamento</a>':'')+
      (area.supplementPaymentsEnabled?(x.paymentAvailable?button('pay','Pagar adicional integral'):x.canRetry?button('pay','Retomar criação da cobrança'):x.canRenew?button('renew','Gerar nova cobrança'):''):'')+
      (x.canVerify?button('verify','Verificar pagamento'):'')+
      (x.status==='accepted'&&!x.paymentAvailable&&!x.canRenew?'<p>Aguardando conferência da etapa e agenda.</p>':'')+
      (x.payment?.status==='creating'&&!x.canRetry?'<p>Não crie outro pagamento. Aguarde conferência da tentativa anterior.</p>':'');
  }
  function supplementHtml(s){
    const offers=(area.supplements||[]).filter(x=>x.family===s.family);
    const statuses={offered:'Aguardando sua decisão',accepted:'Proposta aceita',declined:'Recusada',cancelled:'Cancelada',payment_pending:'Pagamento pendente',paid:'Pago',review:'Em conferência'};
    return offers.map(x=>'<section class="card"><h4>'+esc(x.kind==='upgrade'?'Upgrade de pacote':x.kind==='new_service'?'Novo serviço':'Proposta complementar')+'</h4><p>'+esc(statuses[x.status]||'Em acompanhamento')+'</p>'+x.items.map(i=>'<p>'+esc(i.quantity)+' × '+esc(i.name)+' · '+money(i.totalCents)+'</p>').join('')+(x.note?'<p>'+esc(x.note)+'</p>':'')+(x.cardFeeCents?'<p>Taxa de cartão: '+money(x.cardFeeCents)+'</p>':'')+'<p><strong>Total adicional: '+money(x.totalCents)+'</strong> · '+(x.paymentMethod==='pix'?'Pix integral':'Cartão integral')+'</p><p>O pedido original permanece inalterado até pagamento confirmado e conferência da agenda.</p>'+
      (x.absorbed?.length?'<p>Extras já contratados incorporados ao pacote: '+x.absorbed.map(i=>esc(i.quantity+' × '+i.name)).join(', ')+'</p>':'')+
      (x.deliveryWindow?'<p>Previsão do novo serviço: '+day(x.deliveryWindow.start)+' a '+day(x.deliveryWindow.end)+'. Prazo final confirmado após briefing e materiais completos.</p>':'')+
      (x.terms?'<details><summary>Condições da nova contratação</summary><p style="white-space:pre-wrap">'+esc(x.terms.generalBody)+'</p>'+(x.terms.specificBody?'<p style="white-space:pre-wrap">'+esc(x.terms.specificBody)+'</p>':'')+'</details>'+(x.status==='offered'?'<label><input type="checkbox" data-change-terms="'+x.id+'"> Li e aceito as condições desta proposta.</label>':''):'')+
      (x.status==='offered'?'<div class="grid two"><button type="button" class="btn primary" data-v3-supplement="accept" data-id="'+x.id+'" '+(busy?'disabled':'')+'>Aceitar proposta</button><button type="button" class="btn secondary" data-v3-supplement="decline" data-id="'+x.id+'" '+(busy?'disabled':'')+'>Recusar</button></div>':'')+supplementPaymentHtml(x)+'</section>').join('');
  }
  async function supplementPaymentAction(id,action){
    if(busy||!await flushDrafts()||busy)return;
    const x=(area.supplements||[]).find(y=>y.id===Number(id));if(!x)return;
    if(action!=='verify'&&!window.confirm('Confirma o pagamento integral do adicional de '+money(x.totalCents)+'? O valor já pago do pedido original não será cobrado novamente.'))return;
    busy=true;error='';notice='';render();
    try{
      const r=await api('/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/supplements/'+x.family+'/'+x.id+'/'+action,{method:'POST',body:JSON.stringify({confirmed:true})});
      area=r.briefing;
      notice=r.result.status==='approved'?'Pagamento complementar confirmado.':r.result.needsReview?'A cobrança precisa de conferência. Não faça outro pagamento.':r.result.status==='pending'?'Cobrança pendente. Confira o link para continuar.':'Situação da cobrança atualizada.';
    }catch(e){error=e.message;try{area=(await api(endpoint)).briefing;}catch{}}
    finally{busy=false;render();}
  }
  async function decideSupplement(id,action){
    if(busy||!await flushDrafts()||busy)return;
    const x=(area.supplements||[]).find(y=>y.id===Number(id));
    if(!x||x.status!=='offered')return;
    const termsAccepted=!!root.querySelector('[data-change-terms="'+x.id+'"]')?.checked;
    if(action==='accept'&&x.terms&&!termsAccepted){error='Leia e aceite as condições desta proposta.';render();return;}
    if(!window.confirm(action==='accept'?'Aceitar a proposta de '+money(x.totalCents)+'? Nenhum pagamento será iniciado agora.':'Recusar esta proposta complementar?'))return;
    busy=true;error='';notice='';render();
    try{
      const r=await api('/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/supplements/'+x.family+'/'+x.id+'/decision',{method:'POST',body:JSON.stringify({action,confirmed:true,expectedTotalCents:x.totalCents,termsAccepted})});
      area=r.briefing;notice=action==='accept'?'Aceite registrado. Confira as opções de pagamento.':'Proposta recusada.';
    }catch(e){error=e.message;}finally{busy=false;render();}
  }
  function summary(){
    return '<details class="card v3-financial-details" '+(area.locked?'open':'')+'><summary>Detalhes do pedido e pagamento</summary><p><strong>Contratação original:</strong> '+money(area.payment.totalCents)+'</p>'+(area.payment.depositPercent===50?'<p>Entrada autorizada: '+money(area.payment.depositCents)+'</p><p>Recebido: '+money(area.payment.receivedCents)+'</p><p><strong>Saldo do pedido: '+money(area.payment.remainingCents)+'</strong></p>':'')+(area.financial?'<p>Adicionais confirmados: '+money(area.financial.paidSupplementCents)+'</p><p><strong>Total confirmado: '+money(area.financial.confirmedTotalCents)+'</strong></p>'+(area.financial.pendingSupplementCents?'<p>Adicionais aguardando pagamento: '+money(area.financial.pendingSupplementCents)+'</p>':'')+(area.financial.reviewSupplementCents?'<p>Valores em conferência: '+money(area.financial.reviewSupplementCents)+'</p>':''):'')+
      '<p>Previsão inicial: '+day(area.deliveryWindow.start)+' a '+day(area.deliveryWindow.end)+'. '+(area.deliveryWindow.provisional?'O prazo será confirmado após o briefing e materiais necessários.':'')+'</p></details>'+
      area.services.map(s=>'<section class="card v3-client-service"><h3>'+esc(s.productName)+'</h3><p>'+esc(s.variantName)+'</p><span class="v3-client-service-status">'+esc(s.briefingStatus==='available'?'Dados pendentes':briefingLabels[s.briefingStatus]||'Em acompanhamento')+'</span><p>'+esc(productionLabels[s.productionStatus]||'Em acompanhamento')+'</p>'+
        (s.deliveryWindow?'<p><strong>Entrega prevista:</strong> '+day(s.deliveryWindow.start)+' a '+day(s.deliveryWindow.end)+'</p>':'<p>Prazo de entrega a confirmar.</p>')+(s.complementNote?'<p><strong>Complemento solicitado:</strong> '+esc(s.complementNote)+'</p>':'')+'<p>'+money(s.totalCents)+'</p>'+(s.blackLibri?'<p><strong>Black Libri:</strong> '+esc(s.blackLibri.label)+(s.blackLibri.gift?' · Brinde incluído':s.blackLibri.applied?' · Desconto aplicado':' · Melhor condição mantida')+'</p>':'')+s.extras.map(x=>'<p>'+esc(x.quantity)+' × '+esc(x.name)+'</p>').join('')+
        (!area.locked?'<button type="button" class="btn '+(area.modules.find(m=>m.module===s.family)?.editable?'primary':'secondary')+'" data-v3-tab="'+esc(s.family)+'">'+(area.modules.find(m=>m.module===s.family)?.editable?'Preencher dados do serviço':'Ver dados do serviço')+'</button>':'')+(s.delivery?.delivered?'':productionHtml(s))+deliveryHtml(s)+supplementHtml(s)+'</section>').join('');
  }
  function paymentHtml(){
    if(!area.locked)return '';
    if(area.orderStatus==='awaiting_urgency_decision'&&payment?.state!=='not_started'&&payment?.state!=='pending')return '<section class="card"><h3>Encaixe em análise</h3><p>Aguarde a confirmação da Libri. Nenhuma cobrança foi criada.</p><button type="button" class="btn secondary" data-v3-action="payment">Atualizar situação</button></section>';
    if(area.orderStatus==='cancelled'&&area.urgency?.status==='rejected')return '<section class="card"><h3>Encaixe não aprovado</h3><p>'+esc(area.urgency.note||'Não há capacidade para esta data.')+'</p><p>Nenhuma cobrança foi criada.</p></section>';
    if(area.cancellation)return '<section class="card"><h3>'+(area.cancellation.status==='completed'?'Pedido cancelado':'Cancelamento em conferência')+'</h3><p>Devoluções confirmadas: '+money(area.cancellation.refundCents)+'</p><p>Não realize novos pagamentos. Entre em contato com a Libri para esclarecimentos.</p></section>';
    if(area.revision){
      const r=area.revision;
      return '<section class="card"><h3>Confira a proposta revisada</h3><p>'+esc(r.reason)+'</p>'+r.items.map(i=>'<p><strong>'+esc(i.productName+' · '+i.variantName)+'</strong> · '+money(i.totalCents)+'<br>'+i.addons.map(esc).join(', ')+' '+i.extras.map(x=>esc(x.quantity+' × '+x.name)).join(', ')+'</p>').join('')+'<p>Nova previsão: '+day(r.deliveryWindow.start)+' a '+day(r.deliveryWindow.end)+'</p><p><strong>Total: '+money(acceptedUpsell?.totalCents??r.totalCents)+'</strong> · Entrada: '+money(acceptedUpsell?.depositCents??r.depositCents)+'</p>'+(acceptedUpsell?'<p>Sugestão escolhida · +'+money(acceptedUpsell.increaseCents)+' <button type="button" class="btn btn-ghost" data-v3-action="remove-upsell">Retirar sugestão</button></p>':'')+''+(r.blackLibri?'<p>Surpresa preservada: '+esc(r.blackLibri.label)+'</p>':'')+'<details><summary>Condições da contratação</summary><p style="white-space:pre-wrap">'+esc(r.terms.general.body)+'</p>'+r.terms.services.map(t=>'<p style="white-space:pre-wrap">'+esc(t.body)+'</p>').join('')+'</details><label><input type="checkbox" data-revision-terms> Li e aceito as condições e o novo valor.</label><button class="btn primary" data-v3-action="accept-revision">Aceitar proposta</button></section>';
    }
    const url=payment?.state==='pending'?safePayment(payment.checkoutUrl):null;
    return '<section class="card"><h3>Pagamento</h3><p>'+esc(payment?.state==='urgency_pending'?'Solicitação em análise.':payment?.state==='paid'?'Pagamento confirmado. Atualize o pedido para conferir a liberação.':payment?.state==='expired'?'Cobrança anterior encerrada.':payment?.state==='review'?'Entre em contato com a Libri para revisar a cobrança.':'Confira a situação do pagamento para liberar os dados contratados.')+'</p>'+
      (url?'<a href="'+esc(url)+'" class="btn primary">Continuar pagamento</a>':'')+
      (payment?.canRenew?'<button type="button" class="btn primary" data-v3-action="renew">'+(payment?.state==='not_started'?'Pagar pedido':'Gerar nova cobrança')+'</button>':'')+
      '<button type="button" class="btn secondary" data-v3-action="payment">Verificar pagamento</button></section>';
  }
  function render(){
    if(allDelivered()){root.innerHTML=deliveredSummary();root.setAttribute('aria-busy','false');return;}
    const m=current();
    root.innerHTML=clientHeader()+saveStatusHtml()+(active==='summary'?briefingHome():'')+completionNotice()+
      (error?'<p role="alert" class="card">'+esc(error)+'</p>':'')+(notice?'<p role="status" class="card">'+esc(notice)+'</p>':'')+
      (active==='contracts'?contractHtml():m?'<section class="card"><h2>'+esc(labels[m.module])+'</h2><p>'+(!m.editable?'Este briefing está disponível apenas para consulta.':'Preencha com calma. As próximas perguntas aparecem conforme suas escolhas.')+'</p><form id="v3-module-form">'+m.schema.sections.map(s=>'<section><h3>'+esc(s.title)+'</h3>'+(s.description?'<p>'+esc(s.description)+'</p>':'')+s.fields.map(f=>v3FieldHtml(f,m.data[f.key],{disabled:busy||!m.editable})).join('')+'</section>').join('')+
        (m.editable?'<div class="v3-client-form-actions"><button type="submit" class="btn '+(m.module==='shared'?'secondary':'primary')+'" '+(busy?'disabled':'')+'>Salvar rascunho</button>'+(m.module==='shared'?'<button type="button" class="btn primary" data-v3-action="next-briefing" '+(busy?'disabled':'')+'>Salvar e continuar</button>':'')+'</div>':'')+'</form><p class="field-help">As respostas salvas ficam disponíveis quando você voltar.</p></section>'+renderV3Uploads(m,busy,uploadState?.module===m.module?uploadState:null)+renderV3Materials(m)+(m.editable&&m.module!=='shared'?'<section class="card"><button type="button" class="btn primary" data-v3-action="submit" '+(busy?'disabled':'')+'>Enviar dados definitivos</button></section>':''):summary()+paymentHtml());
    root.setAttribute('aria-busy',String(busy));
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
  async function save({quiet=false}={}){
    const tab=active;
    const ok=await flushDrafts();
    if(ok&&!quiet&&active===tab){notice='Rascunho salvo.';render();}
    return ok;
  }
  function updateUploadProgress(percent,message){
    if(!uploadState)return;
    uploadState.percent=percent;uploadState.message=message;
    const box=root.querySelector('[data-v3-upload-progress]');
    if(box){box.querySelector('progress').value=percent;box.querySelector('[data-v3-upload-status]').textContent=message;}
  }
  async function fileAction({fieldKey,files,id}){
    if(busy||uploadStarting||!current()?.editable)return;
    const tab=active;uploadStarting=true;
    try{if(!await save({quiet:true})||active!==tab||busy)return;
      const m=current();
      if(id){busy=true;error='';notice='';uploadState=null;render();try{await api(endpoint+'/'+m.module+'/uploads/'+encodeURIComponent(id),{method:'DELETE'});area=(await api(endpoint)).briefing;notice='Imagem removida.';}catch(e){error=e.message;}finally{busy=false;render();}return;}
      const rule=m.schema.uploadRules.find(r=>r.fieldKey===fieldKey);
      if(!rule||(!rule.authorized&&!rule.requiresUploadAuthorization))return;
      const remaining=Math.max(0,rule.max-(m.uploads||[]).filter(x=>x.fieldKey===fieldKey).length);
      const selected=Array.from(files||[]);if(!selected.length)return;
      // Reject an oversized selection rather than silently discarding images.
      if(selected.length>remaining){uploadState={module:tab,fieldKey,running:false,percent:0,message:'Você pode selecionar até '+remaining+' imagem(ns) neste campo.'};render();return;}
      const invalid=selected.find(file=>!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.type.toLowerCase())||file.size<=0||file.size>15*1024*1024);
      if(invalid){uploadState={module:tab,fieldKey,running:false,percent:0,message:'Confira '+invalid.name+': envie JPG, PNG, WebP, HEIC ou HEIF de até 15 MB.'};render();return;}
      busy=true;error='';notice='';
      const total=selected.reduce((sum,file)=>sum+file.size,0);let confirmedBytes=0,confirmed=0,failure='';
      uploadState={module:tab,fieldKey,running:true,percent:0,message:'Preparando '+selected.length+' imagem(ns)…'};render();
      root.querySelector('[data-v3-upload-progress]')?.scrollIntoView({block:'nearest'});
      try{
        for(const file of selected){
          const body=new FormData();body.append('fieldKey',fieldKey);body.append('file',file);
          if(rule.requiresUploadAuthorization)body.append('authorizationAccepted','true');
          const prefix='Enviando '+(confirmed+1)+' de '+selected.length;
          updateUploadProgress(Math.floor(100*confirmedBytes/total),prefix+'…');
          await uploadV3WithProgress(endpoint+'/'+m.module+'/uploads',body,fraction=>{
            const percent=Math.min(99,Math.floor(100*(confirmedBytes+file.size*fraction)/total));
            updateUploadProgress(percent,fraction===1?'Salvando imagem '+(confirmed+1)+' de '+selected.length+'…':prefix+' • '+percent+'%');
          });
          confirmed++;confirmedBytes+=file.size;
          updateUploadProgress(Math.floor(100*confirmedBytes/total),confirmed+' de '+selected.length+' imagens salvas');
        }
      }catch(e){failure=e.message||'Falha no envio.';}
      // Always reconcile from the server, including partial success or lost responses.
      try{area=(await api(endpoint)).briefing;}catch(e){failure=(failure?failure+' ':'')+'Não foi possível atualizar a lista. Recarregue a página antes de enviar novamente.';}
      uploadState.running=false;
      uploadState.percent=Math.floor(100*confirmedBytes/total);
      uploadState.message=failure?confirmed+' de '+selected.length+' confirmadas. '+failure:confirmed+' de '+selected.length+' imagens enviadas ✓';
      busy=false;render();
    }finally{uploadStarting=false;}
  }
  function missingFields(modules){
    const issues=[];
    for(const m of modules.filter(Boolean)){
      for(const f of m.schema.sections.flatMap(s=>s.fields)){
        const v=m.data[f.key],filled=Array.isArray(v)?v.length>0:v!=null&&String(v).trim()!=='';
        if(f.required&&!['info','upload'].includes(f.type)&&!filled)issues.push({module:m.module,key:f.key,label:f.label,kind:'field'});
      }
      for(const r of m.schema.uploadRules||[])if(r.min>0&&(!r.authorized||(m.uploads||[]).filter(x=>x.fieldKey===r.fieldKey).length<r.min))issues.push({module:m.module,key:r.fieldKey,label:r.label+': envie pelo menos '+r.min+' imagem(ns).',kind:'upload'});
    }
    return issues;
  }
  function showMissing(issues){
    const issue=issues[0];if(!issue)return;
    active=issue.module;notice='';error='';render();
    for(const item of issues.filter(x=>x.module===active)){
      const control=[...root.querySelectorAll(item.kind==='upload'?'[data-v3-upload-field]':'[data-v3-field]')].find(el=>item.kind==='upload'?el.dataset.v3UploadField===item.key:el.dataset.v3Field===item.key);
      const field=control?.closest('.field');if(!field)continue;
      field.classList.add('v3-invalid-field');control.setAttribute('aria-invalid','true');
      const msg=document.createElement('p');msg.className='v3-field-error';msg.setAttribute('role','alert');msg.textContent=item.kind==='upload'?item.label:'Preencha este campo: '+item.label;field.append(msg);
    }
    const field=root.querySelector('.v3-invalid-field');
    if(field){field.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});field.querySelector('input,textarea,select')?.focus({preventScroll:true});}
    else{error=issue.label;render();root.querySelector('[role="alert"]')?.scrollIntoView({block:'center'});}
  }
  async function submit(){
    if(busy||!current()?.editable||active==='shared')return;
    const tab=active;if(!await save({quiet:true})||active!==tab||busy)return;
    const issues=missingFields([area.modules.find(x=>x.module==='shared'),current()]);if(issues.length){showMissing(issues);return;}
    if(!window.confirm('Enviar as respostas definitivas deste serviço? Os dados compartilhados ficarão bloqueados para alterações.'))return;
    const m=current();busy=true;error='';notice='';render();
    try{
      const r=await api(endpoint+'/'+m.module+'/submit',{method:'POST',body:JSON.stringify({revision:m.revision,sharedRevision:area.modules.find(x=>x.module==='shared')?.revision||0})});
      area=r.briefing;notice='Briefing enviado com sucesso.';if(area.services.length&&area.services.every(s=>s.briefingStatus==='completed')){active='summary';window.scrollTo(0,0);}
    }catch(e){if(e.data?.details?.fields?.length){busy=false;showMissing(e.data.details.fields);return;}error=e.message;busy=false;render();return;}
    busy=false;render();
  }
  async function productionAction(family,action){
    if(busy||!await flushDrafts()||busy)return;
    const s=area.services.find(x=>x.family===family),p=s?.progress;
    if(!p?.preview)return;
    const note=root.querySelector('[data-adjust-note="'+family+'"]')?.value.trim()||'';
    if(action==='request_adjustments'&&note.length<5){error='Descreva os ajustes que deseja solicitar.';render();return;}
    if(action==='approve'&&!window.confirm('Aprovar esta versão da prévia? A Libri poderá preparar os arquivos finais.'))return;
    busy=true;error='';notice='';render();
    try{
      const res=await api('/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/production/'+family,{method:'POST',body:JSON.stringify({action,version:p.version,previewId:p.preview.id,confirmed:action==='approve',note})});
      area=res.briefing;notice=action==='approve'?'Prévia aprovada!':'Solicitação de ajustes enviada.';
    }catch(e){error=e.message;}finally{busy=false;render();}
  }
  async function verify(renew=false){
    if(busy)return;busy=true;error='';render();
    try{
      payment=await api('/api/v3/cart/'+(renew?'renew':'recover'),{method:'POST',body:JSON.stringify({publicToken:token})});
      const r=await api(endpoint);area=r.briefing;
      if(!area.locked){active='summary';notice='';}
    }catch(e){error=e.message;}finally{busy=false;render();}
  }
  function captureInput(el,immediate){
    const m=current();if(!el.hasAttribute('data-v3-field')||busy||!m?.editable)return;
    const before=schemaSignature(m);
    const f=m.schema.sections.flatMap(s=>s.fields).find(f=>f.key===el.dataset.v3Field);
    if(!f)return;
    const value=collect(m)[f.key];
    if(el.type==='checkbox'&&Number.isInteger(f.max)&&value.length>f.max){
      el.checked=false;let alert=root.querySelector('[data-v3-choice-error]');if(!alert){alert=document.createElement('p');alert.dataset.v3ChoiceError='';alert.setAttribute('role','alert');el.closest('.field')?.append(alert);}alert.textContent='Escolha até '+f.max+' opções.';return;
    }
    root.querySelector('[data-v3-choice-error]')?.remove();
    if(el.type==='radio'||el.type==='checkbox')for(const input of el.closest('.field').querySelectorAll('input[data-v3-field]'))input.closest('.choice-card')?.classList.toggle('selected',input.checked);
    const invalid=el.closest('.v3-invalid-field');if(invalid){invalid.classList.remove('v3-invalid-field');invalid.querySelector('.v3-field-error')?.remove();el.removeAttribute('aria-invalid');}
    rememberField(m,f.key,value);
    if(m.module==='convite'&&['pix_key_type','pix_key','pix_holder'].includes(f.key))rememberField(m,'pix_confirmed','');
    if(before!==schemaSignature(current()))refreshAfterSchemaChange();
    scheduleSave(immediate);
  }
  root.addEventListener('input',e=>{const el=e.target;if(el.type!=='radio'&&el.type!=='checkbox')captureInput(el,false);});
  root.addEventListener('change',e=>{
    const el=e.target,fieldKey=el.dataset.v3Upload;
    if(fieldKey&&el.files?.length){const files=Array.from(el.files);el.value='';void fileAction({fieldKey,files});return;}
    if(el.type==='radio'||el.type==='checkbox')captureInput(el,true);
  });
  root.addEventListener('submit',e=>{if(e.target.id==='v3-module-form'){e.preventDefault();save();}});
  root.addEventListener('click',async e=>{
    const tab=e.target.closest('[data-v3-tab]')?.dataset.v3Tab||e.target.closest('[data-v3-start]')?.dataset.v3Start;
    if(tab&&!busy&&!uploadStarting){
      active=tab;notice='';error='';render();window.scrollTo(0,0);void flushDrafts();if(tab==='contracts')void loadContracts();return;
    }
    const sign=e.target.closest('[data-v3-sign-contract]');if(sign&&!busy){const id=sign.dataset.v3SignContract,name=root.querySelector('[data-contract-name="'+id+'"]')?.value.trim();if(!name||!confirm('Confirma que leu e aceita este contrato?'))return;busy=true;sign.disabled=true;try{await api(contractEndpoint+'/'+id+'/sign',{method:'POST',body:JSON.stringify({accepted:true,signerName:name})});notice='Contrato assinado ✓';await loadContracts();}catch(e){error=e.message;}finally{busy=false;render();}return;}
    const id=e.target.closest('[data-v3-delete]')?.dataset.v3Delete;
    if(id&&!busy&&window.confirm('Remover esta imagem?')){await fileAction({id});return;}
    const supplement=e.target.closest('[data-v3-supplement]');if(supplement&&!busy){const a=supplement.dataset.v3Supplement;await (['pay','renew','verify'].includes(a)?supplementPaymentAction(supplement.dataset.id,a):decideSupplement(supplement.dataset.id,a));return;}
    const prod=e.target.closest('[data-v3-production]');if(prod&&!busy){await productionAction(prod.dataset.family,prod.dataset.v3Production);return;}
    const action=e.target.closest('[data-v3-action]')?.dataset.v3Action;
    if(action==='remove-upsell'&&!busy){acceptedUpsell=null;notice='Pedido original mantido.';render();return;}
    if(action==='accept-revision'&&!busy&&area.revision){
      if(!root.querySelector('[data-revision-terms]')?.checked){error='Leia e aceite as condições da proposta.';render();return;}
      const r=area.revision;
      if(!upsellSeen&&area.manualUpsell){upsellSeen=true;const u=area.manualUpsell;const {modal}=await import('./client-v2-core.js');const close=modal(u.title,'<div class="manual-upsell-card"><p>'+esc(u.description)+'</p><div class="manual-upsell-delta"><small>Por apenas mais</small><strong>'+money(u.increaseCents)+'</strong></div><p>Novo total: '+money(u.totalCents)+'</p>'+(u.depositPercent===50?'<p>Entrada: '+money(u.depositCents)+' · Saldo: '+money(u.balanceCents)+'</p>':'')+'<div class="action-row"><button id="v3ManualUpsellSkip" class="btn btn-ghost">Agora não</button><button id="v3ManualUpsellAccept" class="btn btn-primary">Quero adicionar</button></div></div>');document.getElementById('v3ManualUpsellSkip').onclick=()=>{close();root.querySelector('[data-v3-action="accept-revision"]')?.click();};document.getElementById('v3ManualUpsellAccept').onclick=()=>{close();acceptedUpsell=u;render();notice='Sugestão escolhida. Confira o novo valor e aceite a proposta.';render();};return;}
      busy=true;error='';render();
      try{const res=await api('/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/revision/accept',{method:'POST',body:JSON.stringify({id:r.id,confirmed:true,termsAccepted:true,expectedTotalCents:acceptedUpsell?.totalCents??r.totalCents,upsellKey:acceptedUpsell?.key})});area=res.briefing;acceptedUpsell=null;notice='Proposta aceita. Confira o pagamento atualizado.';}catch(e){error=e.message;}finally{busy=false;render();}
      if(!area.revision)await verify();return;
    }
    if(action==='retry-draft'&&!busy){void flushDrafts();return;}
    if(action==='next-briefing'&&!busy&&current()?.module==='shared'){if(await save({quiet:true})&&active==='shared'&&!busy){const missing=missingFields([current()]);if(missing.length){showMissing(missing);return;}const next=area.modules.find(m=>m.module!=='shared'&&m.editable);active=next?.module||'summary';notice='Dados da festa salvos.';render();window.scrollTo(0,0);}return;}
    if(action==='submit')submit();
    if(action==='payment')verify();
    if(action==='renew'&&payment?.canRenew)verify(true);
  });
  render();
  if(area.locked&&['awaiting_payment','configuring'].includes(area.orderStatus))await verify();
}
