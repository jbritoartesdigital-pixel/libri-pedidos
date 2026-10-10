import {driveConnectionStatus} from './v2-google-drive-oauth.js';
import {uploadApprovedPreview} from './v2-google-drive-upload.js';

export async function getDriveSyncSetting(DB){
  const row=await DB.prepare(
    "SELECT enabled,enabled_at,updated_at FROM v2_drive_sync_settings WHERE account_key='primary' LIMIT 1"
  ).first();
  return {enabled:Number(row?.enabled||0)===1,enabledAt:row?.enabled_at||null,
    updatedAt:row?.updated_at||null};
}
export async function setDriveSyncSetting(env,enabled){
  if(typeof enabled!=='boolean')throw Error('Escolha ativar ou desativar a sincronização.');
  if(enabled){
    const connection=await driveConnectionStatus(env);
    if(!connection.configured||!connection.connected)
      throw Error('Conecte sua conta do Google Drive antes de ativar o envio automático.');
  }
  const previous=await getDriveSyncSetting(env.DB);
  if(previous.enabled===enabled)return previous;
  await env.DB.prepare(
    "INSERT INTO v2_drive_sync_settings(account_key,enabled,enabled_at,updated_at)"+
    " VALUES ('primary',?,?,datetime('now'))"+
    " ON CONFLICT(account_key) DO UPDATE SET enabled=excluded.enabled,"+
    " enabled_at=excluded.enabled_at,updated_at=datetime('now')"
  ).bind(enabled?1:0,enabled?new Date().toISOString():null).run();
  return getDriveSyncSetting(env.DB);
}
/**
 * Only newly approved previews (after explicit opt-in) are synchronized.
 * No scene, final video, unapproved, canceled or historical media are inferred.
 * Scheduled execution is bounded to two files per tick and five failures each.
 */
export async function runV2DriveSync(env){
  const settings=await getDriveSyncSetting(env.DB);
  if(!settings.enabled||!settings.enabledAt)
    return {enabled:false,attempted:0,sent:0,failed:0};
  const connection=await driveConnectionStatus(env);
  if(!connection.configured||!connection.connected)
    return {enabled:true,waitingForConnection:true,attempted:0,sent:0,failed:0};
  const sql=[
    'SELECT p.id AS preview_id,o.order_code',
    'FROM v2_previews p',
    'JOIN v2_orders o ON o.id=p.order_id',
    'JOIN v2_preview_approvals a ON a.preview_id=p.id AND a.order_id=p.order_id',
    'JOIN v2_order_drive_folders f ON f.order_code=o.order_code',
    'LEFT JOIN v2_drive_uploaded_previews uploaded ON uploaded.preview_id=p.id',
    'LEFT JOIN v2_drive_sync_attempts attempt ON attempt.preview_id=p.id',
    "WHERE p.status='approved' AND p.original_r2_key IS NOT NULL",
    "AND o.status NOT IN ('cancelled','finalized')",
    'AND f.folder_id IS NOT NULL AND uploaded.preview_id IS NULL',
    'AND julianday(a.approved_at)>=julianday(?)',
    'AND COALESCE(attempt.failures,0)<5',
    "AND (attempt.next_attempt_at IS NULL OR datetime(attempt.next_attempt_at)<=datetime('now'))",
    'ORDER BY a.approved_at,p.id LIMIT 2'
  ].join(' ');
  const pending=(await env.DB.prepare(sql).bind(settings.enabledAt).all()).results;
  let sent=0,failed=0;
  for(const item of pending){
    try{
      await uploadApprovedPreview(env,item.order_code,Number(item.preview_id));
      await env.DB.prepare('DELETE FROM v2_drive_sync_attempts WHERE preview_id=?')
        .bind(item.preview_id).run();
      sent++;
    }catch{
      failed++;
      await env.DB.prepare(
        'INSERT INTO v2_drive_sync_attempts(preview_id,failures,next_attempt_at,last_failed_at)'+
        " VALUES (?,1,datetime('now','+1 hour'),datetime('now'))"+
        " ON CONFLICT(preview_id) DO UPDATE SET failures=failures+1,"+
        " next_attempt_at=datetime('now','+1 hour'),last_failed_at=datetime('now')"
      ).bind(item.preview_id).run();
    }
  }
  return {enabled:true,attempted:pending.length,sent,failed};
}
