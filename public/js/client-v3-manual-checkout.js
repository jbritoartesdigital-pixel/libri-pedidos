// The manual link is a checkout for an existing order, not a new order or revision UI.
import {openBlackLibriBeforePayment} from './client-v2-black-libri.js?v=109';
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)/100);
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.split('-').reverse().join('/'):'A confirmar';
const labels={save_the_date:'Save the Date',reminder:'Lembrete',confirmation:'Confirmação de presença',filter:'Filtro personalizado',moments:'Álbum de fotos',retrospectiva:'Retrospectiva',identidade_visual:'Libri Ateliê'};
function safePay(v){try{const u=new URL(v);return u.protocol==='https:'&&/(^|\.)mercadopago\.com(\.br)?$/.test(u.hostname)?u.href:null;}catch{return null;}}
export async function startV3ManualCheckout(root,{token,api}){
 const endpoint='/api/v2/customer-area/'+encodeURIComponent(token)+'/v3/manual-checkout';
 const c=await api(endpoint+'/catalog');
 let quote=c.quote,step=c.addons.length||c.extras.length?'extras':'cart',busy=false,error='',terms=false,black=null;
 const chosen=new Map(),quantities=new Map();
 const selection=()=>({addonCodes:[...chosen.values()].filter(Boolean),extras:[...quantities].filter(([,q])=>q>0).map(([code,quantity])=>({code,quantity}))});
 const request=(action,data={})=>api(endpoint+'/'+action,{method:'POST',body:JSON.stringify(data)});
 const grouped=Array.from(new Set(c.addons.map(x=>x.group))).map(g=>({group:g,options:c.addons.filter(x=>x.group===g)}));
 root.classList.add('libri-manual-checkout');
 document.body.classList.add('libri-manual-body');
 function itemsHtml(){return quote.items.map(i=>'<article class="manual-cart-item"><div><h3>'+esc(i.productName)+'</h3><p>'+esc(i.variantName)+'</p></div><strong>'+money(i.totalCents)+'</strong>'+((i.addons.length||i.extras.length)?'<div class="manual-included"><strong>Adicionais escolhidos</strong><p>'+esc([...i.addons,...i.extras.map(x=>x.quantity+' × '+x.name)].join(' · '))+'</p></div>':'')+'</article>').join('');}
 function extrasHtml(){
 return grouped.map(({group,options})=>{
 const value=chosen.get(group)||'';
 const unavailable=(group==='moments'&&chosen.has('filter'))||(group==='filter'&&chosen.has('moments'));
 return '<article class="manual-extra"><div><h3>'+esc(labels[group]||options[0].name)+'</h3><p>'+esc(options.length===1?options[0].name:'Escolha a opção que prefere.')+'</p></div><div>'+ (options.length===1?'<button class="manual-small-btn" type="button" data-manual-addon="'+esc(group)+'" data-code="'+esc(options[0].code)+'" '+(unavailable?'disabled':'')+'>'+ (value?'Retirar':'+ '+money(options[0].priceCents))+'</button>':'<select aria-label="'+esc(labels[group]||group)+'" data-manual-group="'+esc(group)+'" '+(unavailable?'disabled':'')+'><option value="">Não adicionar</option>'+options.map(a=>'<option value="'+esc(a.code)+'" '+(value===a.code?'selected':'')+'>'+esc(a.name)+' · '+money(a.priceCents)+'</option>').join('')+'</select>')+'</div></article>';
 }).join('')+c.extras.map(x=>'<article class="manual-extra"><div><h3>'+esc(x.name)+'</h3><p>'+money(x.priceCents)+' por unidade</p></div><label><span class="manual-quantity-label">Quantidade</span><input type="number" min="0" max="'+x.maxQuantity+'" step="1" data-manual-extra="'+esc(x.code)+'" value="'+(quantities.get(x.code)||0)+'"></label></article>').join('');
 }
 function render(){
 const cart=step==='cart';
 root.innerHTML='<section class="manual-shell"><header class="manual-heading"><small>LIBRI CONVITES · '+esc(c.orderCode)+'</small><h1>'+(cart?'Seu pedido':'Personalize seu pedido')+'</h1><p>'+(cart?'Confira os serviços escolhidos e finalize o pagamento.':'Escolha os adicionais que quiser. Todos são opcionais.')+'</p></header>'+
 '<div class="manual-scroll">'+(error?'<p class="manual-error" role="alert">'+esc(error)+'</p>':'')+(cart?
 '<div class="manual-event"><strong>'+esc(c.event.honoreeName)+'</strong><span>Festa: '+day(c.event.date)+'</span><span>Entrega: '+day(c.deliveryWindow.start)+(c.deliveryWindow.end!==c.deliveryWindow.start?' a '+day(c.deliveryWindow.end):'')+'</span></div>'+itemsHtml()+
 ((c.addons.length||c.extras.length)&&!black?'<button type="button" data-manual-action="extras" class="manual-text-btn">+ Alterar adicionais</button>':'')+
 '<details class="manual-terms"><summary>Termos da contratação</summary><div>'+esc(c.terms.general.body)+'</div>'+c.terms.services.map(t=>'<div>'+esc(t.body)+'</div>').join('')+'</details><label class="manual-terms-check"><input type="checkbox" data-manual-terms '+(terms?'checked':'')+'> Li e aceito os termos da contratação.</label>':extrasHtml())+'</div>'+
 '<footer class="manual-footer"><div class="manual-total"><div><strong>'+(c.paymentMethod==='pix'?'Total no Pix':'Total no cartão')+'</strong>'+(quote.discountCents?'<small>Desconto: − '+money(quote.discountCents)+'</small>':'')+(quote.blackLibri?'<small>Black Libri: '+esc(quote.blackLibri.label)+'</small>':'')+'</div><b>'+money(quote.totalCents)+'</b></div>'+
 (quote.depositPercent===50?'<div class="manual-payment-split"><span>Entrada: <b>'+money(quote.depositCents)+'</b></span><span>Saldo: '+money(quote.balanceCents)+'</span></div>':'')+
 '<button class="manual-primary" type="button" data-manual-action="'+(cart?'pay':'cart')+'" '+(busy?'disabled':'')+'>'+(busy?'Conferindo…':cart?(quote.depositPercent===50?'Pagar entrada':'Continuar para pagamento'):'Ir para o carrinho')+'</button></footer><div class="manual-progress" aria-label="Etapas"><span class="'+(!cart?'active':'done')+'"></span><span class="'+(cart?'active':'')+'"></span><span></span></div></section>';
 root.setAttribute('aria-busy',String(busy));
 }
 async function refresh(){
 if(busy)return;
 const y=root.querySelector('.manual-scroll')?.scrollTop||0;busy=true;error='';render();
 try{quote=(await request('quote',selection())).quote;}
 catch(e){error=e.message||'Não foi possível conferir os adicionais.';chosen.clear();quantities.clear();quote=c.quote;}
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
 async function finish(){
 if(busy)return;
 if(!terms){error='Leia e aceite os termos da contratação para continuar.';render();return;}
 if(!quote.items.some(i=>i.family==='convite')||black){await payFinal();return;}
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
 if(e.target.matches('[data-manual-group]')){const g=e.target.dataset.manualGroup;if(e.target.value)chosen.set(g,e.target.value);else chosen.delete(g);refresh();}
 if(e.target.matches('[data-manual-extra]')){const n=Number(e.target.value),max=Number(e.target.max);quantities.set(e.target.dataset.manualExtra,Number.isInteger(n)?Math.max(0,Math.min(max,n)):0);refresh();}
 });
 root.addEventListener('click',e=>{
 if(busy)return;
 const addon=e.target.closest('[data-manual-addon]');
 if(addon&&!black){const g=addon.dataset.manualAddon;if(chosen.has(g))chosen.delete(g);else chosen.set(g,addon.dataset.code);refresh();return;}
 const action=e.target.closest('[data-manual-action]')?.dataset.manualAction;
 if(action==='cart'||action==='extras'&&!black){step=action;error='';render();return;}
 if(action==='pay')finish();
 });
 render();
}
