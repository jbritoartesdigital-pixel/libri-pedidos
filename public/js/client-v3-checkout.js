import {trackStoreStage,storeJourneyId,finishStoreJourney} from './store-funnel.js';
// Unified V3 checkout. Draft customer data stays in memory, not localStorage.
// Once a payment attempt is sent, only the exact same payload may be retried.
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const day=v=>String(v).split('-').reverse().join('/');
import {pendingV3CheckoutKey,keepV3CheckoutKey,clearV3CheckoutKey,mountV3PaymentRecovery} from './client-v3-payment-recovery.js';
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('');
const labels={identidade_visual:'Libri Ateliê',retrospectiva:'Retrospectiva'};
export function mountV3Checkout(root,{items,eventType,eventDate='',request,onBack}){
  trackStoreStage('dados');
  const cart={items:JSON.parse(JSON.stringify(items)),eventType};
  let form={name:'',whatsapp:'',email:'',honoreeName:'',eventDate,paymentMethod:'pix',couponCode:'',deliveryWindow:null};
  let quote=null,terms=null,enabled=false,options=[],accepted=new Set(),busy=false,error='',attempt=null,attemptKey=null;
  let blackChecked=false,blackClaim=null,checkingBlack=false;
  const hasInvite=cart.items.some(i=>! /^(atelie_|retrospectiva)/.test(i.productCode));
  const blackSelection=()=>blackClaim?{blackLibriClaimId:blackClaim.id,clientRequestId:attemptKey,customer:{name:form.name,whatsapp:form.whatsapp,email:form.email}}:{};
  function readForm(){
    for(const k of ['name','whatsapp','email','honoreeName','eventDate','paymentMethod','couponCode']){
      const el=root.querySelector('[name="'+k+'"]');if(el)form[k]=el.value;
    }
    const checked=root.querySelector('[name="deliveryWindow"]:checked');
    if(checked)form.deliveryWindow=options[Number(checked.value)]||null;
    accepted=new Set(Array.from(root.querySelectorAll('[data-v3-term]:checked'),x=>x.value));
  }
  function summary(){
    if(!quote)return '';
    return '<div class="v3-lines">'+quote.items.map(x=>'<div class="v3-line"><span>'+esc(x.productName)+'</span><b>'+money(x.grossCents)+'</b></div>').join('')+
      (quote.discountCents?'<div class="v3-line"><span>'+esc(quote.selectedDiscount==='black_libri'?'Black Libri':quote.selectedDiscount==='coupon'?'Cupom '+quote.coupon.code:quote.selectedDiscount==='combined'?'Desconto combinado ('+quote.combinedDiscountPercent+'%)':'Desconto do convite')+'</span><b>− '+money(quote.discountCents)+'</b></div>':'')+
      (quote.blackLibri?'<p class="v3-notice"><strong>'+esc(quote.blackLibri.label)+'</strong><br>'+esc(quote.blackLibri.gift?'Presente incluído, sem custo.':quote.blackLibri.applied?'Benefício aplicado.':'Mantivemos a melhor condição disponível.')+'</p>':'')+
      (quote.cardFeeCents?'<div class="v3-line"><span>Taxa de cartão</span><b>'+money(quote.cardFeeCents)+'</b></div>':'')+
      '</div><div class="v3-total"><strong>Total integral</strong><b>'+money(quote.totalCents)+'</b></div>';
  }
  function field(name,label,type='text',required=true,max=180){
    return '<label for="v3c-'+name+'">'+label+'</label><input class="v3-at-input" id="v3c-'+name+'" name="'+name+'" type="'+type+'" value="'+esc(form[name])+'" maxlength="'+max+'" '+(name==='whatsapp'?'autocomplete="tel" inputmode="tel" ':name==='email'?'autocomplete="email" ':name==='name'?'autocomplete="name" ':'')+(name==='whatsapp'&&blackClaim?'readonly ':'')+(required?'required':'')+'>';
  }
  function render(){
    const termRows=terms?[{family:'general',...terms.general},...terms.services]:[];
    root.innerHTML='<section class="v3-panel"><span class="v3-eyebrow">Libri · contratação</span><h1 class="v3-title">Finalizar seu pedido</h1><p class="v3-text">Um pagamento, acompanhamento individual dos serviços.</p>'+
      (!enabled?'<div class="v3-notice">Prévia do novo checkout. O pagamento ainda não está liberado.</div>':'')+
      (error?'<div class="v3-notice" role="alert">'+esc(error)+'</div>':'')+
      '<form id="v3-unified-checkout"><fieldset '+(busy||attempt?'disabled':'')+' style="border:0;padding:0;margin:0;min-width:0">'+
      '<section class="v3-checkout-block"><h2>1. Seus dados</h2>'+field('name','Seu nome','text',true,160)+field('whatsapp','WhatsApp','tel',true,30)+field('email','E-mail (opcional)','email',false,240)+
      '</section><section class="v3-checkout-block"><h2>2. Sua comemoração</h2>'+field('honoreeName','Nome do homenageado ou evento')+field('eventDate','Data do evento','date')+
      '<button type="button" class="v3-btn v3-btn-secondary" data-v3-checkout="agenda">Consultar agenda</button>'+
      (options.length?'<div class="v3-notice"><strong>Escolha a previsão de entrega</strong>'+options.map((o,i)=>'<label style="display:block;padding:8px 0"><input type="radio" name="deliveryWindow" value="'+i+'" '+(form.deliveryWindow?.start===o.start&&form.deliveryWindow?.end===o.end?'checked':'')+' required> '+esc(day(o.start)+' a '+day(o.end))+(o.recommended?' · sugerida':'')+'</label>').join('')+'<p class="v3-mini">A previsão depende de pagamento, briefing e materiais completos. A reserva só ocorre ao contratar.</p></div>':'')+
      '</section><section class="v3-checkout-block"><h2>3. Pagamento</h2><label for="v3c-payment">Forma de pagamento</label><select class="v3-at-input" id="v3c-payment" name="paymentMethod"><option value="pix" '+(form.paymentMethod==='pix'?'selected':'')+'>Pix integral</option><option value="card" '+(form.paymentMethod==='card'?'selected':'')+'>Cartão integral</option></select>'+field('couponCode','Cupom (opcional)','text',false,80)+'<button type="button" class="v3-btn v3-btn-secondary" data-v3-checkout="coupon">Conferir cupom</button>'+summary()+
      '</section><section class="v3-checkout-block"><h2>4. Condições da contratação</h2>'+termRows.map(t=>'<div class="v3-notice"><details><summary>'+esc(labels[t.family]||'Condições gerais')+' · ler condições</summary><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(t.body)+'</p></details><label><input type="checkbox" data-v3-term value="'+esc(t.family)+'" '+(accepted.has(t.family)?'checked':'')+' required> Li e aceito estas condições.</label></div>').join('')+
      '</section></fieldset><div class="v3-action-row">'+(!attempt?'<button type="button" class="v3-btn v3-btn-text" data-v3-checkout="back" '+(busy?'disabled':'')+'>Voltar ao carrinho</button>':'')+
      '<button type="'+(attempt?'button':'submit')+'" '+(attempt?'data-v3-checkout="retry"':'')+' class="v3-btn v3-btn-primary" '+(!enabled||busy||!quote||!terms||(!attempt&&!options.length)?'disabled':'')+'>'+(busy?'Conferindo…':attempt?'Retomar a mesma tentativa':'Confirmar e pagar')+'</button></div></form></section>';
    root.setAttribute('aria-busy',String(busy));
  }
  async function refresh({agenda=false}={}){
    if(busy||attempt)return;
    readForm();busy=true;error='';render();
    try{
      const selection={...cart,paymentMethod:form.paymentMethod,couponCode:form.couponCode,...blackSelection()};
      const [p,t]=await Promise.all([request('/api/v3/cart/quote',selection),request('/api/v3/cart/terms',selection)]);
      quote=p.quote;
      const next=t.terms;
      if(JSON.stringify(next)!==JSON.stringify(terms))accepted.clear();
      terms=next;enabled=t.checkoutEnabled===true;
      if(agenda){
        trackStoreStage('agenda');
        options=[];form.deliveryWindow=null;
        if(!form.eventDate)throw Error('Informe a data do evento.');
        const result=await request('/api/v3/cart/delivery-options',{...selection,eventDate:form.eventDate});
        quote=result.quote;options=result.delivery.options||[];
        if(!options.length)error='Não há uma janela automática para esta data. Consulte a Libri antes de contratar.';
      }
    }catch(e){error=e.message;quote=null;}finally{busy=false;render();}
  }
  async function pay(){
    if(busy||checkingBlack||!enabled)return;
    if(!attempt){
      const el=root.querySelector('#v3-unified-checkout');
      if(!el.reportValidity())return;
      readForm();
      if(!quote||!terms||!form.deliveryWindow||!accepted.has('general')||terms.services.some(x=>!accepted.has(x.family))){error='Confira a agenda e aceite todas as condições.';render();return;}
      try{
        attemptKey=pendingV3CheckoutKey()||token();
        keepV3CheckoutKey(attemptKey);
      }catch{error='O navegador não permite guardar a tentativa com segurança. Abra a loja em outro navegador.';render();return;}
      if(hasInvite&&!blackChecked){
        checkingBlack=true;
        let immediate=false,opening=true;
        try{
          const {openBlackLibriBeforePayment}=await import('./client-v2-black-libri.js?v=20261124-atelier-gift-v3');
          await openBlackLibriBeforePayment({customer:{name:form.name,whatsapp:form.whatsapp,email:form.email},clientRequestId:attemptKey,v3Cart:{...cart,paymentMethod:form.paymentMethod,couponCode:form.couponCode},onContinue:claim=>{
            blackChecked=true;
            if(claim?.status==='reserved')blackClaim=claim;
            if(opening&&!claim){immediate=true;return;}
            // Recalculate capacity after the gift and request a fresh confirmation.
            refresh({agenda:true});
          }});
        }catch(e){error=e.message;render();return;}
        finally{opening=false;checkingBlack=false;}
        if(!immediate)return;
      }
      trackStoreStage('tentativa');
      attempt={...cart,...blackSelection(),storeJourneyId:storeJourneyId(),customer:{name:form.name,whatsapp:form.whatsapp,email:form.email},honoreeName:form.honoreeName,eventDate:form.eventDate,
        paymentMethod:form.paymentMethod,couponCode:form.couponCode,deliveryWindow:{start:form.deliveryWindow.start,end:form.deliveryWindow.end},expectedTotalCents:quote.totalCents,
        clientRequestId:attemptKey,termsAccepted:true,termsVersion:terms.general.version};
      for(const t of terms.services){
        if(t.family==='identidade_visual'){attempt.atelieTermsAccepted=true;attempt.atelieTermsVersion=t.version;}
        if(t.family==='retrospectiva'){attempt.retrospectiveTermsAccepted=true;attempt.retrospectiveTermsVersion=t.version;}
      }
    }
    busy=true;error='';render();
    try{
      const result=await request('/api/v3/cart/checkout',attempt);
      const target=result.alreadyPaid?result.customerAreaPath:result.checkoutUrl;
      if(!target)throw Error('Não foi possível obter o link. Retome esta mesma tentativa.');
      const url=new URL(target,location.origin);
      if(result.alreadyPaid?url.origin!==location.origin:url.protocol!=='https:'||!/(^|\.)mercadopago\.com(\.br)?$/.test(url.hostname))throw Error('Link de pagamento indisponível.');
      // Retain the retry key until confirmed payment; do not create a new
      // attempt merely because the browser returns from the payment provider.
      if(result.alreadyPaid)clearV3CheckoutKey(attemptKey);
      finishStoreJourney();location.assign(url.href);
    }catch(e){error=e.message+' Retome a mesma tentativa para evitar duplicidade.';busy=false;render();}
  }
  root.addEventListener('click',handleClick);
  root.addEventListener('change',handleChange);
  root.addEventListener('submit',handleSubmit);
  function detach(){root.removeEventListener('click',handleClick);root.removeEventListener('change',handleChange);root.removeEventListener('submit',handleSubmit);}
  function handleClick(e){
    const action=e.target.closest('[data-v3-checkout]')?.dataset.v3Checkout;if(!action)return;
    if(action==='back'&&!busy&&!attempt){detach();onBack();}
    if(action==='agenda')refresh({agenda:true});
    if(action==='coupon')refresh();
    if(action==='retry'&&attemptKey){detach();mountV3PaymentRecovery(root,{request,credential:{clientRequestId:attemptKey},onMissing:()=>{root.addEventListener('click',handleClick);root.addEventListener('change',handleChange);root.addEventListener('submit',handleSubmit);pay();}});}
  }
  function handleChange(e){
    if(busy||attempt)return;
    if(e.target.name==='whatsapp'&&!blackClaim)blackChecked=false;
    if(e.target.name==='eventDate'){readForm();options=[];form.deliveryWindow=null;render();}
    if(e.target.name==='deliveryWindow')trackStoreStage('pagamento');
    if(e.target.hasAttribute('data-v3-term'))trackStoreStage('revisao');
    if(e.target.name==='paymentMethod'||e.target.name==='couponCode'){trackStoreStage('pagamento');refresh();}
  }
  function handleSubmit(e){if(e.target.id==='v3-unified-checkout'){e.preventDefault();pay();}}
  render();refresh();
}
