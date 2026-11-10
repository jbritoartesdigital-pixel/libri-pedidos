import { nowIso } from './http.js';
import { blackLibriOperational } from './v2-black-libri.js';

function error(message,status=422,code='black_libri_admin_invalid') {
  return Object.assign(new Error(message),{ status,code });
}
export function blackLibriEnvironmentReady(env) {
  const start=Date.parse(String(env.BLACK_LIBRI_START||''));
  const end=Date.parse(String(env.BLACK_LIBRI_END||''));
  return String(env.BLACK_LIBRI_ENABLED||'')==='1'
    && String(env.BLACK_LIBRI_IDENTITY_SECRET||'').length>=24
    && Number.isFinite(start) && Number.isFinite(end) && end>start;
}

// Adicional às variáveis de ambiente: precisa ser habilitada no painel e
// ter registro administrativo da autorização exigida para a ação promocional.
export async function getBlackLibriAdmin(env) {
  let campaign;
  let prizes;
  try {
    campaign=await env.DB.prepare(`
      SELECT admin_enabled,compliance_confirmed,authorization_reference,
        admin_note,updated_at
      FROM v2_black_libri_campaign_state WHERE id=1
    `).first();
    const results=await env.DB.prepare(`
      SELECT p.code,p.label,p.kind,p.value,p.weight,p.max_claims,p.enabled,
        p.description,p.sort_order,
        COALESCE(SUM(CASE WHEN c.status='redeemed' THEN 1 ELSE 0 END),0) AS redeemed,
        COALESCE(SUM(CASE WHEN c.status IN ('reserved','attached')
          AND c.expires_at > ? THEN 1 ELSE 0 END),0) AS reserved,
        COALESCE(SUM(CASE WHEN c.status='expired' OR
          (c.status IN ('reserved','attached') AND c.expires_at<=?)
          THEN 1 ELSE 0 END),0) AS expired,
        COUNT(c.id) AS total_revealed
      FROM v2_black_libri_prizes p
      LEFT JOIN v2_black_libri_claims c ON c.prize_code=p.code
      GROUP BY p.code ORDER BY p.sort_order
    `).bind(nowIso(),nowIso()).all();
    prizes=(results.results||[]).map(p=>{
      const used=Number(p.reserved)+Number(p.redeemed);
      return {
        code:p.code,label:p.label,kind:p.kind,value:Number(p.value),
        weight:Number(p.weight),maxClaims:p.max_claims===null?null:Number(p.max_claims),
        enabled:Number(p.enabled)===1,
        description:p.description,sortOrder:Number(p.sort_order),
        reserved:Number(p.reserved),redeemed:Number(p.redeemed),
        expired:Number(p.expired),totalRevealed:Number(p.total_revealed),
        available:p.max_claims===null?null:Math.max(0,Number(p.max_claims)-used)
      };
    });
  } catch(e) {
    if (/no such table/i.test(String(e.message||''))) {
      return {ok:true,migrationRequired:true,active:false,
        environmentReady:blackLibriEnvironmentReady(env),prizes:[],
        campaign:null,summary:{totalRevealed:0,reserved:0,redeemed:0}};
    }
    throw e;
  }
  const available=prizes.filter(p=>p.enabled&&(p.available===null||p.available>0));
  const totalWeight=available.reduce((s,p)=>s+p.weight,0);
  return {
    ok:true,migrationRequired:false,
    environmentReady:blackLibriEnvironmentReady(env),
    active:await blackLibriOperational(env),
    // Não expor secret nem exigir que a campanha já tenha começado para configurar.
    windowStart:env.BLACK_LIBRI_START||null,
    windowEnd:env.BLACK_LIBRI_END||null,
    campaign:{
      adminEnabled:Number(campaign?.admin_enabled)===1,
      complianceConfirmed:Number(campaign?.compliance_confirmed)===1,
      authorizationReference:campaign?.authorization_reference||'',
      adminNote:campaign?.admin_note||'',
      updatedAt:campaign?.updated_at||null
    },
    prizes:prizes.map(p=>({...p,
      chancePercent: totalWeight && available.some(a=>a.code===p.code)
       ? Math.round(10000*p.weight/totalWeight)/100 : 0
    })),
    summary:{
      totalRevealed:prizes.reduce((s,p)=>s+p.totalRevealed,0),
      reserved:prizes.reduce((s,p)=>s+p.reserved,0),
      redeemed:prizes.reduce((s,p)=>s+p.redeemed,0),
      expired:prizes.reduce((s,p)=>s+p.expired,0),
      availablePrizeTypes:available.length,
      totalWeight
    }
  };
}

