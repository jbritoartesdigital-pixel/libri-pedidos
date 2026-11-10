import { normalizeWhatsapp, nowIso, randomToken } from './http.js';
import { priceWithCardProcessingFee } from './v2-payment-pricing.js';

// OFF por padrão. Exige data inicial/final e secret antes da liberação comercial.
export function blackLibriEnabled(env, date = new Date()) {
  if (String(env.BLACK_LIBRI_ENABLED || '') !== '1') return false;
  if (!env.BLACK_LIBRI_IDENTITY_SECRET || String(env.BLACK_LIBRI_IDENTITY_SECRET).length < 24) return false;
  const start = Date.parse(String(env.BLACK_LIBRI_START || ''));
  const end = Date.parse(String(env.BLACK_LIBRI_END || ''));
  return Number.isFinite(start) && Number.isFinite(end)
    && start < end && date.getTime() >= start && date.getTime() < end;
}

export async function blackLibriOperational(env,date=new Date()) {
  if (!blackLibriEnabled(env,date)) return false;
  try {
    const row=await env.DB.prepare(`
      SELECT admin_enabled,compliance_confirmed,authorization_reference
      FROM v2_black_libri_campaign_state WHERE id=1
    `).first();
    return Number(row?.admin_enabled)===1
      && Number(row?.compliance_confirmed)===1
      && String(row?.authorization_reference||'').trim().length>=6;
  } catch {
    // Em caso de erro de banco ou migração ausente, a campanha fica desligada.
    return false;
  }
}

function customerPhone(customer) {
  const digits = normalizeWhatsapp(customer?.whatsapp);
  if (!/^\d{10,15}$/.test(digits)) {
    throw Object.assign(new Error('Confira o WhatsApp antes de escolher seu balão.'), { status: 422, code: 'black_libri_phone' });
  }
  return digits;
}

