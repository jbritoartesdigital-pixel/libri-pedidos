-- ==================================================
-- LIBRI PEDIDOS V2
-- REPARO DE DATAS DE ENTREGA DO LEGADO FINALIZADO
--
-- A V1 não tinha uma janela de entrega confiável equivalente à V2.
-- A migration 0014 precisou derivar uma janela para todos os registros,
-- o que produziu datas artificiais em pedidos que já estavam encerrados.
--
-- Para histórico finalizado:
-- - se a V1 foi realmente marcada como finished, usa a data histórica
--   de finalização como referência de entrega;
-- - se a finalização foi inferida pela 0015, não inventa uma data.
-- ==================================================

PRAGMA foreign_keys = ON;

UPDATE v2_orders
SET
  delivery_start = (
    SELECT substr(
      COALESCE(
        NULLIF(legacy.finalized_at, ''),
        NULLIF(legacy.updated_at, ''),
        legacy.created_at
      ),
      1,
      10
    )
    FROM orders legacy
    WHERE legacy.order_code = v2_orders.order_code
    LIMIT 1
  ),
  delivery_end = (
    SELECT substr(
      COALESCE(
        NULLIF(legacy.finalized_at, ''),
        NULLIF(legacy.updated_at, ''),
        legacy.created_at
      ),
      1,
      10
    )
    FROM orders legacy
    WHERE legacy.order_code = v2_orders.order_code
    LIMIT 1
  ),
  recommended_target_date = NULL
WHERE
  event_subtype = 'legacy_v1'
  AND status = 'finalized'
  AND EXISTS (
    SELECT 1
    FROM orders legacy
    WHERE
      legacy.order_code = v2_orders.order_code
      AND legacy.status = 'finished'
  );

UPDATE v2_orders
SET
  delivery_start = NULL,
  delivery_end = NULL,
  recommended_target_date = NULL
WHERE
  event_subtype = 'legacy_v1'
  AND status = 'finalized'
  AND EXISTS (
    SELECT 1
    FROM orders legacy
    WHERE
      legacy.order_code = v2_orders.order_code
      AND legacy.status != 'finished'
  );

DELETE FROM v2_agenda_allocations
WHERE order_id IN (
  SELECT id
  FROM v2_orders
  WHERE
    event_subtype = 'legacy_v1'
    AND status = 'finalized'
);

INSERT OR REPLACE INTO v2_settings(
  key,
  value,
  updated_at
)
VALUES (
  'legacy_v1_delivery_repair',
  'applied',
  datetime('now')
);
