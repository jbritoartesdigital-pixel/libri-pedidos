import {fail,json} from '../lib/http.js';
import {quoteV3Cart,V3CartValidationError} from '../lib/v3-cart-quote.js';
import {previewV3CartDelivery} from '../lib/v3-cart-delivery.js';
import {getV3CheckoutTerms,startV3Checkout,v3CheckoutEnabled,recoverV3Checkout} from '../lib/v3-checkout.js';
import {listV3Extras} from '../lib/v3-extras-catalog.js';
import {listV3RetrospectivePackages} from '../lib/v3-retrospective-catalog.js';

// V3 própria: etapa segura de cotação, não de pagamento.
export async function handlePublicCartV3Api(request,env,url) {
  if(url.pathname==='/api/v3/retrospectivas/catalog') {
    if(request.method!=='GET')return fail('Método não permitido.',405);
    return json({ok:true,packages:await listV3RetrospectivePackages(env.DB)});
  }
  if(url.pathname==='/api/v3/extras/catalog'){
    if(request.method!=='GET')return fail('Método não permitido.',405);
    const code=url.searchParams.get('productCode')||'';
    const family=code.startsWith('atelie_')?'identidade_visual':code.startsWith('retrospectiva_')?'retrospectiva':'convite';
    return json({ok:true,extras:listV3Extras(family,code)});
  }
  const deliveryRoute=url.pathname==='/api/v3/cart/delivery-options';
  const termsRoute=url.pathname==='/api/v3/cart/terms';
  const checkoutRoute=url.pathname==='/api/v3/cart/checkout';
  const recoveryRoute=url.pathname==='/api/v3/cart/recover';
  const renewRoute=url.pathname==='/api/v3/cart/renew';
  if(!deliveryRoute&&!termsRoute&&!checkoutRoute&&!recoveryRoute&&!renewRoute&&url.pathname!=='/api/v3/cart/quote')return null;
  if(checkoutRoute&&!v3CheckoutEnabled(env))return fail('A contratação V3 ainda não está disponível.',503);
  if(request.method!=='POST')return fail('Método não permitido.',405);
  try {
    if(!(request.headers.get('content-type')||'').includes('application/json'))
      return fail('Envie os dados em JSON.',415);
    const raw=await request.text();
    if(raw.length>12000)return fail('Carrinho muito grande.',413);
    let body;
    try{body=JSON.parse(raw);}catch{return fail('Dados do carrinho inválidos.',422);}
    if(recoveryRoute||renewRoute)return json({ok:true,...await recoverV3Checkout(request,env,body,{renew:renewRoute})});
    if(termsRoute)return json({ok:true,terms:await getV3CheckoutTerms(env.DB,body),checkoutEnabled:v3CheckoutEnabled(env)});
    if(checkoutRoute)return json({ok:true,...await startV3Checkout(request,env,body)});
    if(deliveryRoute)return json({ok:true,...await previewV3CartDelivery(env.DB,body)});
    const quote=await quoteV3Cart(env.DB,body);
    return json({ok:true,quote});
  }catch(error){
    // Rejeição comercial esperada. Não inclui dados pessoais nem pagamento.
    if(error instanceof V3CartValidationError||error?.code==='cart_extra_invalid'||error?.name==='V2CheckoutError'||error?.code==='order_busy')
      return json({ok:false,error:error.message,code:error.code},error.status);
    return fail('Não foi possível cotar esse conjunto de produtos. Atualize a seleção.',422);
  }
}
