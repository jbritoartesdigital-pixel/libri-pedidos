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
  assert.match(root.innerHTML,/Seu nome/);assert.doesNotMatch(root.innerHTML,/name="email"|data-v3-checkout="agenda"/);assert.match(root.innerHTML,/Sugerida/);assert.match(root.innerHTML,/Consultar outra data/);
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

test('another requested delivery date is selected only after server validation',async()=>{
  const listeners=new Map();let desired='',radio=null,requested=[];
  const root={innerHTML:'',setAttribute(){},querySelector(sel){
    if(sel==='[name="requestedDeliveryEnd"]')return {value:desired};
    if(sel==='[name="deliveryWindow"]:checked'&&radio!==null)return {value:String(radio)};
    return null;
  },querySelectorAll(){return [];},addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
  const quote={items:[{productName:'Convite',grossCents:10000}],totalCents:10000,discountCents:0,cardFeeCents:0};
  mountV3Checkout(root,{items:[{productCode:'interactive_essential',variantCode:'interactive_essential_default'}],eventType:'birthday',eventDate:'2027-04-01',onBack(){},request:async(path,body)=>{
    if(path.endsWith('/quote'))return {quote};
    if(path.endsWith('/terms'))return {checkoutEnabled:true,terms:{general:{version:'v1',body:'Termos'},services:[]}};
    if(path.endsWith('/delivery-options')){
      if(body.deliveryWindow){requested.push(body.deliveryWindow);if(body.deliveryWindow.end==='2027-03-20')throw Error('Sem capacidade');}
      return {quote,delivery:{options:[{start:'2027-02-18',end:'2027-02-20',recommended:true}],selected:body.deliveryWindow||null}};
    }
    throw Error('unexpected request');
  }});
  await new Promise(resolve=>setImmediate(resolve));
  const consult=()=>listeners.get('click')({target:{closest:()=>({dataset:{v3Checkout:'custom-delivery'}})}});
  desired='2027-03-10';consult();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(requested[0],{start:'2027-03-08',end:'2027-03-10'});
  assert.match(root.innerHTML,/value="1" checked required/);
  assert.match(root.innerHTML,/Janela disponível e selecionada/);
  radio=1;desired='2027-03-20';consult();await new Promise(resolve=>setImmediate(resolve));
  assert.match(root.innerHTML,/Sem capacidade/);
  assert.match(root.innerHTML,/value="1" checked required/);
  assert.doesNotMatch(root.innerHTML,/18\/03\/2027 a 20\/03\/2027/);
});
