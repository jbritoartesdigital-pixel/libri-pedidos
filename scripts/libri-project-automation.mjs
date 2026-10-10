/**
 * Libri Project Bible + social export plan (Etapas 3 e 4).
 *
 * Pure, offline and opt-in. NO Google APIs, Cloudflare requests, client data
 * search, publication, checkout, or automatic upload. Authenticated app
 * integration will own the approval events and per-project Drive folder IDs.
 */
import {readFileSync,mkdirSync,writeFileSync,statSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {spawnSync} from 'node:child_process';

const PROJECT_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{3,95}$/;
const DRIVE_ID=/^[a-zA-Z0-9_-]{15,128}$/;
const HASH=/^[a-f0-9]{64}$/i;
const TYPES=new Set(['character_reference','opening','scene','preview','final_card',
  'popup_location','popup_rsvp','popup_gifts','popup_dress_code','loop','final_video',
  'social_cover']);
const MIME_EXT={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp',
  'video/mp4':'.mp4','video/webm':'.webm','audio/mpeg':'.mp3'};
const FORMATS=new Set(['video','interativo','loop','save_the_date','casamento','outro']);
const typeName={
  character_reference:'Referencia de Personagem',opening:'Abertura',
  preview:'Preview',final_card:'Card Final',popup_location:'Popup Localizacao',
  popup_rsvp:'Popup Confirmacao',popup_gifts:'Popup Presentes',
  popup_dress_code:'Popup Dress Code',loop:'Loop',final_video:'Video Final',
  social_cover:'Capa Social'
};
function required(value,message){if(!value)throw Error(message);return value;}
function validDate(value){return typeof value==='string'&&
  /^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));}
