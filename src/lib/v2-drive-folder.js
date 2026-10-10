/**
 * Etapa 3 | vínculo de pasta por pedido.
 *
 * Metadata only. Sync is deliberately DISABLED until Google OAuth credentials
 * and a verified upload transport exist. No tokens, signed links or file bytes.
 */
const ORDER=/^LIBRI-\d{1,15}$/;
const ID=/^[A-Za-z0-9_-]{15,128}$/;
const FOLDER_URL=/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{15,128})\/?(?:\?[^#]*)?$/;

export function parseDriveFolderId(raw){
  if(typeof raw!=='string'||raw.length>400)throw Error('Informe um ID ou link de pasta válido do Google Drive.');
  const input=raw.trim(),fromUrl=FOLDER_URL.exec(input);
  const id=fromUrl?.[1]||input;
  if(!ID.test(id))throw Error('Use o link completo ou o ID exato da pasta do Google Drive.');
  return id;
}
function checkedOrder(code){
  if(!ORDER.test(String(code||'')))throw Error('Código de pedido inválido.');
  return code;
}
async function knownOrder(DB,code){
  return Boolean(await DB.prepare('SELECT 1 AS ok FROM v2_orders WHERE order_code = ? LIMIT 1').bind(code).first());
}
export async function readOrderDriveFolder(DB,code){
  checkedOrder(code);
  if(!await knownOrder(DB,code))return null;
  const row=await DB.prepare('SELECT folder_id, sync_status, updated_at FROM v2_order_drive_folders WHERE order_code = ? LIMIT 1')
    .bind(code).first();
  return {orderCode:code,folderId:row?.folder_id||null,syncStatus:row?.sync_status||'not_linked',
    updatedAt:row?.updated_at||null,uploadEnabled:false,
    message:'Vínculo preparado. Envio automático aguarda integração autenticada com o Google Drive.'};
}
export async function saveOrderDriveFolder(DB,code,raw){
  checkedOrder(code);
  const folderId=parseDriveFolderId(raw);
  if(!await knownOrder(DB,code))return null;
  const used=await DB.prepare('SELECT order_code FROM v2_order_drive_folders WHERE folder_id = ? AND order_code <> ? LIMIT 1')
    .bind(folderId,code).first();
  if(used)throw Error('Essa pasta já está vinculada a outro pedido. Escolha a pasta exclusiva desta cliente.');
  const previous=await DB.prepare('SELECT folder_id FROM v2_order_drive_folders WHERE order_code = ? LIMIT 1')
    .bind(code).first();
  // Prevent a DB uniqueness race. Any unique violation is surfaced as conflict
  // by the admin route and does not expose the other order code.
  await DB.prepare(\`INSERT INTO v2_order_drive_folders (order_code,folder_id,sync_status,updated_at)
    VALUES (?,?,'pending_connection',datetime('now'))
    ON CONFLICT(order_code) DO UPDATE SET
      folder_id=excluded.folder_id,
      sync_status=CASE WHEN v2_order_drive_folders.folder_id=excluded.folder_id
        THEN v2_order_drive_folders.sync_status ELSE 'pending_connection' END,
      updated_at=datetime('now')\`).bind(code,folderId).run();
  return {...await readOrderDriveFolder(DB,code),changed:previous?.folder_id!==folderId};
}
