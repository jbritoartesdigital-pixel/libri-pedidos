// The manual link is a checkout for an existing order, not a new order or revision UI.
import {openBlackLibriBeforePayment} from './client-v2-black-libri.js?v=109';
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)/100);
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.split('-').reverse().join('/'):'A confirmar';
// Match the commercial language of the V3 storefront, not the legacy V2 controls.
const groupNames={confirmation:'Formulário de confirmação',filter:'Filtro personalizado',moments:'Álbum de fotos',save_the_date:'Save the Date',reminder:'Lembrete da festa',retrospectiva:'Retrospectiva',moments_extra:'Mais fotos para o álbum'};
const groupOrder=['save_the_date','reminder','confirmation','filter','moments','retrospectiva','moments_extra'];
const isMomentsPlan=code=>/^moments_(festa|premium|exclusive)$/.test(code);
const shortVariant=a=>a.code.endsWith('_static')?'Estático':a.code.endsWith('_animated')?'Animado':({moments_festa:'Festa',moments_premium:'Premium',moments_exclusive:'Exclusive',moments_extra_100:'+100 fotos'}[a.code]||a.name);
function manualGroups(addons){const groups=new Map();for(const a of addons){if(!groups.has(a.group))groups.set(a.group,[]);groups.get(a.group).push(a);}return [...groups].sort(([a],[b])=>(groupOrder.includes(a)?groupOrder.indexOf(a):99)-(groupOrder.includes(b)?groupOrder.indexOf(b):99)).map(([key,options])=>({key,label:groupNames[key]||options[0].name,options:options.slice().sort((a,b)=>a.priceCents-b.priceCents),minPriceCents:Math.min(...options.map(a=>a.priceCents))}));}
const suggestionCopy={confirmation:'Acompanhe as respostas e escolha confirmação livre ou por lista de convidados.',filter:'Uma câmera com filtro personalizado para os convidados registrarem a festa.',moments:'Reúna os registros dos convidados em um álbum digital com filtro incluso.',save_the_date:'Avise seus convidados sobre a data com antecedência.',reminder:'Relembre os convidados perto da comemoração.'};
function safePay(v){try{const u=new URL(v);return u.protocol==='https:'&&/(^|\.)mercadopago\.com(\.br)?$/.test(u.hostname)?u.href:null;}catch{return null;}}
export async function startV3ManualCheckout(root,{token,api}){
 const endpoint='/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/manual-checkout';
 const c=await api(endpoint+'/catalog');
 let quote=c.quote,extrasOpen=true,busy=false,error='',terms=false,black=null,suggestionSeen=false;
 const chosen=new Map(),quantities=new Map();let invitationVariant=c.invitationVariant,savedVariant=c.invitationVariant;let savedChosen=new Map(),savedQuantities=new Map();
 const selection=()=>({revisionVersion:c.revisionVersion,...(invitationVariant?{invitationVariant}:{}),addonCodes:[...chosen.values()].filter(Boolean),extras:[...quantities].filter(([,q])=>q>0).map(([code,quantity])=>({code,quantity}))});
 const request=(action,data={})=>api(endpoint+'/'+action,{method:'POST',body:JSON.stringify(data)});
 const grouped=manualGroups(c.addons);
 const albumSelected=()=>Boolean(c.ownedAddonCodes?.some(isMomentsPlan)||[...chosen.values()].some(isMomentsPlan));
 const blocked=g=>g==='moments'&&chosen.has('filter')||g==='filter'&&chosen.has('moments')||g==='moments_extra'&&!albumSelected();
 root.classList.add('libri-manual-checkout');
 document.body.classList.add('libri-manual-body');
 function itemsHtml(){return quote.items.map(i=>'<article class="manual-cart-item"><div><h3>'+esc(i.productName)+'</h3><p>'+esc(i.variantName)+'</p>'+(i.family==='convite'&&c.invitationVariants?.length&&!black?'<button type="button" class="studio-manual-inline" data-manual-action="format">Alterar</button>':'')+'</div><strong>'+money(i.totalCents)+'</strong>'+((i.addons.length||i.extras.length)?'<div class="manual-included"><strong>Inclusos no pedido</strong><p>'+esc([...i.addons,...i.extras.map(x=>x.quantity+' × '+x.name)].join(' · '))+'</p></div>':'')+'</article>').join('');}
 function extrasHtml(){
 const rows=grouped.filter(g=>(g.key!=='moments_extra'||albumSelected())&&!(g.key==='confirmation'&&invitationVariant?.productCode==='cinematic_video')).map(g=>{
 const value=chosen.get(g.key)||'',selected=g.options.find(a=>a.code===value),disabled=blocked(g.key)||busy;
 if(g.options.length===1){
 const a=g.options[0];
 return '<label class="manual-v110-row studio-manual-row"><input type="checkbox" data-manual-choice="'+esc(g.key)+'" value="'+esc(a.code)+'" '+(value?'checked ':'')+(disabled?'disabled':'')+'><span class="studio-manual-copy"><strong>'+esc(g.label)+'</strong>'+(g.key==='confirmation'?'<small>Confirmação simples já inclusa no convite.</small>':'')+'</span><b>+'+money(a.priceCents)+'</b></label>';
 }
 return '<button type="button" class="manual-v110-row studio-manual-row studio-manual-expand" data-manual-open="'+esc(g.key)+'" '+(disabled?'disabled':'')+'><span class="studio-manual-copy"><strong>'+esc(g.label)+'</strong>'+(selected?'<small>'+esc(shortVariant(selected))+'</small>':'')+'</span><span class="studio-manual-price"><b>'+(selected?money(selected.priceCents):'A partir de '+money(g.minPriceCents))+'</b><small>'+(selected?'Alterar':'Ver opções')+'</small></span></button>';
 }).join('');
 return '<div class="manual-extras-list">'+rows+c.extras.map(x=>'<article class="manual-extra manual-v110-row"><div><h3>'+esc(x.name)+'</h3><p>'+money(x.priceCents)+' por unidade</p></div><label><span class="manual-quantity-label">Quantidade</span><input type="number" min="0" max="'+x.maxQuantity+'" step="1" data-manual-extra="'+esc(x.code)+'" value="'+(quantities.get(x.code)||0)+'"></label></article>').join('')+'</div>';
 }
 function openStudioDialog(title,html){
 const d=document.createElement('dialog');d.className='studio-manual-dialog';d.setAttribute('aria-label',title);
 d.innerHTML='<div class="studio-manual-dialog-head"><h2>'+esc(title)+'</h2><button type="button" class="studio-manual-close" aria-label="Fechar">×</button></div>'+html;
 document.body.append(d);
 const close=()=>{if(d.open)d.close();};d.addEventListener('close',()=>d.remove(),{once:true});
 d.querySelector('.studio-manual-close').onclick=close;
 d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
 d.showModal();return {d,close};
 }
 function openOptions(group){
 const g=grouped.find(x=>x.key===group);if(!g||blocked(group)||busy)return;
 const selected=chosen.get(group);
 const {d,close}=openStudioDialog(g.label,(group==='moments'?'<p>Inclui o filtro personalizado na câmera Libri.</p>':'')+'<div class="studio-manual-option-list">'+g.options.map(a=>'<button type="button" class="studio-manual-option" data-option="'+esc(a.code)+'" aria-pressed="'+(selected===a.code)+'"><span>'+esc(shortVariant(a))+'</span><b>+'+money(a.priceCents)+'</b></button>').join('')+'</div>'+(selected?'<button type="button" class="studio-manual-text" data-option="">Retirar adicional</button>':'')+'<button type="button" class="studio-manual-text" data-dismiss>Voltar</button>');
 d.addEventListener('click',e=>{const opt=e.target.closest('[data-option]');if(opt){const value=opt.dataset.option;if(value)chosen.set(group,value);else chosen.delete(group);if(!albumSelected())chosen.delete('moments_extra');close();refresh();}else if(e.target.closest('[data-dismiss]'))close();});
 }
 function openFormat(){
 const options=c.invitationVariants||[];
 const {d,close}=openStudioDialog('Alterar convite','<p>Escolha o formato e a quantidade de cenas. O total será conferido antes de pagar.</p><label class="studio-format-field">Formato<select data-format>'+[...new Map(options.map(v=>[v.productCode,v.name])).entries()].map(([code,name])=>'<option value="'+esc(code)+'" '+(code===invitationVariant?.productCode?'selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label><label class="studio-format-field">Configuração<select data-variant></select></label><button class="studio-format-save" type="button" data-apply-format>Atualizar valor</button>');
 const product=d.querySelector('[data-format]'),variant=d.querySelector('[data-variant]');
 const fill=()=>{variant.innerHTML=options.filter(v=>v.productCode===product.value).map(v=>'<option value="'+esc(v.variantCode)+'" '+(v.variantCode===invitationVariant?.variantCode?'selected':'')+'>'+esc(v.variantName)+' · '+money(v.priceCents)+'</option>').join('');};fill();product.onchange=fill;
 d.querySelector('[data-apply-format]').onclick=()=>{invitationVariant={productCode:product.value,variantCode:variant.value};if(product.value==='cinematic_video')chosen.delete('confirmation');terms=false;close();refresh();};
 }
 function render(){
 const firstName=String(c.customerName||'').trim().split(/\s+/)[0],hasExtras=Boolean(c.addons.length||c.extras.length);
 root.innerHTML='<section class="manual-shell"><header class="manual-heading"><small>'+esc(c.orderCode)+'</small><h1>'+(firstName?'Olá, '+esc(firstName)+'!':'Olá!')+'</h1><p>Aqui é sua área para finalizar seu pedido.</p></header>'+
 '<div class="manual-scroll">'+(error?'<p class="manual-error" role="alert">'+esc(error)+'</p>':'')+
 '<div class="studio-manual-section-title">Seu pedido</div><div class="manual-event"><strong>'+esc(c.event.honoreeName)+'</strong><span>Festa: '+day(c.event.date)+'</span><span>Entrega: '+day(c.deliveryWindow.start)+(c.deliveryWindow.end!==c.deliveryWindow.start?' a '+day(c.deliveryWindow.end):'')+'</span></div>'+itemsHtml()+
 (hasExtras&&!black?'<div class="studio-manual-addons"><button type="button" data-manual-action="extras" aria-expanded="'+extrasOpen+'" aria-controls="manualOptionalAddons" class="studio-manual-addons-toggle" '+(busy?'disabled':'')+'><span>Adicionais opcionais</span><small>'+(extrasOpen?'Recolher':'+ Ver opções')+'</small></button><div id="manualOptionalAddons" '+(extrasOpen?'':'hidden')+'>'+(extrasOpen?extrasHtml():'')+'</div></div>':'')+
 '<details class="manual-terms"><summary>Termos da contratação</summary><div>'+esc(c.terms.general.body)+'</div>'+c.terms.services.map(t=>'<div>'+esc(t.body)+'</div>').join('')+'</details><label class="manual-terms-check"><input type="checkbox" data-manual-terms '+(terms?'checked ':'')+(busy?'disabled':'')+'> Li e aceito os termos da contratação.</label></div>'+
 '<footer class="manual-footer"><div class="manual-total"><div><strong>'+(c.paymentMethod==='pix'?'Total no Pix':'Total no cartão')+'</strong>'+(quote.discountCents?'<small>Desconto: − '+money(quote.discountCents)+'</small>':'')+(quote.blackLibri?'<small>Black Libri: '+esc(quote.blackLibri.label)+'</small>':'')+'</div><b>'+money(quote.totalCents)+'</b></div>'+
 (quote.depositPercent===50?'<div class="manual-payment-split"><span>Entrada: <b>'+money(quote.depositCents)+'</b></span><span>Saldo: '+money(quote.balanceCents)+'</span></div>':'')+
 '<button class="manual-primary" type="button" data-manual-action="pay" '+(busy?'disabled':'')+'>'+(busy?'Conferindo…':quote.depositPercent===50?'Pagar entrada':'Continuar para pagamento')+'</button></footer></section>';
 root.setAttribute('aria-busy',String(busy));
 }
 async function refresh(){
 if(busy)return;
 const y=root.querySelector('.manual-scroll')?.scrollTop||0;busy=true;error='';
 root.setAttribute('aria-busy','true');root.querySelectorAll('input,button').forEach(el=>{el.disabled=true;});
 try{quote=(await request('quote',selection())).quote;savedChosen=new Map(chosen);savedQuantities=new Map(quantities);savedVariant=invitationVariant;}
 catch(e){error=e.message||'Não foi possível conferir a alteração.';invitationVariant=savedVariant;chosen.clear();for(const [k,v] of savedChosen)chosen.set(k,v);quantities.clear();for(const [k,v] of savedQuantities)quantities.set(k,v);}
 finally{busy=false;render();const el=root.querySelector('.manual-scroll');if(el)el.scrollTop=y;}
 }
 async function payFinal(){
 busy=true;error='';render();
 try{
  const finalSelection={...selection(),...(black?.status==='reserved'?{blackLibriClaimId:black.id}:{})};
  quote=(await request('quote',finalSelection)).quote;render();
  const result=await request('finish',{...finalSelection,id:c.revisionId,termsAccepted:true,confirmed:true,expectedTotalCents:quote.totalCents});
  const url=safePay(result.payment?.checkoutUrl);if(url){location.assign(url);return;}
  location.reload();
 }catch(e){
  // A provider failure can happen after the terms were recorded. Reopen the same
  // order rather than attempting another checkout or repeating its acceptance.
  try{const area=await api('/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/briefing');if(area.briefing&&!area.briefing.revision){location.reload();return;}}catch{}
  error=e.message||'Não foi possível continuar. Reabra seu pedido para conferir o pagamento.';busy=false;render();
 }
 }
 async function findSuggestion(){
 for(const group of ['confirmation','filter','moments','save_the_date','reminder']){
  if(chosen.has(group)||blocked(group)||group==='confirmation'&&invitationVariant?.productCode==='cinematic_video')continue;
  const g=grouped.find(x=>x.key===group);if(!g)continue;
  const a=g.options[0];
  try{const next=(await request('quote',{...selection(),addonCodes:[...selection().addonCodes,a.code]})).quote;
   if(next.totalCents>quote.totalCents)return {group,a,next,delta:next.totalCents-quote.totalCents};
  }catch{/* Incompatible suggestions never block the original checkout. */}
 }
 return null;
 }
 function showSuggestion({group,a,next,delta}){
 const {d,close}=openStudioDialog(groupNames[group]||a.name,'<p>'+esc(suggestionCopy[group])+'</p><div class="studio-manual-offer"><small>Por apenas mais</small><strong>'+money(delta)+'</strong></div><div class="studio-manual-offer-total"><span>Novo total <b>'+money(next.totalCents)+'</b></span>'+(next.depositPercent===50?'<span>Entrada <b>'+money(next.depositCents)+'</b></span><span>Saldo <b>'+money(next.balanceCents)+'</b></span>':'')+'</div><div class="studio-manual-dialog-actions"><button type="button" id="manualV3SuggestionSkip">Agora não</button><button type="button" id="manualV3SuggestionAccept">Quero adicionar</button></div>');
 d.querySelector('#manualV3SuggestionSkip').onclick=()=>{close();finish();};
 d.querySelector('#manualV3SuggestionAccept').onclick=()=>{close();chosen.set(group,a.code);quote=next;savedChosen=new Map(chosen);savedQuantities=new Map(quantities);error='';render();};
 }
 async function finish(){
 if(busy)return;
 if(!terms){error='Leia e aceite os termos da contratação para continuar.';render();return;}
 if(!quote.items.some(i=>i.family==='convite')||black){await payFinal();return;}
 if(!suggestionSeen){suggestionSeen=true;busy=true;error='';render();const offer=await findSuggestion();busy=false;render();if(offer){showSuggestion(offer);return;}}
 busy=true;error='';render();
 let continuation=null;
 try{
  await openBlackLibriBeforePayment({manualV3Endpoint:endpoint,manualV3Selection:selection(),onContinue:claim=>{black=claim?.status==='reserved'?claim:{status:'unavailable'};continuation=payFinal();}});
  if(continuation){await continuation;return;}
  // The overlay owns its own click handlers and calls onContinue after the
  // balloon is selected. Closing it leaves the cart intact.
  busy=false;render();
 }catch(e){error=e.message;busy=false;render();}
 }
 root.addEventListener('change',e=>{
 if(e.target.matches('[data-manual-terms]')){terms=e.target.checked;return;}
 if(busy||black)return;
 if(e.target.matches('[data-manual-choice]')){const g=e.target.dataset.manualChoice;if(e.target.checked&&e.target.value)chosen.set(g,e.target.value);else chosen.delete(g);if(!albumSelected())chosen.delete('moments_extra');refresh();}
 if(e.target.matches('[data-manual-extra]')){const n=Number(e.target.value),max=Number(e.target.max);quantities.set(e.target.dataset.manualExtra,Number.isInteger(n)?Math.max(0,Math.min(max,n)):0);refresh();}
 });
 root.addEventListener('click',e=>{
 if(busy)return;
 const open=e.target.closest('[data-manual-open]');if(open&&!black){openOptions(open.dataset.manualOpen);return;}
 const action=e.target.closest('[data-manual-action]')?.dataset.manualAction;
 if(action==='format'&&!black){openFormat();return;}
 if(action==='extras'&&!black){const y=root.querySelector('.manual-scroll')?.scrollTop||0;extrasOpen=!extrasOpen;error='';render();const body=root.querySelector('.manual-scroll');if(body)body.scrollTop=y;root.querySelector('[data-manual-action="extras"]')?.focus({preventScroll:true});return;}
 if(action==='pay')finish();
 });
 render();
}
