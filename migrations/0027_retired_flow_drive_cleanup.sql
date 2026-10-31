-- Retira somente tabelas de integrações descontinuadas, após desativação
-- das rotas/aplicativos Flow + Google Drive. Migração irreversível sem D1 Time Travel.
-- Nunca remove v2_orders, v2_previews, dados de pagamentos ou mídia.
PRAGMA foreign_keys=ON;

DROP TABLE IF EXISTS v2_flow_drive_uploads;
DROP TABLE IF EXISTS v2_flow_publication_links;
DROP TABLE IF EXISTS v2_flow_device_grants;
DROP TABLE IF EXISTS v2_drive_sync_attempts;
DROP TABLE IF EXISTS v2_drive_sync_settings;
DROP TABLE IF EXISTS v2_drive_uploaded_previews;
DROP TABLE IF EXISTS v2_order_drive_folders;
DROP TABLE IF EXISTS v2_drive_oauth_state;
DROP TABLE IF EXISTS v2_drive_oauth_connection;
