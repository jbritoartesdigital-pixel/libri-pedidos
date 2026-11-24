// Cotação da V3 por produtos principais. Nenhuma operação financeira é criada.
// A V2 continua responsável pelo checkout efetivo até a validação integral
// de pagamento único, reserva de capacidade e briefings de múltiplos serviços.
import { calculateCommercialV2Quote } from './v2-commercial-pricing.js';
import { productionDaysForQuote } from './v3-production-policy.js';
import { priceWithCardProcessingFee } from './v2-payment-pricing.js';

export class V3CartValidationError extends Error {
  constructor(message, code='invalid_cart') {
    super(message);
    this.code=code;
    this.status=422;
  }
}
const FAMILY_BY_CODE = code => {
  if (code.startsWith('atelie_')) return 'identidade_visual';
  if (code==='retrospectiva'||code.startsWith('retrospectiva_')) return 'retrospectiva';
  return 'convite';
};
const MONEY = Number.isSafeInteger;
const str = (value,max=100) => typeof value==='string' ? value.trim().slice(0,max+1) : '';
function validateItems(items) {
  if(!Array.isArray(items)||!items.length||items.length>3)
    throw new V3CartValidationError('Escolha de 1 a 3 produtos principais.','cart_items_invalid');
  const codes=new Set(), families=new Set();
  return items.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))
      throw new V3CartValidationError('Item do carrinho inválido.','cart_item_invalid');
    const code=str(item.productCode);
    const variant=str(item.variantCode);
    if(!/^[a-z0-9_]{3,80}$/.test(code)||!/^([a-z0-9_]{3,80})?$/.test(variant))
      throw new V3CartValidationError('Produto ou configuração inválida.','cart_product_invalid');
    const family=FAMILY_BY_CODE(code);
    if(codes.has(code)||families.has(family))
      throw new V3CartValidationError('Escolha no máximo um produto principal de cada linha.','cart_duplicate_family');
    codes.add(code);families.add(family);
    const addonCodes=item.addonCodes??[];
    if(!Array.isArray(addonCodes)||addonCodes.length>30||addonCodes.some(x=>typeof x!=='string'||x.length>80))
      throw new V3CartValidationError('Adicionais inválidos.','cart_addons_invalid');
    // Nenhum adicional é inferido ou colocado no pedido pelo servidor.
    // Apenas um combo explícito na linha de convite pode usar as regras V2.
    // Cupons e combos globais continuam bloqueados.
    if(item.couponCode || (item.comboCode && family!=='convite'))
      throw new V3CartValidationError('Descontos combinados ainda não estão disponíveis para carrinhos com vários serviços.','cart_promotion_pending');
    const comboCode=str(item.comboCode,80);
    if(item.comboCode && !/^[a-z0-9_]{1,80}$/.test(comboCode))
      throw new V3CartValidationError('Combo inválido.','cart_combo_invalid');
    return {index, family, productCode:code, variantCode:variant, addonCodes:[...new Set(addonCodes)],comboCode};
  });
}

export async function quoteV3Cart(db, cart={}) {
  if(!cart||typeof cart!=='object'||Array.isArray(cart))
    throw new V3CartValidationError('Carrinho inválido.');
  const items=validateItems(cart.items);
  if(cart.couponCode||cart.comboCode)
    throw new V3CartValidationError('Descontos combinados ainda não estão disponíveis para carrinhos com vários serviços.','cart_promotion_pending');
  // Não cobrar a mesma retrospectiva como produto principal e adicional de convite.
  if(items.some(item=>item.family==='retrospectiva') &&
    items.some(item=>item.addonCodes.some(code=>/^retro_(070|100|150|200|250)$/.test(code))))
    throw new V3CartValidationError('Retrospectiva já selecionada como produto principal. Retire o adicional duplicado.','cart_duplicate_retrospective');
  if(cart.paymentMethod && !['pix','card'].includes(cart.paymentMethod))
    throw new V3CartValidationError('Método de pagamento inválido.');
  const eventType=str(cart.eventType,80);
  if(eventType.length>80)
    throw new V3CartValidationError('Evento inválido.');
  const paymentMethod=cart.paymentMethod||'pix';
  const quotes=[];
  for(const item of items) {
    // Cada linha passa pelas MESMAS validações oficiais do catálogo V2.
    // Proíbe tabela/precificação client-side e produtos ainda não ativados.
    const quote=await calculateCommercialV2Quote(db,{
      productCode:item.productCode,
      variantCode:item.variantCode,
      addonCodes:item.addonCodes,
      couponCode:'',
      comboCode:item.comboCode,
      paymentMethod:'pix'
    },{eventType});
    if(quote.product.code!==item.productCode)
      throw new V3CartValidationError('Produto do carrinho mudou. Atualize a seleção.','cart_product_changed');
    if(!MONEY(quote.totalCents)||quote.totalCents<0||!MONEY(quote.pointsUnits)||quote.pointsUnits<0)
      throw new V3CartValidationError('Cotação inválida.','cart_invalid_quote');
    quotes.push({
      lineId:'product_'+item.index,
      family:item.family,
      productCode:quote.product.code,
      variantCode:quote.variant.code,
      productName:quote.product.name,
      variantName:quote.variant.label,
      addonCodes:quote.addons.map(x=>x.code),
      grossCents:quote.productCents+quote.addonsCents,
      comboCode:quote.combo?.code||'',
      comboName:quote.combo?.name||'',
      discountCents:quote.comboDiscountCents,
      subtotalCents:quote.subtotalCents,
      totalCents:quote.totalCents,
      pointsUnits:quote.pointsUnits,
      productionDays:productionDaysForQuote(quote)
    });
  }
  const sum=key=>quotes.reduce((n,x)=>n+x[key],0);
  const baseTotalCents=sum('totalCents');
  const pricing=priceWithCardProcessingFee(baseTotalCents,paymentMethod);
  // A cotação é informativa: nunca vira ordem de pagamento com base nesse total.
  return {
    status:'preview_only',
    canCheckout:false,
    reason:'A compra conjunta exige checkout atômico, reserva de agenda e briefings por serviço. Os pagamentos V2 continuam inalterados.',
    paymentMethod,
    items:quotes,
    subtotalCents:sum('subtotalCents'),
    grossCents:sum('grossCents'),
    baseTotalCents,
    totalCents:pricing.totalCents,
    cardFeeCents:pricing.cardFeeCents,
    pointsUnits:sum('pointsUnits'),
    productionDays:Math.max(...quotes.map(x=>x.productionDays)),
    discountCents:sum('discountCents'),
    pricedOnServer:true
  };
}
