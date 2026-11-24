import {api,esc,money,showToast,viewRoot,setViewMeta} from './admin-v2-core.js';
const names={convite:'Convite digital',identidade_visual:'Libri Ateliê',retrospectiva:'Retrospectiva'};
const eventTypes=[['birthday','Aniversário'],['15_years','15 anos'],['wedding','Casamento'],['celebration','Chá / Celebração'],['other','Outro']];
const brDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):String(value||'');
function isoDate(value){
 const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value||''));
 if(!m)return '';
 const iso=m[3]+'-'+m[2]+'-'+m[1],d=new Date(iso+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===iso?iso:'';
}
function dateField(attr,key,value){
 return '<span class="manual-br-date"><input type="text" '+attr+'="'+key+'" data-date-text="'+attr+'-'+key+'" class="input" inputmode="numeric" maxlength="10" placeholder="DD/MM/AAAA" value="'+esc(brDate(value))+'"><span class="manual-date-calendar"><span aria-hidden="true">▦</span><input type="date" aria-label="Abrir calendário" data-native-date="'+attr+'-'+key+'" value="'+esc(isoDate(value))+'"></span></span>';
}
const endpoint='/api/admin/v2/orders/v3/manual/';
export async function renderV3ManualOrder(back){
 setViewMeta('Novo pedido','Monte a contratação e envie o link privado');
 const {result:catalog}=await api(endpoint+'catalog');
 const form={customer:{name:'',whatsapp:'+55 ',email:''},event:{type:'birthday',honoreeName:'',date:'',subtype:''},items:[],paymentMethod:'pix',depositPercent:100,couponCode:'',reason:''};
 let preview=null,busy=false,error='',key=null,created=null;
 let delivery={start:'',end:''};
 function read(){
  for(const k of ['name','whatsapp','email'])form.customer[k]=viewRoot.querySelector('[data-contact="'+k+'"]')?.value||'';
  for(const k of ['type','honoreeName','date','subtype'])form.event[k]=viewRoot.querySelector('[data-event="'+k+'"]')?.value||'';
  form.paymentMethod=viewRoot.querySelector('[data-method]').value;form.depositPercent=form.paymentMethod==='pix'&&viewRoot.querySelector('[data-half]').checked?50:100;
  form.couponCode=viewRoot.querySelector('[data-coupon]').value.trim();form.reason=viewRoot.querySelector('[data-reason]').value.trim();
  form.items=Array.from(viewRoot.querySelectorAll('[data-family]')).flatMap(el=>{
   const v=catalog.variants.find(x=>x.variantCode===el.value&&x.family===el.dataset.family);if(!v)return [];
   return [{family:v.family,productCode:v.productCode,variantCode:v.variantCode,addonCodes:v.family==='convite'?Array.from(viewRoot.querySelectorAll('[data-addon]:checked')).map(x=>x.dataset.addon):[],extras:Array.from(viewRoot.querySelectorAll('[data-extra-family="'+v.family+'"]')).map(x=>({code:x.dataset.extra,quantity:Number(x.value)})).filter(x=>x.quantity>0)}];
  });
 }
 function render(){
  if(created){
   const url=location.origin+created.customerAreaPath,raw=form.customer.whatsapp.trim(),digits=raw.replace(/\D/g,''),wa=!raw.startsWith('+')&&[10,11].includes(digits.length)&&!digits.startsWith('55')?'55'+digits:digits;
   viewRoot.innerHTML='<section class="card"><h2>Pedido '+esc(created.orderCode)+' preparado</h2><p>A cliente pode incluir adicionais, conferir o carrinho, aceitar os termos e pagar.</p><label>Link privado <input readonly value="'+esc(url)+'" data-link></label><button data-action="copy" class="btn btn-secondary">Copiar link</button><a class="btn btn-primary" target="_blank" rel="noopener noreferrer" href="https://wa.me/'+esc(wa)+'?text='+encodeURIComponent('Oi! Preparei seu pedido na Libri. Confira a proposta e conclua a contratação: '+url)+'">Enviar no WhatsApp</a><button data-action="back" class="btn btn-secondary">Voltar</button></section>';
   return;
  }
  viewRoot.innerHTML='<section class="card admin-manual-integrated"><div class="section-title"><h2>Dados da cliente</h2><button class="btn btn-ghost" data-action="back">Pedido manual clássico</button></div><div class="form-grid">'+['name','whatsapp','email'].map((k,i)=>'<label>'+['Nome','WhatsApp com código do país','E-mail (opcional)'][i]+'<input data-contact="'+k+'" '+(k==='whatsapp'?'type="tel" inputmode="tel" placeholder="+55 61 99999-9999 ou +351 ..."':'')+' value="'+esc(form.customer[k])+'" class="input">'+(k==='whatsapp'?'<small>Troque +55 pelo código do país da cliente, se necessário.</small>':'')+ '</label>').join('')+'</div><h3>Comemoração</h3><label>Tipo <select class="select" data-event="type">'+eventTypes.map(([k,n])=>'<option value="'+k+'" '+(form.event.type===k?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+['honoreeName','date','subtype'].map((k,i)=>'<label>'+['Homenageado(a)','Data do evento','Detalhes do evento'][i]+(k==='date'?dateField('data-event',k,form.event[k]):'<input data-event="'+k+'" type="text" class="input" value="'+esc(form.event[k])+'">')+'</label>').join('')+'<h3>Entrega</h3><p class="muted">Escolha as datas que combinou com a cliente. A agenda sugere janelas, mas você pode informar outra.</p><div class="form-grid"><label>Início da entrega '+dateField('data-delivery','start',delivery.start)+'</label><label>Fim da entrega '+dateField('data-delivery','end',delivery.end)+'</label></div></section>'+
  ['convite','identidade_visual','retrospectiva'].map(f=>{
    const old=form.items.find(x=>x.family===f),variants=catalog.variants.filter(v=>v.family===f),chosen=variants.find(v=>v.variantCode===old?.variantCode);
    return '<section class="card"><h3>'+names[f]+'</h3><label>Pacote <select class="select" data-family="'+f+'"><option value="">Não contratar</option>'+variants.map(v=>'<option value="'+esc(v.variantCode)+'" '+(v.variantCode===old?.variantCode?'selected':'')+'>'+esc(v.name+' · '+v.variantName)+' · '+money(v.priceCents)+'</option>').join('')+'</select></label>'+
    (chosen&&f==='convite'?'<details><summary>Adicionais do convite</summary>'+catalog.addons.map(a=>'<label class="checkline"><input type="checkbox" data-addon="'+esc(a.code)+'" '+(old.addonCodes.includes(a.code)?'checked':'')+'>'+esc(a.name)+' · '+money(a.priceCents)+'</label>').join('')+'</details>':'')+
    (chosen?.extras||[]).map(a=>'<label>'+esc(a.name)+' · '+money(a.priceCents)+'<input class="input" type="number" min="0" max="'+a.maxQuantity+'" data-extra="'+esc(a.code)+'" data-extra-family="'+f+'" value="'+(old?.extras.find(x=>x.code===a.code)?.quantity||0)+'"></label>').join('')+'</section>';
  }).join('')+
  '<section class="card"><h3>Pagamento</h3><label>Forma <select class="select" data-method><option value="pix" '+(form.paymentMethod==='pix'?'selected':'')+'>Pix integral</option><option value="card" '+(form.paymentMethod==='card'?'selected':'')+'>Cartão integral</option></select></label><label><input type="checkbox" data-half '+(form.depositPercent===50?'checked':'')+' '+(form.paymentMethod!=='pix'?'disabled':'')+'> Autorizar excepcionalmente 50% no Pix</label><label>Motivo da exceção / observação <input class="input" data-reason maxlength="500" value="'+esc(form.reason)+'"></label><label>Cupom <input class="input" data-coupon value="'+esc(form.couponCode)+'"></label><button data-action="preview" class="btn btn-secondary">Calcular e buscar janelas</button>'+
  (preview?'<p><strong>Total: '+money(preview.totalCents)+'</strong> · Entrada: '+money(preview.depositCents)+' · Saldo: '+money(preview.balanceCents)+'</p><p>Capacidade: '+preview.pointsUnits/100+' pontos</p><label>Sugestões da agenda (opcional) <select class="select" data-window><option value="">Usar as datas que informei</option>'+preview.options.map((w,i)=>'<option value="'+i+'">'+(w.recommended?'Recomendada · ':'')+esc(brDate(w.start)+' a '+brDate(w.end))+'</option>').join('')+'</select></label><button data-action="create" class="btn btn-primary">Criar link privado</button>':'')+
  (error?'<p role="alert">'+esc(error)+'</p>':'')+'</section>';
  if(busy)viewRoot.querySelectorAll('button').forEach(b=>b.disabled=true);
 }
 let fingerprint=null;
 viewRoot.oninput=e=>{if(!e.target.matches('[data-date-text]'))return;const d=e.target.value.replace(/\D/g,'').slice(0,8);const masked=[d.slice(0,2),d.slice(2,4),d.slice(4)].filter(Boolean).join('/');if(e.target.value!==masked)e.target.value=masked;const native=viewRoot.querySelector('[data-native-date="'+e.target.dataset.dateText+'"]');if(native)native.value=isoDate(masked);};
 viewRoot.onchange=e=>{if(created||busy)return;if(e.target.matches('[data-native-date]')){const input=viewRoot.querySelector('[data-date-text="'+e.target.dataset.nativeDate+'"]');if(input){input.value=brDate(e.target.value);input.dispatchEvent(new Event('change',{bubbles:true}));}return;}if(e.target.matches('[data-delivery]')){delivery[e.target.dataset.delivery]=e.target.value;const select=viewRoot.querySelector('[data-window]');if(select)select.value='';return;}if(e.target.matches('[data-window]')){const w=e.target.value!==''?preview?.options[Number(e.target.value)]:null;if(w){delivery={start:brDate(w.start),end:brDate(w.end)};for(const k of ['start','end']){viewRoot.querySelector('[data-delivery="'+k+'"]').value=delivery[k];viewRoot.querySelector('[data-native-date="data-delivery-'+k+'"]').value=isoDate(delivery[k]);}}return;}read();if(e.target.matches('[data-family],[data-method],[data-half]')){preview=null;key=null;fingerprint=null;render();}else if(preview&&JSON.stringify(form)!==fingerprint){preview=null;key=null;fingerprint=null;render();}};
 viewRoot.onclick=async e=>{
  const action=e.target.closest('[data-action]')?.dataset.action;if(!action||busy)return;
  if(action==='back'){viewRoot.onclick=null;viewRoot.onchange=null;viewRoot.oninput=null;await back();return;}
  if(action==='copy'){await navigator.clipboard.writeText(viewRoot.querySelector('[data-link]').value);showToast('Link copiado.');return;}
  read();
  const current=JSON.stringify(form);
  for(const k of ['start','end'])delivery[k]=viewRoot.querySelector('[data-delivery="'+k+'"]')?.value||'';
  const w=isoDate(delivery.start)&&isoDate(delivery.end)?{start:isoDate(delivery.start),end:isoDate(delivery.end)}:null;
  const eventDate=isoDate(form.event.date);
  if(!eventDate){showToast('Informe uma data de evento válida (DD/MM/AAAA).');return;}
  const payload={...form,event:{...form.event,date:eventDate}};
  
  if(action==='create'&&(!preview||!w||current!==fingerprint)){showToast('Calcule o pedido e informe as datas de entrega.');return;}
  if(action==='create'&&!confirm('Criar pedido de '+money(preview.totalCents)+' e gerar o link de pagamento?'))return;
  busy=true;error='';render();
  try{
   if(action==='preview'){preview=(await api(endpoint+'preview',{method:'POST',body:JSON.stringify(payload)})).result;fingerprint=current;key=Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('');}
   else if(action==='create'){created=(await api(endpoint+'create',{method:'POST',body:JSON.stringify({...payload,deliveryWindow:w,expectedTotalCents:preview.totalCents,requestKey:key,confirmed:true})})).result;}
  }catch(e){error=e.message;}finally{busy=false;render();}
 };
 render();
}