async function customerKey(env, customer) {
  if (!env.BLACK_LIBRI_IDENTITY_SECRET) throw Object.assign(new Error('A campanha está indisponível.'), { status: 503 });
  const key = await crypto.subtle.importKey('raw',
    new TextEncoder().encode(String(env.BLACK_LIBRI_IDENTITY_SECRET)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(customerPhone(customer)));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('');
}

const currentClaimSql = `
  SELECT c.id,c.client_request_id,c.prize_code,c.status,c.order_id,c.revealed_at,c.expires_at,
         p.label,p.kind,p.value,p.description
  FROM v2_black_libri_claims c
  JOIN v2_black_libri_prizes p ON p.code = c.prize_code
  WHERE c.customer_key = ? LIMIT 1
`;

async function updateClaimStatus(db, claim) {
  if (!claim) return null;
  if (claim.status === 'redeemed' || claim.status === 'expired') return claim;
  if (claim.order_id) {
    const payment = await db.prepare(`
      SELECT paid_at FROM v2_payments WHERE order_id = ? AND status = 'approved'
      AND paid_at IS NOT NULL ORDER BY paid_at LIMIT 1`
    ).bind(claim.order_id).first();
    if (payment && Date.parse(payment.paid_at) <= Date.parse(claim.expires_at)) {
      await db.prepare(`UPDATE v2_black_libri_claims SET status='redeemed',updated_at=?
        WHERE id=? AND status IN ('reserved','attached')`
      ).bind(nowIso(),claim.id).run();
      return { ...claim, status:'redeemed' };
    }
  }
  if (Date.parse(claim.expires_at) <= Date.now()) {
    await db.prepare(`UPDATE v2_black_libri_claims SET status='expired',updated_at=?
      WHERE id=? AND status IN ('reserved','attached')`
    ).bind(nowIso(),claim.id).run();
    return { ...claim, status:'expired' };
  }
  return claim;
}

export async function findBlackLibriClaim(env, customer) {
  const key = await customerKey(env, customer);
  const claim = await env.DB.prepare(currentClaimSql).bind(key).first();
  return updateClaimStatus(env.DB, claim);
}

function publicClaim(claim) {
  if (!claim) return null;
  return {
    id: claim.id,
    code: claim.prize_code,
    label: claim.label,
    kind: claim.kind,
    value: Number(claim.value || 0),
    description: claim.description,
    status: claim.status,
    expiresAt: claim.expires_at,
    revealedAt: claim.revealed_at,
    reserved: ['reserved','attached'].includes(claim.status)
  };
}

export async function blackLibriStatus(env, customer) {
  const active = await blackLibriOperational(env);
  if (!active) return { ok:true, enabled:false, claim:null };
  return { ok:true, enabled:true, claim:publicClaim(await findBlackLibriClaim(env, customer)) };
}

function cryptoChoice(weightSum) {
  const bucket = new Uint32Array(1);
  const domain = 0x100000000;
  const limit = domain - (domain % weightSum);
  do { crypto.getRandomValues(bucket); } while (bucket[0] >= limit);
  return bucket[0] % weightSum;
}

export async function revealBlackLibri(env, customer, clientRequestId) {
  if (!(await blackLibriOperational(env))) {
    throw Object.assign(new Error('A Black Libri ainda não está disponível.'), { status: 409, code: 'black_libri_disabled' });
  }
  const requestId = String(clientRequestId || '').trim();
  if (requestId.length < 12 || requestId.length > 120) {
    throw Object.assign(new Error('Reabra o pedido e tente novamente.'), { status:422 });
  }
  const key = await customerKey(env, customer);
  const existing = await findBlackLibriClaim(env, customer);
  if (existing) return { ok:true, enabled:true, claim:publicClaim(existing), alreadyRevealed:true };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const available = await env.DB.prepare(`
      SELECT p.code,p.weight
      FROM v2_black_libri_prizes p
      WHERE p.enabled=1 AND
        (p.max_claims IS NULL OR
          (SELECT count(*) FROM v2_black_libri_claims c WHERE c.prize_code=p.code AND
           (c.status='redeemed' OR
            (c.status IN ('reserved','attached') AND c.expires_at > ?))) < p.max_claims)
      ORDER BY p.sort_order`
    ).bind(nowIso()).all();
    const choices = (available.results || []).filter(p=>Number(p.weight)>0);
    const sum = choices.reduce((total,p)=>total+Number(p.weight),0);
    if (!sum) throw Object.assign(new Error('Todos os brindes desta edição se esgotaram.'), { status:409, code:'black_libri_sold_out' });
    let ticket = cryptoChoice(sum);
    let choice = choices[choices.length-1];
    for (const item of choices) {
      ticket -= Number(item.weight);
      if (ticket < 0) { choice = item; break; }
    }
    const id = randomToken('blk_');
    const stamp = nowIso();
    const expires = new Date(Date.now()+24*60*60*1000).toISOString();
    // Um único INSERT atômico verifica ao mesmo tempo identidade e estoque.
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO v2_black_libri_claims
        (id,customer_key,client_request_id,prize_code,status,revealed_at,expires_at,updated_at)
      SELECT ?,?,?,p.code,'reserved',?,?,? FROM v2_black_libri_prizes p
      WHERE p.code=? AND p.enabled=1 AND
        (p.max_claims IS NULL OR
          (SELECT count(*) FROM v2_black_libri_claims c WHERE c.prize_code=p.code AND
            (c.status='redeemed' OR
             (c.status IN ('reserved','attached') AND c.expires_at > ?))) < p.max_claims)
    `).bind(id,key,requestId,stamp,expires,stamp,choice.code,stamp).run();
    if (Number(result.meta?.changes||0)>0) {
      return { ok:true,enabled:true,claim:publicClaim(await findBlackLibriClaim(env,customer)),alreadyRevealed:false };
    }
    const concurrent = await findBlackLibriClaim(env,customer);
    if (concurrent) return { ok:true,enabled:true,claim:publicClaim(concurrent),alreadyRevealed:true };
  }
  throw Object.assign(new Error('Muitos acessos simultâneos. Tente novamente.'), { status:409,code:'black_libri_busy' });
}

export async function reservedBlackLibriForCheckout(env, customer, clientRequestId) {
  if (!env.BLACK_LIBRI_IDENTITY_SECRET) return null;
  const claim = await findBlackLibriClaim(env,customer);
  if (!claim || claim.status !== 'reserved') return null;
  // Mesmo aparelho ou outro navegador: a identidade pelo WhatsApp recupera
  // sempre a mesma reserva, sem permitir uma segunda escolha.
  return claim;
}

export function applyBlackLibriToQuote(quote, claim) {
  if (!claim) return quote;
  const discountBase = Math.max(0, Number(quote.baseTotalCents || 0));
  let discountCents = 0;
  if (claim.kind === 'fixed') discountCents = Number(claim.value);
  if (claim.kind === 'percent') discountCents = Math.round(discountBase * Number(claim.value)/100);
  // Não cria checkout de valor zero ou negativo.
  discountCents = Math.max(0,Math.min(Math.max(0,discountBase-100),discountCents));
  const adjustedBase = discountBase - discountCents;
  const priced = priceWithCardProcessingFee(adjustedBase,quote.payment.method);
  const depositPercent = Number(quote.payment.depositPercent||100);
  const depositCents = Math.round(priced.totalCents * depositPercent/100);
  return {
    ...quote,
    subtotalCents: Math.max(0, Number(quote.subtotalCents||0)-discountCents),
    baseTotalCents: adjustedBase,
    totalCents: priced.totalCents,
    cardFeeCents: priced.cardFeeCents,
    cardFeePercent: priced.cardFeePercent,
    blackLibriDiscountCents: discountCents,
    blackLibri: {
      claimId: claim.id,
      code: claim.prize_code,
      label: claim.label,
      kind: claim.kind,
      expiresAt: claim.expires_at,
      description: claim.description
    },
    payment: {
      ...quote.payment,
      depositCents,
      balanceCents: Math.max(0,priced.totalCents-depositCents)
    }
  };
}

export async function linkBlackLibriClaim(db, claim, orderId) {
  if (!claim) return;
  const changed = await db.prepare(`
    UPDATE v2_black_libri_claims SET order_id=?,status='attached',updated_at=?
    WHERE id=? AND client_request_id=? AND status='reserved' AND expires_at > ?
      AND order_id IS NULL
  `).bind(orderId,nowIso(),claim.id,claim.client_request_id,nowIso()).run();
  if (Number(changed.meta?.changes||0) !== 1) {
    throw Object.assign(new Error('A reserva do balão venceu ou está vinculada a outro pedido.'),{status:409,code:'black_libri_reservation_changed'});
  }
}

export async function unlinkBlackLibriClaim(db, orderId) {
  await db.prepare(`
    UPDATE v2_black_libri_claims SET order_id=NULL,status='reserved',updated_at=?
    WHERE order_id=? AND status='attached' AND expires_at>?
  `).bind(nowIso(),orderId,nowIso()).run();
}

export async function expireBlackLibriClaims(db) {
  const stamp = nowIso();
  await db.prepare(`
    UPDATE v2_black_libri_claims SET status='redeemed', updated_at=?
    WHERE status IN ('reserved','attached') AND order_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM v2_payments p WHERE p.order_id=v2_black_libri_claims.order_id
      AND p.status='approved' AND p.paid_at IS NOT NULL AND p.paid_at<=v2_black_libri_claims.expires_at)
  `).bind(stamp).run();
  await db.prepare(`
    UPDATE v2_black_libri_claims SET status='expired', updated_at=?
    WHERE status IN ('reserved','attached') AND expires_at<=?
  `).bind(stamp,stamp).run();
}
