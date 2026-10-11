import { json } from '../lib/http.js';
import { listFlowProductionOrders } from '../lib/v2-flow-orders.js';

// Executed ONLY after the existing /api/admin/v2 passkey session gate.
export async function handleAdminFlowV2Api(request, env, url) {
  if (url.pathname !== '/api/admin/v2/flow/projects') return null;
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  const projects = await listFlowProductionOrders(env.DB);
  return json({ ok: true, readOnly: true, projects });
}
