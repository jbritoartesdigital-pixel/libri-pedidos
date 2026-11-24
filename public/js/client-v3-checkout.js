import {trackStoreStage,storeJourneyId,finishStoreJourney} from './store-funnel.js';
// Unified V3 checkout. Draft customer data stays in memory, not localStorage.
// Once a payment attempt is sent, only the exact same payload may be retried.
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const day=v=>String(v).split('-').reverse().join('/');
const windowFromStart=start=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(start||''))return null;const d=new Date(start+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==start)return null;d.setUTCDate(d.getUTCDate()+2);return {start,end:d.toISOString().slice(0,10)};};
import {pendingV3CheckoutKey,keepV3CheckoutKey,clearV3CheckoutKey,mountV3PaymentRecovery} from './client-v3-payment-recovery.js';
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('');
const labels={identidade_visual:'Libri Ateliê',retrospectiva:'Retrospectiva'};
export function mountV3Checkout(root,{items,eventType,eventSubtype='',eventDate='',request,onBack}){
  trackStoreStage('dados');
  const cart={items:JSON.parse(JSON.stringify(items)),eventType,eventSubtype};
  let form={name:'',whatsapp:'',email:'',honoreeName:'',eventDate,paymentMethod:'pix',couponCode:'',deliveryWindow:null};
  let quote=null,terms=null,enabled=false,options=[],accepted=new Set(),busy=false,error='',attempt=null,attemptKey=null;
  let blackChecked=false,blackClaim=null,checkingBlack=false,urgentQuote=null,urgentAccepted=false,couponOpen=false,blackConflict=false,otherOpen=false,otherDate='',otherError='';
  const hasInvite=cart.items.some(i=>! /^(atelie_|retrospectiva)/.test(i.productCode));
  const blackSelection=()=>blackClaim?{blackLibriClaimId:blackClaim.id,clientRequestId:attemptKey,customer:{name:form.name,whatsapp:form.whatsapp,email:form.email}}:{};
  function readForm(){
    const couponDetails=root.querySelector('#v3-coupon-details');if(couponDetails)couponOpen=couponDetails.open;
    const otherDetails=root.querySelector('#v3-other-delivery');if(otherDetails)otherOpen=otherDetails.open;
    const dateInput=root.querySelector('#v3-other-delivery-date');if(dateInput)otherDate=dateInput.value;
    for(const k of ['name','whatsapp','honoreeName','eventDate','paymentMethod','couponCode']){
      const el=root.querySelector('[name="'+k+'"]');if(el)form[k]=el.value;
    }
    const checked=root.querySelector('[name="deliveryWindow"]:checked');
    if(checked)form.deliveryWindow=options[Number(checked.value)]||null;
    accepted=new Set(Array.from(root.querySelectorAll('[data-v3-term]:checked'),x=>x.value));
    urgentAccepted=!!root.querySelector('[name="urgencyAccepted"]:checked');
  }
  function summary(){
    if(!quote)return '';
    const display=urgentQuote&&urgentAccepted?urgentQuote:quote;
    return '<div class="v3-lines">'+display.items.map(x=>'<div class="v3-line"><span>'+esc(x.productName)+'</span><b>'+money(x.grossCents-(x.urgencyAmountCents||0))+'</b></div>').join('')+
      (quote.discountCents?'<div class="v3-line"><span>'+esc(quote.selectedDiscount==='black_libri'?'Black Libri':quote.selectedDiscount==='coupon'?'Cupom '+quote.coupon.code:quote.selectedDiscount==='combined'?'Desconto combinado ('+quote.combinedDiscountPercent+'%)':'Desconto do convite')+'</span><b>− '+money(quote.discountCents)+'</b></div>':'')+
      (quote.blackLibri?'<p class="v3-notice"><strong>'+esc(quote.blackLibri.label)+'</strong><br>'+esc(quote.blackLibri.gift?'Presente incluído, sem custo.':quote.blackLibri.applied?'Benefício aplicado.':'Mantivemos a melhor condição disponível.')+'</p>':'')+
      (display.urgencyAmountCents?'<div class="v3-line"><span>Encaixe urgente ('+display.urgencyPercent+'%)</span><b>'+money(display.urgencyAmountCents)+'</b></div>':'')+
      (display.cardFeeCents?'<div class="v3-line"><span>Taxa de cartão</span><b>'+money(display.cardFeeCents)+'</b></div>':'')+
      '</div><div class="v3-total"><strong>Total integral</strong><b>'+money(display.totalCents)+'</b></div>';
  }
  function field(name,label,type='text',required=true,max=180){
    return '<label for="v3c-'+name+'">'+label+'</label><input class="v3-at-input" id="v3c-'+name+'" name="'+name+'" type="'+type+'" value="'+esc(form[name])+'" maxlength="'+max+'" '+(name==='whatsapp'?'autocomplete="tel" inputmode="tel" ':name==='email'?'autocomplete="email" ':name==='name'?'autocomplete="name" ':'')+(name==='whatsapp'&&blackClaim?'readonly ':'')+(required?'required':'')+'>';
  }
  function deliveryHtml(){
    if(!options.length)return '';
    const radio=(o,i)=>'<label class="v3-agenda-option"><input type="radio" name="deliveryWindow" value="'+i+'" '+(form.deliveryWindow?.start===o.start&&form.deliveryWindow?.end===o.end?'checked':'')+' required><span><strong>'+esc(day(o.start)+' a '+day(o.end))+'</strong>'+(o.recommended||o.earliest||o.custom?'<small>'+esc(o.recommended&&o.earliest?'Sugerida · Primeira disponível':o.recommended?'Sugerida':o.earliest?'Primeira disponível':'Data escolhida')+'</small>':'')+'</span></label>';
    const earliest=options.find(o=>o.earliest)||options.slice().sort((a,b)=>a.start.localeCompare(b.start))[0];
    const featured=options.map((o,i)=>({o,i})).filter(({o})=>o.recommended||o.earliest||o.custom||form.deliveryWindow?.start===o.start);
    const shown=featured.length?featured:options.slice(0,2).map((o,i)=>({o,i}));
    const rest=options.map((o,i)=>({o,i})).filter(({i})=>!shown.some(x=>x.i===i));
    return '<div class="v3-notice v3-delivery-picker" data-v3-delivery-options><strong>Quando deseja receber?</strong>'+shown.map(({o,i})=>radio(o,i)).join('')+
      '<details id="v3-other-delivery" '+(otherOpen?'open':'')+'><summary>Escolher outra data de entrega</summary>'+
      (rest.length?'<div class="v3-delivery-more">'+rest.map(({o,i})=>radio(o,i)).join('')+'</div>':'')+
      '<label for="v3-other-delivery-date">Ou escolha o início do prazo no calendário</label><input class="v3-at-input" id="v3-other-delivery-date" type="date" min="'+esc(earliest.start)+'" max="'+esc(form.eventDate)+'" value="'+esc(otherDate)+'"><small>Confira automaticamente se há capacidade para o período de 3 dias.</small>'+
      (otherError?'<p class="v3-mini" role="alert">'+esc(otherError)+'</p>':'')+'</details><p class="v3-mini">A previsão depende de pagamento, briefing e materiais completos. A reserva só ocorre ao contratar.</p></div>';
  }
  function render(){
    const termRows=terms?[{family:'general',...terms.general},...terms.services]:[];
    root.innerHTML='<section class="v3-panel"><h1 class="v3-title">Finalizar seu pedido</h1>'+
      (!enabled&&!busy&&terms?'<div class="v3-notice">Pagamento indisponível no momento.</div>':'')+
      (error?'<div class="v3-notice" role="alert">'+esc(error)+'</div>':'')+
      (blackConflict?'<div class="v3-black-recovery"><strong>Você já tem uma surpresa registrada!</strong><p>Seu presente não será sorteado novamente. Se a Libri enviou um código de recuperação, informe abaixo.</p><label for="v3-black-code">Código de recuperação</label><input id="v3-black-code" class="v3-at-input" autocomplete="off"><button type="button" class="v3-btn v3-btn-secondary" data-v3-checkout="black-recover">Recuperar presente</button><p class="v3-mini">Se não tiver o código, fale com a Libri antes de pagar para preservar o benefício.</p></div>':'')+
      '<form id="v3-unified-checkout"><fieldset '+(busy||attempt?'disabled':'')+' style="border:0;padding:0;margin:0;min-width:0">'+
      '<section class="v3-checkout-block"><h2>1. Seus dados</h2><div class="v3-checkout-fields">'+field('name','Seu nome','text',true,160)+field('whatsapp','WhatsApp','tel',true,30)+'</div>'+
      '</section><section class="v3-checkout-block"><h2>2. Sua comemoração</h2>'+field('honoreeName',eventType==='birthday'?'Nome da criança ou aniversariante':'Nome do homenageado ou evento')+field('eventDate','Data do evento','date')+
      (busy&&form.eventDate?'<p class="v3-agenda-loading" role="status">Consultando datas disponíveis…</p>':'')+
      deliveryHtml()+
      (urgentQuote?'<div class="v3-notice" data-v3-delivery-options><strong>Precisa de um encaixe?</strong><p>Não há janela normal para esta data. A Libri pode avaliar um encaixe com adicional de '+urgentQuote.urgencyPercent+'% ('+money(urgentQuote.urgencyAmountCents)+'). Nenhuma cobrança ou reserva será criada antes da aprovação.</p><label><input type="checkbox" name="urgencyAccepted" '+(urgentAccepted?'checked':'')+'> Solicitar análise pelo total de '+money(urgentQuote.totalCents)+'</label></div>':'')+
      '</section><section class="v3-checkout-block"><h2>3. Pagamento</h2><label for="v3c-payment">Forma de pagamento</label><select class="v3-at-input" id="v3c-payment" name="paymentMethod"><option value="pix" '+(form.paymentMethod==='pix'?'selected':'')+'>Pix integral</option><option value="card" '+(form.paymentMethod==='card'?'selected':'')+'>Cartão integral</option></select>'+'<details id="v3-coupon-details" class="v3-coupon-disclosure" '+(couponOpen||form.couponCode?'open':'')+'><summary>Tenho um cupom</summary>'+field('couponCode','Código do cupom','text',false,80)+'<button type="button" class="v3-btn v3-btn-secondary" data-v3-checkout="coupon">Aplicar</button></details>'+summary()+
      '</section><section class="v3-checkout-block"><h2>4. Condições da contratação</h2>'+termRows.map(t=>'<div class="v3-term-row"><details><summary>'+esc(labels[t.family]||'Condições gerais')+' · ler condições</summary><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(t.body)+'</p></details><label><input type="checkbox" data-v3-term value="'+esc(t.family)+'" '+(accepted.has(t.family)?'checked':'')+' required> Li e aceito estas condições.</label></div>').join('')+
      '</section></fieldset><div class="v3-action-row">'+(!attempt?'<button type="button" class="v3-btn v3-btn-text" data-v3-checkout="back" '+(busy?'disabled':'')+'>Voltar ao carrinho</button>':'')+
      '<button type="'+(attempt?'button':'submit')+'" '+(attempt?'data-v3-checkout="retry"':'')+' class="v3-btn v3-btn-primary" '+(!enabled||busy||!quote||!terms||(!attempt&&!options.length&&!(urgentQuote&&urgentAccepted))?'disabled':'')+'>'+(busy?'Conferindo…':attempt?'Retomar a mesma tentativa':urgentQuote&&urgentAccepted?'Solicitar encaixe, sem pagar agora':'Confirmar e pagar')+'</button></div></form></section>';
    root.setAttribute('aria-busy',String(busy));
  }
  async function refresh({agenda=false}={}){
    if(busy||attempt)return;
    readForm();const hadUrgency=!!urgentQuote;busy=true;error='';render();
    try{
      const selection={...cart,paymentMethod:form.paymentMethod,couponCode:form.couponCode,...blackSelection()};
      const [p,t]=await Promise.all([request('/api/v3/cart/quote',selection),request('/api/v3/cart/terms',selection)]);
      quote=p.quote;
      const next=t.terms;
      if(JSON.stringify(next)!==JSON.stringify(terms))accepted.clear();
      terms=next;enabled=t.checkoutEnabled===true;
      if(agenda||hadUrgency){
        trackStoreStage('agenda');
        const previousWindow=form.deliveryWindow;options=[];form.deliveryWindow=null;urgentQuote=null;urgentAccepted=false;
        if(!form.eventDate)throw Error('Informe a data do evento.');
        const result=await request('/api/v3/cart/delivery-options',{...selection,eventDate:form.eventDate});
        quote=result.quote;options=result.delivery.options||[];urgentQuote=result.urgencyQuote||null;
        if(previousWindow&&options.some(o=>o.start===previousWindow.start&&o.end===previousWindow.end))form.deliveryWindow=previousWindow;
        else if(previousWindow&&options.length){try{const extra=await request('/api/v3/cart/delivery-options',{...selection,eventDate:form.eventDate,deliveryWindow:{start:previousWindow.start,end:previousWindow.end}});if(!extra.delivery.selected)throw Error('Data não confirmada');options.push({...extra.delivery.selected,custom:true});form.deliveryWindow=options[options.length-1];}catch{otherError='O prazo escolhido precisa ser confirmado novamente. Selecione outra data.';otherOpen=true;}}
        if(options.length||urgentQuote)trackStoreStage('pagamento');
        if(!options.length&&!urgentQuote)error='Não há uma janela automática para esta data. Consulte a Libri antes de contratar.';
      }
    }catch(e){error=e.message;quote=null;}finally{busy=false;render();}
  }
  async function pay(){
    if(busy||checkingBlack||!enabled)return;
    if(!attempt){
      const el=root.querySelector('#v3-unified-checkout');
      if(!el.reportValidity())return;
      readForm();
      if(!quote||!terms||(!form.deliveryWindow&&!(urgentQuote&&urgentAccepted))||!accepted.has('general')||terms.services.some(x=>!accepted.has(x.family))){error='Confira a agenda e aceite todas as condições.';render();return;}
      try{
        attemptKey=pendingV3CheckoutKey()||token();
        keepV3CheckoutKey(attemptKey);
      }catch{error='O navegador não permite guardar a tentativa com segurança. Abra a loja em outro navegador.';render();return;}
      if(hasInvite&&!blackChecked){
        trackStoreStage('surpresa');
        checkingBlack=true;
        let immediate=false,opening=true;
        try{
          const {openBlackLibriBeforePayment}=await import('./client-v2-black-libri.js?v=20261124-atelier-gift-v3');
          let legacyRequestId='';try{legacyRequestId=JSON.parse(localStorage.getItem('libriV2StoreState')||'null')?.clientRequestId||'';}catch{}
          await openBlackLibriBeforePayment({legacyRequestId,customer:{name:form.name,whatsapp:form.whatsapp,email:form.email},clientRequestId:attemptKey,v3Cart:{...cart,paymentMethod:form.paymentMethod,couponCode:form.couponCode},onContinue:claim=>{
            blackChecked=true;blackConflict=false;
            if(claim?.status==='reserved')blackClaim=claim;
            if(opening&&!claim){immediate=true;return;}
            // Recalculate capacity after the gift and request a fresh confirmation.
            refresh({agenda:true});
          }});
        }catch(e){blackConflict=e?.data?.code==='black_libri_private_claim';error=blackConflict?'A reserva existe, mas precisamos confirmar a chave de recuperação.':e.message;render();return;}
        finally{opening=false;checkingBlack=false;}
        if(!immediate)return;
      }
      trackStoreStage('tentativa');
      attempt={...cart,...blackSelection(),storeJourneyId:storeJourneyId(),customer:{name:form.name,whatsapp:form.whatsapp,email:form.email},honoreeName:form.honoreeName,eventDate:form.eventDate,
        paymentMethod:form.paymentMethod,couponCode:form.couponCode,...(urgentQuote&&urgentAccepted?{urgencyRequested:true,expectedTotalCents:urgentQuote.totalCents}:{deliveryWindow:{start:form.deliveryWindow.start,end:form.deliveryWindow.end},expectedTotalCents:quote.totalCents}),
        clientRequestId:attemptKey,termsAccepted:true,termsVersion:terms.general.version};
      for(const t of terms.services){
        if(t.family==='identidade_visual'){attempt.atelieTermsAccepted=true;attempt.atelieTermsVersion=t.version;}
        if(t.family==='retrospectiva'){attempt.retrospectiveTermsAccepted=true;attempt.retrospectiveTermsVersion=t.version;}
      }
    }
    busy=true;error='';render();
    try{
      const result=await request('/api/v3/cart/checkout',attempt);
      const target=result.alreadyPaid||result.urgencyRequested?result.customerAreaPath:result.checkoutUrl;
      if(!target)throw Error('Não foi possível obter o link. Retome esta mesma tentativa.');
      const url=new URL(target,location.origin);
      if(result.alreadyPaid||result.urgencyRequested?url.origin!==location.origin:url.protocol!=='https:'||!/(^|\.)mercadopago\.com(\.br)?$/.test(url.hostname))throw Error('Link de pagamento indisponível.');
      // Retain the retry key until confirmed payment; do not create a new
      // attempt merely because the browser returns from the payment provider.
      if(result.alreadyPaid)clearV3CheckoutKey(attemptKey);
      if(!result.alreadyPaid&&!result.urgencyRequested)trackStoreStage('redirecionamento');finishStoreJourney();location.assign(url.href);
    }catch(e){error=e.message+' Retome a mesma tentativa para evitar duplicidade.';busy=false;render();}
  }
  root.addEventListener('click',handleClick);
  root.addEventListener('change',handleChange);
  root.addEventListener('submit',handleSubmit);
  function detach(){root.removeEventListener('click',handleClick);root.removeEventListener('change',handleChange);root.removeEventListener('submit',handleSubmit);}
  function handleClick(e){
    const action=e.target.closest('[data-v3-checkout]')?.dataset.v3Checkout;if(!action)return;
    if(action==='back'&&!busy&&!attempt){detach();onBack();}

    if(action==='coupon')refresh({agenda:!!form.eventDate});
    if(action==='black-recover')recoverBlack();
    if(action==='retry'&&attemptKey){detach();mountV3PaymentRecovery(root,{request,credential:{clientRequestId:attemptKey},onMissing:()=>{root.addEventListener('click',handleClick);root.addEventListener('change',handleChange);root.addEventListener('submit',handleSubmit);pay();}});}
  }
  function handleChange(e){
    if(busy||attempt)return;
    if(e.target.name==='whatsapp'&&!blackClaim){blackChecked=false;blackConflict=false;}
    if(e.target.name==='eventDate'){readForm();options=[];form.deliveryWindow=null;urgentQuote=null;urgentAccepted=false;otherDate='';otherError='';otherOpen=false;render();if(form.eventDate&&e.target.validity.valid)refresh({agenda:true});return;}
    if(e.target.name==='urgencyAccepted'){readForm();render();return;}
    if(e.target.id==='v3-other-delivery-date'){chooseOtherDate();return;}
    if(e.target.name==='deliveryWindow'){readForm();otherError='';trackStoreStage('pagamento');render();return;}
    if(e.target.hasAttribute('data-v3-term')){readForm();trackStoreStage(terms&&accepted.has('general')&&terms.services.every(t=>accepted.has(t.family))?'pagamento':'revisao');}
    if(e.target.name==='paymentMethod'||e.target.name==='couponCode'){trackStoreStage('pagamento');refresh({agenda:!!form.eventDate});}
  }
  async function chooseOtherDate(){
    if(busy||attempt||checkingBlack)return;
    readForm();otherOpen=true;otherError='';const chosen=windowFromStart(otherDate);if(!chosen){render();return;}
    const existing=options.find(o=>o.start===chosen.start&&o.end===chosen.end);if(existing){form.deliveryWindow=existing;render();trackStoreStage('pagamento');return;}
    form.deliveryWindow=null;busy=true;render();
    try{const result=await request('/api/v3/cart/delivery-options',{...cart,paymentMethod:form.paymentMethod,couponCode:form.couponCode,...blackSelection(),eventDate:form.eventDate,deliveryWindow:chosen});if(!result.delivery.selected)throw Error('Prazo não confirmado');options=result.delivery.options||[];let picked=options.find(o=>o.start===chosen.start&&o.end===chosen.end);if(!picked){picked={...result.delivery.selected,custom:true};options.push(picked);}form.deliveryWindow=picked;quote=result.quote;trackStoreStage('pagamento');}
    catch{otherError='Não foi possível confirmar esse prazo. Escolha outra data ou uma das opções disponíveis.';}
    finally{busy=false;render();}
  }
  function handleSubmit(e){if(e.target.id==='v3-unified-checkout'){e.preventDefault();pay();}}
  async function recoverBlack(){
    if(busy||checkingBlack||attempt)return;
    const key=root.querySelector('#v3-black-code')?.value.trim().toLowerCase()||'';
    if(!/^[a-f0-9]{36}$/.test(key)){error='Confira o código enviado pela Libri.';render();return;}
    readForm();busy=true;error='';render();
    try{
      const status=await request('/api/v3/cart/black/status',{...cart,paymentMethod:form.paymentMethod,couponCode:form.couponCode,customer:{name:form.name,whatsapp:form.whatsapp,email:''},clientRequestId:key});
      if(status.claim?.status!=='reserved')throw Error('Não foi encontrada uma reserva válida para esse código.');
      keepV3CheckoutKey(key);attemptKey=key;blackClaim=status.claim;blackChecked=true;blackConflict=false;
    }catch(e){error=e.message;busy=false;render();return;}
    busy=false;render();await refresh({agenda:true});
  }
  render();refresh({agenda:!!form.eventDate});
}
