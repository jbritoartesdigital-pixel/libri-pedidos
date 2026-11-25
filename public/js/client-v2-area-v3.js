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
    (module.receipt?'<p><strong>Recebimento registrado:</strong> '+esc(module.receipt.photoCount)+' fotos e '+esc(module.receipt.videoCount)+' vídeos. '+(module.receipt.completeAt?'Materiais completos confirmados.':'Ainda falta confirmar o recebimento completo.')+' A produção depende da conferência e da agenda.</p>':'<p>Aguardando conferência dos materiais pela Libri.</p>')+'</section>';
}
export function renderV3Uploads(m,busy=false){
 const files=m.uploads||[],rules=m.schema.uploadRules||[];
 if(!rules.length&&!files.length)return '';
 return '<section class="card"><h3>Imagens privadas</h3><p>JPG, PNG, WebP, HEIC ou HEIF, até 15 MB por imagem.</p>'+
 rules.map(r=>'<div class="field full"><label>'+esc(r.label)+'</label><p>'+esc(r.help||('Até '+r.max+' imagens.'))+'</p>'+
 (!r.authorized?'<p>Salve a autorização necessária antes do envio.</p>':m.editable?'<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-v3-upload="'+esc(r.fieldKey)+'" '+(busy?'disabled':'')+'>':'')+'</div>').join('')+
 files.map(x=>'<div class="field full"><span>'+esc(x.originalFilename)+'</span>'+
 (rules.some(r=>r.fieldKey===x.fieldKey&&r.authorized)?'<a href="'+esc(x.contentPath)+'" target="_blank" rel="noopener noreferrer">Ver imagem</a>':'<span>Imagem sem autorização ativa</span>')+
 (m.editable?'<button type="button" class="btn secondary" data-v3-delete="'+esc(x.id)+'" '+(busy?'disabled':'')+'>Remover</button>':'')+'</div>').join('')+'</section>';
}
export async function startV3CustomerArea(root,{token,initial,api}){
  if(initial.locked&&initial.revision?.kind==='manual'&&!initial.cancellation&&['configuring','awaiting_payment'].includes(initial.orderStatus)){
    const {startV3ManualCheckout}=await import('./client-v3-manual-checkout.js?v=112');
    return startV3ManualCheckout(root,{token,api});
  }
  root.classList.add('libri-v3-area');document.body.classList.add('libri-v3-area-body');
  const endpoint='/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/briefing';
  let area=initial,active='summary',busy=false,error='',notice='',dirty=false,payment=null,upsellSeen=false,acceptedUpsell=null;
  function current(){return area.modules.find(m=>m.module===active);}
  function deliveryHtml(s){
    const d=s.delivery;if(!d?.delivered)return '';
    const base='/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/delivery/'+esc(s.family)+'/files/';
    return '<section class="card"><h4>Seu serviço foi entregue!</h4><p>Entrega em '+day(d.deliveredAt.slice(0,10))+'</p>'+
    (d.files.length?'<p>Arquivos finais disponíveis para download até '+day(d.downloadUntil.slice(0,10))+'.</p>':'')+
    (d.warning&&(d.files.length||d.externalChannel==='drive')?'<p role="status"><strong>'+esc(d.warning)+'</strong></p>':'')+
    d.files.map(f=>'<p>'+esc(f.filename)+' '+(f.available?'<a class="btn primary" href="'+esc(base+f.id)+'">Baixar arquivo</a>':'· Prazo de download encerrado')+'</p>').join('')+
    (d.externalChannel==='whatsapp'?'<p>Arquivo final enviado pelo WhatsApp. Confira a conversa com a Libri.</p>':d.externalChannel==='drive'?(d.externalUrl?'<p>Baixe o arquivo até '+day(d.downloadUntil.slice(0,10))+'.</p><a class="btn primary" href="'+esc(d.externalUrl)+'" target="_blank" rel="noopener noreferrer">Abrir no Google Drive</a>':'<p>O prazo de acesso ao link pelo aplicativo encerrou.</p>'):'')+
    (d.interactiveUrl?'<p><a class="btn primary" href="'+esc(d.interactiveUrl)+'" target="_blank" rel="noopener noreferrer">Abrir meu convite interativo</a></p><p>A validade do convite segue a contratação, independentemente do prazo de download.</p>':'')+'</section>';
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
    if(busy)return;
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
    if(busy)return;
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
    return '<section class="card"><h2>Seu pedido</h2><p>'+esc(area.event.honoreeName)+' · '+day(area.event.date)+'</p><p><strong>Contratação original:</strong> '+money(area.payment.totalCents)+'</p>'+(area.payment.depositPercent===50?'<p>Entrada autorizada: '+money(area.payment.depositCents)+'</p><p>Recebido: '+money(area.payment.receivedCents)+'</p><p><strong>Saldo do pedido: '+money(area.payment.remainingCents)+'</strong></p>':'')+(area.financial?'<p>Adicionais confirmados: '+money(area.financial.paidSupplementCents)+'</p><p><strong>Total confirmado: '+money(area.financial.confirmedTotalCents)+'</strong></p>'+(area.financial.pendingSupplementCents?'<p>Adicionais aguardando pagamento: '+money(area.financial.pendingSupplementCents)+'</p>':'')+(area.financial.reviewSupplementCents?'<p>Valores em conferência: '+money(area.financial.reviewSupplementCents)+'</p>':''):'')+
      '<p>Previsão inicial: '+day(area.deliveryWindow.start)+' a '+day(area.deliveryWindow.end)+'. '+(area.deliveryWindow.provisional?'O prazo será confirmado após o briefing e materiais necessários.':'')+'</p></section>'+
      area.services.map(s=>'<section class="card"><h3>'+esc(s.productName)+'</h3><p>'+esc(s.variantName)+'</p><p>'+esc(briefingLabels[s.briefingStatus]||'Em acompanhamento')+' · '+esc(productionLabels[s.productionStatus]||'Em acompanhamento')+'</p>'+
        (s.deliveryWindow?'<p><strong>Entrega prevista:</strong> '+day(s.deliveryWindow.start)+' a '+day(s.deliveryWindow.end)+'</p>':'<p>Prazo individual aguardando conferência.</p>')+(s.complementNote?'<p><strong>Complemento solicitado:</strong> '+esc(s.complementNote)+'</p>':'')+'<p>'+money(s.totalCents)+'</p>'+(s.blackLibri?'<p><strong>Black Libri:</strong> '+esc(s.blackLibri.label)+(s.blackLibri.gift?' · Brinde incluído':s.blackLibri.applied?' · Desconto aplicado':' · Melhor condição mantida')+'</p>':'')+s.extras.map(x=>'<p>'+esc(x.quantity)+' × '+esc(x.name)+'</p>').join('')+
        (!area.locked?'<button type="button" class="btn secondary" data-v3-tab="'+esc(s.family)+'">Ver briefing do serviço</button>':'')+productionHtml(s)+deliveryHtml(s)+supplementHtml(s)+'</section>').join('');
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
    const m=current();
    root.innerHTML=(area.capacityReview?'<section class="card"><h3>Pagamento recebido, agenda em conferência</h3><p>Você já pode preencher seus dados. A Libri confirmará a previsão antes de iniciar a produção.</p></section>':'')+'<section class="card"><h1>Meu pedido · '+esc(area.orderCode)+'</h1><p>'+(area.locked?'Acompanhe seu pagamento.':'Escolha o serviço que deseja acompanhar.')+'</p><div class="grid two"><button type="button" class="btn secondary" data-v3-tab="summary">Resumo</button>'+
      (!area.locked?area.modules.map(x=>'<button type="button" class="btn secondary" data-v3-tab="'+esc(x.module)+'">'+esc(labels[x.module])+'</button>').join(''):'')+'</div></section>'+
      (error?'<p role="alert" class="card">'+esc(error)+'</p>':'')+(notice?'<p role="status" class="card">'+esc(notice)+'</p>':'')+
      (m?'<section class="card"><h2>'+esc(labels[m.module])+'</h2><p>'+(!m.editable?'Este briefing está disponível apenas para consulta.':'Preencha com calma. Salve as respostas para atualizar as próximas perguntas.')+'</p><form id="v3-module-form">'+m.schema.sections.map(s=>'<section><h3>'+esc(s.title)+'</h3>'+(s.description?'<p>'+esc(s.description)+'</p>':'')+s.fields.map(f=>v3FieldHtml(f,m.data[f.key],{disabled:busy||!m.editable})).join('')+'</section>').join('')+
        (m.editable?'<button type="submit" class="btn primary" '+(busy?'disabled':'')+'>Salvar rascunho</button>':'')+'</form><p class="field-help">Salvar ou enviar o briefing não inicia a produção automaticamente.</p></section>'+renderV3Uploads(m,busy)+renderV3Materials(m)+(m.editable&&m.module!=='shared'?'<section class="card"><button type="button" class="btn primary" data-v3-action="submit" '+(busy?'disabled':'')+'>Enviar briefing definitivo</button></section>':''):summary()+paymentHtml());
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
  async function fileAction({fieldKey,file,id}){
    if(busy||!current()?.editable)return;
    if(dirty&&!await save())return;
    const m=current();busy=true;error='';notice='';render();
    try{
      if(file){const body=new FormData();body.append('fieldKey',fieldKey);body.append('file',file);await api(endpoint+'/'+m.module+'/uploads',{method:'POST',body});}
      else await api(endpoint+'/'+m.module+'/uploads/'+encodeURIComponent(id),{method:'DELETE'});
      area=(await api(endpoint)).briefing;notice=file?'Imagem enviada com segurança.':'Imagem removida.';
    }catch(e){error=e.message;}finally{busy=false;render();}
  }
  async function submit(){
    if(busy||!current()?.editable||active==='shared')return;
    if(dirty&&!await save())return;
    if(!window.confirm('Enviar as respostas definitivas deste serviço? Os dados compartilhados ficarão bloqueados para alterações.'))return;
    const m=current();busy=true;error='';notice='';render();
    try{
      const r=await api(endpoint+'/'+m.module+'/submit',{method:'POST',body:JSON.stringify({revision:m.revision,sharedRevision:area.modules.find(x=>x.module==='shared')?.revision||0})});
      area=r.briefing;notice='Briefing enviado. A Libri vai conferir a produção e os materiais.';
    }catch(e){error=e.message;}finally{busy=false;render();}
  }
  async function productionAction(family,action){
    if(busy)return;
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
      if(!area.locked){active='summary';notice='Pagamento confirmado. Seus briefings estão disponíveis.';}
    }catch(e){error=e.message;}finally{busy=false;render();}
  }
  root.addEventListener('input',e=>{if(e.target.hasAttribute('data-v3-field'))dirty=true;});
  root.addEventListener('change',e=>{if(e.target.hasAttribute('data-v3-field'))dirty=true;const fieldKey=e.target.dataset.v3Upload;if(fieldKey&&e.target.files?.[0])fileAction({fieldKey,file:e.target.files[0]});});
  root.addEventListener('submit',e=>{if(e.target.id==='v3-module-form'){e.preventDefault();save();}});
  root.addEventListener('click',async e=>{
    const tab=e.target.closest('[data-v3-tab]')?.dataset.v3Tab;
    if(tab&&!busy){
      if(dirty&&current()?.editable&&!await save())return;
      active=tab;notice='';error='';render();return;
    }
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
    if(action==='submit')submit();
    if(action==='payment')verify();
    if(action==='renew'&&payment?.canRenew)verify(true);
  });
  render();
  if(area.locked&&['awaiting_payment','configuring'].includes(area.orderStatus))await verify();
}
