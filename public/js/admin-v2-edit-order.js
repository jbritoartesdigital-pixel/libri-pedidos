import { api, esc, money, showToast } from './admin-v2-core.js';

const cents = value => Math.round(Number(value || 0) * 100);
const reais = value => (Number(value || 0) / 100).toFixed(2);
const sum = values => values.map(x=>x).join('');
const selectedItems = options => options.current.items || [];
const productRow = options => selectedItems(options).find(x=>x.type==='product');
const addonRows = options => selectedItems(options).filter(x=>x.type==='addon');
function renderProductVariants(form,options){
  const select=form.querySelector('#adminEditProduct');
  const variant=form.querySelector('#adminEditVariant');
  const chosen=options.catalog.products.find(p=>p.code===select.value);
  const current=productRow(options);
  const currentConfig=current?.config||{};
  if(!chosen){
    variant.innerHTML='<option value="">Produto atual mantido</option>';
    variant.disabled=true;
    form.querySelector('#adminEditLegacyScenes').disabled=false;
    return;
  }
  const values=chosen.variants||[];
  const defaultValue=chosen.code===currentConfig.productCode
    ? currentConfig.variantCode : values.find(v=>v.isDefault)?.code;
  variant.innerHTML=values.map(v=>`<option value="${esc(v.code)}"
    ${v.code===defaultValue?'selected':''}>${esc(v.label)} • ${money(v.priceCents)}</option>`).join('');
  variant.disabled=false;
  form.querySelector('#adminEditLegacyScenes').disabled=true;
  form.querySelector('#adminEditLegacyScenes').value='';
}
function capture(form,options){
  const product=productRow(options);
  const currentConfig=product?.config||{};
  const productCode=form.querySelector('#adminEditProduct').value;
  const useOriginal=productCode==='__keep__';
  const variantCode=useOriginal ? '' : form.querySelector('#adminEditVariant').value;
  const sceneOverride=useOriginal ? form.querySelector('#adminEditLegacyScenes').value.trim() : '';
  return {productCode:useOriginal?'':productCode,variantCode,
    sceneCountOverride:sceneOverride||null,
    addonCodes:[...form.querySelectorAll('[data-edit-addon]:checked')].map(x=>x.value),
    manualDiscountCents:cents(form.querySelector('#adminEditDiscount').value),
    priceAdjustmentCents:cents(form.querySelector('#adminEditAdjustment').value),
    expectedTotalCents:options.current.totalCents,
    expectedRevision:options.current.revision,
    note:form.querySelector('#adminEditNote').value.trim(),
  };
}
function cardHtml(options){
  const current=options.current;
  const original=productRow(options);
  const cfg=original?.config||{};
  const known=options.catalog.products.some(p=>p.code===cfg.productCode);
  const paid=current.paidCents;
  const productOptions=options.catalog.products.map(p=>
    `<option value="${esc(p.code)}" ${p.code===cfg.productCode?'selected':''}>${esc(p.name)}</option>`).join('');
  const selectedAddonCodes=new Set(addonRows(options).map(x=>x.code));
  const addons=options.catalog.addons.map(a=>
    `<label class="admin-edit-addon"><input type="checkbox" data-edit-addon value="${esc(a.code)}"
      ${selectedAddonCodes.has(a.code)?'checked':''}>
      <span><strong>${esc(a.name)}</strong><small> ${money(a.priceCents)}</small></span></label>`).join('');
  const inactive=addonRows(options).filter(a=>!options.catalog.addons.some(x=>x.code===a.code));
  return `<div class="admin-edit-order">
    <div class="admin-edit-intro">
      <strong>Alterações combinadas pelo WhatsApp</strong>
      <small>Revise a diferença antes de salvar. Nenhum Pix ou pagamento no cartão será modificado automaticamente.</small>
    </div>
    <div class="admin-edit-totals"><span>Total atual <b>${money(current.totalCents)}</b></span>
      <span>Já recebido <b>${money(paid)}</b></span>
      <span>Saldo atual <b>${money(Math.max(0,current.totalCents-paid))}</b></span></div>
    ${current.pendingMercadoPago?'<p class="notice info">Existe cobrança pendente no Mercado Pago. Resolva-a antes de editar valores.</p>':''}
    <div class="field"><label for="adminEditProduct">Produto contratado</label>
      <select id="adminEditProduct" class="select">
      <option value="__keep__" ${known?'':'selected'}>Manter: ${esc(original?.name||'produto atual')}</option>
      ${productOptions}</select></div>
    <div class="field"><label for="adminEditVariant">Versão / quantidade de cenas do catálogo</label>
      <select id="adminEditVariant" class="select"></select></div>
    <div class="field"><label for="adminEditLegacyScenes">Cenas do modelo antigo (se não estiver no catálogo)</label>
      <input type="number" id="adminEditLegacyScenes" class="input" inputmode="numeric"
        min="1" max="30" placeholder="Ex.: 7" value="${Number(cfg.sceneCount)||''}"></div>
    <details><summary>Adicionar ou retirar adicionais</summary>
      <div class="admin-edit-addons">${addons||'<small>Sem adicionais ativos no catálogo.</small>'}</div>
      ${inactive.length?`<small>Preservados (fora do catálogo atual): ${inactive.map(x=>esc(x.name)).join(', ')}</small>`:''}
    </details>
    <div class="admin-edit-grid">
      <div class="field"><label for="adminEditDiscount">Desconto manual adicional (R$)</label>
        <input id="adminEditDiscount" type="number" class="input" inputmode="decimal" min="0"
          step="0.01" value="${reais(current.manualDiscountCents)}"></div>
      <div class="field"><label for="adminEditAdjustment">Ajuste combinado de preço (R$)</label>
        <input id="adminEditAdjustment" type="number" class="input" inputmode="decimal"
          step="0.01" value="${reais(current.priceAdjustmentCents)}"></div>
    </div>
    <small>Use ajuste positivo para cobrar uma cena ou serviço fora do catálogo. Um desconto adicional não altera descontos anteriores.</small>
    <div class="field"><label for="adminEditNote">O que foi combinado no WhatsApp?</label>
      <textarea id="adminEditNote" class="textarea" rows="2" maxlength="800"
        placeholder="Ex.: acrescentar mais uma cena e confirmação, desconto autorizado"></textarea></div>
    <p id="adminEditQuote" role="status" class="admin-edit-quote">Confira o novo valor antes de salvar.</p>
    <div class="admin-edit-buttons">
      <button id="adminEditPreview" class="btn btn-secondary" type="button">Conferir alteração</button>
      <button id="adminEditSave" class="btn btn-primary" type="button" disabled>Salvar alterações</button>
      <button id="adminEditCancel" class="btn btn-ghost" type="button">Fechar</button>
    </div>
    <small>Para corrigir um Pix já registrado, use o Financeiro. Pagamentos do Mercado Pago exigem estorno ou cobrança próprios.</small>
  </div>`;
}
export function bindAdminOrderEditing(detail,onChanged,close,reopen){
  const toggle=document.getElementById('editAdminOrder');
  const panel=document.getElementById('adminEditOrderPanel');
  if(!toggle||!panel)return;
  let options=null;
  let verified=null;
  const hide=()=>{panel.classList.add('hidden');toggle.setAttribute('aria-expanded','false');};
  const begin=async()=>{
    toggle.disabled=true;
    try {
      const response=await api(`/api/admin/v2/orders/${detail.order.code}/edit`);
      options=response.result;
      panel.innerHTML=cardHtml(options);
      panel.classList.remove('hidden');
      toggle.setAttribute('aria-expanded','true');
      const form=panel;
      const p=form.querySelector('#adminEditProduct');
      const original=productRow(options);
      const originalCode=original?.config?.productCode||'';
      const isKnown=options.catalog.products.some(item=>item.code===originalCode);
      p.value=isKnown?originalCode:'__keep__';
      renderProductVariants(form,options);
      const preview=form.querySelector('#adminEditQuote');
      const save=form.querySelector('#adminEditSave');
      const invalidate=()=>{verified=null;save.disabled=true;
        preview.textContent='Alterações não conferidas. Confira o novo total antes de salvar.';};
      form.querySelectorAll('input,textarea,select').forEach(el=>
        el.addEventListener('input',invalidate));
      p.addEventListener('change',()=>{renderProductVariants(form,options);invalidate();});
      form.querySelector('#adminEditCancel').addEventListener('click',hide);
      form.querySelector('#adminEditPreview').addEventListener('click',async e=>{
        const button=e.currentTarget;button.disabled=true;
        try {
          const body=capture(form,options);
          const r=await api(`/api/admin/v2/orders/${detail.order.code}/edit`,{
            method:'POST',body:JSON.stringify(body),
          });
          verified=JSON.stringify(body);
          const v=r.result;
          save.disabled=!v.changed||options.current.pendingMercadoPago;
          preview.innerHTML=`<strong>Novo total: ${money(v.newTotalCents)}</strong>
            <span>Diferença: ${money(v.newTotalCents-v.beforeTotalCents)}</span>
            <span>Já recebido: ${money(v.paidCents)}</span>
            <span>Saldo após alteração: ${money(v.remainingCents)}</span>
            <small>${esc(v.note)}</small>`;
        }catch(err){verified=null;save.disabled=true;preview.textContent=err.message;}
        finally{button.disabled=false;}
      });
      save.addEventListener('click',async()=>{
        const body=capture(form,options);
        if(!verified||verified!==JSON.stringify(body)){invalidate();return;}
        if(body.note.length<5){showToast('Explique o que foi combinado com a cliente.');return;}
        if(!confirm(`Salvar alterações do pedido ${detail.order.code}? O total e o saldo serão atualizados, sem cobrar ou estornar pagamentos automaticamente.`))return;
        save.disabled=true;
        try {
          const answer=await api(`/api/admin/v2/orders/${detail.order.code}/edit`,{
            method:'PATCH',body:JSON.stringify(body),
          });
          close();
          showToast(answer.result.briefingNeedsReview
            ? 'Pedido atualizado. Confira o briefing após alterar cenas/adicionais.'
            : 'Pedido e saldo atualizados com histórico ✓');
          if(onChanged)await onChanged();
          await reopen(detail.order.code,onChanged);
        }catch(err){showToast(err.message);save.disabled=false;}
      });
    }catch(error){showToast(error.message);}
    finally{toggle.disabled=false;}
  };
  toggle.addEventListener('click',()=>{if(!panel.classList.contains('hidden')){hide();return;}begin();});
}
