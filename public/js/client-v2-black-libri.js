import {api,esc,money,showToast} from './client-v2-core.js';

const palette=[
 '#ad6b83','#d7a2b1','#bc8196','#e0b3be',
 '#b2768e','#c88ea3','#9e637c','#e9c2c9',
 '#b98295','#d6a6b4','#bc849f','#dbb0bc'
];

async function ensureStyles(){
 if(document.getElementById('blackLibriClientStyles'))return;
 const link=document.createElement('link');
 link.id='blackLibriClientStyles';link.rel='stylesheet';
 link.href='/css/client-v2-black-libri.css?v=20261110-rose-1';
 await new Promise(resolve=>{link.onload=resolve;link.onerror=resolve;document.head.appendChild(link);});
}

// Áudio sintético acionado exclusivamente por toque. Sem músicas ou MP3.
function playBalloonPop(enabled=true){
 if(!enabled)return;
 const Ctx=window.AudioContext||window.webkitAudioContext;
 if(!Ctx)return;
 try{
  const ctx=new Ctx();
  if(ctx.state==='suspended')void ctx.resume().catch(()=>{});
  const t=ctx.currentTime,duration=.13;
  const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate);
  const values=buffer.getChannelData(0);
  for(let i=0;i<values.length;i++)values[i]=(Math.random()*2-1)*Math.pow(1-i/values.length,3);
  const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
  noise.buffer=buffer;filter.type='highpass';filter.frequency.value=550;
  gain.gain.setValueAtTime(.11,t);gain.gain.exponentialRampToValueAtTime(.001,t+duration);
  noise.connect(filter);filter.connect(gain);gain.connect(ctx.destination);
  noise.start(t);noise.stop(t+duration);
  const tone=ctx.createOscillator(),toneGain=ctx.createGain();
  tone.type='sine';tone.frequency.setValueAtTime(150,t);
  tone.frequency.exponentialRampToValueAtTime(65,t+.08);
  toneGain.gain.setValueAtTime(.08,t);toneGain.gain.exponentialRampToValueAtTime(.001,t+.09);
  tone.connect(toneGain);toneGain.connect(ctx.destination);
  tone.start(t);tone.stop(t+.09);
  window.setTimeout(()=>void ctx.close().catch(()=>{}),380);
 }catch{/* Navegador sem áudio não bloqueia o sorteio. */}
}

function prizePanel(claim,quote,{readonly=false,paid=false}={}){
 if(!claim)return '';
 const expired=!readonly&&claim.status==='expired';
 const redeemed=paid||claim.status==='redeemed';
 const discount=Number(quote?.blackLibriDiscountCents||claim.creditCents||0);
 const note=expired?'O prazo desta surpresa terminou.':
  readonly||redeemed||claim.status==='attached'?'Seu benefício já está vinculado ao pedido.':
  'Seu presente fica reservado por 24 horas.';
 return `<div class="black-libri-result" role="status">
  <span aria-hidden="true">${expired?'⌛':'✦'}</span>
  <small>VOCÊ GANHOU!</small>
  <strong>${esc(claim.label||'Presente especial')}</strong>
  ${claim.description?`<p>${esc(claim.description)}</p>`:''}
  <p>${note}</p>
  ${!expired&&discount>0?`<p class="black-libri-saved">
    ${claim.convertedToDiscount?'Crédito aplicado: ':'Desconto aplicado: '}${money(discount)}
  </p>`:''}
  ${quote?.totalCents!=null&&!expired&&!redeemed?`
    <p class="black-libri-saved">Total do convite: ${money(quote.totalCents)}</p>
  `:''}
 </div>`;
}

function overlayShell(){
 const overlay=document.createElement('div');
 overlay.className='black-libri-overlay';overlay.setAttribute('role','presentation');
 const previousOverflow=document.body.style.overflow;
 const priorFocus=document.activeElement;
 document.body.style.overflow='hidden';document.body.appendChild(overlay);
 let closed=false,canClose=()=>true;
 const close=()=>{
  if(closed||!canClose())return;
  closed=true;document.body.style.overflow=previousOverflow;
  document.removeEventListener('keydown',onEscape);overlay.remove();
  if(priorFocus?.isConnected)priorFocus.focus();
 };
 const onEscape=e=>{if(e.key==='Escape')close();};
 document.addEventListener('keydown',onEscape);
 return {overlay,close,isClosed:()=>closed,setCanClose:fn=>{canClose=fn;}};
}

function brandHeader(title,subtitle){
 return `<span class="black-libri-brand">Libri Convites</span>
  <span class="black-libri-kicker">BLACK LIBRI · EDIÇÃO ESPECIAL</span>
  <h2 class="black-libri-heading" id="blackLibriTitle">${title}</h2>
  <p class="black-libri-subtitle">${subtitle}</p>`;
}

