// Defense in depth at the Worker boundary. No client-side trust or IP supplied in JSON.
const auth=/^\/api\/admin\/v2\/auth\/(authentication|registration)\/(options|verify)$/;
const checkout=/^\/api\/(?:v3\/cart\/(checkout|recover|renew)|v3\/cart\/black(?:-libri)?\/reveal|v2\/(checkout\/start|urgency\/request|black-libri\/reveal)|v2\/customer-area\/ord_[a-f0-9]{36}\/v3\/(manual-checkout\/(finish|reveal)|supplements\/[^/]+\/\d+\/(pay|renew)))$/;
const privatePath=/^\/(?:admin(?:-v2)?(?:[/.]|$)|meu-pedido(?:\/|$)|api\/admin(?:\/|$)|api\/v2\/(?:customer-area|manual-order|urgency)(?:\/|$))/;
const jsonError=(status,error,extra={})=>new Response(JSON.stringify({ok:false,error}),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
export function securityBucket(path,method){
 if(method!=='POST'&&method!=='PATCH'&&method!=='DELETE'&&method!=='PUT')return null;
 if(auth.test(path))return path.includes('/registration/')?'RECOVERY_RATE_LIMIT':'AUTH_RATE_LIMIT';
 if(checkout.test(path)||/^\/api\/v2\/manual-order\/ord_[a-f0-9]{36}\//.test(path))return 'CHECKOUT_RATE_LIMIT';
 if(/^\/api\/v3\/cart\/|^\/api\/v2\/(quote|delivery-options|briefing-simulation|black-libri\/)/.test(path))return 'QUOTE_RATE_LIMIT';
 if(/^\/api\/v2\/customer-area\//.test(path))return 'CUSTOMER_WRITE_RATE_LIMIT';
 return null;
}
export async function securityGate(request,env){
 const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
 if(!['GET','HEAD','OPTIONS'].includes(method)&&path.startsWith('/api/admin/')){
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((origin&&origin!==url.origin)||['cross-site','same-site'].includes(site))return jsonError(403,'Origem não autorizada.');
 }
 const bucket=securityBucket(path,method);if(!bucket)return null;
 const binding=env[bucket];
 if(!binding){if(env.ENVIRONMENT==='production')return jsonError(503,'Serviço temporariamente indisponível.');return null;}
 // CF-Connecting-IP is set by the trusted Cloudflare edge, not X-Forwarded-For.
 const ip=request.headers.get('cf-connecting-ip')||'unknown';
 try{const result=await binding.limit({key:ip});if(!result.success)return jsonError(429,'Muitas tentativas. Aguarde um minuto e tente novamente.',{'retry-after':'60'});}
 catch{return jsonError(503,'Serviço temporariamente indisponível.');}
 return null;
}
export function secureResponse(request,response){
 const path=new URL(request.url).pathname,headers=new Headers(response.headers);
 headers.set('x-content-type-options','nosniff');
 headers.set('referrer-policy','no-referrer');
 headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
 if(new URL(request.url).protocol==='https:')headers.set('strict-transport-security','max-age=31536000');
 if(privatePath.test(path)||path==='/client-v2.html'||path==='/admin-v2.html'||path==='/client-v3.html'){
  headers.set('cache-control','private, no-store, max-age=0');
  headers.set('x-robots-tag','noindex, nofollow, noarchive');
 }
 if((headers.get('content-type')||'').includes('text/html')){
  headers.set('x-frame-options','DENY');
  headers.set('content-security-policy',"base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  // Report-only script restrictions until the complete checkout/browser matrix is validated.
  headers.set('content-security-policy-report-only',"default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob: https:; frame-src 'self' https:");
 }
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
