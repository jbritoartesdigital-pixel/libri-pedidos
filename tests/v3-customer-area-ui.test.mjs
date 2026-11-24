import test from 'node:test';
import assert from 'node:assert/strict';
import {v3FieldHtml,renderV3Materials,startV3CustomerArea} from '../public/js/client-v2-area-v3.js';
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
test('V3 private area shows only purchased services and shared fields',async()=>{
  const root={innerHTML:'',setAttribute(){},addEventListener(){}};
  const initial={orderCode:'LIBRI-TEST',locked:false,orderStatus:'briefing_pending',event:{honoreeName:'Ana',date:'2027-02-01'},payment:{totalCents:14900},deliveryWindow:{start:'2027-01-05',end:'2027-01-07',provisional:true},services:[{family:'retrospectiva',productName:'Memórias',variantName:'Memórias',briefingStatus:'available',productionStatus:'pending',totalCents:14900,extras:[]}],modules:[{module:'shared'},{module:'retrospectiva'}]};
  await startV3CustomerArea(root,{token:'ord_test',initial,api:async()=>{throw Error('unexpected API request');}});
  assert.match(root.innerHTML,/Dados da comemoração/);
  assert.match(root.innerHTML,/Retrospectiva/);
  assert.doesNotMatch(root.innerHTML,/data-v3-tab="convite"/);
  assert.doesNotMatch(root.innerHTML,/data-v3-tab="identidade_visual"/);
  assert.match(root.innerHTML,/149,00/);
});
