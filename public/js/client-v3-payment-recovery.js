// Store only the unguessable private retry credential, not customer details,
// prices, terms, or payment URLs. Preserve it across browser reloads.
const KEY='libriV3PendingCheckout';
export function pendingV3CheckoutKey(){
  for(const storage of ['localStorage','sessionStorage']){
    try{const key=globalThis[storage]?.getItem(KEY);if(/^[a-f0-9]{36}$/.test(key||''))return key;}catch{}
  }
  return '';
}
export function keepV3CheckoutKey(key){
  if(!/^[a-f0-9]{36}$/.test(key))throw Error('Tentativa inválida.');
  let saved=false;
  for(const storage of ['localStorage','sessionStorage']){
    try{globalThis[storage].setItem(KEY,key);saved=true;}catch{}
  }
  if(!saved)throw Error('O navegador não permite guardar a tentativa com segurança.');
}
export function clearV3CheckoutKey(key){
  for(const storage of ['localStorage','sessionStorage']){
    try{if(globalThis[storage]?.getItem(KEY)===key)globalThis[storage].removeItem(KEY);}catch{}
  }
}
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
function validCustomerPath(path){return /^\/meu-pedido\/ord_[a-f0-9]{36}$/.test(path||'');}
function providerLink(path){try{const u=new URL(path);return u.protocol==='https:'&&/(^|\.)mercadopago\.com(\.br)?$/.test(u.hostname)?u.href:null;}catch{return null;}}
export async function mountV3PaymentRecovery(root,{request,onMissing,credential}){
  const key=credential?.clientRequestId||pendingV3CheckoutKey();
  const body=credential||{clientRequestId:key};
  if(!body.clientRequestId&&!body.publicToken)return false;
  let state=null,busy=false,error='';
  const descriptions={
    urgency_pending:'Solicitação de encaixe enviada. Aguarde a decisão da Libri; ainda não existe cobrança.',
    paid:'Pagamento confirmado. Acesse seu pedido para acompanhar os serviços.',
    pending:'A cobrança anterior está disponível. Continue pelo mesmo link, sem gerar outra cobrança.',
    expired:'A cobrança anterior foi encerrada pelo Mercado Pago. Você poderá gerar uma nova somente se a agenda original continuar disponível.',
    not_started:'O pedido está salvo, mas ainda não existe uma cobrança. Você pode iniciar o pagamento.',
    review:'Não foi possível garantir uma nova cobrança segura. Acesse seu pedido e fale com a Libri.'
  };
  function render(){
    const validPath=validCustomerPath(state?.customerAreaPath);
    const provider=state?.state==='pending'?providerLink(state.checkoutUrl):null;
    root.innerHTML='<section class="v3-panel"><span class="v3-eyebrow">Libri · pagamento</span><h1 class="v3-title">Retomar contratação</h1>'+
      (state?.found?'<p><strong>'+esc(state.orderCode)+'</strong> · '+money(state.totalCents)+'</p>'+(state.depositPercent===50?'<p>Entrada autorizada: '+money(state.amountDueNowCents)+' · Saldo posterior: '+money(state.balanceCents)+'</p>':'')+'<p>'+esc(descriptions[state.state]||'Confira a situação do pedido.')+'</p>':'<p>Consultando sua tentativa privada de pagamento.</p>')+
      (state?.capacityReview?'<div class="v3-notice">Pagamento confirmado. A Libri precisa revisar a capacidade da agenda.</div>':'')+
      (error?'<div class="v3-notice" role="alert">'+esc(error)+'</div>':'')+
      '<div class="v3-action-row">'+
      (provider?'<button type="button" class="v3-btn v3-btn-primary" data-v3-recovery="continue" '+(busy?'disabled':'')+'>Continuar pagamento</button>':'')+
      (state?.canRenew?'<button type="button" class="v3-btn v3-btn-primary" data-v3-recovery="renew" '+(busy?'disabled':'')+'>Gerar cobrança</button>':'')+
      (validPath?'<button type="button" class="v3-btn v3-btn-secondary" data-v3-recovery="order" '+(busy?'disabled':'')+'>Acessar meu pedido</button>':'')+
      '<button type="button" class="v3-btn v3-btn-text" data-v3-recovery="refresh" '+(busy?'disabled':'')+'>'+(busy?'Consultando…':'Atualizar situação')+'</button></div></section>';
    root.setAttribute('aria-busy',String(busy));
  }
  async function check(renew=false){
    if(busy)return true;
    busy=true;error='';render();
    try{
      const result=await request('/api/v3/cart/'+(renew?'renew':'recover'),body);
      if(!result.found){
        // Keep the same key: an earlier in-flight request may still commit.
        // The next submission cannot create a second order with that key.
        detach();if(onMissing)await onMissing();return false;
      }
      state=result;
    }catch(e){error=e.message||'Não foi possível verificar o pagamento. Não gere outro pedido.';}
    finally{busy=false;}
    render();return true;
  }
  function detach(){root.removeEventListener('click',click);}
  function click(event){
    const action=event.target.closest('[data-v3-recovery]')?.dataset.v3Recovery;if(!action||busy)return;
    if(action==='refresh')check();
    if(action==='renew'&&state?.canRenew)check(true);
    if(action==='continue'&&state?.state==='pending'){
      const url=providerLink(state.checkoutUrl);if(url)location.assign(url);
    }
    if(action==='order'&&validCustomerPath(state?.customerAreaPath)){
      if(state.state==='paid'&&key)clearV3CheckoutKey(key);
      location.assign(state.customerAreaPath);
    }
  }
  root.addEventListener('click',click);
  return check();
}
