// Real Chromium, actual public JS/CSS and server catalogue, isolated SQLite.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {database,day} from '../helpers.mjs';
import {handlePublicV2Api} from '../../src/routes/public-v2.js';
import {handlePublicCartV3Api} from '../../src/routes/public-cart-v3.js';
import {setAtelieSaleStatus} from '../../src/lib/v3-atelie-release.js';
const {chromium}=await import(pathToFileURL(process.env.LIBRI_PLAYWRIGHT_MODULE).href);
const db=database();await setAtelieSaleStatus(db,'essencia',true);
db.sqlite.exec("UPDATE v3_retrospective_packages SET sale_enabled=1 WHERE code='RETRO_070'");
const env={DB:db,LIBRI_V3_CHECKOUT_ENABLED:'false'};
const allowed=new Set(['/api/v2/catalog','/api/v2/atelie/catalog','/api/v2/quote','/api/v3/retrospectivas/catalog','/api/v3/extras/catalog','/api/v3/cart/quote','/api/v3/cart/terms','/api/v3/cart/delivery-options','/api/v3/store/stage']);
let blocked=0;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:'+server.address().port);
  if(url.pathname.startsWith('/api/')){
   if(!allowed.has(url.pathname)){blocked++;res.writeHead(403);res.end('Test: no payment or mutation allowed');return;}
   const chunks=[];for await(const c of req)chunks.push(c);
   const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body:Buffer.concat(chunks)})});
   const result=await (url.pathname.startsWith('/api/v3/')?handlePublicCartV3Api(request,env,url):handlePublicV2Api(request,env,url));
   res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  const p=url.pathname==='/loja'?'client-v3.html':url.pathname.slice(1);
  if(!/^(client-v3\.html|(?:js|css)\/[a-z0-9_.-]+)$/.test(p)){res.writeHead(404);res.end();return;}
  const mime=p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html';
  res.writeHead(200,{'content-type':mime});res.end(await readFile(path.join('public',p)));
 }catch(e){console.error(e);if(!res.headersSent)res.writeHead(500);res.end('fixture error');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const errors=[];await mkdir('artifacts/v3-browser',{recursive:true});
async function pageFor(width,height){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
 // No outgoing requests to production or payment providers.
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/loja');await page.locator('[data-action="event"]').first().waitFor();
 return {context,page};
}
const click=(p,a,v)=>p.locator('[data-action="'+a+'"]'+(v?'[data-value="'+v+'"]':'')).first().click();
async function invite(p){
 await click(p,'event','birthday');await click(p,'next');await click(p,'creation','invitation');await click(p,'next');await click(p,'intent','simple');await click(p,'next');
 await click(p,'product','interactive_essential');await p.locator('[data-action="product"][data-value="interactive_essential"][aria-pressed="true"]').waitFor();await click(p,'next');
 await p.locator('[data-action="guided-options"]').first().waitFor();
 await click(p,'guided-options');await p.locator('#v3-modal [data-action="guided-addon"]').first().waitFor();
 const question=await p.locator('.v3-title').innerText();
 await p.locator('#v3-modal [data-action="guided-addon"]').first().click();
 await p.waitForFunction(previous=>document.querySelector('.v3-title')?.textContent!==previous,question);
 await p.locator('#v3-modal').waitFor({state:'hidden'});
 // A second question proves the modal click advanced the flow.
 await p.locator('[data-action="guided-back"]').waitFor();await click(p,'guided-finish');
 await p.locator('[data-action="add-invitation"]').waitFor();await click(p,'add-invitation');
 await p.locator('[data-action="cart-unified-checkout"]').waitFor();
}
async function checkout(p){
 await p.locator('#v3CartEventDate').fill(day(65));
 await click(p,'cart-unified-checkout');
 await p.locator('#v3-unified-checkout').waitFor();
 assert.equal(await p.locator('#v3c-eventDate').inputValue(),day(65));
 await p.locator('[data-v3-checkout="agenda"]').click();
 await p.locator('[name="deliveryWindow"]').first().waitFor();
 assert.equal(await p.locator('#v3-unified-checkout button[type="submit"]').isDisabled(),true);
 assert.match(p.url(),/\/loja$/);
}
try{
 const {context,page}=await pageFor(390,844);
 await invite(page);
 await page.screenshot({path:'artifacts/v3-browser/cart-mobile.png',fullPage:true});
 await click(page,'cart-edit','0');await page.locator('[data-action="add-invitation"]').waitFor();await click(page,'add-invitation');await page.locator('[data-action="cart-unified-checkout"]').waitFor();
 await checkout(page);
 await page.screenshot({path:'artifacts/v3-browser/checkout-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await context.close();
 const desktop=await pageFor(1280,900);const p=desktop.page;
 await click(p,'event','birthday');await click(p,'next');await click(p,'creation','identity');await click(p,'next');
 await click(p,'atelie-package','essencia');await click(p,'atelie-detail');await click(p,'atelie-buy');
 await p.locator('[data-action="cart-unified-checkout"]').waitFor();
 await click(p,'cart-extra-start');await p.locator('#v3-modal [data-action="guided-cart-expand"]').waitFor();await click(p,'guided-cart-expand');await click(p,'guided-cart-plus','atelie_pose');await click(p,'guided-cart-next');
 await click(p,'guided-cart-skip');await click(p,'guided-cart-skip');p.once('dialog',d=>d.accept());await click(p,'guided-cart-skip');await p.locator('[data-action="cart-unified-checkout"]').waitFor();await p.getByText('1 × Pose extra',{exact:true}).waitFor();
 await p.screenshot({path:'artifacts/v3-browser/atelie-cart-desktop.png',fullPage:true});
 await checkout(p);await desktop.context.close();
 assert.deepEqual(errors,[]);assert.equal(blocked,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);
 console.log('Chromium: single invite, paid extra modal, cart, date, standalone Atelie, read-only checkout, mobile overflow, no payment.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));db.sqlite.close();}
