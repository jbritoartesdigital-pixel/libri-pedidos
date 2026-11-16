import {json,fail} from "../lib/http.js";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/**
 * Store only a random per-tab UUID and a numeric step. Never accept names,
 * contacts, product IDs, shopping-cart contents, IPs or free-text metadata.
 * An incomplete visit is not an actual cancelled order or missed payment.
 */
export async function handleAnonymousFunnel(request,env) {
  if(request.method!=="POST")return fail("Método não permitido.",405);
  const origin=request.headers.get("origin");
  const site=request.headers.get("sec-fetch-site");
  if(origin!==new URL(request.url).origin &&
    !(origin===null && site==="same-origin"))
    return fail("Origem inválida.",403);
  const contentType=request.headers.get("content-type")||"";
  if(!/^application\/json(?:\s*;|$)/i.test(contentType))return fail("JSON necessário.",415);
  if(Number(request.headers.get("content-length")||0)>300)return fail("Dados muito grandes.",413);
  const raw=await request.text();
  if(raw.length>300)return fail("Dados muito grandes.",413);
  let input;
  try{input=JSON.parse(raw)}catch{return fail("JSON inválido.",400)}
  const id=String(input?.sessionId||"");
  const step=Number(input?.step);
  const checkoutCreated=input?.checkoutCreated===true?1:0;
  if(!UUID.test(id)||!Number.isInteger(step)||step<0||step>10)
    return fail("Etapa inválida.",422);
  if(input.simulated===true)return json({ok:true});
  try {
    // A single valid session updates one row; no step-by-step event log, no PII.
    await env.DB.prepare(`
      INSERT INTO v2_funnel_sessions
        (id,last_step,max_step,checkout_created)
      VALUES (?1,?2,?2,?3)
      ON CONFLICT(id) DO UPDATE SET
        last_step=excluded.last_step,
        max_step=MAX(v2_funnel_sessions.max_step,excluded.max_step),
        checkout_created=MAX(v2_funnel_sessions.checkout_created,excluded.checkout_created),
        last_seen_at=datetime('now')
    `).bind(id,step,checkoutCreated).run();
    return json({ok:true});
  }catch(error){
    // Analytics may not be deployed yet. It must never block purchases.
    console.warn("funnel_telemetry_unavailable",error?.name||"Error");
    return json({ok:false,analyticsUnavailable:true},202);
  }
}
