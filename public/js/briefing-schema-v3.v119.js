import {buildV2BriefingSimulationSchema} from './briefing-schema-v2.v119.js';
import {buildAtelieBriefingBlueprint} from './briefing-schema-atelie.v119.js';
const fail=(message,status=422)=>{const e=new Error(message);e.status=status;throw e;};
const field=(key,label,type='text',options={})=>({key,label,type,...options});
const section=(id,title,fields)=>({id,title,fields});
const sharedKeys=new Set(['theme_or_style','joint_celebration','joint_honorees','age','special_info','event_time','venue_name','venue_address']);
const filled=v=>Array.isArray(v)?v.length>0:v!==null&&v!==undefined&&String(v).trim()!=='';
export function retroSpec(snapshot){
  const r=snapshot.variant?.config?.retrospective;
  if(!r||!Number.isSafeInteger(r.maxPhotos)||r.maxPhotos<1||!Number.isSafeInteger(r.maxVideos)||r.maxVideos<0)
    fail('Os limites contratados da retrospectiva ainda precisam ser definidos.',409);
  const quantity=code=>(snapshot.v3Extras||[]).filter(x=>x.code===code).reduce((n,x)=>n+x.quantity,0);
  return {...r,maxPhotos:r.maxPhotos+25*quantity('retro_more_photos'),maxVideos:r.maxVideos+5*quantity('retro_more_videos'),
    maxTotalVideoSeconds:Number.isSafeInteger(r.maxTotalVideoSeconds)?r.maxTotalVideoSeconds+300*quantity('retro_more_videos'):null,
    captionsIncluded:r.captionsIncluded||quantity('retro_captions')>0,
    rawVideoSeconds:600*quantity('retro_long_video')};
}
export function buildV3ModuleSchema(order,services,module,drafts={}){
  const shared=drafts.shared||{};
  const data=drafts[module]||{};
  const invitation=services.find(s=>s.family==='convite');
  const addedInvite=!!invitation?.origin_supplement_id;
  const inviteSchema=invitation?buildV2BriefingSimulationSchema({
    product:invitation.snapshot.product,eventType:order.event_type,addons:invitation.snapshot.addons||[],
    data:addedInvite?{...shared,...drafts.convite}:{...drafts.convite,...shared}
  }):null;
  if(module==='shared'){
    if(inviteSchema&&!addedInvite)return {sections:inviteSchema.sections.filter(s=>s.id==='event'),uploadRules:[]};
    const fields=[field('theme_or_style','Tema ou estilo da comemoração','text',{required:true})];
    if(order.event_type==='birthday'){
      fields.push(field('joint_celebration','A festa tem mais de um aniversariante?','choice',{required:true,options:[{value:'no',label:'Não'},{value:'yes',label:'Sim'}]}));
      fields.push(shared.joint_celebration==='yes'
        ?field('joint_honorees','Nomes e idades','textarea',{required:true})
        :field('age','Idade','number',{required:true,min:1,max:120}));
    }
    fields.push(field('special_info','Informações gerais adicionais','textarea'));
    return {sections:[section('event','Sobre a comemoração',fields)],uploadRules:[]};
  }
  const service=services.find(s=>s.family===module);
  if(!service)fail('Este serviço não faz parte do pedido.',404);
  if(module==='convite'){
    const sections=inviteSchema.sections.filter(s=>s.id!=='event');
    if(addedInvite){const extras=inviteSchema.sections.filter(s=>s.id==='event').flatMap(s=>s.fields).filter(f=>!sharedKeys.has(f.key)||['event_time','venue_name','venue_address'].includes(f.key));if(extras.length)sections.unshift(section('added_event','Dados adicionais do convite',extras));}
    const personal=inviteSchema.uploadRules.some(r=>r.fieldKey==='person_photos');
    if(personal)sections.push(section('private_permission','Autorização de imagens',[
      field('private_photo_authorization','Você possui autorização da pessoa retratada ou de seu responsável legal para usar as fotos nesta criação?','choice',{required:true,options:['sim','não']})
    ]));
    const gift=service.snapshot.blackLibri?.gift;
    if(gift?.config?.giftOnly){
      const prize=gift.config.blackLibriPrizeCode;
      const fields=[field('black_gift_notes','Preferências para o presente '+gift.name,'textarea',{required:true,help:'Informe o texto, tema, cores, personagem ou mensagem desejada; se preferir, escreva que a Libri pode decidir.'})];
      if(['mini_retrospective','child_birthday'].includes(prize)){
        fields.push(field('black_gift_media_authorization','Possui autorização do responsável para utilizar as fotos neste presente?','choice',{required:true,options:['sim','não']}),
          field('black_gift_media_sent','Envie as fotos pelo WhatsApp da Libri, como documentos, identificando seu pedido e o presente. Já enviou?', 'choice',{required:true,options:['sim','não']}));
      }
      sections.push(section('black_gift','Seu presente Black Libri',fields));
    }
    return {...inviteSchema,sections,uploadRules:inviteSchema.uploadRules.map(r=>({...r,authorized:!['person_photos','outfit_photos'].includes(r.fieldKey)||data.private_photo_authorization==='sim'}))};
  }
  if(module==='identidade_visual'){
    const config=service.snapshot.variant?.config?.atelie||{};
    const pkg=service.product_code.replace(/^atelie_/,'');
    const atelie=buildAtelieBriefingBlueprint({event:{honoreeName:order.honoree_display_name,type:order.event_type,date:order.event_date},
      packageCode:pkg,contractedApplications:config.contractedApplications||[],requiresChildPhoto:true,
      data:{...data,theme:shared.theme_or_style,age:shared.age,multipleHonorees:shared.joint_celebration==='yes'?'sim':'não',honoreesNamesAges:shared.joint_honorees}});
    const sections=atelie.sections.filter(s=>s.id!=='celebracao').map(s=>({...s,fields:s.fields.filter(f=>f.key!=='theme').map(f=>
      f.key==='includedPosesInfo'&&config.includedMascotPoses?{...f,label:'Poses incluídas no pacote: '+config.includedMascotPoses}:f)}));
    const uploadRules=sections.flatMap(s=>s.fields.filter(f=>f.type==='upload').map(f=>({fieldKey:f.key,label:f.label,min:f.key==='childPhotos'?1:0,max:f.key==='childPhotos'?4:6,maxBytes:15*1024*1024,authorized:true})));
    return {sections:sections.map(s=>({...s,fields:s.fields.filter(f=>f.type!=='upload')})),uploadRules};
  }
  if(module==='retrospectiva'){
    const r=retroSpec(service.snapshot);
    return {sections:[section('story','A história que vamos contar',[
      field('story','Conte um pouco da história e dos momentos importantes','textarea',{required:true}),
      field('music_mode','Como vamos escolher a música?','choice',{required:true,options:['Libri escolhe','quero sugerir']}),
      ...(data.music_mode==='quero sugerir'?[field('music_reference','Música ou referência','text',{required:true})]:[]),
      field('dedication','Mensagem, homenagem ou dedicatória','textarea'),
      field('sequence_notes','Ordem das fotos, períodos ou pessoas importantes','textarea'),
      ...(r.captionsIncluded?[field('caption_notes','Legendas desejadas','textarea')]:[]),
      field('media_authorization','Possui autorização para usar os materiais enviados na criação contratada?','choice',{required:true,options:['sim','não']})
    ])],uploadRules:[],materials:{channel:'whatsapp',maxPhotos:r.maxPhotos,maxVideos:r.maxVideos,maxVideoSeconds:r.maxVideoSeconds||null,maxTotalVideoSeconds:r.maxTotalVideoSeconds,rawVideoSeconds:r.rawVideoSeconds,requiresAdminReceipt:true,storesFilesInR2:false}};
  }
  fail('Módulo inválido.');
}
