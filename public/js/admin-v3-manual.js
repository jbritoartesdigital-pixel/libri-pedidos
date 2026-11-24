import {api,esc,money,showToast,viewRoot,setViewMeta} from './admin-v2-core.js';
const names={convite:'Convite digital',identidade_visual:'Libri Ateliê',retrospectiva:'Retrospectiva'};
const eventTypes=[['birthday','Aniversário'],['15_years','15 anos'],['wedding','Casamento'],['celebration','Chá / Celebração'],['other','Outro']];
const endpoint='/api/admin/v2/orders/v3/manual/';
export async function renderV3ManualOrder(back){
 setViewMeta('Novo pedido V3','Monte a contratação e envie o link privado');
 const {result:catalog}=await api(endpoint+'catalog');
 const form={customer:{name:'',whatsapp:'',email:''},event:{type:'birthday',honoreeName:'',date:'',subtype:''},items:[],paymentMethod:'pix',depositPercent:100,couponCode:'',reason:''};
 let preview=null,busy=false,error='',key=null,created=null;
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
   const url=location.origin+created.customerAreaPath,wa=form.customer.whatsapp.replace(/\D/g,'');
   viewRoot.innerHTML='<section class="card"><h2>Pedido '+esc(created.orderCode)+' preparado</h2><p>O pagamento só fica disponível após o aceite da cliente.</p><label>Link privado <input readonly value="'+esc(url)+'" data-link></label><button data-action="copy" class="btn btn-secondary">Copiar link</button><a class="btn btn-primary" target="_blank" rel="noopener noreferrer" href="https://wa.me/'+esc(wa.length===10||wa.length===11?'55'+wa:wa)+'?text='+encodeURIComponent('Oi! Preparei seu pedido na Libri. Confira a proposta e conclua a contratação: '+url)+'">Enviar no WhatsApp</a><button data-action="back" class="btn btn-secondary">Voltar</button></section>';
   return;
  }
  viewRoot.innerHTML='<section class="card"><button class="btn btn-secondary" data-action="back">Voltar ao pedido manual clássico</button><h2>Dados da cliente</h2><div class="form-grid">'+['name','whatsapp','email'].map((k,i)=>'<label>'+['Nome','WhatsApp','E-mail'][i]+'<input data-contact="'+k+'" value="'+esc(form.customer[k])+'" class="input"></label>').join('')+'</div><h3>Comemoração</h3><label>Tipo <select data-event="type">'+eventTypes.map(([k,n])=>'<option value="'+k+'" '+(form.event.type===k?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+['honoreeName','date','subtype'].map((k,i)=>'<label>'+['Homenageado(a)','Data do evento','Detalhes do evento'][i]+'<input data-event="'+k+'" type="'+(k==='date'?'date':'text')+'" class="input" value="'+esc(form.event[k])+'"></label>').join('')+'</section>'+
  ['convite','identidade_visual','retrospectiva'].map(f=>{
    const old=form.items.find(x=>x.family===f),variants=catalog.variants.filter(v=>v.family===f),chosen=variants.find(v=>v.variantCode===old?.variantCode);
    return '<section class="card"><h3>'+names[f]+'</h3><label>Pacote <select data-family="'+f+'"><option value="">Não contratar</option>'+variants.map(v=>'<option value="'+esc(v.variantCode)+'" '+(v.variantCode===old?.variantCode?'selected':'')+'>'+esc(v.name+' · '+v.variantName)+' · '+money(v.priceCents)+'</option>').join('')+'</select></label>'+
    (chosen&&f==='convite'?'<details><summary>Adicionais do convite</summary>'+catalog.addons.map(a=>'<label class="checkline"><input type="checkbox" data-addon="'+esc(a.code)+'" '+(old.addonCodes.includes(a.code)?'checked':'')+'>'+esc(a.name)+' · '+money(a.priceCents)+'</label>').join('')+'</details>':'')+
    (chosen?.extras||[]).map(a=>'<label>'+esc(a.name)+' · '+money(a.priceCents)+'<input type="number" min="0" max="'+a.maxQuantity+'" data-extra="'+esc(a.code)+'" data-extra-family="'+f+'" value="'+(old?.extras.find(x=>x.code===a.code)?.quantity||0)+'"></label>').join('')+'</section>';
  }).join('')+
  '<section class="card"><h3>Pagamento</h3><label>Forma <select data-method><option value="pix" '+(form.paymentMethod==='pix'?'selected':'')+'>Pix integral</option><option value="card" '+(form.paymentMethod==='card'?'selected':'')+'>Cartão integral</option></select></label><label><input type="checkbox" data-half '+(form.depositPercent===50?'checked':'')+' '+(form.paymentMethod!=='pix'?'disabled':'')+'> Autorizar excepcionalmente 50% no Pix</label><label>Motivo da exceção / observação <input data-reason maxlength="500" value="'+esc(form.reason)+'"></label><label>Cupom <input data-coupon value="'+esc(form.couponCode)+'"></label><button data-action="preview" class="btn btn-secondary">Calcular e buscar janelas</button>'+
  (preview?'<p><strong>Total: '+money(preview.totalCents)+'</strong> · Entrada: '+money(preview.depositCents)+' · Saldo: '+money(preview.balanceCents)+'</p><p>Capacidade: '+preview.pointsUnits/100+' pontos</p><label>Previsão <select data-window><option value="">Escolha</option>'+preview.options.map((w,i)=>'<option value="'+i+'">'+esc(w.start+' a '+w.end)+'</option>').join('')+'</select></label><button data-action="create" class="btn btn-primary">Criar link privado</button>':'')+
  (error?'<p role="alert">'+esc(error)+'</p>':'')+'</section>';
  if(busy)viewRoot.querySelectorAll('button').forEach(b=>b.disabled=true);
 }
 let fingerprint=null;
 viewRoot.onchange=e=>{if(created||busy)return;read();if(e.target.matches('[data-family],[data-method],[data-half]')){preview=null;key=null;fingerprint=null;render();}};
 viewRoot.onclick=async e=>{
  const action=e.target.closest('[data-action]')?.dataset.action;if(!action||busy)return;
  if(action==='back'){viewRoot.onclick=null;viewRoot.onchange=null;await back();return;}
  if(action==='copy'){await navigator.clipboard.writeText(viewRoot.querySelector('[data-link]').value);showToast('Link copiado.');return;}
  read();
  const current=JSON.stringify(form);
  const chosen=viewRoot.querySelector('[data-window]')?.value,w=chosen!==undefined&&chosen!==''?preview?.options[Number(chosen)]:null;
  if(action==='create'&&(!preview||!w||current!==fingerprint)){showToast('Recalcule e escolha uma janela válida.');return;}
  if(action==='create'&&!confirm('Criar proposta de '+money(preview.totalCents)+' para aceite da cliente?'))return;
  busy=true;error='';render();
  try{
   if(action==='preview'){preview=(await api(endpoint+'preview',{method:'POST',body:current})).result;fingerprint=current;key=Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('');}
   else if(action==='create'){created=(await api(endpoint+'create',{method:'POST',body:JSON.stringify({...form,deliveryWindow:w,expectedTotalCents:preview.totalCents,requestKey:key,confirmed:true})})).result;}
  }catch(e){error=e.message;}finally{busy=false;render();}
 };
 render();
}
