import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
if(config.vars.LIBRI_V3_CHECKOUT_ENABLED!=='true')process.exit(0);
const base='https://pedidos.libriconvites.com.br';
async function request(path,body){
 const r=await fetch(base+path,{headers:{'cache-control':'no-cache',...(body?{'content-type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(path+' HTTP '+r.status);return r;
}
const main=await (await request('/pedido')).text();
if(!main.includes('id="v3-app"'))throw Error('Loja principal ainda não é V3.');
const legacy=await (await request('/pedido?versao=2')).text();
if(legacy.includes('id="v3-app"')||!legacy.includes('client-v2.js'))throw Error('Compatibilidade da loja anterior não confirmada.');
const [atelie,retro]=await Promise.all([request('/api/v2/atelie/catalog').then(r=>r.json()),request('/api/v3/retrospectivas/catalog').then(r=>r.json())]);
if(atelie.packages.filter(p=>p.purchaseAvailable).length!==3||retro.packages.filter(p=>p.purchaseAvailable).length!==5)throw Error('Catálogo incompleto.');
const items=['interactive_essential','atelie_essencia','retrospectiva_070'].map(productCode=>({productCode,variantCode:productCode+'_default',addonCodes:[]}));
const terms=await (await request('/api/v3/cart/terms',{items,eventType:'birthday',paymentMethod:'pix'})).json();
if(terms.checkoutEnabled!==true||!terms.terms?.general?.version||terms.terms.services.length!==2)throw Error('Checkout V3 ou aceites não disponíveis.');
console.log('Loja principal V3, compatibilidade V2, 8 pacotes e checkout triplo verificados sem pagamento.');