function parseWhole(value,min,max,label) {
  const n=Number(value);
  if(!Number.isInteger(n)||n<min||n>max) throw error(label+' deve estar entre '+min+' e '+max+'.');
  return n;
}

export async function saveBlackLibriPrize(env,code,body) {
  if(!/^[a-z0-9_]{2,50}$/.test(String(code||''))) throw error('Prêmio inválido.');
  const current=await env.DB.prepare(`
    SELECT code,label,kind,value,weight,max_claims,enabled
    FROM v2_black_libri_prizes WHERE code=?
  `).bind(code).first();
  if(!current) throw error('Prêmio não encontrado.',404);
  if(!body||typeof body!=='object'||Array.isArray(body)) throw error('Dados inválidos.');
  const weight=parseWhole(body.weight,1,2000,'Peso');
  const enabled=body.enabled===true?1:body.enabled===false?0:null;
  if(enabled===null) throw error('Escolha se o prêmio está habilitado.');
  const limit=body.maxClaims===null?null:parseWhole(body.maxClaims,1,100000,'Limite');
  const stock=await env.DB.prepare(`
    SELECT COUNT(*) AS qty FROM v2_black_libri_claims
    WHERE prize_code=? AND (status='redeemed'
      OR (status IN ('reserved','attached') AND expires_at>?))
  `).bind(code,nowIso()).first();
  if(limit!==null && limit<Number(stock?.qty||0)) {
    throw error('Este limite é menor que os prêmios já reservados e confirmados.',409);
  }
  // A campanha não permite editar valor, tipo ou nome de prêmio já atribuído.
  // Pesos são configuração futura; toda alteração fica registrada em auditoria.
  const stamp=nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE v2_black_libri_prizes
      SET weight=?,max_claims=?,enabled=? WHERE code=?`
    ).bind(weight,limit,enabled,code),
    env.DB.prepare(`INSERT INTO v2_black_libri_audit
      (action_code,target_code,before_json,after_json,created_at)
      VALUES('prize_configuration',?,?,?,?)`
    ).bind(code,JSON.stringify({weight:current.weight,maxClaims:current.max_claims,enabled:!!current.enabled}),
      JSON.stringify({weight,maxClaims:limit,enabled:!!enabled}),stamp)
  ]);
  return getBlackLibriAdmin(env);
}

export async function saveBlackLibriCampaign(env,body) {
  if(!body||typeof body!=='object'||Array.isArray(body)) throw error('Dados inválidos.');
  if(typeof body.adminEnabled!=='boolean'||typeof body.complianceConfirmed!=='boolean') {
    throw error('Dados de ativação inválidos.');
  }
  const ref=String(body.authorizationReference||'').trim().slice(0,160);
  const note=String(body.adminNote||'').trim().slice(0,600);
  if(body.adminEnabled) {
    if(!blackLibriEnvironmentReady(env)) {
      throw error('Configure primeiro segredo e período no ambiente Cloudflare.',409);
    }
    if(!body.complianceConfirmed||ref.length<6) {
      throw error('É necessário registrar a autorização aplicável antes da ativação.',409);
    }
  }
  const current=await env.DB.prepare(`
    SELECT admin_enabled,compliance_confirmed,authorization_reference,admin_note
    FROM v2_black_libri_campaign_state WHERE id=1
  `).first();
  const stamp=nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE v2_black_libri_campaign_state
      SET admin_enabled=?,compliance_confirmed=?,authorization_reference=?,admin_note=?,updated_at=?
      WHERE id=1`).bind(body.adminEnabled?1:0,body.complianceConfirmed?1:0,ref,note,stamp),
    env.DB.prepare(`INSERT INTO v2_black_libri_audit
      (action_code,target_code,before_json,after_json,created_at)
      VALUES('campaign_configuration',NULL,?,?,?)`
    ).bind(JSON.stringify(current||{}),JSON.stringify({
      adminEnabled:body.adminEnabled,complianceConfirmed:body.complianceConfirmed,
      authorizationReference:ref,adminNote:note
    }),stamp)
  ]);
  return getBlackLibriAdmin(env);
}
