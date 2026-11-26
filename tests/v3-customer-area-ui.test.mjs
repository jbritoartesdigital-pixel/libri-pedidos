import test from 'node:test';
import assert from 'node:assert/strict';
import {v3FieldHtml,renderV3Materials,startV3CustomerArea,renderV3Uploads,uploadV3WithProgress} from '../public/js/client-v2-area-v3.js';
test('V3 field rendering escapes text and supports both invitation and Atelie choices',()=>{
  assert.match(v3FieldHtml({key:'mode',label:'<tema>',type:'choice',options:['sim','não']},'sim'),/&lt;tema&gt;/);
  assert.match(v3FieldHtml({key:'mode',label:'Tema',type:'choice',options:[{value:'yes',label:'Sim'}]},'yes'),/value="yes"[^>]*checked/);
  assert.match(v3FieldHtml({key:'mode',label:'Tema',type:'multi_choice',options:['a','b']},['b']),/value="b"[^>]*checked/);
  assert.match(v3FieldHtml({key:'text',label:'Texto',type:'textarea'},'<script>'),/&lt;script&gt;/);
  assert.doesNotMatch(v3FieldHtml({key:'photo',label:'Foto',type:'upload'},''),/type="file"/);
});
test('retrospective materials show purchased limits and safe WhatsApp link but no upload',()=>{
  const html=renderV3Materials({schema:{materials:{maxPhotos:95,maxVideos:10,maxVideoSeconds:60,maxTotalVideoSeconds:480,whatsappUrl:'https://wa.me/5561999999999'}},receipt:{photoCount:95,videoCount:8}});
  assert.match(html,/95 fotos e 10 vídeos/);
  assert.match(html,/8 minutos/);
  assert.match(html,/wa.me/);
  assert.match(html,/Recebimento registrado/);
  assert.doesNotMatch(html,/type="file"/);
  assert.doesNotMatch(renderV3Materials({schema:{materials:{whatsappUrl:'javascript:alert(1)'}}}),/javascript:/);
});
test('V3 private area shows only purchased services and shared fields',async(t)=>{
  const rootClasses=new Set(), bodyClasses=new Set();
  const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{classList:{add:(name)=>bodyClasses.add(name)}}}});
  t.after(()=>{if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else delete globalThis.document;});
  const root={innerHTML:'',classList:{add:(name)=>rootClasses.add(name)},setAttribute(){},addEventListener(){}};
  const initial={orderCode:'LIBRI-TEST',locked:false,orderStatus:'briefing_pending',event:{honoreeName:'Ana',date:'2027-02-01'},capacityReview:true,payment:{totalCents:14900,fullyPaid:true,receivedCents:14900},deliveryWindow:{start:'2027-01-05',end:'2027-01-07',provisional:true},services:[{family:'retrospectiva',productName:'Memórias',variantName:'Memórias',briefingStatus:'available',productionStatus:'pending',totalCents:14900,extras:[]}],modules:[{module:'shared',editable:true,revision:0},{module:'retrospectiva',editable:true,revision:0}]};
  await startV3CustomerArea(root,{token:'ord_test',initial,api:async()=>{throw Error('unexpected API request');}});
  assert.ok(rootClasses.has('libri-v3-area'));
  assert.ok(bodyClasses.has('libri-v3-area-body'));
  assert.match(root.innerHTML,/Dados da comemoração/);
  assert.match(root.innerHTML,/Retrospectiva/);
  assert.doesNotMatch(root.innerHTML,/data-v3-tab="convite"/);
  assert.doesNotMatch(root.innerHTML,/data-v3-tab="identidade_visual"/);
  assert.match(root.innerHTML,/149,00/);
  assert.match(root.innerHTML,/Pagamento confirmado/);
  assert.match(root.innerHTML,/data-v3-start="shared"[^>]*>Preencher meus dados/);
  assert.match(root.innerHTML,/<progress[^>]*value="0" max="1"/);
  assert.doesNotMatch(root.innerHTML,/Agenda em conferência/i);
  assert.doesNotMatch(root.innerHTML,/Pagamento recebido, agenda em conferência/);
  assert.doesNotMatch(root.innerHTML,/v3-financial-details" open/);
});

 test('V119 completed order restores WhatsApp button without exposing order token',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{classList:{add(){}}}}});t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 const root={innerHTML:'',classList:{add(){}},setAttribute(){},addEventListener(){}};
 const initial={orderCode:'LIBRI-TEST',locked:false,orderStatus:'briefing_pending',event:{honoreeName:'Ana',date:'2027-02-01'},payment:{totalCents:14900,fullyPaid:true,receivedCents:14900},deliveryWindow:{start:'2027-01-05',end:'2027-01-07'},services:[{family:'convite',productName:'Convite',variantName:'Vídeo',briefingStatus:'completed',productionStatus:'pending',totalCents:14900,extras:[]}],modules:[{module:'shared',editable:false},{module:'convite',editable:false}],briefingWhatsappUrl:'https://wa.me/5561999999999?text=LIBRI-TEST'};
 await startV3CustomerArea(root,{token:'ord_test',initial,api:async()=>{throw Error('unexpected API request');}});assert.match(root.innerHTML,/Avisar a Libri no WhatsApp/);assert.match(root.innerHTML,/data-v3-briefing-whatsapp/);
 });

