import { nowIso } from './http.js';
import { withV2PaymentLock } from './v2-payment-lock.js';
import { cancelMercadoPagoOrder, syncMercadoPagoOrder } from './v2-mercadopago.js';

// Runs only from the authenticated Central, after explicit confirmation.
// Cancels the former Mercado Pago preference, NOT the client's Libri order.
export async function releaseV2PendingCheckoutForAdminDeposit(env, code) {
  if (!/^LIBRI-\d+$/.test(String(code || ''))) {
    const e = new Error('Código do pedido inválido.'); e.status = 422; throw e;
  }
  const db = env.DB;
  const row = await db.prepare(`
    SELECT o.id, o.order_code, o.public_token, o.status, o.briefing_status,
           p.payment_method, p.deposit_percent
    FROM v2_orders o JOIN v2_order_pricing p ON p.order_id=o.id
    WHERE o.order_code=? LIMIT 1
  `).bind(code).first();
  if (!row) { const e = new Error('Pedido não encontrado.'); e.status = 404; throw e; }
  if (row.payment_method !== 'pix'
    || !['awaiting_payment', 'urgency_approved', 'configuring'].includes(row.status)
    || row.briefing_status !== 'locked') {
    const e = new Error('Somente pedidos Pix aguardando pagamento podem trocar a entrada.');
    e.status = 409; throw e;
  }
  return withV2PaymentLock(db, row.id, async () => {
    const payments = (await db.prepare(`
      SELECT provider_order_id, status FROM v2_payments
      WHERE order_id=? AND provider='mercado_pago' AND status IN ('pending','approved')
      ORDER BY id DESC
    `).bind(row.id).all()).results || [];
    const approved = await db.prepare(`
      SELECT 1 FROM v2_payments WHERE order_id=? AND status='approved' LIMIT 1
    `).bind(row.id).first();
    if (approved) {
      const e = new Error('Já há pagamento aprovado. Confira o Financeiro; não cancele esta cobrança.');
      e.status = 409; throw e;
    }
    const pending = payments.filter(p => p.status === 'pending');
    const holds = (await db.prepare(`
      SELECT id FROM v2_checkout_holds WHERE order_id=? AND status='active'
    `).bind(row.id).all()).results || [];
    if (!pending.length && holds.length) {
      const e = new Error('Há uma reserva sem cobrança identificada. Verifique o checkout antes de alterar.');
      e.status = 409; throw e;
    }
    if (pending.some(p => !p.provider_order_id)) {
      const e = new Error('Há uma cobrança sem identificador do Mercado Pago. Não é seguro alterar.');
      e.status = 409; throw e;
    }
    let cancelled = 0;
    for (const payment of pending) {
      const before = await syncMercadoPagoOrder(env, payment.provider_order_id, { lock: false });
      if (before.approved || before.paymentStatus === 'approved') {
        const e = new Error('Pagamento aprovado no Mercado Pago. Nenhuma nova cobrança será criada.');
        e.status = 409; throw e;
      }
      if (before.paymentStatus === 'pending') {
        await cancelMercadoPagoOrder(env, payment.provider_order_id);
      }
      const verified = await syncMercadoPagoOrder(env, payment.provider_order_id, { lock: false });
      if (verified.approved || verified.paymentStatus === 'approved') {
        const e = new Error('Pagamento recebido enquanto a cobrança era revisada. Confira o Financeiro.');
        e.status = 409; throw e;
      }
      if (verified.paymentStatus === 'pending' || !verified.found) {
        const e = new Error('A cobrança original ainda não foi encerrada pelo Mercado Pago. Tente novamente após a confirmação.');
        e.status = 409; throw e;
      }
      cancelled++;
    }
    const remaining = await db.prepare(`
      SELECT 1 FROM v2_payments
      WHERE order_id=? AND (status='approved' OR (provider='mercado_pago' AND status='pending'))
      LIMIT 1
    `).bind(row.id).first();
    if (remaining) {
      const e = new Error('Ainda há pagamento ativo no pedido. Confira o Financeiro.');
      e.status = 409; throw e;
    }
    if (cancelled) {
      await db.batch([
        db.prepare(`
          UPDATE v2_checkout_holds SET status='cancelled',updated_at=?
          WHERE order_id=? AND status='active'
        `).bind(nowIso(),row.id),
        db.prepare(`
          INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at)
          VALUES (?,?,?,?,?)
        `).bind(row.id,'admin_checkout_released_for_deposit',
          'Administradora encerrou checkout anterior para autorizar nova entrada Pix no mesmo pedido.',
          JSON.stringify({cancelledProviderCheckouts:cancelled,orderCode:row.order_code,
            sameOrder:true,briefingAndGiftPreserved:true}),nowIso()),
      ]);
    }
    return { ok:true, cancelled, orderCode:row.order_code,
      customerAreaPath:`/meu-pedido/${row.public_token}`,
      sameOrder:true, giftAndBriefingPreserved:true,
      message:'Checkout anterior encerrado. Escolha 50% no editor e salve; a cliente usará seu pedido original.' };
  });
}
