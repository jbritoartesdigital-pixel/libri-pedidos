import test from 'node:test';
import assert from 'node:assert/strict';
import {startFlowDriveUpload,forwardFlowDriveChunk,getFlowDriveUploadStatus}
 from '../src/lib/v2-flow-drive-delivery.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sha='b'.repeat(64);
test('Drive rejects invalid orders, names, extensions, sizes without touching credentials',async()=>{
 const env={};
 for(const filename of ['../final.png','relatorio.exe','fora/outro.jpg','CAPA.svg']){
  await assert.rejects(startFlowDriveUpload(env,{orderCode:'LIBRI-123',filename,size:99,sha256:sha}),/inválido/);
 }
 await assert.rejects(startFlowDriveUpload(env,{orderCode:'LIBRI-123',filename:'final.png',size:600*1024*1024,sha256:sha}),/inválido/);
});
test('one resumable Drive chunk is accepted only at its committed byte offset',async()=>{
 const row={id,order_code:'LIBRI-123',filename:'final.png',mime_type:'image/png',
  size_bytes:8,offset_bytes:0,session_url:'https://www.googleapis.com/upload/drive/v3/files?upload_id=test',
  state:'ready',created_at:new Date().toISOString()};
 const db={prepare(sql){
  return {bind(...args){return {first:async()=>({...row}),
   run:async()=>{
    if(sql.includes("state='uploading'"))row.state='uploading';
    if(sql.includes("state='ready'")){row.state='ready';row.offset_bytes=args[0];}
    return {meta:{changes:1}};
   }}};
  }};
 }};
 const request=()=>new Request('https://pedidos.libriconvites.com.br/api/admin/v2/flow/drive/uploads/'+id,
  {method:'PUT',headers:{'content-type':'application/octet-stream'},body:Uint8Array.of(1,2,3,4)});
 const network=async(url,opts)=>{
  assert.match(url,/^https:\/\/www\.googleapis\.com\/upload\/drive/);
  assert.equal(opts.headers['content-range'],'bytes 0-3/8');
  return new Response(null,{status:308,headers:{range:'bytes=0-3'}});
 };
 const result=await forwardFlowDriveChunk({DB:db},id,0,request(),network);
 assert.deepEqual(result,{offset:4,total:8,done:false});
 assert.equal(row.offset_bytes,4);
 await assert.rejects(forwardFlowDriveChunk({DB:db},id,0,request(),network),/posição diferente/);
});
test('Drive rejects forged session IDs and non-HTTPS Google upload addresses',async()=>{
 await assert.rejects(getFlowDriveUploadStatus({DB:{}},'../../etc/passwd'),/Sessão inválida/);
 const row={id,order_code:'LIBRI-123',filename:'final.png',mime_type:'image/png',
  size_bytes:4,offset_bytes:0,session_url:'https://evil.invalid/steal',state:'ready',
  created_at:new Date().toISOString()};
 const env={DB:{prepare(sql){return{bind(){return{
  first:async()=>row,run:async()=>({meta:{changes:1}})}}};}}};
 await assert.rejects(forwardFlowDriveChunk(env,id,0,new Request('https://test.invalid',{
  method:'POST',body:Uint8Array.of(1,2,3,4)})),/destino inesperado/);
});
test('Google Drive metadata exposes no OAuth bearer or session URLs',async()=>{
 const row={order_code:'LIBRI-123',filename:'final.png',size_bytes:4,
  offset_bytes:0,state:'ready',google_file_id:null,session_url:'https://www.googleapis.com/secrettoken'};
 const env={DB:{prepare(){return{bind(){return{first:async()=>row}}};}}};
 const out=await getFlowDriveUploadStatus(env,id);
 assert.equal(JSON.stringify(out).includes('secrettoken'),false);
});
