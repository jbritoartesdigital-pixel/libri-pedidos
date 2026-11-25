import {api,esc,money,modal,showToast,dateTimeBr} from './admin-v2-core.js';
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
 '<p>Entregue em '+esc(d.deliveredAt.slice(0,10))+' · Download até '+esc(d.downloadUntil.slice(0,10))+'</p><p>Originais disponíveis até '+esc(d.originalsUntil.slice(0,10))+'</p>'+(d.warning?'<p>'+esc(d.warning)+'</p>':'')+whatsappActions(s,['delivery','download'])+(s.capacityRelease?.releasedUnits?'<p>Capacidade já liberada: '+(s.capacityRelease.releasedUnits/100).toFixed(2)+' pt</p>':'')+(s.capacityRelease?.availableUnits?'<p>Há '+(s.capacityRelease.availableUnits/100).toFixed(2)+' pt reservados em dias futuros.</p><button type="button" class="btn btn-secondary" data-v3-admin="capacity-release" data-family="'+family+'">Liberar pontos futuros deste serviço</button>':'')+(d.externalChannel==='whatsapp'?'<p>Entrega registrada pelo WhatsApp.</p>':d.externalChannel==='drive'?'<p>Entrega pelo Google Drive.</p>'+(d.externalUrl?'<a href="'+esc(d.externalUrl)+'" target="_blank" rel="noopener noreferrer">Abrir arquivo no Drive</a>':'<p>Link expirado no aplicativo.</p>'):'')+(d.interactiveUrl?'<a href="'+esc(d.interactiveUrl)+'" target="_blank" rel="noopener noreferrer">Abrir convite interativo</a>':''):
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
 return '<details class="notice" data-v3-panel="supplement-'+family+'"'+((draft||offers.some(x=>x.status==='review'))?' open':'')+'><summary>Adicionais, upgrades e novos serviços'+(offers.length?' ('+offers.length+')':'')+'</summary>'+offers.map(x=>'<p><strong>'+money(x.totalCents)+'</strong> · '+esc(status[x.status])+'</p>'+x.items.map(i=>'<p>'+esc(i.quantity)+' × '+esc(i.name)+'</p>').join('')+(x.note?'<p>'+esc(x.note)+'</p>':'')+(x.payment?.paidAt?'<p>Confirmação registrada: '+esc(x.payment.paidAt.slice(0,10))+'</p>':'')+
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
  if(brief.revision&&brief.revision.kind!=='manual')return '<section class="card"><h3>Alteração aguardando aceite</h3><p>Novo total: '+money(brief.revision.totalCents)+'</p><p>'+esc(brief.revision.reason)+'</p><button class="btn btn-secondary" data-v3-admin="revision-withdraw">Retirar proposta</button></section>';
  if(!brief.adminPayment?.canCancelUnpaid||brief.revision?.kind==='manual'&&!brief.adminPayment?.canEditManual)return '';
  if(!revisionEditor)return '<button class="btn btn-secondary" data-v3-admin="revision-editor">Editar pedido</button>';
  return '<section class="card"><h3>Editar contratação</h3><p>Confira serviços, cenas e adicionais. O valor será recalculado antes de salvar.</p>'+['convite','identidade_visual','retrospectiva'].map(f=>{
   const current=revisionEditor.items.find(i=>i.family===f),variants=revisionEditor.variants.filter(v=>v.family===f),chosen=variants.find(v=>v.variantCode===current?.variantCode);
   return '<details open><summary>'+esc(names[f])+'</summary><label>Pacote <select data-revision-family="'+f+'"><option value="">Não contratar</option>'+variants.map(v=>'<option value="'+esc(v.variantCode)+'" '+(v.variantCode===current?.variantCode?'selected':'')+'>'+esc(v.name+' · '+v.variantName)+' · '+money(v.priceCents)+'</option>').join('')+'</select></label>'+
    (f==='convite'?'<details><summary>Adicionais do convite</summary>'+revisionEditor.addons.map(a=>'<label><input type="checkbox" data-revision-addon="'+esc(a.code)+'" '+(current?.addonCodes.includes(a.code)?'checked':'')+'>'+esc(a.name)+' · '+money(a.priceCents)+'</label>').join('')+'</details>':(chosen?.extras||[]).map(a=>'<label>'+esc(a.name)+' · '+money(a.priceCents)+'<input type="number" min="0" max="'+a.maxQuantity+'" data-revision-extra="'+esc(a.code)+'" data-extra-family="'+f+'" value="'+(current?.extras.find(x=>x.code===a.code)?.quantity||0)+'"></label>').join(''))+'</details>';
  }).join('')+'<label>Cupom <input data-revision-coupon value="'+esc(revisionEditor.couponCode)+'"></label><label>Motivo <input data-revision-reason maxlength="500" value="'+esc(revisionPreview?.input.reason||'')+'"></label>'+(revisionEditor.direct?'<label>Início da entrega <input type="date" data-revision-start value="'+esc(revisionEditor.deliveryWindow?.start||'')+'"></label><label>Fim da entrega <input type="date" data-revision-end value="'+esc(revisionEditor.deliveryWindow?.end||'')+'"></label><label>Entrada <select data-revision-deposit><option value="100" '+(revisionEditor.depositPercent===100?'selected':'')+'>100%</option>'+(revisionEditor.paymentMethod==='pix'?'<option value="50" '+(revisionEditor.depositPercent===50?'selected':'')+'>50% excepcional</option>':'')+'</select></label>':'')+'<button class="btn btn-secondary" data-v3-admin="revision-preview">Recalcular valor</button>'+(revisionPreview?'<p><strong>'+money(revisionPreview.result.totalCents)+'</strong> · '+(revisionPreview.result.pointsUnits/100)+' pontos</p>'+(revisionEditor.direct?'<p>Entrega conferida no servidor.</p>':'<label>Nova janela <select data-revision-window><option value="">Selecione</option>'+revisionPreview.result.options.map((w,i)=>'<option value="'+i+'">'+esc(w.start+' a '+w.end)+'</option>').join('')+'</select></label>')+'<button class="btn btn-primary" data-v3-admin="revision-create">'+(revisionEditor.direct?'Salvar pedido':'Enviar para aceite')+'</button>':'')+'</section>';
 }
 function readRevision(){
  const items=Array.from(host.querySelectorAll('[data-revision-family]')).flatMap(el=>{
   const v=revisionEditor.variants.find(x=>x.variantCode===el.value&&x.family===el.dataset.revisionFamily);if(!v)return [];
   const old=revisionEditor.items.find(x=>x.family===v.family);
   return [{family:v.family,productCode:v.productCode,variantCode:v.variantCode,addonCodes:v.family==='convite'?Array.from(host.querySelectorAll('[data-revision-addon]:checked')).map(x=>x.dataset.revisionAddon):[],extras:Array.from(host.querySelectorAll('[data-extra-family="'+v.family+'"]')).map(x=>({code:x.dataset.revisionExtra,quantity:Number(x.value)})).filter(x=>x.quantity>0),comboCode:old?.variantCode===v.variantCode?old.comboCode||'':''}];
  });
  return {items,couponCode:host.querySelector('[data-revision-coupon]').value,reason:host.querySelector('[data-revision-reason]').value.trim(),...(revisionEditor.direct?{deliveryWindow:{start:host.querySelector('[data-revision-start]').value,end:host.querySelector('[data-revision-end]').value},depositPercent:Number(host.querySelector('[data-revision-deposit]').value),expectedRevisionId:revisionEditor.revisionId,expectedRevisionVersion:revisionEditor.revisionVersion,expectedOriginalTotalCents:revisionEditor.originalTotalCents}:{})};
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
 const openPanels=new Map();
 let activeTab='summary';
 const nextStep=s=>s.briefingStatus==='locked'?['finance','Conferir pagamento']:s.briefingStatus!=='completed'?['briefing','Acompanhar briefing']:!s.reviewedAt?['briefing','Conferir briefing']:s.productionStatus==='pending'?['production','Programar produção']:({ready:['production','Iniciar produção'],in_production:['production','Publicar prévia'],waiting_customer:['production','Acompanhar aprovação'],adjustments:['production','Realizar ajustes'],approved:['production','Conferir entrega final'],delivered:['history','Consultar histórico']})[s.productionStatus]||['production','Consultar serviço'];
 const tabs=[['summary','Resumo'],['briefing','Briefing'],['production','Produção e entrega'],['finance','Financeiro'],['changes','Alterações'],['history','Histórico']];
 function selectTab(key){if(!tabs.some(t=>t[0]===key))return;activeTab=key;for(const el of host.querySelectorAll('[data-v3-admin-page]'))el.hidden=el.dataset.v3AdminPage!==key;for(const el of host.querySelectorAll('[data-v3-admin-tab]'))el.setAttribute('aria-pressed',String(el.dataset.v3AdminTab===key));}
 function dateBr(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.split('-').reverse().join('/'):'A definir';}
 function prizeHtml(s){
 const a=s.blackLibri;if(!a)return '';
 const description=a.gift?'Brinde a produzir · sem custo adicional':a.convertedToDiscount&&a.creditCents>0?'Brinde convertido em crédito de '+money(a.creditCents)+' · não produzir em duplicidade':a.applied&&a.creditCents>0?'Desconto aplicado: '+money(a.creditCents):a.alreadyIncluded||a.convertedToDiscount?'Benefício já contemplado; não produzir em duplicidade':'Melhor condição comercial mantida; sem desconto adicional';
 return '<div class="notice" aria-label="Premiação Black Libri"><strong>BLACK LIBRI · '+esc(a.label)+'</strong><p>'+esc(description)+'</p>'+(a.gift&&brief.locked?'<small>Aguardar confirmação de pagamento para produzir.</small>':'')+'</div>';
 }
 function contactHtml(){
 const c=brief.customer||{},m=brief.orderMeta||{},phone=String(c.whatsapp||'').replace(/\D/g,'');
 return '<div class="order-meta"><p><strong>Cliente:</strong> '+esc(c.name||'Não informado')+'</p><p>WhatsApp: '+esc(c.whatsapp||'Não informado')+'</p>'+'<p>Evento: '+esc(({birthday:'Aniversário',wedding:'Casamento','15_years':'15 anos',celebration:'Chá ou celebração',other:'Outra celebração'})[brief.event.type]||brief.event.type||'Não informado')+(m.eventSubtype?' · '+esc(m.eventSubtype):'')+'</p><p>Festa: '+dateBr(brief.event.date)+'</p><p>Entrega: '+dateBr(brief.deliveryWindow?.start)+(brief.deliveryWindow?.end&&brief.deliveryWindow.end!==brief.deliveryWindow.start?' a '+dateBr(brief.deliveryWindow.end):'')+'</p><p>Origem: '+esc(m.source==='manual_whatsapp'?'Pedido manual':m.source==='store'?'Loja':m.source||'Não informada')+'</p>'+(m.createdAt?'<p>Criado em: '+esc(dateTimeBr(m.createdAt))+'</p>':'')+(m.nextAction?'<p>Próximo: '+esc(m.nextAction)+'</p>':'')+(/^\d{10,15}$/.test(phone)?'<a class="btn btn-secondary" href="https://wa.me/'+phone+'" target="_blank" rel="noopener noreferrer">WhatsApp da cliente</a>':'')+'</div>';
 }
 function folderButton(){return !brief.locked&&!brief.cancellation?'<a class="btn btn-primary" data-v3-download-folder href="/api/admin/v2/orders/'+encodeURIComponent(code)+'/download-folder" download>Baixar pasta ZIP</a>':'';}
 function quickStart(s){
 if(brief.locked||brief.cancellation||s.briefingStatus!=='completed'||s.productionStatus!=='pending')return '';
 const dependent=s.family==='convite'&&brief.services.some(x=>x.family==='identidade_visual');
 const gift=['mini_retrospective','child_birthday'].includes(s.blackLibri?.gift?.config?.blackLibriPrizeCode)&&!s.reviewedAt;
 const receipt=brief.modules.find(m=>m.module===s.family)?.receipt;
 if(s.family==='retrospectiva'&&!receipt?.completeAt)return '<button type="button" data-v3-admin-tab="briefing">Registrar materiais recebidos</button>';
 return '<div class="v3-start-actions">'+(dependent?'<label>Depende da identidade visual? <select data-quick-dependency="'+esc(s.family)+'"><option value="">Selecione</option><option value="no">Não</option><option value="yes">Sim</option></select></label>':'')+(gift?'<label><input type="checkbox" data-quick-gift="'+esc(s.family)+'"> Conferi fotos e autorização do brinde</label>':'')+'<button type="button" class="btn btn-primary" data-v3-admin="quick-start" data-family="'+esc(s.family)+'">Iniciar produção</button><small>Confirma os dados e mantém a data contratada.</small><button type="button" data-v3-admin-tab="briefing">Ver briefing</button><button type="button" data-v3-admin-tab="production">Opções de agenda</button></div>';
 }
 function purchasedHtml(s){
 return '<div class="v3-admin-mini-service"><div><strong>'+esc(s.productName)+'</strong><small>'+esc(s.variantName)+(s.sceneCount?' · '+Number(s.sceneCount)+' cena(s)':'')+'</small><small>'+money(s.totalCents)+'</small>'+(s.addons||[]).map(a=>'<small>+ '+esc(a.name)+' · '+money(a.priceCents)+'</small>').join('')+(s.extras||[]).map(a=>'<small>+ '+esc(a.quantity)+' × '+esc(a.name)+' · '+money(a.totalCents)+'</small>').join('')+'</div>'+(quickStart(s)||(s.productionStatus==='ready'&&!brief.locked&&!brief.cancellation?'<button type="button" class="btn btn-primary" data-v3-admin="start" data-family="'+esc(s.family)+'">Iniciar produção</button>':'<button type="button" data-v3-admin-tab="'+nextStep(s)[0]+'">'+esc(nextStep(s)[1])+'</button>'))+'</div>'+prizeHtml(s);
 }
 function financeReadout(){
 const b=brief.priceBreakdown||{},labels={approved:'Aprovado',pending:'Pendente',cancelled:'Cancelado',expired:'Expirado',rejected:'Recusado',refunded:'Reembolsado'};
 return '<section class="card"><h3>Composição e movimentações</h3>'+(Number.isFinite(b.grossCents)?'<p>Itens: '+money(b.grossCents)+'</p>':'')+(b.discountCents?'<p>Descontos: − '+money(b.discountCents)+'</p>':'')+(b.couponCode?'<p>Cupom: '+esc(b.couponCode)+'</p>':'')+(b.cardFeeCents?'<p>Taxa do cartão: '+money(b.cardFeeCents)+'</p>':'')+'<p>Forma de pagamento: '+(brief.payment.method==='pix'?'Pix':'Cartão')+'</p><h4>Tentativas de pagamento</h4>'+((brief.paymentAttempts||[]).length?brief.paymentAttempts.map(p=>'<p>'+esc(labels[p.status]||p.status)+' · '+money(p.amountCents)+' · '+esc(p.provider==='direct_pix'?'Pix registrado':p.provider==='mercado_pago'?'Mercado Pago':p.provider)+(p.paidAt?' · '+esc(dateTimeBr(p.paidAt)):'')+'</p>').join(''):'<p>Nenhuma tentativa registrada.</p>')+'<h4>Termos da contratação</h4>'+((brief.termsAcceptances||[]).length?brief.termsAcceptances.map(t=>'<p>Versão '+esc(t.terms_version)+' · '+esc(dateTimeBr(t.accepted_at))+'</p>').join(''):'<p>Ainda não aceitos pela cliente.</p>')+'</section>';
 }
 function organizeTabs(){
  const summary=host.querySelector('.v3-admin-summary');if(!summary)return;
  const sections=[...host.children],pages=new Map();
  const nav=document.createElement('nav');nav.className='v3-admin-tabs';nav.setAttribute('aria-label','Seções do pedido');nav.innerHTML=tabs.map(t=>'<button type="button" data-v3-admin-tab="'+t[0]+'" aria-pressed="false">'+t[1]+'</button>').join('');
  summary.after(nav);
  for(const t of tabs){const page=document.createElement('section');page.dataset.v3AdminPage=t[0];page.className='v3-admin-tab-page';page.setAttribute('aria-label',t[1]);host.append(page);pages.set(t[0],page);}
  const statuses={pending:'Aguardando programação',ready:'Pronto para produzir',in_production:'Em produção',waiting_customer:'Aguardando aprovação',adjustments:'Ajustes solicitados',approved:'Aprovado',delivered:'Entregue'};
  pages.get('summary').innerHTML=(brief.adminPayment?.canEditManual?'<button class="btn btn-primary" data-v3-admin="revision-editor">Editar pedido</button>':'')+folderButton()+'<h3>Serviços contratados</h3>'+brief.services.map(purchasedHtml).join('');
  pages.get('finance').innerHTML=financeReadout();
  if(folderButton())pages.get('briefing').innerHTML=folderButton();
  for(const el of sections){if(el===summary)continue;const k=el.dataset.v3Panel||'';if(el.matches('[role="alert"]'))pages.get(activeTab).prepend(el);else if(k.startsWith('briefing-'))pages.get('briefing').append(el);else if(k==='finance'||k==='cancel')pages.get('finance').append(el);else if(k==='revision')pages.get('changes').append(el);else if(el.classList.contains('v3-admin-service'))pages.get('production').append(el);else if(el.tagName==='DETAILS'&&!k)pages.get('history').append(el);else if(el.matches('p.muted'))pages.get('production').append(el);else if(el.querySelector('[data-v3-admin^="paid-capacity-"],[data-v3-admin^="urgency-"]'))pages.get('production').prepend(el);}
  for(const [key,page] of pages)if(!page.childElementCount)page.innerHTML='<p class="muted">Nenhuma informação nesta seção.</p>';
  selectTab(activeTab);
 }
 function render(){
 if(!host.isConnected)return;
 for(const el of host.querySelectorAll('details[data-v3-panel]'))openPanels.set(el.dataset.v3Panel,el.open);
 const opened=(key,fallback=false)=>((openPanels.has(key)?openPanels.get(key):fallback)?' open':'');
 const panel=(key,title,body,fallback=false)=>body?'<details class="card v3-admin-panel" data-v3-panel="'+esc(key)+'"'+(fallback&&(key==='revision'&&revisionEditor||key==='cancel'&&brief.cancellation)?' open':opened(key,fallback))+'><summary>'+esc(title)+'</summary><div class="v3-admin-panel-content">'+body+'</div></details>':'';
 host.innerHTML='<section class="card v3-admin-summary"><span class="eyebrow">Pedido integrado</span><h3>'+esc(brief.event.honoreeName)+'</h3>'+(brief.aggregate?'<p><strong>'+esc(brief.aggregate.label)+'</strong> · '+esc(brief.aggregate.deliveredServices)+' de '+esc(brief.aggregate.totalServices)+' serviços entregues</p>':'')+contactHtml()+(brief.instagram?'<p>Instagram informado: <a href="https://www.instagram.com/'+encodeURIComponent(brief.instagram)+'/" target="_blank" rel="noopener noreferrer">@'+esc(brief.instagram)+'</a></p>':'')+'<div class="order-payment-snapshot" aria-label="Resumo financeiro"><div><small>Valor do pedido</small><strong>'+money(brief.payment.totalCents)+'</strong></div><div><small>Recebido</small><strong>'+money(brief.payment.receivedCents)+'</strong></div><div><small>A receber</small><strong>'+money(brief.payment.remainingCents)+'</strong></div></div>'+(brief.financial?'<p>Adicionais confirmados: '+money(brief.financial.paidSupplementCents)+'</p><p><strong>Total confirmado: '+money(brief.financial.confirmedTotalCents)+'</strong></p><p>Adicionais a receber: '+money(brief.financial.pendingSupplementCents)+'</p>'+(brief.financial.reviewSupplementCents?'<p>Valores em conferência: '+money(brief.financial.reviewSupplementCents)+'</p>':''):'')+'<p>'+ (brief.cancellation?(brief.cancellation.status==='completed'?'Pedido cancelado':'Cancelamento em conferência'):brief.locked?'Aguardando confirmação de pagamento':'Pagamento confirmado')+'</p><button class="btn btn-secondary" data-v3-admin="refresh">Atualizar</button></section>'+
 (error?'<p role="alert" class="notice">'+esc(error)+'</p>':'')+(brief.capacityReview?'<section class="card"><h3>Pagamento recebido · agenda em revisão</h3><p>Os dados estão liberados, mas a produção ainda não tem capacidade confirmada. Nenhuma nova cobrança será gerada.</p><button class="btn btn-primary" data-v3-admin="paid-capacity-retry">Conferir a janela original</button>'+(!brief.urgency?'<label>Nova previsão acordada · início <input type="date" data-capacity-start></label><label>Fim <input type="date" data-capacity-end></label><label>Registro do acordo com a cliente <textarea data-capacity-note maxlength="500"></textarea></label><button class="btn btn-secondary" data-v3-admin="paid-capacity-replace">Confirmar nova previsão</button>':'')+'</section>':'')+(brief.urgency?.status==='pending'?'<section class="card"><h3>Solicitação de encaixe urgente</h3><p>Adicional de '+esc(brief.urgency.percent)+'%. Valor integral já conferido no pedido. Nenhuma cobrança criada.</p><label>Início da entrega <input type="date" data-urgency-start></label><label>Fim da entrega <input type="date" data-urgency-end></label><label>Observação / motivo <textarea data-urgency-note></textarea></label><button class="btn btn-primary" data-v3-admin="urgency-approve">Aprovar encaixe</button><button class="btn btn-danger" data-v3-admin="urgency-reject">Rejeitar</button></section>':'')+panel('finance','Financeiro · '+money(brief.payment.remainingCents)+' de saldo',financeActions(),brief.locked||brief.payment.remainingCents>0)+panel('revision','Alterar contratação',revisionHtml(),!!brief.revision||!!revisionEditor)+panel('cancel','Cancelamento e devoluções',cancellationHtml(),!!brief.cancellation)+
 brief.services.map(s=>'<section class="card v3-admin-service"><div class="v3-service-header"><span class="eyebrow">'+esc(names[s.family])+'</span><h3>'+esc(s.productName)+'</h3><strong>'+money(s.totalCents)+'</strong></div><p>'+esc(s.briefingStatus==='completed'?'Briefing enviado':s.briefingStatus==='locked'?'Aguardando pagamento':'Aguardando respostas')+' · '+esc(s.reviewedAt?'Conferido pelo Admin':'Conferência pendente')+'</p>'+
 (s.complementNote?'<p>Complemento solicitado: '+esc(s.complementNote)+'</p>':'')+agendaHtml(s)+productionHtml(s)+deliveryHtml(s)+supplementHtml(s)+'</section>').join('')+
 brief.modules.map(m=>{const s=brief.services.find(x=>x.family===m.module);return '<details class="card v3-admin-panel" data-v3-panel="briefing-'+esc(m.module)+'"'+opened('briefing-'+m.module,!!s&&s.briefingStatus==='completed'&&!s.reviewedAt)+'><summary><strong>'+esc(names[m.module])+'</strong>'+ (s?' · '+esc(s.reviewedAt?'Conferido':s.briefingStatus==='completed'?'A conferir':'Aguardando respostas'):'')+'</summary>'+
 m.schema.sections.map(sec=>'<h4>'+esc(sec.title)+'</h4>'+sec.fields.filter(f=>m.data[f.key]!=null&&String(m.data[f.key]).trim()).map(f=>'<div class="order-answer-item"><strong>'+esc(f.label)+'</strong><p>'+esc(value(f,m.data[f.key]))+'</p></div>').join('')).join('')+
 (m.uploads||[]).map(u=>'<p>'+esc(u.originalFilename)+' · <a href="'+esc(u.contentPath)+'" target="_blank" rel="noopener noreferrer">Ver imagem privada</a></p>').join('')+
 materials(m)+(m.schema.sections.some(sec=>sec.fields.some(f=>f.key==='black_gift_media_sent'))?'<label><input type="checkbox" data-gift-media="'+esc(m.module)+'"> Conferi as fotos, a autorização e o escopo do presente Black Libri</label>':'')+(s?.briefingStatus==='completed'&&s.productionStatus==='pending'?'<div><button class="btn btn-primary" data-v3-admin="confirm" data-family="'+esc(m.module)+'">Confirmar briefing conferido</button><label>Complemento necessário <textarea maxlength="500" data-note="'+esc(m.module)+'"></textarea></label><button class="btn btn-secondary" data-v3-admin="reopen" data-family="'+esc(m.module)+'">Solicitar complemento</button></div>':'')+'</details>';}).join('')+
 ('<details class="card history-timeline" open><summary>Histórico geral do pedido</summary><div class="history-track">'+((brief.history||[]).length?brief.history.map(e=>'<article class="history-event"><time>'+esc(dateTimeBr(e.created_at))+'</time><strong>'+esc(e.description||e.action)+'</strong>'+(e.family?'<small>'+esc(names[e.family]||e.family)+'</small>':'')+(e.note?'<p>'+esc(e.note)+'</p>':'')+'</article>').join(''):'<p>Nenhuma movimentação registrada.</p>')+'</div></details>')+
 '<p class="muted">Conferir não libera a produção automaticamente. A agenda será validada por serviço.</p>';
 for(const el of host.querySelectorAll('details[data-v3-panel]'))if(openPanels.has(el.dataset.v3Panel)&&!el.dataset.v3Panel.startsWith('finance')&&!el.dataset.v3Panel.startsWith('revision')&&!el.dataset.v3Panel.startsWith('cancel'))el.open=openPanels.get(el.dataset.v3Panel);
 organizeTabs();host.querySelectorAll('button').forEach(b=>b.disabled=busy);
 }
 host.addEventListener('change',e=>{if(!e.target.matches('[data-revision-family]')||!revisionEditor)return;const draft=readRevision();revisionEditor.items=draft.items;revisionEditor.couponCode=draft.couponCode;revisionPreview=null;render();});
 host.addEventListener('click',async e=>{
 const tab=e.target.closest('[data-v3-admin-tab]');if(tab&&!busy){selectTab(tab.dataset.v3AdminTab);return;}const b=e.target.closest('[data-v3-admin]');if(!b||busy)return;
 const action=b.dataset.v3Admin,family=b.dataset.family;
 let path=base,payload=null,method='POST';
 if(action==='quick-start'){
   const s=brief.services.find(x=>x.family===family),m=brief.modules.find(x=>x.module===family);
   if(!s?.progress||!m)return;
   const dep=host.querySelector('[data-quick-dependency="'+family+'"]'),gift=host.querySelector('[data-quick-gift="'+family+'"]');
   if(dep&&!dep.value){showToast('Informe se depende da identidade visual.');return;}
   if(gift&&!gift.checked){showToast('Confirme as fotos e a autorização do brinde.');return;}
   path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/agenda/'+family+'/start';
   payload={confirmed:true,version:s.progress.version,revision:m.revision,sharedRevision:brief.modules.find(x=>x.module==='shared')?.revision||0,dependsOnIdentity:dep?dep.value==='yes':undefined,giftMediaConfirmed:!!gift?.checked};
 }
 else if(action.startsWith('paid-capacity-')){const replace=action==='paid-capacity-replace';if(!confirm(replace?'Confirma que a cliente aceitou a nova previsão? Nenhuma cobrança será criada.':'Conferir a capacidade da janela original?'))return;path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/paid-capacity';payload={confirmed:true,...(replace?{deliveryWindow:{start:host.querySelector('[data-capacity-start]').value,end:host.querySelector('[data-capacity-end]').value},note:host.querySelector('[data-capacity-note]').value}:{})};}
 else if(action.startsWith('urgency-')){const decision=action.slice(8);if(!confirm(decision==='approve'?'Aprovar o encaixe e liberar a contratação pelo valor informado? Nenhuma cobrança será criada agora.':'Rejeitar este encaixe?'))return;path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/urgency';payload={decision,deliveryStart:host.querySelector('[data-urgency-start]').value,deliveryEnd:host.querySelector('[data-urgency-end]').value,note:host.querySelector('[data-urgency-note]').value};}
 else if(action.startsWith('revision-')){
   const mode=action.slice(9);path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/revision/'+mode;
   if(mode==='editor'){method='GET';}
   else if(mode==='withdraw'){if(!confirm('Retirar a proposta e manter as condições anteriores?'))return;payload={confirmed:true};}
   else{
    const input=readRevision();
    if(mode==='preview'){payload=input;}
    else{
      const index=host.querySelector('[data-revision-window]')?.value,w=revisionEditor.direct?input.deliveryWindow:index===''?null:revisionPreview?.result.options[Number(index)];
      if(!w||JSON.stringify(input)!==JSON.stringify(revisionPreview?.input)||input.reason.length<5){showToast('Confira o motivo, recalcule e escolha a previsão.');return;}
      if(!confirm(revisionEditor.direct?'Salvar o pedido de '+money(revisionPreview.result.totalCents)+' mantendo o mesmo link?':'Encerrar cobrança anterior e enviar alteração de '+money(revisionPreview.result.totalCents)+' para aceite?'))return;
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
 }else if(action==='capacity-release'){
   const units=brief.services.find(s=>s.family===family)?.capacityRelease?.availableUnits;
   if(!units||!confirm('Liberar '+(units/100).toFixed(2)+' pontos futuros deste serviço para novas contratações? Os outros serviços e os dias já passados serão preservados.'))return;
   path='/api/admin/v2/orders/'+encodeURIComponent(code)+'/v3/agenda/'+family+'/release';payload={expectedUnits:units,confirmed:true};
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
 try{const res=await api(path,payload?{method,body:payload instanceof FormData?payload:JSON.stringify(payload)}:{});if(res.briefing)brief=res.briefing;if(action==='revision-editor'){revisionEditor=res.result;revisionPreview=null;activeTab='changes';}else if(action==='revision-preview'){revisionEditor.items=payload.items;revisionEditor.couponCode=payload.couponCode;if(revisionEditor.direct){revisionEditor.deliveryWindow=payload.deliveryWindow;revisionEditor.depositPercent=payload.depositPercent;}revisionPreview={input:payload,result:res.result};}else if(action==='revision-create'||action==='revision-withdraw'){revisionEditor=null;revisionPreview=null;if(onChanged)await onChanged();}else if(action==='supplement-capacity'){supplementCapacity[b.dataset.supplementId]=res.result;}else if(action==='supplement-preview'){supplementDrafts[family]={input:payload,quote:res.result,key:Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('')};}else if(action==='agenda'){agenda[family]={options:res.result.options,depends:payload.dependsOnIdentity};}else if(payload){if(action==='quick-start'||action==='start'||action==='confirm'||action==='schedule')activeTab='production';agenda={};supplementDrafts={};supplementCapacity={};showToast('Atualizado.');if(onChanged)await onChanged();}}
 catch(err){error=err.message;}
 finally{busy=false;render();}
 });
 render();return close;
}