function assertClean(text,max=2000){
  if(typeof text!=='string'||text.length>max||/[\u0000-\u001f]/.test(text))
    throw Error('Texto inválido');
  return text;
}
function fileKey(a){
  return a.type==='scene'?'scene:'+a.sceneNumber:a.type;
}
function filename(a){
  const key=a.type==='scene'?'Cena '+a.sceneNumber:typeName[a.type];
  return key+MIME_EXT[a.mimeType];
}
function validateAsset(a){
  if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Aprovação inválida');
  if(!PROJECT_ID.test(String(a.id||'')))throw Error('ID de aprovação inválido');
  if(!TYPES.has(a.type))throw Error('Tipo de mídia desconhecido');
  if(a.type==='scene'&&(!Number.isInteger(a.sceneNumber)||a.sceneNumber<1||a.sceneNumber>99))
    throw Error('Número da cena inválido');
  if(a.type!=='scene'&&a.sceneNumber!=null)throw Error('Número de cena inesperado');
  if(!MIME_EXT[a.mimeType])throw Error('MIME inválido');
  if(!Number.isInteger(a.version)||a.version<1||a.version>9999)throw Error('Versão inválida');
  if(!validDate(a.approvedAt))throw Error('Data da aprovação inválida');
  if(!HASH.test(String(a.sha256||'')))throw Error('Integridade SHA-256 obrigatória');
  if(typeof a.sourceRef!=='string'||!PROJECT_ID.test(a.sourceRef))
    throw Error('Identificador de mídia confiável obrigatório, sem URL ou token');
  if(a.approved!==true)throw Error('Somente aprovações confirmadas entram no Bible');
  if(a.notes!=null)assertClean(a.notes,2000);
  return {...a,notes:a.notes||''};
}
export function buildProjectBible(record){
  if(!record||typeof record!=='object')throw Error('Projeto ausente');
  if(!PROJECT_ID.test(String(record.projectId||'')))throw Error('Projeto sem ID estável');
  if(!PROJECT_ID.test(String(record.orderCode||'')))throw Error('Pedido sem ID estável');
  if(!FORMATS.has(record.format))throw Error('Formato desconhecido');
  if(!DRIVE_ID.test(String(record.driveFolderId||'')))
    throw Error('Vínculo seguro da pasta Drive obrigatório; nunca deduzir pelo nome');
  if(!Array.isArray(record.approvals)||record.approvals.length>300)
    throw Error('Lista de aprovações inválida');
  const entries=record.approvals.map(validateAsset);
  const unique=new Set();
  for(const asset of entries){
    if(unique.has(asset.id))throw Error('Aprovação repetida');
    unique.add(asset.id);
  }
  const latest=new Map();
  for(const asset of entries){
    const key=fileKey(asset),previous=latest.get(key);
    if(!previous||asset.version>previous.version||
       (asset.version===previous.version&&asset.approvedAt>previous.approvedAt)) latest.set(key,asset);
  }
  // Never delete or replace older approved binaries automatically.
  const approvals=entries.map(a=>({
    id:a.id,type:a.type,sceneNumber:a.sceneNumber??null,
    version:a.version,approvedAt:a.approvedAt,mimeType:a.mimeType,
    sha256:a.sha256,sourceRef:a.sourceRef,
    notes:a.notes,primary:latest.get(fileKey(a))?.id===a.id,
    targetName:latest.get(fileKey(a))?.id===a.id
      ?filename(a)
      :'Historico/'+filename(a).replace(MIME_EXT[a.mimeType],
        '_v'+String(a.version).padStart(2,'0')+'_'+a.id+MIME_EXT[a.mimeType])
  })).sort((a,b)=>a.approvedAt.localeCompare(b.approvedAt));
  const names=new Set();
  for(const a of approvals){
    if(names.has(a.targetName))throw Error('Conflito de nome não resolvido');
    names.add(a.targetName);
  }
  const decisions=(Array.isArray(record.decisions)?record.decisions:[])
    .map(v=>({topic:assertClean(v.topic,120),decision:assertClean(v.decision,1000),
      updatedAt:required(validDate(v.updatedAt),'Data de decisão inválida')&&v.updatedAt}));
  return {
    schemaVersion:1,projectId:record.projectId,orderCode:record.orderCode,
    format:record.format,driveFolderId:record.driveFolderId,
    updatedAt:approvals.at(-1)?.approvedAt||null,
    decisions,approvals,
    uploadPlan:approvals.map(a=>({
      approvalId:a.id,projectId:record.projectId,driveFolderId:record.driveFolderId,
      sourceRef:a.sourceRef,sha256:a.sha256,targetName:a.targetName,
      rule:'create-only-after-checking-existing-file-and-hash'
    }))
  };
}
export function buildSocialDraft(bible,{hasMarketingPermission=false}={}){
  const finals=bible.approvals.filter(a=>a.primary&&a.type==='final_video'&&
    ['video/mp4','video/webm'].includes(a.mimeType));
  const selected=finals[0]||null;
  const eligible=hasMarketingPermission===true&&Boolean(selected);
  return {
    schemaVersion:1,projectId:bible.projectId,orderCode:bible.orderCode,
    canRender:eligible,needsApproval:!hasMarketingPermission,
    selectedSourceId:selected?.sourceRef||null,
    formats:[
      {type:'reels',name:'Reels_9x16.mp4',width:1080,height:1920,maxSeconds:20},
      {type:'stories',name:'Stories_9x16.mp4',width:1080,height:1920,maxSeconds:15},
      {type:'cover',name:'Capa_9x16.jpg',width:1080,height:1920}
    ],
    caption:'Convites que fazem a celebração começar antes da festa. ✨\n' +
      'Projeto autoral da Libri Convites.\n@libriconvites',
    rules:[
      'Rascunho privado. Nunca publicar automaticamente.',
      'Somente vídeo FINAL aprovado com autorização específica para divulgação.',
      'Preservar áudio original sem adicionar músicas externas.',
      'Não incluir dados privados de clientes, local da festa ou contatos.'
    ]
  };
}
function ffmpeg(args){
  const result=spawnSync('ffmpeg',args,{stdio:'pipe',encoding:'utf8',maxBuffer:1024*1024});
  if(result.error)throw Error('FFmpeg não disponível: '+result.error.code);
  if(result.status!==0)throw Error('FFmpeg falhou: '+(result.stderr||'').slice(-350));
}
export function renderSocialDraft(draft,videoPath,outDir){
  if(!draft?.canRender||!draft.selectedSourceId)
    throw Error('Autorização de divulgação e vídeo final aprovado são obrigatórios');
  const source=resolve(String(videoPath||'')),target=resolve(String(outDir||''));
  if(!['.mp4','.webm','.mov'].includes(extname(source).toLowerCase()))
    throw Error('A fonte precisa ser um vídeo local conhecido');
  if(!statSync(source).isFile())throw Error('Arquivo final não encontrado');
  mkdirSync(target,{recursive:true});
  const framing='scale=1080:1920:force_original_aspect_ratio=decrease,'+
    'pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1';
  for(const item of draft.formats.filter(x=>x.type!=='cover')){
    ffmpeg(['-hide_banner','-loglevel','error','-nostdin','-y','-i',source,
      '-t',String(item.maxSeconds),'-map','0:v:0','-map','0:a?',
      '-vf',framing,'-c:v','libx264','-crf','22','-preset','medium',
      '-pix_fmt','yuv420p','-c:a','aac','-b:a','160k',
      '-movflags','+faststart',join(target,item.name)]);
  }
  ffmpeg(['-hide_banner','-loglevel','error','-nostdin','-y','-ss','1',
    '-i',source,'-frames:v','1','-vf',framing,
    '-q:v','3',join(target,'Capa_9x16.jpg')]);
  writeFileSync(join(target,'Legenda_Rascunho.txt'),draft.caption+'\n');
  return draft.formats.map(a=>join(target,a.name));
}
function flag(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
  try{
    const manifest=required(flag('--manifest'),'Use --manifest caminho-para-json');
    const dir=resolve(required(flag('--out'),'Use --out pasta'));
    const bible=buildProjectBible(JSON.parse(readFileSync(resolve(manifest),'utf8')));
    const social=buildSocialDraft(bible,{hasMarketingPermission:process.argv.includes('--consent')});
    mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'Project_Bible.json'),JSON.stringify(bible,null,2)+'\n');
    writeFileSync(join(dir,'Plano_Envio_Drive.json'),JSON.stringify(bible.uploadPlan,null,2)+'\n');
    writeFileSync(join(dir,'Pacote_Divulgacao_Rascunho.json'),JSON.stringify(social,null,2)+'\n');
    if(process.argv.includes('--render'))renderSocialDraft(social,required(flag('--video'),'Use --video'),join(dir,'DIVULGACAO'));
    console.log('Plano de aprovação, Project Bible e rascunho social criados localmente. Nenhum upload/publicação.');
  }catch(e){console.error('Etapas 3/4: '+e.message);process.exitCode=1;}
}
