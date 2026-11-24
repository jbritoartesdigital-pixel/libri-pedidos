import {fail,json} from '../lib/http.js';
import {quoteV3Cart,V3CartValidationError} from '../lib/v3-cart-quote.js';
import {previewV3CartDelivery} from '../lib/v3-cart-delivery.js';
import {listV3RetrospectivePackages} from '../lib/v3-retrospective-catalog.js';

// V3 própria: etapa segura de cotação, não de pagamento.
export async function handlePublicCartV3Api(request,env,url) {
  if(url.pathname==='/api/v3/retrospectivas/catalog') {
    if(request.method!=='GET')return fail('Método não permitido.',405);
    return json({ok:true,packages:await listV3RetrospectivePackages(env.DB)});
  }
  const deliveryRoute=url.pathname==='/api/v3/cart/delivery-options';
  if(!deliveryRoute&&url.pathname!=='/api/v3/cart/quote')return null;
  if(request.method!=='POST')return fail('Método não permitido.',405);
  try {
    if(!(request.headers.get('content-type')||'').includes('application/json'))
      return fail('Envie os dados em JSON.',415);
    const raw=await request.text();
    if(raw.length>12000)return fail('Carrinho muito grande.',413);
    let body;
    try{body=JSON.parse(raw);}catch{return fail('Dados do carrinho inválidos.',422);}
    if(deliveryRoute)return json({ok:true,...await previewV3CartDelivery(env.DB,body)});
    const quote=await quoteV3Cart(env.DB,body);
    return json({ok:true,quote});
  }catch(error){
    // Rejeição comercial esperada. Não inclui dados pessoais nem pagamento.
    if(error instanceof V3CartValidationError)
      return json({ok:false,error:error.message,code:error.code},error.status);
    return fail('Não foi possível cotar esse conjunto de produtos. Atualize a seleção.',422);
  }
}
