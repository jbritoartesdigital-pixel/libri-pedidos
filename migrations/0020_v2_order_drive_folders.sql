-- Etapa 3 | Vínculo explícito entre pedido e pasta Drive.
-- Somente metadata, nenhum token, arquivo, autorização nem sincronização.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS v2_order_drive_folders (
  order_code TEXT PRIMARY KEY NOT NULL,
  folder_id TEXT NOT NULL UNIQUE,
  sync_status TEXT NOT NULL DEFAULT 'pending_connection'
    CHECK(sync_status IN ('pending_connection','verified','sync_error')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_code) REFERENCES v2_orders(order_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_drive_folder_status ON v2_order_drive_folders(sync_status);