// Modal de consulta: lê o benefício salvo no pedido, nunca sorteia novamente.
export async function openBlackLibriPrizeDetails(prize,{paid=false}={}){
 if(!prize?.label)return;
 await ensureStyles();
 const {overlay,close}=overlayShell();
 overlay.innerHTML=`<section class="black-libri-panel" role="dialog" aria-modal="true"
    aria-labelledby="blackLibriTitle">
   <button class="black-libri-close" type="button" aria-label="Fechar presente">×</button>
   ${brandHeader('Seu presente especial!','Você pode consultar sua surpresa sempre que quiser.')}
   ${prizePanel({...prize,status:paid?'redeemed':'attached'},
    {blackLibriDiscountCents:Number(prize.creditCents||0)},{readonly:true,paid})}
   <button type="button" class="black-libri-secondary" data-black-close>
      Voltar ao meu pedido
   </button>
   <p class="black-libri-foot">Este benefício permanece vinculado ao pedido.</p>
 </section>`;
 overlay.querySelector('.black-libri-close')?.addEventListener('click',close);
 overlay.querySelector('[data-black-close]')?.addEventListener('click',close);
 overlay.querySelector('.black-libri-close')?.focus();
}

// Mantém o callback de pagamento e a seleção criptográfica no servidor.
export async function openBlackLibriBeforePayment({
 customer,clientRequestId,selection,event,onContinue,manualToken=null,manualSelection=null
}){
 const endpoint=manualToken
  ?'/api/v2/manual-order/'+encodeURIComponent(manualToken)+'/black-libri'
  :'/api/v2/black-libri';
 const payload=manualToken?{...(manualSelection||{})}:{customer,clientRequestId,selection,event};
 let response=await api(endpoint+'/status',{method:'POST',body:JSON.stringify(payload)});
 if(!response.enabled){onContinue();return;}
 await ensureStyles();
 let claim=response.claim||null,quote=null,active=false,chosen=-1,soundOn=true;
 const {overlay,close,isClosed,setCanClose}=overlayShell();
 setCanClose(()=>!active);
 const preview=async()=>{
  if(!claim||claim.status==='expired'||claim.status==='redeemed')return;
  try{
   const result=await api(endpoint+'/preview',{method:'POST',body:JSON.stringify(payload)});
   quote=result.quote||null;
  }catch(error){quote=null;showToast(error.message||'Não foi possível conferir o valor do presente.');}
 };
 const paint=()=>{
  if(isClosed())return;
  const selected=!!claim;
  const balloons=palette.map((color,i)=>`
   <button class="black-libri-balloon" type="button"
    style="--balloon:${color};--slot:${i}" data-black-slot="${i}"
    aria-label="Estourar balão ${i+1}" ${selected||active?'disabled':''}>
    <span class="bulb"></span><span class="string"></span>
   </button>`).join('');
  const label=claim?.status==='expired'?'Continuar sem brinde':
   ['attached','redeemed'].includes(claim?.status)?'Continuar para meu pedido':'Resgatar meu presente';
  overlay.innerHTML=`<section class="black-libri-panel" role="dialog" aria-modal="true"
   aria-labelledby="blackLibriTitle">
   <button class="black-libri-close" type="button" aria-label="Fechar">×</button>
   ${brandHeader(selected?'Seu presente especial!':'Escolha seu balão!',
    selected?'Surpresa para você! O seu presente já está registrado.':'Toque em um dos 12 balões rosé para descobrir seu presente.')}
   ${selected?prizePanel(claim,quote):`
    <div class="black-libri-grid" aria-label="Doze balões rosé">${balloons}</div>
    <button type="button" class="black-libri-sound" data-black-sound
       aria-pressed="${soundOn}">${soundOn?'♪ Som ligado':'♪ Som desligado'}</button>
   `}
   ${selected?`
    <button class="black-libri-button" type="button" data-black-continue
      ${active||(claim.status==='reserved'&&!quote)?'disabled':''}>${label}</button>
    <p class="black-libri-foot">${claim.status==='expired'
     ?'Seu prêmio anterior não será substituído.':
     'Continue para vincular o benefício ao pedido e ao pagamento.'}</p>
   `:''}
   <p class="black-libri-foot">Seu presente fica registrado · Reserva de 24 horas ♡</p>
  </section>`;
  overlay.querySelector('.black-libri-close')?.addEventListener('click',close);
  overlay.querySelector('[data-black-sound]')?.addEventListener('click',e=>{
   soundOn=!soundOn;e.currentTarget.setAttribute('aria-pressed',String(soundOn));
   e.currentTarget.textContent=soundOn?'♪ Som ligado':'♪ Som desligado';
  });
  overlay.querySelectorAll('[data-black-slot]').forEach(button=>button.addEventListener('click',async()=>{
   if(active||claim)return;
   active=true;chosen=Number(button.dataset.blackSlot);
   button.classList.add('chosen');
   overlay.querySelectorAll('[data-black-slot]').forEach(b=>b.disabled=true);
   playBalloonPop(soundOn);
   try{
    const [reveal]=await Promise.all([
     api(endpoint+'/reveal',{method:'POST',body:JSON.stringify({...payload,balloon:chosen})}),
     new Promise(resolve=>window.setTimeout(resolve,500))
    ]);
    claim=reveal.claim;
    await preview();
   }catch(error){
    chosen=-1;showToast(error.message||'Não conseguimos revelar seu presente.');
   }finally{active=false;paint();}
  }));
  overlay.querySelector('[data-black-continue]')?.addEventListener('click',()=>{
   if(active||(claim?.status==='reserved'&&!quote))return;
   close();onContinue(claim);
  });
 };
 if(claim)await preview();
 paint();overlay.querySelector('.black-libri-close')?.focus();
}
