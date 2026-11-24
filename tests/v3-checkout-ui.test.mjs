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
      if(path.endsWith('/terms'))return {checkoutEnabled:false,terms:{general:{version:'v1',body:'Condições <script>'},services:[{family:'retrospectiva',version:'v2',body:'Limites de materiais'}]}};
      throw Error('unexpected request');
    }});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(root.innerHTML,/Seu nome/);
  assert.match(root.innerHTML,/2027-02-01/);
  assert.match(root.innerHTML,/Pix integral/);
  assert.match(root.innerHTML,/Cartão integral/);
  assert.match(root.innerHTML,/149,00/);
  assert.match(root.innerHTML,/Memórias &lt;teste&gt;/);
  assert.match(root.innerHTML,/Condições &lt;script&gt;/);
  assert.match(root.innerHTML,/Limites de materiais/);
  assert.match(root.innerHTML,/type="submit"[^>]*disabled[^>]*>Confirmar e pagar/);
  assert.deepEqual(calls.map(x=>x.path),['/api/v3/cart/quote','/api/v3/cart/terms']);
  listeners.get('click')({target:{closest:()=>({dataset:{v3Checkout:'back'}})}});
  assert.equal(backed,true);
  assert.equal(listeners.size,0);
});
