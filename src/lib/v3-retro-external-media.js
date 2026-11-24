// Only direct Google Drive file/folder links; never proxy or fetch external media.
export function externalV3RetroMedia(input={}){
 const fail=message=>{const e=new Error(message);e.status=422;throw e;};
 if(input.channel==='whatsapp'){
  if(input.url)fail('Não informe link para envio pelo WhatsApp.');
  return {channel:'whatsapp',url:null};
 }
 if(input.channel!=='drive')fail('Escolha WhatsApp ou Google Drive.');
 if(typeof input.url!=='string'||input.url.length>2048)fail('Informe um link válido do Google Drive.');
 try{
  const u=new URL(input.url.trim());
  if(u.protocol==='https:'&&u.hostname==='drive.google.com'&&!u.username&&!u.password&&!u.port&&
    (/^\/file\/d\/[A-Za-z0-9_-]+\/(?:view|preview)\/?$/.test(u.pathname)||/^\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)||u.pathname==='/open'&&/^[A-Za-z0-9_-]+$/.test(u.searchParams.get('id')||'')))return {channel:'drive',url:u.href};
 }catch{}
 fail('Use um link direto HTTPS de arquivo ou pasta do Google Drive.');
}
