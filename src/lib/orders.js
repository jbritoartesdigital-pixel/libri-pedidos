import {
  nowIso,
  parseJson,
} from './http.js';

export async function addHistory(
  db,
  orderId,
  actionCode,
  description,
  metadata = {},
) {
  await db
    .prepare(
      `
        INSERT INTO order_history(
          order_id,
          action_code,
          description,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .bind(
      orderId,
      actionCode,
      description,
      JSON.stringify(
        metadata || {},
      ),
      nowIso(),
    )
    .run();
}

export async function getOrderDetail(
  db,
  id,
) {
  const order =
    await db
      .prepare(
        `
          SELECT *
          FROM orders
          WHERE id = ?
        `,
      )
      .bind(id)
      .first();

  if (!order) {
    return null;
  }

  const [
    history,
    notes,
  ] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT *
            FROM order_history
            WHERE order_id = ?
            ORDER BY
              created_at DESC,
              id DESC
          `,
        )
        .bind(id)
        .all(),

      db
        .prepare(
          `
            SELECT *
            FROM internal_notes
            WHERE order_id = ?
            ORDER BY
              created_at DESC,
              id DESC
          `,
        )
        .bind(id)
        .all(),
    ]);

  return {
    ...order,

    addons:
      parseJson(
        order.addons_json,
        {},
      ),

    briefing:
      parseJson(
        order.briefing_json,
        {},
      ),

    pricing:
      parseJson(
        order.pricing_json,
        {},
      ),

    history:
      history.results
      || [],

    notes:
      notes.results
      || [],
  };
}

export function addBusinessDays(
  startDate,
  businessDays,
) {
  const date =
    new Date(
      startDate,
    );

  let remaining =
    Math.max(
      0,
      Number.parseInt(
        businessDays,
        10,
      )
      || 0,
    );

  while (
    remaining > 0
  ) {
    date.setUTCDate(
      date.getUTCDate()
      + 1,
    );

    const day =
      date.getUTCDay();

    if (
      day !== 0
      && day !== 6
    ) {
      remaining -= 1;
    }
  }

  return date
    .toISOString();
}

export function nextActionFor(
  order,
) {
  if (!order) {
    return 'Abrir pedido';
  }

  /*
   * Estados finais primeiro.
   *
   * Um pedido encerrado não deve
   * continuar sugerindo ações
   * operacionais no painel.
   */
  if (
    order.status
    === 'cancelled'
  ) {
    return 'Cancelado';
  }

  if (
    order.status
    === 'finished'
  ) {
    return 'Finalizado';
  }

  /*
   * FOTOS
   */
  if (
    order.photos_status
    === 'waiting'
  ) {
    return 'Aguardar fotos';
  }

  if (
    order.photos_status
    === 'received'
  ) {
    return 'Conferir fotos';
  }

  if (
    order.photos_status
    === 'needs_new'
  ) {
    return 'Aguardar novas fotos';
  }

  if (
    order.photos_status
    !== 'approved'
  ) {
    return 'Conferir fotos';
  }

  /*
   * ENTRADA
   */
  if (
    order.entry_status
    !== 'confirmed'
  ) {
    return 'Confirmar entrada';
  }

  /*
   * PRODUÇÃO
   */
  if (
    !order.production_started_at
  ) {
    return 'Iniciar produção';
  }

  /*
   * MASCOTE
   */
  if (
    order.mascot_status
    !== 'approved'
  ) {
    return 'Criar ou aprovar mascote';
  }

  /*
   * FALAS
   */
  if (
    order.speech_mode
      === 'approve'
    && order.speech_status
      !== 'approved'
  ) {
    return 'Aprovar falas';
  }

  /*
   * CONVITE
   */
  if (
    order.invitation_status
    !== 'approved'
  ) {
    return 'Produzir ou aprovar convite';
  }

  /*
   * SALDO
   */
  if (
    order.balance_status
    !== 'confirmed'
  ) {
    return 'Confirmar saldo';
  }

  /*
   * Tudo concluído,
   * mas o pedido ainda não foi
   * marcado como finalizado.
   */
  return 'Finalizar pedido';
}