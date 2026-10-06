-- ==================================================
-- LIBRI CONVITES
-- CORREÇÃO PÓS-MIGRAÇÃO V1
-- FINALIZADOS + COMPETÊNCIA FINANCEIRA
--
-- Corrige somente registros importados da V1.
-- Não altera pedidos nativos da V2 nem apaga a origem V1.
-- ==================================================

PRAGMA foreign_keys = ON;

-- 1) Pagamentos importados sem evento histórico explícito de confirmação
-- não podem herdar updated_at, porque ele pode ter sido alterado perto da
-- migração e deslocar receita antiga para o mês atual.
UPDATE v2_payments
SET
  paid_at = COALESCE(
    (
      SELECT MIN(h.created_at)
      FROM order_history h
      INNER JOIN orders legacy
        ON legacy.id = h.order_id
      INNER JOIN v2_orders migrated
        ON migrated.order_code = legacy.order_code
      WHERE
        migrated.id = v2_payments.order_id
        AND (
          (
            v2_payments.payment_type = 'deposit'
            AND h.action_code = 'update_entry_status'
            AND h.description LIKE '%confirm%'
          )
          OR (
            v2_payments.payment_type = 'balance'
            AND h.action_code = 'update_balance_status'
            AND h.description LIKE '%confirm%'
          )
        )
    ),
    (
      SELECT legacy.created_at
      FROM orders legacy
      INNER JOIN v2_orders migrated
        ON migrated.order_code = legacy.order_code
      WHERE migrated.id = v2_payments.order_id
      LIMIT 1
    ),
    paid_at
  )
WHERE
  json_extract(
    provider_payload_json,
    '$.source'
  ) = 'legacy_v1';

-- 2) Alguns pedidos antigos já tinham convite aprovado/entregue, mas a V1
-- não recebeu a marcação final de saldo. Se o evento já passou, convite
-- estava aprovado e o pedido não foi cancelado, ele é histórico finalizado,
-- não uma cobrança aberta da V2.
UPDATE v2_orders
SET
  status = 'finalized',
  next_action = 'Finalizado • importado da V1',
  finalized_at = COALESCE(
    finalized_at,
    (
      SELECT
        CASE
          WHEN legacy.status = 'finished'
            THEN COALESCE(
              NULLIF(legacy.updated_at, ''),
              legacy.created_at
            )
          ELSE COALESCE(
            NULLIF(legacy.event_date, ''),
            substr(legacy.updated_at, 1, 10),
            substr(legacy.created_at, 1, 10)
          )
        END
      FROM orders legacy
      WHERE legacy.order_code = v2_orders.order_code
      LIMIT 1
    ),
    updated_at
  )
WHERE
  event_subtype = 'legacy_v1'
  AND EXISTS (
    SELECT 1
    FROM orders legacy
    WHERE
      legacy.order_code = v2_orders.order_code
      AND legacy.status != 'cancelled'
      AND (
        legacy.status = 'finished'
        OR (
          legacy.invitation_status = 'approved'
          AND date(
            COALESCE(
              NULLIF(legacy.event_date, ''),
              substr(legacy.created_at, 1, 10)
            )
          ) < date('now')
        )
      )
  );

-- 3) Pedido finalizado não ocupa mais capacidade futura.
DELETE FROM v2_agenda_allocations
WHERE order_id IN (
  SELECT id
  FROM v2_orders
  WHERE
    event_subtype = 'legacy_v1'
    AND status = 'finalized'
);

-- 4) Marca a correção para auditoria operacional.
INSERT OR REPLACE INTO v2_settings(
  key,
  value,
  updated_at
)
VALUES (
  'legacy_v1_finance_repair',
  'applied',
  datetime('now')
);
