-- ==================================================
-- LIBRI CONVITES
-- CORREÇÃO COMPLEMENTAR PÓS-MIGRAÇÃO V1
-- PEDIDOS HISTÓRICOS PAGOS + EVENTO PASSADO
--
-- Esta migration é intencionalmente separada da 0015 porque a 0015
-- pode já ter sido aplicada em produção. Assim, esta correção também
-- alcança bancos que já registraram a migration anterior.
--
-- Corrige somente pedidos importados da V1.
-- Não altera pedidos nativos da V2 nem apaga a origem V1.
-- ==================================================

PRAGMA foreign_keys = ON;

-- 1) Um pedido V1 com evento já passado e evidência forte de conclusão
-- não pode permanecer como produção/saldo pendente na V2.
--
-- Evidências aceitas:
-- - status legado explicitamente "finished";
-- - convite legado aprovado;
-- - saldo legado confirmado (pedido quitado).
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
              NULLIF(legacy.finalized_at, ''),
              NULLIF(legacy.updated_at, ''),
              legacy.created_at
            )
          WHEN legacy.balance_status = 'confirmed'
            THEN COALESCE(
              (
                SELECT MAX(h.created_at)
                FROM order_history h
                WHERE
                  h.order_id = legacy.id
                  AND h.action_code = 'update_balance_status'
                  AND h.description LIKE '%confirm%'
              ),
              NULLIF(legacy.event_date, ''),
              NULLIF(legacy.updated_at, ''),
              legacy.created_at
            )
          ELSE COALESCE(
            NULLIF(legacy.event_date, ''),
            NULLIF(legacy.updated_at, ''),
            legacy.created_at
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
      AND date(
        COALESCE(
          NULLIF(legacy.event_date, ''),
          substr(legacy.created_at, 1, 10)
        )
      ) < date('now')
      AND (
        legacy.status = 'finished'
        OR legacy.invitation_status = 'approved'
        OR legacy.balance_status = 'confirmed'
      )
  );

-- 2) Reforça a competência financeira histórica dos pagamentos V1.
-- Nunca usa updated_at como fallback porque esse campo pode ter sido
-- tocado perto da migração e deslocar receita antiga para o mês atual.
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

-- 3) Finalizados históricos não consomem a agenda/capacidade de produção.
DELETE FROM v2_agenda_allocations
WHERE order_id IN (
  SELECT id
  FROM v2_orders
  WHERE
    event_subtype = 'legacy_v1'
    AND status = 'finalized'
);

-- 4) Notificações antigas desses pedidos deixam de aparecer como ação pendente.
UPDATE v2_notifications
SET resolved_at = COALESCE(
  resolved_at,
  datetime('now')
)
WHERE
  order_id IN (
    SELECT id
    FROM v2_orders
    WHERE
      event_subtype = 'legacy_v1'
      AND status = 'finalized'
  )
  AND resolved_at IS NULL;

-- 5) Marcador de auditoria operacional.
INSERT OR REPLACE INTO v2_settings(
  key,
  value,
  updated_at
)
VALUES (
  'legacy_v1_paid_history_repair',
  'applied',
  datetime('now')
);
