/**
 * Project Bible read model (server side), always sourced from approved previews.
 * Avoid exporting order PII, private links, signed URLs and R2 key internals.
 * Folder links are metadata only. No upload is claimed or attempted.
 */
const CODE=/^LIBRI-\d{1,15}$/;
function fileExtension(key,type){
  const e=String(key||'').split('/').at(-1)?.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
  if(['mp4','mov','webm','png','jpg','jpeg','gif','webp'].includes(e))return '.'+e;
  return type==='video'?'.mp4':'.png';
}
export async function getApprovedProjectBible(DB,orderCode){
  if(!CODE.test(String(orderCode||'')))throw Error('Código inválido.');
  const order=await DB.prepare(
    'SELECT id,order_code,event_type,event_date FROM v2_orders WHERE order_code=? LIMIT 1'
  ).bind(orderCode).first();
  if(!order)return null;
  const drives=await DB.prepare(
    'SELECT folder_id,sync_status FROM v2_order_drive_folders WHERE order_code=? LIMIT 1'
  ).bind(orderCode).first();
  const rows=(await DB.prepare(
    \`SELECT p.id,p.version_number,p.media_type,p.original_r2_key,p.preview_r2_key,
      a.approved_at,a.evidence_json
     FROM v2_previews p
     JOIN v2_preview_approvals a ON a.preview_id=p.id AND a.order_id=p.order_id
     WHERE p.order_id=? AND p.status='approved'
     ORDER BY p.version_number ASC,p.id ASC\`
  ).bind(order.id).all()).results;
  const previews=rows.map(p=>{
    let channel='customer_area';
    try{
      const evidence=JSON.parse(p.evidence_json||'{}');
      if(evidence.source==='admin_external')channel='admin_external';
    }catch{}
    return{
      previewId:Number(p.id),version:Number(p.version_number),
      mediaType:p.media_type,
      filename:'Preview_v'+String(p.version_number).padStart(2,'0')+
        fileExtension(p.original_r2_key||p.preview_r2_key,p.media_type),
      approvedAt:p.approved_at,
      approvalSource:channel,
      originalAvailable:Boolean(p.original_r2_key),
      driveStatus:drives?.folder_id?'pending_connection':'folder_not_linked'
    };
  });
  return{
    schema:'libri_project_bible_v1',projectId:order.order_code,
    orderCode:order.order_code,eventType:order.event_type,
    eventDate:order.event_date,drive:{
      linked:Boolean(drives?.folder_id),
      syncStatus:drives?.sync_status||'not_linked',
      uploadEnabled:false
    },
    approvedPreviews:previews,
    notes:[
      'Prévia aprovada não comprova que cada cena ou vídeo final foi aprovado separadamente.',
      'Sem URLs privadas, dados de cliente, fotos, credenciais ou tokens.',
      'O arquivo é um retrato atual; sincronização Google Drive ainda não está ativada.'
    ]
  };
}
