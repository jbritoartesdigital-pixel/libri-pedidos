const CALLBACK='/api/admin/v2/drive/oauth/callback';

// A top-level return from Google does not carry the Strict admin cookie.
// This inert landing page retries on the same origin; the existing Passkey
// middleware still authenticates the request that exchanges the OAuth code.
export function needsDriveOAuthReturnPage(request,url){
  return request.method==='GET' && url.pathname===CALLBACK &&
    url.searchParams.get('oauth_return')!=='1';
}

export function driveOAuthReturnPage(){
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(18)),
    byte=>byte.toString(16).padStart(2,'0')).join('');
  return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar Google Drive · Libri</title>
<p role="status">Concluindo a conexão com seu Google Drive…</p>
<script nonce="${nonce}">
(async()=>{
  const target=new URL(location.href);
  target.searchParams.set('oauth_return','1');
  history.replaceState(null,'',target.pathname);
  try{
    const response=await fetch(target.href,{credentials:'same-origin',cache:'no-store'});
    const destination=new URL(response.url);
    if(!response.ok || !response.redirected || destination.origin!==location.origin ||
      destination.pathname!=='/admin-v2')throw Error('OAuth não concluído');
    location.replace(destination.href);
  }catch{location.replace('/admin-v2?drive=error');}
})();
</script><noscript>Ative o JavaScript para concluir a conexão.</noscript></html>`,{
    headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
      'referrer-policy':'no-referrer','x-content-type-options':'nosniff',
      'content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`}
  });
}