test('V127 shows compact existing images only on child-style choices',()=>{
 const f={key:'visual_style',label:'Estilo',type:'choice',options:[{value:'stylized_doll',label:'Bonequinho estilizado'},{value:'realistic_detailed',label:'Realista e detalhado'},{value:'libri_decides',label:'Deixo a Libri decidir'}]};
 const html=v3FieldHtml(f,'stylized_doll');assert.match(html,/mascote-bonequinho\.webp/);assert.match(html,/mascote-realista\.webp/);assert.match(html,/mascote-menino-bonequinho\.webp/);assert.match(html,/mascote-menino-realista\.webp/);assert.equal((html.match(/class="v3-style-thumbnail"/g)||[]).length,4);assert.match(html,/value="stylized_doll"[^>]*checked/);
 assert.doesNotMatch(v3FieldHtml({...f,options:[{value:'realistic_detailed',label:'Realista'}]},''),/v3-style-thumbnail/);
});

test('V129 multiple selection respects remaining capacity and shows confirmed progress',()=>{
 const m={editable:true,schema:{uploadRules:[{fieldKey:'reference_files',label:'Referências',max:3,authorized:true}]},uploads:[{fieldKey:'reference_files',id:1,originalFilename:'foto.jpg',contentPath:'/foto'}]};
 const html=renderV3Uploads(m,true,{fieldKey:'reference_files',percent:47,message:'Enviando 2 de 3'});
 assert.match(html,/type="file" multiple/);assert.match(html,/1 de 3 imagens/);assert.match(html,/<progress max="100" value="47"/);assert.match(html,/Enviando 2 de 3/);assert.match(html,/data-v3-upload="reference_files" disabled/);
});
test('V129 upload reports actual network progress and requires server confirmation',async t=>{
 const old=globalThis.XMLHttpRequest;let xhr;globalThis.XMLHttpRequest=class{constructor(){xhr=this;this.upload={};}open(method,url){this.method=method;this.url=url;}send(body){this.body=body;}};
 t.after(()=>{if(old)globalThis.XMLHttpRequest=old;else delete globalThis.XMLHttpRequest;});
 const progress=[];const result=uploadV3WithProgress('/upload',new FormData(),p=>progress.push(p));
 xhr.upload.onprogress({lengthComputable:true,loaded:30,total:100});xhr.upload.onprogress({lengthComputable:true,loaded:100,total:100});
 assert.deepEqual(progress,[.3,1]);xhr.status=201;xhr.responseText=JSON.stringify({ok:true,result:{id:4}});xhr.onload();assert.equal((await result).result.id,4);
 const failed=uploadV3WithProgress('/upload',new FormData(),()=>{});xhr.onerror();await assert.rejects(failed,e=>e.uncertain===true);
});
