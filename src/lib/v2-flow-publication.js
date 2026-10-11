const ORDER=/^LIBRI-[0-9]{1,15}$/;
const SLUG=/^[a-z0-9](?:[a-z0-9-]{0,68}[a-z0-9])?$/;
export async function verifyLivePublication(slug,fetchImpl=fetch){
 if(!SLUG.test(slug||''))throw Error('Pasta de publicação inválida.');
 const url='https://libriconvites.com.br/'+encodeURIComponent(slug)+'/config.json';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetchImpl(url,{redirect:'follow',signal:controller.signal,headers:{accept:'application/json'}});
  const final=new URL(response.url||url);
  if(final.protocol!=='https:'||
   !['libriconvites.com.br','www.libriconvites.com.br'].includes(final.hostname)||
   final.pathname!=='/'+slug+'/config.json')
   throw Error('O endereço final não pertence ao convite autorizado.');
  if(!response.ok)throw Error('Esta pasta ainda não existe no convite publicado. Nenhum vínculo foi criado.');
  const size=Number(response.headers.get('content-length')||0);
  if(size>65536)throw Error('Configuração do convite maior que o limite.');
  const raw=await response.text();
  if(raw.length>65536)throw Error('Configuração do convite maior que o limite.');
  const parsed=JSON.parse(raw);
  if(!parsed||parsed.pastaCliente!==slug)throw Error('Esta configuração pertence a outro convite.');
  return {slug,verified:true};
 }finally{clearTimeout(timer);}
}
export async function bindFlowPublication(db,orderCode,slug,fetchImpl=fetch){
 if(!ORDER.test(orderCode||''))throw Error('Código do pedido inválido.');
 if(!SLUG.test(slug||''))throw Error('Slug inválido.');
 const order=await db.prepare("SELECT 1 AS ok FROM v2_orders WHERE order_code=? AND status<>'cancelled' AND archived_at IS NULL").bind(orderCode).first();
 if(!order)throw Error('Pedido não encontrado ou indisponível.');
 await verifyLivePublication(slug,fetchImpl);
 const old=await db.prepare('SELECT order_code FROM v2_flow_publication_links WHERE slug=?').bind(slug).first();
 if(old&&old.order_code!==orderCode)throw Error('Esta pasta já pertence a outro pedido.');
 const save=await db.prepare(`INSERT INTO v2_flow_publication_links(order_code,slug,verified_at)
 VALUES (?,?,datetime('now'))
 ON CONFLICT(order_code) DO UPDATE SET slug=excluded.slug,verified_at=excluded.verified_at
 WHERE NOT EXISTS (SELECT 1 FROM v2_flow_publication_links WHERE slug=excluded.slug AND order_code<>excluded.order_code)`
 ).bind(orderCode,slug).run();
 if(save.meta?.changes!==1)throw Error('Não foi possível confirmar vínculo único de publicação.');
 return {orderCode,slug,verified:true};
}
