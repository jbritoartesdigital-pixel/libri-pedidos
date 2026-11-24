import test from 'node:test';
import assert from 'node:assert/strict';
import {mountV3Checkout} from '../public/js/client-v3-checkout.js';
test('unified checkout renders contact, date, payment choices, server totals and separate terms with payment disabled',async()=>{
  const listeners=new Map();
  const root={innerHTML:'',setAttribute(){},querySelector(){return null;},querySelectorAll(){return [];},
    addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
  let backed=false;
  const calls=[];
  mountV3Checkout(root,{items:[{productCode:'retrospectiva_070',variantCode:'retrospectiva_070_default'}],eventType:'birthday',eventDate:'2027-02-01',onBack:()=>{backed=true;},
    request:async(path,body)=>{
      calls.push({path,body});
      if(path.endsWith('/quote'))return {quote:{items:[{productName:'Memórias <teste>',grossCents:14900}],totalCents:14900,discountCents:0,cardFeeCents:0}};
      if(path.endsWith('/delivery-options'))return {quote:{items:[{productName:'Memórias <teste>',grossCents:14900}],totalCents:14900,discountCents:0,cardFeeCents:0},delivery:{options:[{start:'2027-01-01',end:'2027-01-03',recommended:true}]}};
      if(path.endsWith('/terms'))return {checkoutEnabled:false,terms:{general:{version:'v1',body:'Condições <script>'},services:[{family:'retrospectiva',version:'v2',body:'Limites de materiais'}]}};
      throw Error('unexpected request');
    }});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(root.innerHTML,/Seu nome/);assert.doesNotMatch(root.innerHTML,/name="email"|data-v3-checkout="agenda"/);assert.match(root.innerHTML,/Sugerida/);assert.doesNotMatch(root.innerHTML,/Consultar outra data|requestedDeliveryEnd/);
  assert.match(root.innerHTML,/2027-02-01/);
  assert.match(root.innerHTML,/Pix integral/);
  assert.match(root.innerHTML,/Cartão integral/);
  assert.match(root.innerHTML,/149,00/);
  assert.match(root.innerHTML,/Memórias &lt;teste&gt;/);
  assert.match(root.innerHTML,/Condições &lt;script&gt;/);
  assert.match(root.innerHTML,/Limites de materiais/);
  assert.match(root.innerHTML,/type="submit"[^>]*disabled[^>]*>Confirmar e pagar/);
  assert.deepEqual(calls.map(x=>x.path),['/api/v3/cart/quote','/api/v3/cart/terms','/api/v3/cart/delivery-options']);
  listeners.get('click')({target:{closest:()=>({dataset:{v3Checkout:'back'}})}});
  assert.equal(backed,true);
  assert.equal(listeners.size,0);
});

test('agenda shows at most three real options, recommended first and selected',async()=>{
 const listeners=new Map();const root={innerHTML:'',setAttribute(){},querySelector(){return null;},querySelectorAll(){return [];},addEventListener(n,f){listeners.set(n,f);},removeEventListener(n){listeners.delete(n);}};
 const quote={items:[{productName:'Convite',grossCents:10000}],totalCents:10000,discountCents:0,cardFeeCents:0};
 let calls=0;
 mountV3Checkout(root,{items:[{productCode:'interactive_essential',variantCode:'interactive_essential_default'}],eventType:'birthday',eventDate:'2027-04-01',onBack(){},request:async(path)=>{
  if(path.endsWith('/quote'))return {quote};if(path.endsWith('/terms'))return {checkoutEnabled:true,terms:{general:{version:'v1',body:'Termos'},services:[]}};
  if(path.endsWith('/delivery-options')){calls++;return {quote,delivery:{options:[{start:'2027-02-01',end:'2027-02-03',earliest:true},{start:'2027-02-18',end:'2027-02-20',recommended:true},{start:'2027-03-01',end:'2027-03-03'},{start:'2027-03-10',end:'2027-03-12'}]}};}
  throw Error('unexpected request');
 }});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);assert.equal((root.innerHTML.match(/name="deliveryWindow"/g)||[]).length,3);
 assert.match(root.innerHTML,/value="0" checked required> 18\/02\/2027 a 20\/02\/2027 · Sugerida/);
 assert.doesNotMatch(root.innerHTML,/requestedDeliveryEnd|custom-delivery|10\/03\/2027/);
});
