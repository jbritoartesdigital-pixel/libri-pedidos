import { nowIso } from './http.js';
import { blackLibriOperational } from './v2-black-libri.js';

function error(message,status=422,code='black_libri_admin_invalid') {
  return Object.assign(new Error(message),{ status,code });
}
function isoDate(value,label) {
  const date=String(value||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(Date.parse(date+'T12:00:00Z'))) {
    throw error('Escolha uma data válida em '+label+'.');
  }
  return date;
}
function startOfCampaign(value){return value+'T00:00:00-03:00';}
function endOfCampaign(value){return value+'T23:59:59-03:00';}

export async function getBlackLibriAdmin(env) {
  let campaign;
  let prizes;
  try {
    campaign=await env.DB.prepare(`
      SELECT admin_enabled,compliance_confirmed,authorization_reference,
        admin_note,valid_from,valid_until,updated_at
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
    if (/no such table|no such column/i.test(String(e.message||''))) {
      return {ok:true,migrationRequired:true,active:false,
        datesConfigured:false,prizes:[],
        campaign:null,summary:{totalRevealed:0,reserved:0,redeemed:0}};
    }
    throw e;
  }
  const available=prizes.filter(p=>p.enabled&&(p.available===null||p.available>0));
  const totalWeight=available.reduce((s,p)=>s+p.weight,0);
  return {
    ok:true,migrationRequired:false,
    datesConfigured:!!(campaign?.valid_from&&campaign?.valid_until),
    active:await blackLibriOperational(env),
    // Datas mantidas na mesma interface de datas dos cupons.
    windowStart:campaign?.valid_from||null,
    windowEnd:campaign?.valid_until||null,
    campaign:{
      adminEnabled:Number(campaign?.admin_enabled)===1,
      complianceConfirmed:Number(campaign?.compliance_confirmed)===1,
      authorizationReference:campaign?.authorization_reference||'',
      validFrom:campaign?.valid_from?.slice(0,10)||'',
      validUntil:campaign?.valid_until?.slice(0,10)||'',
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
  const campaign=await env.DB.prepare('SELECT admin_enabled FROM v2_black_libri_campaign_state WHERE id=1').first();
  if(Number(campaign?.admin_enabled)===1) {
    throw error('Pause a campanha antes de alterar estoque ou probabilidades.',409);
  }
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
  const from=body.validFrom ? isoDate(body.validFrom,'início') : '';
  const until=body.validUntil ? isoDate(body.validUntil,'término') : '';
  if ((from&&!until)||(!from&&until)) {
    throw error('Preencha as duas datas da Black Libri.');
  }
  if (from && Date.parse(startOfCampaign(from))>Date.parse(endOfCampaign(until))) {
    throw error('O término deve ser igual ou posterior ao início.');
  }
  if(body.adminEnabled) {
    if(!from||!until) throw error('Escolha início e término da campanha antes de ativar.',409);
    if(Date.parse(endOfCampaign(until))<=Date.now()) {
      throw error('A data de término da campanha já passou.',409);
    }
    if(!body.complianceConfirmed||ref.length<6) {
      throw error('É necessário registrar a autorização aplicável antes da ativação.',409);
    }
  }
  const current=await env.DB.prepare(`
    SELECT admin_enabled,compliance_confirmed,authorization_reference,admin_note,valid_from,valid_until
    FROM v2_black_libri_campaign_state WHERE id=1
  `).first();
  const stamp=nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE v2_black_libri_campaign_state
      SET admin_enabled=?,compliance_confirmed=?,authorization_reference=?,admin_note=?,valid_from=?,valid_until=?,updated_at=?
      WHERE id=1`).bind(body.adminEnabled?1:0,body.complianceConfirmed?1:0,ref,note,
        from?startOfCampaign(from):null,until?endOfCampaign(until):null,stamp),
    env.DB.prepare(`INSERT INTO v2_black_libri_audit
      (action_code,target_code,before_json,after_json,created_at)
      VALUES('campaign_configuration',NULL,?,?,?)`
    ).bind(JSON.stringify(current||{}),JSON.stringify({
      adminEnabled:body.adminEnabled,complianceConfirmed:body.complianceConfirmed,
      authorizationReference:ref,adminNote:note,validFrom:from,validUntil:until
    }),stamp)
  ]);
  return getBlackLibriAdmin(env);
}
