import {api,esc,money,modal,showToast} from './admin-v2-core.js';
const names={shared:'Dados da comemoração',convite:'Convite digital',identidade_visual:'Libri Ateliê',retrospectiva:'Retrospectiva'};
const value=(f,v)=>{const opts=f.options||[];const label=x=>opts.find(o=>typeof o==='object'&&o.value===x)?.label||x;return Array.isArray(v)?v.map(label).join(', '):label(v);};
export async function openV3AdminOrder(code,initial,onChanged){
 const base='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/briefing';
 const close=modal(code+' · '+initial.event.honoreeName,'<div id="v3AdminOrder"></div>');
 const host=document.getElementById('v3AdminOrder');let brief=initial,busy=false,error='',agenda={},supplementDrafts={},supplementCapacity={},revisionEditor=null,revisionPreview=null;
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
 if(s.deliveryWindow&&s.productionStatus!=='pending')return '<p>Entrega confirmada: '+esc(s.deliveryWindow.start)+' a '+esc(s.deliveryWindow.end)+'</p><p>Serviço programado para produção.</p>';
 if(!s.reviewedAt||s.productionStatus!=='pending')return '';
 const a=agenda[s.family],dependent=s.family==='convite'&&brief.services.some(x=>x.family==='identidade_visual');
 return '<div class="notice"><h4>Programar produção</h4>'+
 (dependent?'<label>O convite depende da identidade do Ateliê? <select data-dependency="'+esc(s.family)+'"><option value="">Selecione</option><option value="yes" '+(a?.depends===true?'selected':'')+'>Sim</option><option value="no" '+(a?.depends===false?'selected':'')+'>Não</option></select></label>':'')+
 '<button class="btn btn-secondary" data-v3-admin="agenda" data-family="'+esc(s.family)+'">Consultar agenda</button>'+
 (a?.options?.length?'<label>Janela de entrega <select data-window="'+esc(s.family)+'">'+a.options.map((o,i)=>'<option value="'+i+'">'+esc(o.start)+' a '+esc(o.end)+'</option>').join('')+'</select></label><button class="btn btn-primary" data-v3-admin="schedule" data-family="'+esc(s.family)+'">Confirmar e liberar serviço</button>':a?'<p>Não há janela disponível. Revise a agenda antes de prometer uma data.</p>':'')+'</div>';
 }
 function externalFields(family,kind){
 const key=kind+'-'+family;
 return '<label>Canal de envio <select data-external-channel="'+key+'"><option value="whatsapp">WhatsApp</option><option value="drive">Google Drive</option></select></label><label>Link do Google Drive (somente se escolher Drive)<input type="url" data-external-url="'+key+'" placeholder="https://drive.google.com/file/d/.../view"></label><small>Compartilhe o arquivo com a cliente; confira as permissões do Drive e mantenha o link final acessível por 90 dias. Nenhum vídeo será armazenado no aplicativo.</small>';
 }
 function readExternal(family,kind){
 const key=kind+'-'+family,channel=host.querySelector('[data-external-channel="'+key+'"]')?.value;
 return {channel,url:channel==='drive'?host.querySelector('[data-external-url="'+key+'"]')?.value.trim():''};
 }
 function whatsappActions(s,kinds){
 const actions=(s.whatsappActions||[]).filter(a=>kinds.includes(a.kind)&&typeof a.url==='string'&&a.url.startsWith('https://wa.me/'));
 return actions.length?'<div class="notice"><p>Mensagens prontas para envio manual:</p>'+actions.map(a=>'<a class="btn btn-secondary" href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">'+esc(a.label)+' pelo WhatsApp</a>').join('')+'<small>Confira a conversa e toque em enviar no WhatsApp. Abrir o link não confirma o envio.</small></div>':'';
 }
 function deliveryHtml(s){
 const d=s.delivery;if(!d||!['approved','delivered'].includes(s.productionStatus))return '';
 const family=esc(s.family),base='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/delivery/'+family;
 const files=d.files.map(f=>'<p>'+esc(f.filename)+' · '+esc(Math.ceil(f.sizeBytes/1024))+' KB '+(f.available?'<a href="'+esc(base+'/files/'+f.id)+'">Baixar</a>':'Expirado')+
 (!d.delivered?'<button class="btn btn-secondary" data-v3-admin="remove-final" data-family="'+family+'" data-file-id="'+esc(f.id)+'">Remover</button>':'')+'</p>').join('');
 return '<div class="notice"><h4>Entrega final</h4>'+files+(d.delivered?
 '<p>Entregue em '+esc(d.deliveredAt.slice(0,10))+' · Download até '+esc(d.downloadUntil.slice(0,10))+'</p><p>Originais disponíveis até '+esc(d.originalsUntil.slice(0,10))+'</p>'+(d.warning?'<p>'+esc(d.warning)+'</p>':'')+whatsappActions(s,['delivery','download'])+(d.externalChannel==='whatsapp'?'<p>Entrega registrada pelo WhatsApp.</p>':d.externalChannel==='drive'?'<p>Entrega pelo Google Drive.</p>'+(d.externalUrl?'<a href="'+esc(d.externalUrl)+'" target="_blank" rel="noopener noreferrer">Abrir arquivo no Drive</a>':'<p>Link expirado no aplicativo.</p>'):'')+(d.interactiveUrl?'<a href="'+esc(d.interactiveUrl)+'" target="_blank" rel="noopener noreferrer">Abrir convite interativo</a>':''):
 (s.family==='retrospectiva'?externalFields(family,'final'):'<label>Arquivo final sem marca d’água (até 80 MB)<input type="file" accept="video/mp4,video/webm,image/jpeg,image/png,image/webp,application/pdf,.zip" data-final-file="'+family+'"></label><button class="btn btn-secondary" data-v3-admin="stage-final" data-family="'+family+'">Adicionar arquivo</button>')+
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
 (preview&&preview.available!==false?'<p>'+(preview.externalChannel==='whatsapp'?'Prévia '+esc(preview.version)+' enviada pelo WhatsApp':preview.externalChannel==='drive'?(preview.externalUrl?'<a href="'+esc(preview.externalUrl)+'" target="_blank" rel="noopener noreferrer">Ver prévia no Drive</a>':'Prévia no Drive'):'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Ver prévia '+esc(preview.version)+'</a>')+' · Ajustes até '+esc(preview.adjustmentDeadline.slice(0,10))+'</p>':'')+
 whatsappActions(s,['approval'])+(s.productionStatus==='ready'?button('start','Iniciar produção'):'')+
 (s.productionStatus==='in_production'?(s.family==='retrospectiva'?externalFields(family,'preview'):'<label>Prévia protegida (até 60 MB)<input type="file" accept="video/mp4,video/webm,image/jpeg,image/png,image/webp,application/pdf" data-preview-file="'+family+'"></label>')+'<label><input type="checkbox" data-watermark="'+family+'"> O arquivo já contém marca d’água</label>'+button('publish',s.family==='retrospectiva'?'Registrar envio da prévia':'Publicar prévia'):'')+
 (s.productionStatus==='adjustments'?'<p>Solicitação: '+esc(p.events.find(e=>e.action==='adjustments_requested')?.note||'')+'</p><label>Observação da conferência<textarea maxlength="2000" data-production-note="'+family+'"></textarea></label>'+
 (p.revisionsIncluded!==null&&p.revisionsUsed<p.revisionsIncluded?button('included_revision','Usar rodada incluída'):'')+button('libri_correction','Corrigir erro da Libri sem consumir rodada')+button('extra_quote','Registrar necessidade de orçamento')+button('return_preview','Retornar para aprovação'):'')+
 '<details><summary>Histórico de produção</summary>'+p.events.map(e=>'<p>'+esc(e.created_at)+' · '+esc(({started:'Produção iniciada',preview_published:'Prévia publicada',approved:'Aprovada pela cliente',adjustments_requested:'Ajustes solicitados',included_revision:'Rodada utilizada',libri_correction:'Correção da Libri',extra_quote:'Orçamento necessário',return_preview:'Retorno à aprovação'})[e.action]||e.action)+(e.note?' · '+esc(e.note):'')+'</p>').join('')+'</details></div>';
 }
 function supplementHtml(s){
 const family=esc(s.family),offers=(brief.supplements||[]).filter(x=>x.family===s.family),draft=supplementDrafts[s.family];
 const status={offered:'Aguardando cliente',accepted:'Aceita · aguardando pagamento',declined:'Recusada',cancelled:'Cancelada',payment_pending:'Pagamento pendente',paid:'Pago',review:'Em revisão'};
 const open=offers.some(x=>['offered','accepted','payment_pending','review'].includes(x.status));
 return '<details class="notice"><summary>Adicionais, upgrades e novos serviços</summary>'+offers.map(x=>'<p><strong>'+money(x.totalCents)+'</strong> · '+esc(status[x.status])+'</p>'+x.items.map(i=>'<p>'+esc(i.quantity)+' × '+esc(i.name)+'</p>').join('')+(x.note?'<p>'+esc(x.note)+'</p>':'')+(x.payment?.paidAt?'<p>Confirmação registrada: '+esc(x.payment.paidAt.slice(0,10))+'</p>':'')+
 (x.status==='accepted'?'<button class="btn btn-secondary" data-v3-admin="supplement-capacity" data-family="'+family+'" data-supplement-id="'+x.id+'">Conferir capacidade</button>':'')+
 (x.canVerify?'<button class="btn btn-secondary" data-v3-admin="supplement-verify" data-family="'+family+'" data-supplement-id="'+x.id+'">Verificar cobrança</button>':'')+
 (supplementCapacity[x.id]?'<p>Capacidade disponível até '+esc(supplementCapacity[x.id].deliveryEnd)+' · '+esc(supplementCapacity[x.id].pointsUnits/100)+' pontos (consulta sem reserva).</p>':'')+
 (x.status==='review'?'<p>Conciliação necessária. Não cobrar novamente.</p>':'')+(['offered','accepted'].includes(x.status)?'<button class="btn btn-secondary" data-v3-admin="supplement-cancel" data-family="'+family+'" data-supplement-id="'+x.id+'">Cancelar proposta</button>':'')).join('')+
 (!open&&(s.supplementCatalog?.length||s.changeCatalog?.length)?'<p>Escolha adicionais, um pacote superior ou outra linha de serviço.</p><label>Tipo de complemento <select data-change-kind="'+family+'"><option value="">Adicionais</option>'+ (s.changeCatalog||[]).map((x,i)=>'<option value="'+i+'" '+(draft?.input.productCode===x.productCode&&draft?.input.variantCode===x.variantCode&&draft?.input.kind===x.kind?'selected':'')+'>'+esc((x.kind==='upgrade'?'Upgrade · ':'Novo serviço · ')+x.name+' · '+x.variantName)+'</option>').join('')+'</select></label>'+ (draft?.quote.requiresWindow?'<label>Previsão de entrega <select data-change-window="'+family+'"><option value="">Escolha uma janela</option>'+draft.quote.options.map((w,i)=>'<option value="'+i+'">'+esc(w.start+' a '+w.end)+'</option>').join('')+'</select></label>':'')+(draft?.input.deliveryWindow?'<p>Previsão: '+esc(draft.input.deliveryWindow.start+' a '+draft.input.deliveryWindow.end)+' (sujeita à confirmação após briefing)</p>':'')+(s.supplementCatalog||[]).map(x=>'<label class="field">'+esc(x.name)+' · '+money(x.priceCents)+'<input type="number" min="0" max="'+esc(x.maxQuantity)+'" value="'+esc(draft?.input.items?.find(i=>i.code===x.code)?.quantity||0)+'" data-supplement-family="'+family+'" data-extra-code="'+esc(x.code)+'"></label>').join('')+
 '<label>Pagamento <select data-supplement-method="'+family+'"><option value="pix">Pix integral</option><option value="card" '+(draft?.input.paymentMethod==='card'?'selected':'')+'>Cartão integral</option></select></label><label>Observação para cliente <textarea maxlength="500" data-supplement-note="'+family+'">'+esc(draft?.input.note||'')+'</textarea></label>'+
 '<button class="btn btn-secondary" data-v3-admin="supplement-preview" data-family="'+family+'">Calcular proposta</button>'+
 (draft&&!draft.quote.requiresWindow?'<p>Total complementar: <strong>'+money(draft.quote.totalCents)+'</strong> · '+(draft.quote.pointsUnits/100)+' pontos adicionais</p>'+(draft.quote.absorbed?.length?'<p>Já contratado e incorporado ao novo pacote: '+draft.quote.absorbed.map(i=>esc(i.quantity+' × '+i.name)).join(', ')+'</p>':'')+'<button class="btn btn-primary" data-v3-admin="supplement-create" data-family="'+family+'">Enviar proposta para aceite</button>':''):'')+'</details>';
 }
 function revisionHtml(){
  if(brief.revision)return '<section class="card"><h3>Alteração aguardando aceite</h3><p>Novo total: '+money(brief.revision.totalCents)+'</p><p>'+esc(brief.revision.reason)+'</p><button class="btn btn-secondary" data-v3-admin="revision-withdraw">Retirar proposta</button></section>';
  if(!brief.adminPayment?.canCancelUnpaid)return '';
  if(!revisionEditor)return '<button class="btn btn-secondary" data-v3-admin="revision-editor">Editar contratação antes do pagamento</button>';
  return '<section class="card"><h3>Editar contratação</h3><p>Confira serviços, cenas e adicionais. O valor será recalculado antes de enviar a proposta.</p>'+['convite','identidade_visual','retrospectiva'].map(f=>{
   const current=revisionEditor.items.find(i=>i.family===f),variants=revisionEditor.variants.filter(v=>v.family===f),chosen=variants.find(v=>v.variantCode===current?.variantCode);
   return '<details open><summary>'+esc(names[f])+'</summary><label>Pacote <select data-revision-family="'+f+'"><option value="">Não contratar</option>'+variants.map(v=>'<option value="'+esc(v.variantCode)+'" '+(v.variantCode===current?.variantCode?'selected':'')+'>'+esc(v.name+' · '+v.variantName)+' · '+money(v.priceCents)+'</option>').join('')+'</select></label>'+
    (f==='convite'?'<details><summary>Adicionais do convite</summary>'+revisionEditor.addons.map(a=>'<label><input type="checkbox" data-revision-addon="'+esc(a.code)+'" '+(current?.addonCodes.includes(a.code)?'checked':'')+'>'+esc(a.name)+' · '+money(a.priceCents)+'</label>').join('')+'</details>':(chosen?.extras||[]).map(a=>'<label>'+esc(a.name)+' · '+money(a.priceCents)+'<input type="number" min="0" max="'+a.maxQuantity+'" data-revision-extra="'+esc(a.code)+'" data-extra-family="'+f+'" value="'+(current?.extras.find(x=>x.code===a.code)?.quantity||0)+'"></label>').join(''))+'</details>';
  }).join('')+'<label>Cupom <input data-revision-coupon value="'+esc(revisionEditor.couponCode)+'"></label><label>Motivo <input data-revision-reason maxlength="500" value="'+esc(revisionPreview?.input.reason||'')+'"></label><button class="btn btn-secondary" data-v3-admin="revision-preview">Recalcular proposta</button>'+(revisionPreview?'<p><strong>'+money(revisionPreview.result.totalCents)+'</strong> · '+(revisionPreview.result.pointsUnits/100)+' pontos</p><label>Nova janela <select data-revision-window><option value="">Selecione</option>'+revisionPreview.result.options.map((w,i)=>'<option value="'+i+'">'+esc(w.start+' a '+w.end)+'</option>').join('')+'</select></label><button class="btn btn-primary" data-v3-admin="revision-create">Enviar para aceite</button>':'')+'</section>';
 }
 function readRevision(){
  const items=Array.from(host.querySelectorAll('[data-revision-family]')).flatMap(el=>{
   const v=revisionEditor.variants.find(x=>x.variantCode===el.value&&x.family===el.dataset.revisionFamily);if(!v)return [];
   const old=revisionEditor.items.find(x=>x.family===v.family);
   return [{family:v.family,productCode:v.productCode,variantCode:v.variantCode,addonCodes:v.family==='convite'?Array.from(host.querySelectorAll('[data-revision-addon]:checked')).map(x=>x.dataset.revisionAddon):[],extras:Array.from(host.querySelectorAll('[data-extra-family="'+v.family+'"]')).map(x=>({code:x.dataset.revisionExtra,quantity:Number(x.value)})).filter(x=>x.quantity>0),comboCode:old?.variantCode===v.variantCode?old.comboCode||'':''}];
  });
  return {items,couponCode:host.querySelector('[data-revision-coupon]').value,reason:host.querySelector('[data-revision-reason]').value.trim()};
 }
 function cancellationHtml(){
  const c=brief.cancellation;
  if(!c)return brief.adminPayment?.canCancelPaid?'<section class="card"><h3>Cancelar pedido pago</h3><p>Suspende a produção e novas cobranças, preservando o histórico.</p><label>Motivo <input data-paid-cancel-reason maxlength="500"></label><button class="btn btn-secondary" data-v3-admin="cancellation-open">Iniciar conferência de cancelamento</button></section>':'';
  const status={review:'Em conferência',paid:'Pago · devolução disponível',pending:'Pendente',terminal:'Encerrado sem pagamento',refund_requested:'Devolução solicitada · confirmar',refunded:'Devolução confirmada'};
  return '<section class="card"><h3>'+ (c.status==='completed'?'Cancelamento concluído':'Cancelamento em conferência')+'</h3><p>'+esc(c.reason)+'</p><p><strong>Devoluções confirmadas: '+money(c.refundCents)+'</strong></p>'+
   (c.charges||[]).map(x=>'<div class="row-card"><strong>'+money(x.amountCents)+' · '+esc(x.provider==='direct_pix'?'Pix direto':'Mercado Pago')+'</strong><p>'+esc(status[x.status]||x.status)+'</p>'+
    (c.status==='review'&&['paid','refund_requested'].includes(x.status)?(x.provider==='direct_pix'?'<label>Referência do Pix já devolvido <input data-refund-proof="'+esc(x.key)+'" maxlength="500"></label>':'')+'<button class="btn btn-secondary" data-v3-admin="cancellation-refund" data-charge="'+esc(x.key)+'">'+(x.provider==='direct_pix'?'Registrar devolução Pix':'Solicitar devolução integral')+'</button>':'')+'</div>').join('')+
   (c.status==='review'?'<p>Reembolsos parciais, contestações e tentativas desconhecidas exigem conferência. A agenda futura permanece reservada até a conclusão.</p><button class="btn btn-secondary" data-v3-admin="cancellation-refresh">Conferir cobranças no provedor</button><button class="btn btn-primary" data-v3-admin="cancellation-finalize">Concluir cancelamento</button>':'')+'</section>';
 }
 function financeActions(){
  const p=brief.payment,a=brief.adminPayment||{};
  return '<section class="card"><h3>Pagamento do pedido original</h3><p>Entrada: '+p.depositPercent+'% · '+money(p.depositCents)+'</p><p>Recebido: '+money(p.receivedCents)+'</p><p>Saldo: <strong>'+money(p.remainingCents)+'</strong></p>'+
   (a.canChangeDeposit?'<label>Condição autorizada <select data-admin-deposit><option value="100" '+(p.depositPercent===100?'selected':'')+'>100% integral</option><option value="50" '+(p.depositPercent===50?'selected':'')+'>50% excepcional</option></select></label><label>Motivo <input data-finance-reason maxlength="500"></label><button class="btn btn-secondary" data-v3-admin="finance-deposit">Alterar entrada e encerrar cobrança anterior</button>':'')+
   (a.canRecordBalance?'<label>Data do Pix recebido <input type="date" data-admin-paid-date></label><label>Referência do comprovante <input data-admin-paid-note maxlength="500"></label><button class="btn btn-primary" data-v3-admin="finance-balance">Registrar Pix recebido · '+money(p.remainingCents)+'</button>':'')+
   (a.canCancelUnpaid?'<label>Motivo do cancelamento <input data-cancel-reason maxlength="500"></label><button class="btn btn-secondary" data-v3-admin="finance-cancel-unpaid">Cancelar pedido não pago</button>':'')+'</section>';
 }
 function render(){
 if(!host.isConnected)return;
 host.innerHTML='<section class="card"><h3>Pedido V3</h3>'+(brief.aggregate?'<p><strong>'+esc(brief.aggregate.label)+'</strong> · '+esc(brief.aggregate.deliveredServices)+' de '+esc(brief.aggregate.totalServices)+' serviços entregues</p>':'')+'<p>'+esc(brief.event.honoreeName)+' · '+esc(brief.event.date)+'</p><p>Contratação original: '+money(brief.payment.totalCents)+'</p>'+(brief.financial?'<p>Adicionais confirmados: '+money(brief.financial.paidSupplementCents)+'</p><p><strong>Total confirmado: '+money(brief.financial.confirmedTotalCents)+'</strong></p><p>Adicionais a receber: '+money(brief.financial.pendingSupplementCents)+'</p>'+(brief.financial.reviewSupplementCents?'<p>Valores em conferência: '+money(brief.financial.reviewSupplementCents)+'</p>':''):'')+'<p>'+ (brief.cancellation?(brief.cancellation.status==='completed'?'Pedido cancelado':'Cancelamento em conferência'):brief.locked?'Aguardando confirmação de pagamento':'Pagamento confirmado')+'</p><button class="btn btn-secondary" data-v3-admin="refresh">Atualizar</button></section>'+
 financeActions()+cancellationHtml()+revisionHtml()+ (error?'<p role="alert" class="notice">'+esc(error)+'</p>':'')+
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
 host.addEventListener('change',e=>{if(!e.target.matches('[data-revision-family]')||!revisionEditor)return;const draft=readRevision();revisionEditor.items=draft.items;revisionEditor.couponCode=draft.couponCode;revisionPreview=null;render();});
 host.addEventListener('click',async e=>{
 const b=e.target.closest('[data-v3-admin]');if(!b||busy)return;
 const action=b.dataset.v3Admin,family=b.dataset.family;
 let path=base,payload=null,method='POST';
 if(action.startsWith('revision-')){
   const mode=action.slice(9);path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/revision/'+mode;
   if(mode==='editor'){method='GET';}
   else if(mode==='withdraw'){if(!confirm('Retirar a proposta e manter as condições anteriores?'))return;payload={confirmed:true};}
   else{
    const input=readRevision();
    if(mode==='preview'){payload=input;}
    else{
      const index=host.querySelector('[data-revision-window]').value,w=index===''?null:revisionPreview?.result.options[Number(index)];
      if(!w||JSON.stringify(input)!==JSON.stringify(revisionPreview?.input)||input.reason.length<5){showToast('Confira o motivo, recalcule e escolha a previsão.');return;}
      if(!confirm('Encerrar cobrança anterior e enviar proposta de '+money(revisionPreview.result.totalCents)+' para aceite?'))return;
      payload={...input,deliveryWindow:w,expectedTotalCents:revisionPreview.result.totalCents,confirmed:true,requestKey:Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('')};
    }
   }
 }else if(action.startsWith('cancellation-')){
   const mode=action.slice(13);path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/cancellation/'+mode;
   if(mode==='open'){const reason=host.querySelector('[data-paid-cancel-reason]').value.trim();if(reason.length<5){showToast('Informe o motivo.');return;}if(!confirm('Suspender este pedido para conferir o cancelamento?'))return;payload={reason,confirmed:true};}
   else if(mode==='refund'){const charge=brief.cancellation.charges.find(x=>x.key===b.dataset.charge);if(!charge)return;const proof=host.querySelector('[data-refund-proof="'+charge.key+'"]')?.value.trim();if(!confirm((charge.provider==='direct_pix'?'Confirma que já devolveu ':'Confirma solicitar a devolução integral de ')+money(charge.amountCents)+'?'))return;payload={chargeKey:charge.key,amountCents:charge.amountCents,proof,confirmed:true};}
   else if(mode==='finalize'){if(!confirm('Encerrar definitivamente após verificar todas as cobranças?'))return;payload={confirmed:true};}
   else payload={};
 }else if(action.startsWith('finance-')){
   path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/finance/'+action.slice(8);
   if(action==='finance-deposit'){
     const depositPercent=Number(host.querySelector('[data-admin-deposit]').value),reason=host.querySelector('[data-finance-reason]').value.trim();
     if(reason.length<5){showToast('Informe o motivo.');return;}
     if(!confirm('Encerrar a cobrança anterior após conciliação e autorizar '+depositPercent+'% neste mesmo pedido?'))return;
     payload={depositPercent,reason,confirmed:true};
   }else if(action==='finance-balance'){
     const paidDate=host.querySelector('[data-admin-paid-date]').value,note=host.querySelector('[data-admin-paid-note]').value.trim();
     if(!paidDate||note.length<5){showToast('Informe data e referência do Pix efetivamente recebido.');return;}
     if(!confirm('Confirma que recebeu '+money(brief.payment.remainingCents)+' por Pix?'))return;
     payload={paidDate,note,amountCents:brief.payment.remainingCents,confirmed:true,requestKey:Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('')};
   }else{
     const reason=host.querySelector('[data-cancel-reason]').value.trim();
     if(reason.length<5){showToast('Informe o motivo.');return;}
     if(!confirm('Cancelar definitivamente este pedido se nenhuma cobrança tiver sido paga?'))return;
     payload={reason,confirmed:true};
   }
 }else if(action.startsWith('supplement-')){
   path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/supplements/'+family;
   if(['supplement-capacity','supplement-verify'].includes(action)){
     path+='/'+encodeURIComponent(b.dataset.supplementId)+'/'+(action==='supplement-capacity'?'capacity':'verify');payload={};
   }else if(action==='supplement-cancel'){
     if(!confirm('Cancelar esta proposta complementar?'))return;
     path+='/'+encodeURIComponent(b.dataset.supplementId)+'/cancel';payload={};
   }else{
     const items=Array.from(host.querySelectorAll('[data-supplement-family="'+family+'"]')).map(el=>({code:el.dataset.extraCode,quantity:Number(el.value)})).filter(i=>i.quantity>0);
     const input={items,paymentMethod:host.querySelector('[data-supplement-method="'+family+'"]').value,note:host.querySelector('[data-supplement-note="'+family+'"]').value};
     const selected=host.querySelector('[data-change-kind="'+family+'"]')?.value;
     const option=selected!==''&&selected!=null?brief.services.find(s=>s.family===family)?.changeCatalog?.[Number(selected)]:null;
     const prior=supplementDrafts[family];
     if(option){
       input.kind=option.kind;input.productCode=option.productCode;input.variantCode=option.variantCode;input.items=[];
       if(option.kind==='new_service'){
         const windowIndex=host.querySelector('[data-change-window="'+family+'"]')?.value;
         const same=prior?.input.productCode===option.productCode&&prior?.input.variantCode===option.variantCode;
         if(same&&windowIndex!=null&&windowIndex!=='')input.deliveryWindow=prior.quote.options[Number(windowIndex)];
         else if(same&&prior.input.deliveryWindow)input.deliveryWindow=prior.input.deliveryWindow;
       }
     }else if(!items.length){showToast('Selecione pelo menos um adicional.');return;}
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
     if(!confirm(family==='retrospectiva'?'Confirma que enviou o vídeo final pelo WhatsApp ou disponibilizou o link do Drive para a cliente?':'Confirma que os arquivos finais estão completos e conferidos? A entrega iniciará os prazos de retenção.'))return;
     path+='/publish';payload={...payload,confirmed:true,interactiveUrl:host.querySelector('[data-interactive-url="'+family+'"]')?.value.trim()||''};
     if(family==='retrospectiva'){const external=readExternal(family,'final');if(external.channel==='drive'&&!external.url){showToast('Informe o link do Google Drive.');return;}payload.externalChannel=external.channel;payload.externalUrl=external.url;}
   }
 }else if(['start','publish','included_revision','libri_correction','extra_quote','return_preview'].includes(action)){
   const s=brief.services.find(x=>x.family===family);if(!s?.progress)return;
   path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/production/'+family;
   payload={action,version:s.progress.version,note:host.querySelector('[data-production-note="'+family+'"]')?.value||''};
   if(action==='publish'&&family==='retrospectiva'){
     const external=readExternal(family,'preview');
     if(!host.querySelector('[data-watermark="'+family+'"]')?.checked||external.channel==='drive'&&!external.url){showToast('Confira o canal, o link e a marca d’água.');return;}
     if(!confirm('Confirma que a prévia com marca d’água foi disponibilizada à cliente pelo canal selecionado?'))return;
     payload={...external,version:s.progress.version,confirmed:true,watermarkConfirmed:true};path+='/preview';
   }else if(action==='publish'){
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
 try{const res=await api(path,payload?{method,body:payload instanceof FormData?payload:JSON.stringify(payload)}:{});if(res.briefing)brief=res.briefing;if(action==='revision-editor'){revisionEditor=res.result;revisionPreview=null;}else if(action==='revision-preview'){revisionEditor.items=payload.items;revisionEditor.couponCode=payload.couponCode;revisionPreview={input:payload,result:res.result};}else if(action==='revision-create'||action==='revision-withdraw'){revisionEditor=null;revisionPreview=null;if(onChanged)await onChanged();}else if(action==='supplement-capacity'){supplementCapacity[b.dataset.supplementId]=res.result;}else if(action==='supplement-preview'){supplementDrafts[family]={input:payload,quote:res.result,key:Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('')};}else if(action==='agenda'){agenda[family]={options:res.result.options,depends:payload.dependsOnIdentity};}else if(payload){agenda={};supplementDrafts={};supplementCapacity={};showToast('Atualizado.');if(onChanged)await onChanged();}}
 catch(err){error=err.message;}
 finally{busy=false;render();}
 });
 render();return close;
}
