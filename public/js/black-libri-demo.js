// Prévia visual isolada: NÃO usa banco, sorteio, carrinho ou Mercado Pago.
// Compartilhada entre Loja > Black Libri e simulador do pedido.
const colors=['#e9b25d','#d5a1b7','#a48bd0','#111017',
 '#e6bb8c','#c489aa','#b29edb','#d8ad61',
 '#15121a','#edb5b9','#c6a1dd','#e7b779'];

async function ensureStyle() {
  if(document.getElementById('blackLibriClientStyles')) return;
  const link=document.createElement('link');
  link.id='blackLibriClientStyles';
  link.rel='stylesheet';
  link.href='/css/client-v2-black-libri.css?v=20261110-2';
  await new Promise(resolve=>{
    link.onload=resolve;link.onerror=resolve;
    document.head.appendChild(link);
  });
}

export async function openBlackLibriDemo({onContinue=null}={}) {
  await ensureStyle();
  const overlay=document.createElement('div');
  overlay.className='black-libri-overlay';
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  document.body.appendChild(overlay);
  let chosen=-1,closed=false;
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
        <span class="black-libri-kicker">Black Libri • Prévia sem cobrança</span>
        <h2 class="black-libri-heading" id="blackLibriDemoTitle">
          ${chosen<0?'Escolha um balão!':'Seu presente foi revelado!'}
        </h2>
        <p class="black-libri-subtitle">
          ${chosen<0
            ? 'Esta é uma demonstração: você pode testar sem gastar nenhum prêmio.'
            : 'Veja como sua cliente receberá a surpresa.'}
        </p>
        ${chosen<0?'<div class="black-libri-grid">'+colors.map((color,index)=>`
          <button type="button" class="black-libri-balloon"
            data-demo-slot="${index}" style="--balloon:${color};--slot:${index}"
            aria-label="Estourar balão ${index+1}">
            <span class="bulb"></span><span class="string"></span>
          </button>`).join('')+'</div>':`
          <div class="black-libri-result" role="status">
            <span aria-hidden="true">🎁</span>
            <strong>Save the Date estático</strong>
            <p>Prêmio ilustrativo. Nesta demonstração, nada é reservado, cobrado ou salvo.</p>
          </div>
          <button type="button" class="black-libri-button" data-demo-continue>
            ${onContinue?'Continuar teste do briefing':'Fechar prévia'}
          </button>
        `}
        <p class="black-libri-foot">MODO DE TESTE • Sem participação real • Sem pagamento</p>
      </section>`;
    overlay.querySelector('.black-libri-close')?.addEventListener('click',()=>finish());
    overlay.querySelectorAll('[data-demo-slot]').forEach(button=>{
      button.addEventListener('click',()=>{
        if(chosen>=0)return;
        chosen=Number(button.dataset.demoSlot);
        button.classList.add('chosen');
        for(const b of overlay.querySelectorAll('[data-demo-slot]'))b.disabled=true;
        window.setTimeout(paint,300);
      });
    });
    overlay.querySelector('[data-demo-continue]')?.addEventListener('click',
      ()=>finish({continueFlow:true}));
  };
  paint();
  overlay.querySelector('.black-libri-close')?.focus();
}
