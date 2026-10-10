import test from 'node:test';
import assert from 'node:assert/strict';
import {listFlowProductionOrders} from '../src/lib/v2-flow-orders.js';
import {handleAdminFlowV2Api} from '../src/routes/admin-flow-v2.js';
const fake = {prepare(sql) {
 assert.match(sql, /FROM v2_orders o/);
 assert.doesNotMatch(sql, /v2_payments|public_token|whatsapp|amount_cents/i);
 return {bind(limit) {assert.equal(limit,100);return {async all(){return {results:[{
 order_code:'LIBRI-123', honoree_display_name:'Exemplo',
 customer_name:'Cliente Teste',event_type:'aniversario',event_date:'2026-12-01',
 status:'in_production',product_code:'cinematic_interactive',
 drive_folder_id:'drive-id-ficticio', confidential:'NUNCA'
 }]}}}}};
}};
test('exposes only production metadata and never invents a slug',async()=>{
 const projects=await listFlowProductionOrders(fake);
 assert.deepEqual(projects,[{
  orderCode:'LIBRI-123',name:'Exemplo',customerName:'Cliente Teste',eventType:'aniversario',
  eventDate:'2026-12-01',status:'in_production',productCode:'cinematic_interactive',
  slug:null,driveFolderId:'drive-id-ficticio',requiresPublicationMatch:true
 }]);
 assert.equal(JSON.stringify(projects).includes('NUNCA'),false);
});
test('route is GET-only and always read-only',async()=>{
 const env={DB:fake},url=new URL('https://pedidos.libriconvites.com.br/api/admin/v2/flow/projects');
 const data=await (await handleAdminFlowV2Api(new Request(url),env,url)).json();
 assert.equal(data.readOnly,true);assert.equal(data.projects.length,1);
 const denied=await handleAdminFlowV2Api(new Request(url,{method:'POST'}),env,url);
 assert.equal(denied.status,405);
});
