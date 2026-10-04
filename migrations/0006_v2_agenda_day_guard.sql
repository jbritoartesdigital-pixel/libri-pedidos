-- ==================================================
-- LIBRI CONVITES
-- PEDIDOS V2 | GARANTIA DOS DIAS DA AGENDA
--
-- Migration aditiva.
-- Resolve a dependência entre alocações e v2_agenda_days:
-- qualquer alocação definitiva garante antes a existência
-- do respectivo dia com as capacidades padrão.
-- ==================================================

PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS trg_v2_agenda_allocations_ensure_day
BEFORE INSERT ON v2_agenda_allocations
FOR EACH ROW
BEGIN
  INSERT OR IGNORE INTO v2_agenda_days(
    day
  )
  VALUES (
    NEW.day
  );
END;
