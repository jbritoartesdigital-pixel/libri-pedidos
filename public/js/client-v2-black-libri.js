import { api, esc, money, showToast } from './client-v2-core.js';

const palette = [
  '#e9b25d','#d5a1b7','#a48bd0','#111017',
  '#e6bb8c','#c489aa','#b29edb','#d8ad61',
  '#15121a','#edb5b9','#c6a1dd','#e7b779'
];

function prizePanel(claim, quote) {
  if (!claim) return '';
  const expired=claim.status==='expired';
  const used=claim.status==='redeemed';
  const attached=claim.status==='attached';
  const discount=Number(quote?.blackLibriDiscountCents||0);
  return `
    <div class="black-libri-result" role="status">
      <span aria-hidden="true">${expired?'⌛':'🎁'}</span>
      <strong>${esc(claim.label)}</strong>
      ${expired?'<p>Esse presente não está mais disponível.</p>':
        used?'<p>Seu presente já foi utilizado.</p>':
        attached?'<p>Seu presente já faz parte do pedido.</p>':
        '<p>Seu presente está garantido por 24 horas!</p>'}
      ${quote&&!expired&&!used? `
        <p>${discount>0?'Você economiza '+money(discount)+'!':'Um carinho extra da Libri para você!'}</p>
        <p><b>Total do convite: ${money(quote.totalCents)}</b></p>` : ''}
    </div>`;
}

// Acionada ao clicar em "Ir para o pagamento"; a confirmação dentro do modal
// dispara onContinue no próprio clique, preservando a abertura da aba do MP no iOS.
export async function openBlackLibriBeforePayment({
  customer,clientRequestId,selection,event,onContinue,
  manualToken=null,manualSelection=null
}) {
  const endpoint=manualToken
    ? '/api/v2/manual-order/'+encodeURIComponent(manualToken)+'/black-libri'
    : '/api/v2/black-libri';
  const payload=manualToken
    ? {...(manualSelection||{})}
    : {customer,clientRequestId,selection,event};
  let response = await api(endpoint+'/status',{
    method:'POST',body:JSON.stringify(payload)
  });
  if (!response.enabled) {
    onContinue();
    return;
  }
  // Estilo só no fluxo promocional, mantendo a loja normal leve e um único
  // stylesheet principal no HTML. Carrega antes de mostrar o modal.
  if (!document.getElementById('blackLibriClientStyles')) {
    const stylesheet=document.createElement('link');
    stylesheet.id='blackLibriClientStyles';
    stylesheet.rel='stylesheet';
    stylesheet.href='/css/client-v2-black-libri.css?v=20261110-2';
    await new Promise(resolve=>{
      stylesheet.onload=resolve;
      stylesheet.onerror=resolve;
      document.head.appendChild(stylesheet);
    });
  }
  let claim=response.claim||null;
  let quote=null;
  const overlay=document.createElement('div');
  overlay.className='black-libri-overlay';
  overlay.setAttribute('role','presentation');
  const oldOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  document.body.appendChild(overlay);
  let active=false;
  let chosen=-1;
  let closed=false;

  const close=()=>{
    if(closed)return;
    closed=true;
    document.body.style.overflow=oldOverflow;
    document.removeEventListener('keydown',escapeClose);
    overlay.remove();
  };
  const escapeClose=e=>{if(e.key==='Escape'&&!active)close();};
  document.addEventListener('keydown',escapeClose);

  const preview=async()=>{
    if(!claim||claim.status==='expired'||claim.status==='redeemed')return;
    try {
      const result=await api(endpoint+'/preview',{
        method:'POST',body:JSON.stringify(payload)
      });
      quote=result.quote;
    } catch(error) {
      quote=null;
      showToast(error.message||'Não foi possível atualizar o valor.');
    }
  };

  const paint=()=>{
    if(closed)return;
    const selected=!!claim;
    const balloons=palette.map((color,i)=>`
      <button class="black-libri-balloon ${chosen===i?'chosen':''}"
        style="--balloon:${color};--slot:${i}" type="button"
        data-black-slot="${i}" aria-label="Estourar balão ${i+1}" ${selected||active?'disabled':''}>
        <span class="bulb"></span><span class="string"></span>
      </button>`).join('');
    overlay.innerHTML=`
      <section class="black-libri-panel" role="dialog" aria-modal="true"
        aria-labelledby="blackLibriTitle">
        <button class="black-libri-close" type="button" aria-label="Fechar">×</button>
        <span class="black-libri-kicker">Black Libri • Edição especial</span>
        <h2 class="black-libri-heading" id="blackLibriTitle">${selected?'Surpresa para você!':'Escolha um balão!'}</h2>
        <p class="black-libri-subtitle">${selected
          ? 'A Black Libri trouxe um presente especial!'
          : 'Estoure um balão e descubra seu presente!'}</p>
        ${selected ? prizePanel(claim,quote) : '<div class="black-libri-grid">'+balloons+'</div>'}
        ${selected ? `<button class="black-libri-button" type="button" data-black-continue
          ${active || (claim.status==='reserved'&&!quote)?'disabled':''}>${manualToken?'Aplicar meu presente':'Continuar para o pagamento'}</button>` : ''}
        <p class="black-libri-foot">Feito com carinho pela Libri Convites ♡</p>
      </section>`;
    overlay.querySelector('.black-libri-close')?.addEventListener('click',()=>{if(!active)close();});
    overlay.querySelectorAll('[data-black-slot]').forEach(button=>button.addEventListener('click',async()=>{
      if(active||claim)return;
      active=true;
      chosen=Number(button.dataset.blackSlot);
      button.classList.add('chosen');
      overlay.querySelectorAll('[data-black-slot]').forEach(b=>b.disabled=true);
      try {
        response=await api(endpoint+'/reveal',{
          method:'POST',body:JSON.stringify({...payload,balloon:chosen})
        });
        claim=response.claim;
        await preview();
      } catch(error) {
        chosen=-1;
        showToast(error.message||'Não conseguimos revelar o prêmio. Tente novamente.');
      } finally {
        active=false;
        paint();
      }
    }));
    overlay.querySelector('[data-black-continue]')?.addEventListener('click',()=>{
      if(active || (claim?.status==='reserved'&&!quote))return;
      // A cliente pode fechar o modal depois de revelar: reabrir mostra
      // exatamente o mesmo prêmio. O pagamento não atribui outro.
      close();
      onContinue(claim);
    });
  };
  if(claim) await preview();
  paint();
  overlay.querySelector('.black-libri-close')?.focus();
}
