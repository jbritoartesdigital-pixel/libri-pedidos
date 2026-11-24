// Prévia visual isolada: NÃO usa banco, sorteio, carrinho ou Mercado Pago.
// Compartilhada entre Loja > Black Libri e simulador do pedido.
const colors=['#c88ca4','#edc5d0','#c9a46e','#a56786',
 '#e2bbaf','#d398ae','#af7591','#eed6b3',
 '#bb7996','#e7b6c7','#c8a575','#d4a4b7'];

async function ensureStyle() {
  if(document.getElementById('blackLibriClientStyles')) return;
  const link=document.createElement('link');
  link.id='blackLibriClientStyles';
  link.rel='stylesheet';
  link.href='/css/client-v2-black-libri.css?v=95-studio';
  await new Promise(resolve=>{
    link.onload=resolve;link.onerror=resolve;
    document.head.appendChild(link);
  });
}

export async function openBlackLibriDemo({onContinue=null,continueLabel='Continuar teste do briefing'}={}) {
  await ensureStyle();
  const overlay=document.createElement('div');
  overlay.className='black-libri-overlay';
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  document.body.appendChild(overlay);
  let chosen=-1,closed=false,soundOn=true;
  const finish=({continueFlow=false}={})=>{
    if(closed)return;
    closed=true;
    document.body.style.overflow=previousOverflow;
    document.removeEventListener('keydown',onEscape);
    overlay.remove();
    if(continueFlow && typeof onContinue==='function') onContinue();
  };
  const onEscape=e=>{if(e.key==='Escape')finish();};
  document.addEventListener('keydown',onEscape);
  const paint=()=>{
    if(closed)return;
    overlay.innerHTML=`
      <section class="black-libri-panel" role="dialog" aria-modal="true"
        aria-labelledby="blackLibriDemoTitle">
        <button class="black-libri-close" type="button" aria-label="Fechar prévia">×</button>
        <div class="black-libri-brand-slot"><span class="black-libri-brand">LIBRI CONVITES</span></div>
        <span class="black-libri-kicker">UMA SURPRESA DA LIBRI</span>
        <div class="black-libri-campaign">BLACK <em>LIBRI</em></div>
        
        <h2 class="black-libri-heading" id="blackLibriDemoTitle">
          ${chosen<0?'Escolha seu balão!':'VOCÊ GANHOU!'}
        </h2>
        <p class="black-libri-subtitle">
          ${chosen<0
            ? 'Escolha um balão e toque para revelar seu presente.'
            : 'Surpresa para você!'}
        </p>
        ${chosen<0?'<div class="black-libri-grid">'+colors.map((color,index)=>`
          <button type="button" class="black-libri-balloon"
            data-demo-slot="${index}" style="--balloon:${color};--slot:${index}"
            aria-label="Estourar balão ${index+1}">
            <span class="bulb"></span><span class="knot"></span><span class="string"></span>
          </button>`).join('')+`</div><button type="button" class="black-libri-sound" data-demo-sound
            aria-pressed="${soundOn}">${soundOn?'♪ Som ligado':'♪ Som desligado'}</button>`:`
          <div class="black-libri-result" role="status">
            <span aria-hidden="true">🎁</span>
            <small>SEU PRESENTE</small><strong>Save the Date estático</strong>
            <p>Prêmio ilustrativo. Nesta demonstração, nada é reservado, cobrado ou salvo.</p>
          </div>
          <button type="button" class="black-libri-button" data-demo-continue>
            ${onContinue?continueLabel==='Concluir simulação'?'Concluir simulação':'Continuar teste do briefing':'Fechar prévia'}
          </button>
        `}
        <p class="black-libri-foot">MODO DE TESTE • Sem participação real • Sem pagamento</p>
      </section>`;
    overlay.querySelector('.black-libri-close')?.addEventListener('click',()=>finish());
    overlay.querySelector('[data-demo-sound]')?.addEventListener('click',event=>{
      soundOn=!soundOn;
      event.currentTarget.setAttribute('aria-pressed',String(soundOn));
      event.currentTarget.textContent=soundOn?'♪ Som ligado':'♪ Som desligado';
    });
    overlay.querySelectorAll('[data-demo-slot]').forEach(button=>{
      button.addEventListener('click',()=>{
        if(chosen>=0)return;
        chosen=Number(button.dataset.demoSlot);
        button.classList.add('chosen');
        for(const b of overlay.querySelectorAll('[data-demo-slot]'))b.disabled=true;
        // Demonstração não chama o sorteio real. O som depende do toque.
        if(soundOn){
          try{
            const Ctx=window.AudioContext||window.webkitAudioContext;
            if(Ctx){
              const ctx=new Ctx(),t=ctx.currentTime;
              if(ctx.state==='suspended')void ctx.resume().catch(()=>{});
              const oscillator=ctx.createOscillator(),gain=ctx.createGain();
              oscillator.type='sine';
              oscillator.frequency.setValueAtTime(155,t);
              oscillator.frequency.exponentialRampToValueAtTime(68,t+.1);
              gain.gain.setValueAtTime(.12,t);
              gain.gain.exponentialRampToValueAtTime(.001,t+.11);
              oscillator.connect(gain);gain.connect(ctx.destination);
              oscillator.start(t);oscillator.stop(t+.11);
              window.setTimeout(()=>void ctx.close().catch(()=>{}),350);
            }
          }catch{/* Som opcional */ }
        }
        window.setTimeout(()=>{paint();overlay.querySelector('[data-demo-continue]')?.focus();},650);
      });
    });
    overlay.querySelector('[data-demo-continue]')?.addEventListener('click',
      ()=>finish({continueFlow:true}));
  };
  paint();
  overlay.querySelector('.black-libri-close')?.focus();
}
