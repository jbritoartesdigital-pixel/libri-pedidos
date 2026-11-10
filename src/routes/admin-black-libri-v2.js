import { fail, json, readJson } from '../lib/http.js';
import { blackLibriEnabled } from '../lib/v2-black-libri.js';

// O roteador principal exige passkey antes de chamar esta rota.
export async function handleAdminBlackLibriV2Api(request, env, url) {
  const path = url.pathname;
  if (!path.startsWith('/api/admin/v2/black-libri')) return null;
  const method = request.method.toUpperCase();
  if (method === 'GET' && path === '/api/admin/v2/black-libri') {
    try {
      const [prizes, summary] = await Promise.all([
        env.DB.prepare(`
          SELECT p.code,p.label,p.kind,p.value,p.weight,p.max_claims,p.enabled,p.description,p.sort_order,
            (SELECT count(*) FROM v2_black_libri_claims c WHERE c.prize_code=p.code AND
              (c.status='redeemed' OR (c.status IN ('reserved','attached') AND c.expires_at > datetime('now')))) AS occupied,
            (SELECT count(*) FROM v2_black_libri_claims c WHERE c.prize_code=p.code AND c.status='redeemed') AS redeemed
          FROM v2_black_libri_prizes p ORDER BY p.sort_order
        `).all(),
        env.DB.prepare(`
          SELECT status,count(*) AS total FROM v2_black_libri_claims GROUP BY status
        `).all()
      ]);
      const rows = prizes.results || [];
      const available = rows.filter(p => Number(p.enabled) === 1 &&
        (p.max_claims === null || Number(p.occupied) < Number(p.max_claims)));
      const totalWeight = available.reduce((n,p) => n + Number(p.weight),0);
      return json({
        ok:true,
        enabled:blackLibriEnabled(env),
        activationManagedBy:'cloudflare',
        prizes:rows.map(p=>({
          ...p,
          probability:totalWeight && available.some(a=>a.code===p.code)
            ? Number(p.weight)/totalWeight : 0,
          remaining:p.max_claims===null ? null : Math.max(0,Number(p.max_claims)-Number(p.occupied))
        })),
        counts:Object.fromEntries((summary.results||[]).map(r=>[r.status,Number(r.total)])),
        totalWeight
      });
    } catch(error) {
      return fail('Dados da campanha indisponíveis. Confira a migration 0029.',503);
    }
  }
  const match = path.match(/^\/api\/admin\/v2\/black-libri\/prizes\/([a-z0-9_]+)$/);
  if (method === 'PATCH' && match) {
    if (blackLibriEnabled(env)) {
      return fail('A edição dos pesos e estoques fica bloqueada enquanto a campanha estiver ativa.',409);
    }
    try {
      const data=await readJson(request);
      const weight=Number(data.weight);
      const maxClaims=data.maxClaims===null || data.maxClaims==='' ? null : Number(data.maxClaims);
      const enabled=data.enabled===true ? 1 : data.enabled===false ? 0 : NaN;
      if (!Number.isSafeInteger(weight) || weight<1 || weight>10000 ||
          (maxClaims!==null && (!Number.isSafeInteger(maxClaims)||maxClaims<1||maxClaims>100000)) ||
          !Number.isSafeInteger(enabled)) {
        return fail('Peso, estoque ou situação inválidos.',422);
      }
      const result=await env.DB.prepare(`
        UPDATE v2_black_libri_prizes
        SET weight=?,max_claims=?,enabled=?
        WHERE code=?
          AND (? IS NULL OR ? >=
            (SELECT count(*) FROM v2_black_libri_claims c
              WHERE c.prize_code=v2_black_libri_prizes.code
              AND (c.status='redeemed' OR
                (c.status IN ('reserved','attached') AND c.expires_at > datetime('now')))))
      `).bind(weight,maxClaims,enabled,match[1],maxClaims,maxClaims).run();
      if (Number(result.meta?.changes||0)!==1) {
        return fail('Prêmio inexistente ou estoque menor que as reservas já concedidas.',409);
      }
      return json({ok:true});
    } catch(error) {
      return fail('Não foi possível salvar a configuração.',503);
    }
  }
  return fail('Rota Black Libri não encontrada.',404);
}
