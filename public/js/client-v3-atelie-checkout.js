// Compra do Ateliê dentro da V3: mesmo quote, agenda, termos e Mercado Pago da V2.
// Nenhum catálogo ou preço inventado; usa somente pacote explicitamente liberado.
const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
  .format(Number(cents||0)/100);
const field=(name,label,value,type='text',hint='')=>'<label class="v3-at-field">'+
  '<span>'+esc(label)+'</span><input '+(name==='email'?'':'required ')+'class="v3-at-input" name="'+name+'" type="'+type+
  '" value="'+esc(value||'')+'" '+(type==='tel'?'inputmode="tel"':'')+'>'+
  (hint?'<small>'+esc(hint)+'</small>':'')+'</label>';
async function api(path,body){
  const r=await fetch(path,body?{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{credentials:'same-origin'});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||data.message||'Não foi possível consultar agora.');
  return data;
}
export function mountAtelieCheckout(root,{item,eventType,onBack}) {
  if(!item?.purchaseAvailable||!item?.variantCode||!item?.specificTerms)
    throw new Error('Este pacote ainda não está disponível para compra.');
  const order={
    customer:{name:'',whatsapp:'',email:''},
    event:{honoreeName:'',type:eventType||'other',date:'',subtype:''},
    selection:{productCode:'atelie_'+item.code,variantCode:item.variantCode,
      addonCodes:[],comboCode:'',couponCode:'',paymentMethod:'pix'},
    deliveryWindow:null,
    clientRequestId:'atelie_'+crypto.randomUUID()
  };
  let quote=null,terms=null,options=[],busy=false,stage='contact';
  const help=(message,invalid=false)=>{
    const target=root.querySelector('[data-at-help]');
    if(target){target.textContent=message;target.style.color=invalid?'#b12449':'';}
  };
  function frame(title,subtitle,body){
    root.innerHTML='<section class="v3-panel"><span class="v3-eyebrow">Libri Ateliê · contratação</span>'+
      '<h1 class="v3-title">'+esc(title)+'</h1><p class="v3-text">'+esc(subtitle)+'</p>'+
      '<div class="v3-notice"><strong>'+esc(item.name)+'</strong> · '+money(item.priceCents)+
      '<p>Identidade visual digital personalizada, sem impressão ou fabricação física.</p></div>'+
      body+'<p class="v3-mini" data-at-help role="status"></p></section>';
    root.setAttribute('aria-busy','false');
  }
  function renderContact(){
    stage='contact';
    frame('Vamos preparar seu pedido','Primeiro, os dados básicos. A parte criativa será preenchida depois do pagamento.',
      '<form id="atContactForm" class="v3-at-form">'+
      field('honoreeName','Nome da pessoa ou celebração',order.event.honoreeName)+
      field('date','Data da festa',order.event.date,'date')+
      field('name','Seu nome',order.customer.name)+
      field('whatsapp','WhatsApp com DDD',order.customer.whatsapp,'tel')+
      field('email','E-mail para acompanhamento (opcional)',order.customer.email,'email')+
      '<div class="v3-action-row"><button type="button" class="v3-btn v3-btn-text" id="atBack">Voltar aos pacotes</button>'+
      '<button type="submit" class="v3-btn v3-btn-primary">Conferir prazo e pagamento</button></div></form>');
    root.querySelector('#atBack').addEventListener('click',onBack);
    root.querySelector('#atContactForm').addEventListener('submit',async ev=>{
      ev.preventDefault();if(busy)return;
      const form=new FormData(ev.currentTarget);
      const value=k=>String(form.get(k)||'').trim();
      Object.assign(order.event,{honoreeName:value('honoreeName'),date:value('date')});
      Object.assign(order.customer,{name:value('name'),whatsapp:value('whatsapp').replace(/\D/g,''),email:value('email')});
      if(order.customer.whatsapp.length<10||order.customer.whatsapp.length>15)
        return help('Confira seu WhatsApp com DDD.',true);
      if(!order.event.honoreeName||!order.event.date||!order.customer.name)
        return help('Preencha os dados obrigatórios.',true);
      busy=true;const btn=root.querySelector('[type=submit]');btn.disabled=true;help('Conferindo a agenda real…');
      try{
        const [d,t,q]=await Promise.all([
          api('/api/v2/delivery-options',{eventType:order.event.type,eventDate:order.event.date,
            selection:order.selection,limit:8}),
          api('/api/v2/terms/current'),
          api('/api/v2/quote',{eventType:order.event.type,selection:order.selection})
        ]);
        quote=q.quote;terms=t.terms;options=d.delivery?.options||[];
        if(!options.length){
          help('Não há uma janela automática disponível para esta data. A Libri precisa avaliar um prazo especial antes de aceitar o pagamento.',true);
          btn.disabled=false;busy=false;return;
        }
        order.deliveryWindow=options.find(o=>o.recommended)||options[0];
        renderPayment();
      }catch(e){help(e.message,true);btn.disabled=false;}
      finally{busy=false;}
    });
  }
  function renderPayment(){
    stage='payment';
    if(!quote||!terms)return renderContact();
    const extra=quote.variant?.config?.atelie||{};
    const dates=options.map((o,i)=>'<option value="'+i+'" '+
      (order.deliveryWindow?.start===o.start&&order.deliveryWindow?.end===o.end?'selected':'')+'>'+
      esc(o.start)+' a '+esc(o.end)+(o.recommended?' · sugerido':'')+'</option>').join('');
    const includes=(item.includedItems||[]).map(x=>'<li>'+esc(x)+'</li>').join('');
    frame('Revise sua identidade visual','Valor total do pacote, prazo e condições antes de pagar.',
      '<div class="v3-at-summary"><h2>'+esc(item.name)+'</h2>'+
      '<ul>'+includes+'</ul>'+
      '<p><strong>Apresentação visual e simulação conceitual de decoração incluídas.</strong></p>'+
      '<p>Não inclui impressão, montagem, convites digitais ou itens fora do pacote.</p>'+
      '<p>Pedido para: '+esc(order.event.honoreeName)+' · festa '+esc(order.event.date)+'</p>'+
      '<strong>Total no '+(order.selection.paymentMethod==='pix'?'Pix':'cartão')+': '+money(quote.totalCents)+'</strong>'+
      (quote.cardFeeCents?'<p>Acréscimo do cartão: '+money(quote.cardFeeCents)+'</p>':'')+
      '</div>'+
      '<div class="v3-at-form"><label class="v3-at-field"><span>Prazo de entrega disponível</span>'+
      '<select id="atWindow" class="v3-at-input">'+dates+'</select></label>'+
      '<label class="v3-at-field"><span>Como prefere pagar?</span>'+
      '<select id="atPayment" class="v3-at-input"><option value="pix" '+(order.selection.paymentMethod==='pix'?'selected':'')+'>Pix · 100% antecipado</option>'+
      '<option value="card" '+(order.selection.paymentMethod==='card'?'selected':'')+'>Cartão · 100% antecipado</option></select></label>'+
      '<details><summary>Condições gerais do pedido (versão '+esc(terms.version)+')</summary>'+
      '<pre class="v3-at-terms">'+esc(terms.body)+'</pre></details>'+
      '<details open><summary>Condições específicas do Libri Ateliê</summary>'+
      '<div class="v3-at-terms">'+esc(extra.specificTerms||item.specificTerms)+'</div></details>'+
      '<label class="v3-at-check"><input id="atAgreeGeneral" type="checkbox"> Li e aceito as condições gerais.</label>'+
      '<label class="v3-at-check"><input id="atAgreeSpecific" type="checkbox"> Li e aceito o escopo e as condições do Ateliê.</label>'+
      '<p class="v3-mini">Após o pagamento confirmado, você preencherá o briefing criativo em seu próprio pedido.</p>'+
      '<div class="v3-action-row"><button type="button" class="v3-btn v3-btn-text" id="atEdit">Editar dados</button>'+
      '<button type="button" class="v3-btn v3-btn-primary" id="atPay">Ir para pagamento</button></div></div>');
    root.querySelector('#atEdit').addEventListener('click',renderContact);
    root.querySelector('#atWindow').addEventListener('change',e=>{
      order.deliveryWindow=options[Number(e.target.value)]||options[0];
    });
    root.querySelector('#atPayment').addEventListener('change',async e=>{
      const previous=order.selection.paymentMethod;
      order.selection.paymentMethod=e.target.value;
      help('Recalculando o valor oficial…');
      try {
        const value=await api('/api/v2/quote',{eventType:order.event.type,selection:order.selection});
        quote=value.quote;renderPayment();
      }catch(err){order.selection.paymentMethod=previous;help(err.message,true);}
    });
    root.querySelector('#atPay').addEventListener('click',async()=>{
      if(busy)return;
      if(!root.querySelector('#atAgreeGeneral').checked||!root.querySelector('#atAgreeSpecific').checked)
        return help('Leia e aceite as duas condições do pedido para continuar.',true);
      if(!order.deliveryWindow)return help('Escolha uma janela de entrega.',true);
      busy=true;
      // Abrir aba de pagamento no clique real para iPhone/Safari, antes do await.
      const payTab=window.open('about:blank','_blank');
      const button=root.querySelector('#atPay');button.disabled=true;help('Criando seu pedido no Mercado Pago…');
      try{
        const updated=await api('/api/v2/quote',{eventType:order.event.type,selection:order.selection});
        if(updated.quote.totalCents!==quote.totalCents)
          throw new Error('O valor foi atualizado. Revise o total antes de continuar.');
        const specific=updated.quote.variant?.config?.atelie;
        if(!specific||specific.termsVersion!==(quote.variant?.config?.atelie?.termsVersion))
          throw new Error('As condições do pacote mudaram. Atualize os detalhes antes de pagar.');
        const result=await api('/api/v2/checkout/start',{
          clientRequestId:order.clientRequestId,customer:order.customer,event:order.event,
          selection:order.selection,deliveryWindow:order.deliveryWindow,
          termsAccepted:true,termsVersion:terms.version,
          atelieTermsAccepted:true,atelieTermsVersion:specific.termsVersion
        });
        if(!result.payment?.checkoutUrl)throw new Error('Não foi possível abrir o Mercado Pago.');
        if(payTab&&!payTab.closed) {
          payTab.location.replace(result.payment.checkoutUrl);
          window.location.assign(result.order.customerAreaPath);
        } else {
          window.location.assign(result.payment.checkoutUrl);
        }
      }catch(e){
        if(payTab&&!payTab.closed)payTab.close();
        help(e.message,true);button.disabled=false;
      }finally{busy=false;}
    });
  }
  renderContact();
}
