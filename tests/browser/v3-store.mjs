// Real Chromium, actual public JS/CSS and server catalogue, isolated SQLite.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {database,day,providerMock} from '../helpers.mjs';
import {handleCustomerBriefingV3Api,handleAdminBriefingV3Api} from '../../src/routes/briefing-v3.js';
import {handleAdminV2CoreApi} from '../../src/routes/admin-v2-core.js';
import {handleAdminNotificationsV2Api} from '../../src/routes/admin-notifications-v2.js';
import {getV3CheckoutTerms,startV3Checkout} from '../../src/lib/v3-checkout.js';
import {previewV3CartDelivery} from '../../src/lib/v3-cart-delivery.js';
import {syncMercadoPagoOrder} from '../../src/lib/v2-mercadopago.js';
import {randomToken} from '../../src/lib/http.js';
import {handlePublicV2Api} from '../../src/routes/public-v2.js';
import {handlePublicCartV3Api} from '../../src/routes/public-cart-v3.js';
import {setAtelieSaleStatus} from '../../src/lib/v3-atelie-release.js';
const {chromium}=await import(pathToFileURL(process.env.LIBRI_PLAYWRIGHT_MODULE).href);
const db=database();await setAtelieSaleStatus(db,'essencia',true);
db.sqlite.exec("UPDATE v3_retrospective_packages SET sale_enabled=1 WHERE code='RETRO_070'");
const env={DB:db,LIBRI_V3_CHECKOUT_ENABLED:'false'};
const allowed=new Set(['/api/v2/catalog','/api/v2/gallery','/api/v2/atelie/catalog','/api/v2/quote','/api/v3/retrospectivas/catalog','/api/v3/extras/catalog','/api/v3/cart/quote','/api/v3/cart/terms','/api/v3/cart/delivery-options','/api/v3/store/stage']);
// Separate fixture database: actual checkout and payment synchronizer, but
// the provider is fully mocked and fetch is restored before serving Chromium.
const fixtureDb=database();await setAtelieSaleStatus(fixtureDb,'essencia',true);
fixtureDb.sqlite.exec("UPDATE v3_retrospective_packages SET sale_enabled=1 WHERE code='RETRO_070'");
const fixtureEnv={DB:fixtureDb,LIBRI_V3_CHECKOUT_ENABLED:'true',LIBRI_V3_ADMIN_PAYMENT_ENABLED:'true',MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'};
const items=[{productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]},{productCode:'atelie_essencia',variantCode:'atelie_essencia_default',addonCodes:[]},{productCode:'retrospectiva_070',variantCode:'retrospectiva_070_default',addonCodes:[]}];
const selection={items,eventType:'birthday',eventDate:day(65),paymentMethod:'pix'};
const terms=await getV3CheckoutTerms(fixtureDb,selection),preview=await previewV3CartDelivery(fixtureDb,selection);
const originalFetch=globalThis.fetch;let paidFixture,unpaidFixture,mockFetch;
try{
 const mp=providerMock({mock:{method:(obj,key,fn)=>{obj[key]=fn;}}});
 const make=async(name,phone)=>startV3Checkout(new Request('https://test/api/v3/cart/checkout'),fixtureEnv,{...selection,customer:{name,whatsapp:phone,email:''},honoreeName:name,clientRequestId:randomToken(),termsAccepted:true,termsVersion:terms.general.version,atelieTermsAccepted:true,atelieTermsVersion:terms.services.find(x=>x.family==='identidade_visual').version,retrospectiveTermsAccepted:true,retrospectiveTermsVersion:terms.services.find(x=>x.family==='retrospectiva').version,deliveryWindow:preview.delivery.options[0],expectedTotalCents:preview.quote.totalCents});
 paidFixture=await make('Festa teste integrada','5561999999999');mp.approve(paidFixture.providerOrderId);await syncMercadoPagoOrder(fixtureEnv,paidFixture.providerOrderId);
 unpaidFixture=await make('Festa teste pendente','5561888888888');assert.equal(mp.posts,2);mockFetch=globalThis.fetch;
}finally{globalThis.fetch=originalFetch;}
const readEnv={DB:fixtureDb,LIBRI_V3_ADMIN_PAYMENT_ENABLED:'true'};
let blocked=0;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:'+server.address().port);
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const c of req)chunks.push(c);
   const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body:Buffer.concat(chunks)})});
   let result;
   if(allowed.has(url.pathname))result=await (url.pathname.startsWith('/api/v3/')?handlePublicCartV3Api(request,env,url):handlePublicV2Api(request,env,url));
   else if(url.pathname==='/api/admin/v2/auth/status'&&req.method==='GET')result=Response.json({ok:true,auth:{authenticated:true}});
   // Test-only authentication fixture, never in the Worker. Restrict local
   // administrative access to read-only central, notifications and fixture.
   else if(req.method==='GET'&&url.pathname==='/api/admin/v2/central')result=await handleAdminV2CoreApi(request,readEnv,url);
   else if(req.method==='GET'&&url.pathname==='/api/admin/v2/notifications')result=await handleAdminNotificationsV2Api(request,readEnv,url);
   else if(req.method==='GET'&&url.pathname==='/api/admin/v2/orders/'+paidFixture.orderCode+'/v3/briefing')result=await handleAdminBriefingV3Api(request,readEnv,url);
   else if([paidFixture,unpaidFixture].some(o=>url.pathname==='/api/v2/customer-area/'+o.publicToken+'/v3/briefing')&&req.method==='GET')result=await handleCustomerBriefingV3Api(request,readEnv,url);
   else if(url.pathname==='/api/v2/customer-area/'+paidFixture.publicToken+'/v3/briefing/shared'&&req.method==='PATCH')result=await handleCustomerBriefingV3Api(request,readEnv,url);
   else if(url.pathname==='/api/v3/cart/recover'&&req.method==='POST'){const body=await request.clone().json();assert.ok([paidFixture,unpaidFixture].some(o=>o.publicToken===body.publicToken));globalThis.fetch=mockFetch;try{result=await handlePublicCartV3Api(request,fixtureEnv,url);}finally{globalThis.fetch=originalFetch;}}
   else {blocked++;console.error('Unexpected test API',req.method,url.pathname);res.writeHead(403);res.end('Test: route not allowed');return;}
   res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  const p=url.pathname==='/loja'?'client-v3.html':url.pathname==='/admin-v2'?'admin-v2.html':url.pathname.startsWith('/meu-pedido/')?'client-v2.html':url.pathname.slice(1);
  if(!/^(client-v[23]\.html|admin-v2\.html|admin-manifest-v2\.webmanifest|(?:js|css|images)\/[a-z0-9_.-]+)$/.test(p)){res.writeHead(404);res.end();return;}
  const mime=p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'text/html';
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
 await page.goto(origin+'/loja');await page.locator('[data-action="event"]').first().waitFor();assert.equal(await page.locator('a[href*="versao=2"]').count(),0);assert.equal(await page.locator('#v3-live-basket').isVisible(),false);
 await page.locator('.libri-privacy-banner [data-privacy="deny"]').click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('libriPrivacyV1')),'deny');
 return {context,page};
}
const click=(p,a,v)=>p.locator('[data-action="'+a+'"]'+(v?'[data-value="'+v+'"]':'')).first().click();
async function invite(p,fromCreation=false){
 if(!fromCreation){await click(p,'event','birthday');}await click(p,'creation','invitation');await click(p,'intent','simple');
 await click(p,'product','interactive_essential');
 await p.locator('[data-action="guided-options"]').first().waitFor();
 await click(p,'guided-options');await p.locator('#v3-modal [data-action="guided-addon"]').first().waitFor();
 const question=await p.locator('.v3-title').innerText();
 await p.locator('#v3-modal [data-action="guided-addon"]').first().click();
 await p.locator('#v3-modal').waitFor({state:'hidden'});
 await p.locator('.v3-optional-card.is-selected').waitFor();assert.equal(await p.locator('.v3-title').innerText(),question);
 // Optional additions stay on one screen; no sequential upsell.
 const confirmation=p.locator('[data-action="guided-options"][data-value="confirmation"]');await confirmation.click();await confirmation.and(p.locator('[aria-pressed="true"]')).waitFor();assert.equal(await p.locator('#v3-modal').isVisible(),false);await confirmation.click();await confirmation.and(p.locator('[aria-pressed="false"]')).waitFor();
 await p.locator('[data-action="guided-back"]').waitFor();await click(p,'guided-finish');
 await p.locator('[data-action="add-invitation"]').waitFor();await click(p,'add-invitation');
 await p.locator('[data-action="cart-unified-checkout"]').waitFor();
}
async function checkout(p){
 assert.equal(await p.locator('[data-action="cart-delivery"]').count(),0);
 await p.locator('#v3CartEventDate').fill(day(65));
 await click(p,'cart-unified-checkout');
 await p.locator('#v3-unified-checkout').waitFor();
 assert.equal(await p.locator('#v3c-eventDate').inputValue(),day(65));
 await p.locator('#v3-app[aria-busy="false"]').waitFor();
 await p.screenshot({path:'artifacts/v3-browser/checkout-before-agenda-'+p.viewportSize().width+'.png',fullPage:true});
 assert.equal(await p.locator('[data-v3-checkout="agenda"]').count(),0);
 assert.equal(await p.locator('[name="email"]').count(),0);
 await p.locator('[name="deliveryWindow"]').first().waitFor();
 assert.equal(await p.locator('#v3-unified-checkout button[type="submit"]').isDisabled(),true);
 assert.match(p.url(),/\/loja$/);
}
try{
 const durations=await pageFor(390,844);const dp=durations.page;
 await click(dp,'event','birthday');await dp.locator('.v3-stage-creation .v3-choice').first().waitFor();assert.equal(await dp.locator('.v3-stage-creation .v3-choice-icon,.v3-stage-creation .v3-choice-check').count(),0);const cardHeights=await dp.locator('.v3-stage-creation .v3-choice').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().height));assert.ok(Math.max(...cardHeights)-Math.min(...cardHeights)<=1);assert.equal(await dp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await dp.screenshot({path:'artifacts/v3-browser/glass-services-mobile.png',fullPage:true});await click(dp,'creation','invitation');await click(dp,'intent','story');await dp.locator('[data-action="product"][data-value="cinematic_video"]').waitFor();await dp.locator('[data-action="product"][data-value="cinematic_interactive"]').waitFor();assert.equal(await dp.locator('.v3-format-demo,.v3-choice-icon').count(),0);assert.equal(await dp.locator('.v3-example-link').count(),2);await dp.screenshot({path:'artifacts/v3-browser/formats-mobile.png',fullPage:true});await click(dp,'product','cinematic_video');
 await dp.locator('[data-scenes="3"]').waitFor();assert.equal(await dp.locator('[data-action="variant"]').count(),2);assert.equal(await dp.locator('#v3-scene-select').count(),0);await dp.screenshot({path:'artifacts/v3-browser/duration-mobile.png',fullPage:true});
 const short=await dp.locator('[data-scenes="3"]').getAttribute('data-value');await dp.locator('[data-scenes="3"]').click();await dp.locator('[data-action="guided-finish"]').waitFor();assert.equal(await dp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).variantCode),short);
 await click(dp,'guided-back');const long=await dp.locator('[data-scenes="6"]').getAttribute('data-value');await dp.locator('[data-scenes="6"]').click();await dp.locator('[data-action="guided-finish"]').waitFor();assert.equal(await dp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).variantCode),long);
 await click(dp,'guided-back');await click(dp,'custom-scenes');const choices=dp.locator('#v3-scene-select option');assert.ok(await choices.count()>3);const custom=await choices.nth(1).getAttribute('value');await dp.locator('#v3-scene-select').selectOption(custom);await click(dp,'custom-scenes-confirm');await dp.locator('[data-action="guided-finish"]').waitFor();assert.equal(await dp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).variantCode),custom);await durations.context.close();
 const {context,page}=await pageFor(390,844);
 await invite(page);
 await page.screenshot({path:'artifacts/v3-browser/cart-mobile.png',fullPage:true});
 await click(page,'cart-edit','0');await page.locator('[data-action="add-invitation"]').waitFor();await click(page,'add-invitation');await page.locator('[data-action="cart-unified-checkout"]').waitFor();
 await checkout(page);
 await page.screenshot({path:'artifacts/v3-browser/checkout-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await context.close();
 const desktop=await pageFor(1280,900);const p=desktop.page;
 await click(p,'event','birthday');await click(p,'creation','identity');
 await click(p,'atelie-package','essencia');await click(p,'atelie-buy');
 await p.locator('[data-action="cart-unified-checkout"]').waitFor();
 await click(p,'cart-extra-start');await p.locator('#v3-modal [data-action="guided-cart-expand"]').waitFor();await click(p,'guided-cart-expand');await click(p,'guided-cart-plus','atelie_pose');await click(p,'guided-cart-next');
 await click(p,'guided-cart-skip');await click(p,'guided-cart-skip');p.once('dialog',d=>d.accept());await click(p,'guided-cart-skip');await p.locator('[data-action="cart-unified-checkout"]').waitFor();await p.getByText('1 × Pose extra',{exact:true}).waitFor();
 await p.screenshot({path:'artifacts/v3-browser/atelie-cart-desktop.png',fullPage:true});
 // Add a retrospective and invitation to the existing Ateliê cart.
 await click(p,'cart-more');await click(p,'creation','retrospective');
 await p.locator('[data-action="retro-buy"]').first().waitFor();await p.locator('[data-action="retro-buy"]').first().click();
 await p.locator('[data-action="cart-unified-checkout"]').waitFor();assert.equal(await p.locator('.v3-cart-item').count(),2);
 await click(p,'cart-more');await invite(p,true);assert.equal(await p.locator('.v3-cart-item').count(),3);
 await p.getByText('Desconto combinado (10%)',{exact:true}).waitFor();
 await p.screenshot({path:'artifacts/v3-browser/three-services-cart-desktop.png',fullPage:true});
 await checkout(p);assert.equal(await p.locator('[data-v3-term]').count(),3);
 await p.screenshot({path:'artifacts/v3-browser/three-services-checkout-desktop.png',fullPage:true});
 await desktop.context.close();
 const standalone=await pageFor(390,844);const rp=standalone.page;
 await click(rp,'event','birthday');await click(rp,'creation','retrospective');
 await rp.locator('[data-action="retro-buy"]').first().click();await rp.locator('[data-action="cart-unified-checkout"]').waitFor();
 assert.equal(await rp.locator('.v3-cart-item').count(),1);await checkout(rp);
 await rp.screenshot({path:'artifacts/v3-browser/retro-checkout-mobile.png',fullPage:true});await standalone.context.close();
 // Actual private shell, actual persisted three-family briefing.
 const privateContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await privateContext.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const customer=await privateContext.newPage();customer.on('pageerror',e=>errors.push(e.message));
 await customer.goto(origin+unpaidFixture.customerAreaPath);
 await customer.locator('[data-v3-action="payment"]').waitFor();assert.equal(await customer.locator('[data-v3-tab="shared"]').count(),0);
 await customer.goto(origin+paidFixture.customerAreaPath);
 await customer.locator('[data-v3-tab="shared"]').waitFor();
 await customer.locator('[data-v3-tab="shared"]').click();
 await customer.locator('#v3-f-theme_or_style').fill('Jardim de teste');
 await customer.locator('#v3-module-form button[type="submit"]').click();await customer.getByText('Rascunho salvo.',{exact:false}).waitFor();
 await customer.reload();await customer.locator('[data-v3-tab="shared"]').click();
 assert.equal(await customer.locator('#v3-f-theme_or_style').inputValue(),'Jardim de teste');
 await customer.locator('[data-v3-tab="retrospectiva"]').first().click();await customer.getByText('Fotos e vídeos pelo WhatsApp',{exact:true}).waitFor();
 await customer.screenshot({path:'artifacts/v3-browser/customer-retro-mobile.png',fullPage:true});
 assert.equal(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await privateContext.close();
 const adminContext=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 await adminContext.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const admin=await adminContext.newPage();admin.on('pageerror',e=>errors.push(e.message));
 await admin.goto(origin+'/admin-v2?order='+paidFixture.orderCode);
 await admin.locator('#v3AdminOrder .v3-admin-mini-service').first().waitFor();assert.equal(await admin.locator('#v3AdminOrder .v3-admin-mini-service').count(),3);assert.equal(await admin.locator('[data-v3-admin-page="production"]').isVisible(),false);await admin.locator('.v3-admin-tabs [data-v3-admin-tab="briefing"]').click();await admin.locator('[data-v3-admin-page="briefing"]').waitFor();assert.equal(await admin.locator('[data-v3-admin-page="finance"]').isVisible(),false);await admin.locator('.v3-admin-tabs [data-v3-admin-tab="finance"]').click();await admin.locator('[data-v3-admin-page="finance"]').waitFor();await admin.locator('.v3-admin-tabs [data-v3-admin-tab="production"]').click();await admin.locator('#v3AdminOrder .v3-admin-service').first().waitFor();
 assert.equal(await admin.locator('#v3AdminOrder .v3-admin-service').count(),3);
 await admin.screenshot({path:'artifacts/v3-browser/admin-three-services-desktop.png',fullPage:true});
 await admin.goto(origin+'/admin-v2');
 await admin.locator('.central-section-tabs [data-central-section="today"]').waitFor();
 assert.equal(await admin.locator('[data-central-page="today"]').isVisible(),true);
 assert.equal(await admin.locator('#central-parties-today').isVisible(),true);
 assert.equal(await admin.locator('#central-new').isVisible(),false);
 await admin.locator('.central-quick-summary a[href="#central-new"]').click();
 assert.equal(await admin.locator('#central-new').isVisible(),true);
 await admin.locator('.central-section-tabs [data-central-section="agenda"]').click();
 assert.equal(await admin.locator('#central-capacity').isVisible(),true);
 await admin.locator('.central-section-tabs [data-central-section="numbers"]').click();
 assert.equal(await admin.locator('.monthly-goal-card').isVisible(),true);
 assert.equal(await admin.locator('#advancedOrderSearch').isVisible(),true);
 await admin.screenshot({path:'artifacts/v3-browser/admin-central-desktop.png',fullPage:true});
 await adminContext.close();
 assert.deepEqual(errors,[]);assert.equal(blocked,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v3_store_journeys').get().n,0);
 console.log('Chromium: invite, Atelie, retro, three services, checkout terms, locked/unlocked customer shell, persisted draft, admin detail; test-only mock provider.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));db.sqlite.close();fixtureDb.sqlite.close();}
