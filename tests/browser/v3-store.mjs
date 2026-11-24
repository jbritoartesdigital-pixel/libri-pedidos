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
import {handleAdminStoreConfigV2Api} from '../../src/routes/admin-store-config-v2.js';
import {handleAdminFinanceV2Api} from '../../src/routes/admin-finance-v2.js';
import {handleAdminAgendaV2Api} from '../../src/routes/admin-agenda-v2.js';
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
   else if(req.method==='GET'&&['/api/admin/v2/central','/api/admin/v2/production','/api/admin/v2/orders/search'].includes(url.pathname))result=await handleAdminV2CoreApi(request,readEnv,url);
   else if(req.method==='GET'&&['/api/admin/v2/store-config','/api/admin/v2/store-config/v3/retrospectives'].includes(url.pathname))result=await handleAdminStoreConfigV2Api(request,readEnv,url);
   else if(req.method==='GET'&&url.pathname==='/api/admin/v2/finance')result=await handleAdminFinanceV2Api(request,readEnv,url);
   else if(req.method==='GET'&&['/api/admin/v2/agenda','/api/admin/v2/agenda/cascade'].includes(url.pathname))result=await handleAdminAgendaV2Api(request,readEnv,url);
   else if(req.method==='GET'&&url.pathname==='/api/admin/v2/orders/v3/manual/catalog')result=await handleAdminBriefingV3Api(request,readEnv,url);
   else if(req.method==='GET'&&url.pathname==='/api/admin/v2/notifications')result=await handleAdminNotificationsV2Api(request,readEnv,url);
   else if(req.method==='GET'&&url.pathname==='/api/admin/v2/orders/'+paidFixture.orderCode+'/v3/briefing')result=await handleAdminBriefingV3Api(request,readEnv,url);
   else if([paidFixture,unpaidFixture].some(o=>url.pathname==='/api/v2/customer-area/'+o.publicToken+'/v3/briefing')&&req.method==='GET')result=await handleCustomerBriefingV3Api(request,readEnv,url);
   else if(url.pathname==='/api/v2/customer-area/'+paidFixture.publicToken+'/v3/briefing/shared'&&req.method==='PATCH')result=await handleCustomerBriefingV3Api(request,readEnv,url);
   else if(url.pathname==='/api/v3/cart/recover'&&req.method==='POST'){const body=await request.clone().json();assert.ok([paidFixture,unpaidFixture].some(o=>o.publicToken===body.publicToken));globalThis.fetch=mockFetch;try{result=await handlePublicCartV3Api(request,fixtureEnv,url);}finally{globalThis.fetch=originalFetch;}}
   else {blocked++;console.error('Unexpected test API',req.method,url.pathname);res.writeHead(403);res.end('Test: route not allowed');return;}
   res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  const p=url.pathname==='/loja'?'client-v3.html':url.pathname==='/admin-v2'?'admin-v2.html':url.pathname.startsWith('/meu-pedido/')?'client-v2.html':url.pathname.slice(1);
  if(!/^(client-v[23]\.html|admin-v2\.html|admin-manifest-v2\.webmanifest|(?:js|css|images|fonts)\/[a-z0-9_.-]+)$/.test(p)){res.writeHead(404);res.end();return;}
  const mime=p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':p.endsWith('.ttf')?'font/ttf':'text/html';
  res.writeHead(200,{'content-type':mime});res.end(await readFile(path.join('public',p)));
 }catch(e){console.error(e);if(!res.headersSent)res.writeHead(500);res.end('fixture error');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const errors=[];await mkdir('artifacts/v3-browser',{recursive:true});
async function pageFor(width,height,preferredName=''){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
 // No outgoing requests to production or payment providers.
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/loja');await page.locator('#v3-welcome-name').waitFor();if(preferredName){await page.locator('#v3-welcome-name').fill(preferredName);await page.locator('#v3-welcome-form button[type="submit"]').click();await page.locator('.v3-title').filter({hasText:preferredName}).waitFor();assert.equal(await page.evaluate(name=>JSON.stringify(localStorage.getItem('libriV3Draft')).includes(name),preferredName),false);}else await page.locator('[data-action="welcome-skip"]').click();await page.locator('[data-action="event"]').first().waitFor();assert.equal(await page.locator('a[href*="versao=2"]').count(),0);assert.equal(await page.locator('#v3-live-basket').isVisible(),false);
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
 await p.locator('[data-action="add-invitation"]').waitFor();if(await p.locator('[data-action="dismiss-offer"]').count()){await p.locator('.v3-offer-card[role="dialog"]').waitFor();await click(p,'dismiss-offer');}await click(p,'add-invitation');
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
 await p.locator('#v3-app[aria-busy="false"]').waitFor();await p.waitForFunction(()=>{const el=document.querySelector('.v3-checkout-block h2');return el&&getComputedStyle(el).fontFamily.includes('Manrope')});
 assert.equal(await p.locator('#v3-unified-checkout button[type="submit"]').isDisabled(),true);await p.locator('#v3-theme-toggle').click();assert.equal(await p.locator('html').getAttribute('data-v3-theme'),'dark');assert.equal(await p.locator('#v3c-eventDate').inputValue(),day(65));assert.equal(await p.locator('#v3c-eventDate').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(36, 27, 30)');await p.locator('#v3-theme-toggle').click();
 assert.match(p.url(),/\/loja$/);
}
try{
 const loadContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await loadContext.addInitScript(()=>localStorage.setItem('libriPrivacyV1','deny'));
 const loadPage=await loadContext.newPage();
 let releaseCatalog;const catalogGate=new Promise(resolve=>{releaseCatalog=resolve;});
 await loadContext.route('**/*',async route=>{if(!route.request().url().startsWith(origin+'/'))return route.abort();if(new URL(route.request().url()).pathname==='/api/v2/catalog')await catalogGate;return route.continue();});
 await loadPage.goto(origin+'/loja');
 await loadPage.locator('.v3-status-title').waitFor();assert.match(await loadPage.locator('.v3-panel--status').evaluate(el=>getComputedStyle(el).backgroundImage),/radial-gradient/);await loadPage.evaluate(()=>document.fonts.ready);
 assert.match(await loadPage.locator('.v3-status-title').evaluate(el=>getComputedStyle(el).fontFamily),/Manrope/);
 assert.equal(await loadPage.locator('.v3-status-line').count(),1);
 assert.equal(await loadPage.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true);
 await loadPage.screenshot({path:'artifacts/v3-browser/loading-mobile.png',fullPage:true});
 releaseCatalog();await loadPage.locator('#v3-welcome-name').waitFor();await loadPage.screenshot({path:'artifacts/v3-browser/welcome-mobile.png',fullPage:true});await loadPage.locator('[data-action="welcome-skip"]').click();await loadPage.locator('[data-action="event"]').first().waitFor();await loadContext.close();
 const durations=await pageFor(390,844,'Tereza');const dp=durations.page;
 await click(dp,'event','birthday');assert.equal(await dp.locator('.v3-title').innerText(),'O que gostaria de criar?');await click(dp,'creation','invitation');assert.match(await dp.locator('.v3-title').innerText(),/Tereza, como imagina seu convite/);await click(dp,'intent','story');await dp.locator('[data-action="product"][data-value="cinematic_video"]').waitFor();assert.equal(await dp.locator('.v3-format-demo,.v3-choice-icon,.v3-arrow').count(),0);assert.equal(await dp.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true);await dp.evaluate(()=>document.fonts.ready);assert.equal(await dp.evaluate(()=>[...document.fonts].some(f=>f.family==='Manrope'&&f.status==='loaded')),true,'Manrope precisa carregar o arquivo local');const glass=await dp.evaluate(()=>{const panel=getComputedStyle(document.querySelector('.v3-panel--guided'));const card=getComputedStyle(document.querySelector('.v3-format-card'));return {panelImage:panel.backgroundImage,cardImage:card.backgroundImage,cardBlur:card.backdropFilter}});assert.equal(glass.panelImage,'none','O contêiner deve manter o fundo claro original');assert.match(glass.cardImage,/linear-gradient/);assert.match(glass.cardBlur,/blur\(22px\)/);await dp.screenshot({path:'artifacts/v3-browser/formats-mobile.png',fullPage:true});await click(dp,'product','cinematic_video');
 await dp.locator('[data-scenes="3"]').waitFor();const stageBefore=await dp.locator('.v3-title').innerText();const night=dp.locator('#v3-theme-toggle');await night.click();assert.equal(await dp.locator('html').getAttribute('data-v3-theme'),'dark');assert.equal(await night.getAttribute('aria-pressed'),'true');assert.equal(await dp.locator('.v3-title').innerText(),stageBefore);assert.equal(await dp.evaluate(()=>localStorage.getItem('libriV3Theme')),'dark');assert.equal(await dp.evaluate(()=>getComputedStyle(document.querySelector('.v3-panel--guided')).backgroundColor),'rgb(48, 36, 39)');await dp.screenshot({path:'artifacts/v3-browser/night-mode-mobile.png',fullPage:true});await night.click();assert.equal(await dp.locator('html').getAttribute('data-v3-theme'),'light');assert.equal(await dp.locator('[data-action="variant"]').count(),2);assert.equal(await dp.locator('#v3-scene-select').count(),0);await dp.screenshot({path:'artifacts/v3-browser/duration-mobile.png',fullPage:true});assert.equal(await dp.evaluate(()=>{const m=document.querySelector('.v3-main'),p=document.querySelector('.v3-panel--guided'),b=document.querySelector('#v3-live-basket');const a=m.getBoundingClientRect(),q=b.getBoundingClientRect();return getComputedStyle(m).flexDirection==='column'&&getComputedStyle(p).backgroundImage==='none'&&Math.abs(a.x-q.x)<=2&&Math.abs(a.width-q.width)<=2&&document.scrollingElement.scrollHeight<=innerHeight+1}),true,'Uma única coluna com resumo integrado e viewport travado');
 const short=await dp.locator('[data-scenes="3"]').getAttribute('data-value');await dp.locator('[data-scenes="3"]').click();await dp.locator('[data-action="guided-finish"]').waitFor();assert.equal(await dp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).variantCode),short);assert.equal(await dp.evaluate(()=>{const p=document.querySelector('.v3-panel--guided'),c=document.querySelector('.v3-optional-card'),h=document.querySelector('.v3-stage-heading');return getComputedStyle(p).backgroundImage==='none'&&getComputedStyle(c).backdropFilter.includes('blur(22px)')&&getComputedStyle(h).textAlign==='center'&&document.scrollingElement.scrollHeight<=innerHeight+1}),true,'Adicionais com mesma linguagem e título centralizado');await dp.screenshot({path:'artifacts/v3-browser/extras-mobile.png',fullPage:true});
 await click(dp,'guided-back');const long=await dp.locator('[data-scenes="6"]').getAttribute('data-value');await dp.locator('[data-scenes="6"]').click();await dp.locator('[data-action="guided-finish"]').waitFor();assert.equal(await dp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).variantCode),long);
 await click(dp,'guided-back');await click(dp,'custom-scenes');const choices=dp.locator('#v3-scene-select option');assert.ok(await choices.count()>3);const custom=await choices.nth(1).getAttribute('value');await dp.locator('#v3-scene-select').selectOption(custom);await click(dp,'custom-scenes-confirm');await dp.locator('[data-action="guided-finish"]').waitFor();assert.equal(await dp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).variantCode),custom);await durations.context.close();
 const {context,page}=await pageFor(390,844,'Tereza');
 await invite(page);
 await page.screenshot({path:'artifacts/v3-browser/cart-mobile.png',fullPage:true});
 await click(page,'cart-edit','0');await page.locator('[data-action="add-invitation"]').waitFor();await click(page,'add-invitation');await page.locator('[data-action="cart-unified-checkout"]').waitFor();
 await checkout(page);
 assert.equal(await page.locator('#v3c-name').inputValue(),'Tereza');await page.locator('#v3c-name').fill('Tereza da Silva');assert.equal(await page.locator('#v3c-name').inputValue(),'Tereza da Silva');
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
 await admin.locator('.central-section-tabs [data-central-section="today"]').waitFor();await admin.locator('.admin-hero').waitFor();
 await admin.locator('#adminRailToggle').click();assert.equal(await admin.locator('html').evaluate(el=>el.classList.contains('admin-rail-compact')),true);await admin.locator('#adminRailToggle').click();
 await admin.locator('#findAdminFeature').click();await admin.locator('#featureFinderQuery').fill(paidFixture.orderCode);await admin.locator('[data-universal-order="'+paidFixture.orderCode+'"]').waitFor();await admin.locator('[data-universal-order="'+paidFixture.orderCode+'"]').click();await admin.locator('#v3AdminOrder').waitFor();assert.equal(await admin.locator('#modalRoot').evaluate(el=>el.classList.contains('order-drawer-root')),true);await admin.locator('#modalRoot .close-btn').click();
 await admin.locator('#findAdminFeature').click();await admin.locator('#featureFinderQuery').fill('cupom');await admin.locator('[data-pin-index]').first().click();assert.equal(await admin.locator('#adminPinned [data-pin-open]').count(),1);await admin.locator('#featureFinderClose').click();
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
 await admin.locator('#adminThemeToggle').click();assert.equal(await admin.locator('html').getAttribute('data-admin-theme'),'dark');
 assert.equal(await admin.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(32, 24, 27)');
 await admin.locator('[data-view="orders"]').click();await admin.locator('#viewTitle').filter({hasText:'Pedidos'}).waitFor();await admin.locator('#advancedOrderSearch').waitFor();await admin.locator('#central-new').waitFor();await admin.locator('[data-searched-order]').first().waitFor();assert.equal(await admin.locator('#advOrderArchived').inputValue(),'no');assert.equal(await admin.locator('#central-parties-today').count(),0);
 await admin.screenshot({path:'artifacts/v3-browser/admin-orders-night-desktop.png',fullPage:true});
 await admin.reload();await admin.locator('#central-new').waitFor();assert.equal(await admin.locator('html').getAttribute('data-admin-theme'),'dark');
 await admin.setViewportSize({width:390,height:844});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await admin.locator('.nav-primary').evaluate(el=>getComputedStyle(el).position),'fixed');
 await admin.screenshot({path:'artifacts/v3-browser/admin-orders-night-mobile.png',fullPage:true});await admin.locator('#adminThemeToggle').click();assert.equal(await admin.locator('html').getAttribute('data-admin-theme'),'light');
 await admin.locator('[data-view="production"]').click();await admin.locator('[data-production-service="retrospectivas"]').click();await admin.locator('#productionList').getByText(/LIBRI-|Nenhum pedido nessa fila/).first().waitFor();assert.equal(await admin.locator('[data-production-service="retrospectivas"]').getAttribute('aria-pressed'),'true');await admin.screenshot({path:'artifacts/v3-browser/admin-production-mobile.png',fullPage:true});await admin.locator('[data-production-layout="board"]').click();await admin.locator('.production-board').waitFor();assert.equal(await admin.locator('.board-lane').count()>=9,true);await admin.screenshot({path:'artifacts/v3-browser/admin-kanban-mobile.png',fullPage:true});await admin.locator('[data-production-layout="list"]').click();
 await admin.goto(origin+'/admin-v2?view=store&storeTab=retrospectives');await admin.locator('.retro-catalog-card').first().waitFor();assert.equal(await admin.locator('.retro-catalog-card').count(),5);await admin.screenshot({path:'artifacts/v3-browser/admin-retrospectives-mobile.png',fullPage:true});
 await admin.locator('[data-view="finance"]').click();await admin.locator('[data-finance-page="summary"]').waitFor();await admin.locator('.finance-hero').waitFor();assert.equal(await admin.locator('.finance-compare .financial-bar-row').count(),3);assert.equal(await admin.locator('[data-finance-page="movements"]').isVisible(),false);await admin.locator('[data-finance-tab="movements"]').click();await admin.locator('[data-finance-page="movements"]').waitFor();await admin.locator('[data-finance-tab="supplements"]').click();await admin.locator('[data-finance-page="supplements"]').waitFor();assert.equal(await admin.locator('[data-finance-page="movements"]').isVisible(),false);await admin.screenshot({path:'artifacts/v3-browser/admin-finance-mobile.png',fullPage:true});
 await admin.locator('[data-view="agenda"]').click();await admin.locator('.agenda-calendar').waitFor();assert.equal(await admin.locator('.agenda-advanced').count(),1);await admin.locator('[data-agenda-mode="capacity"]').click();await admin.locator('.capacity-tile').first().waitFor();assert.equal(await admin.locator('.agenda-calendar').isVisible(),false);await admin.screenshot({path:'artifacts/v3-browser/admin-capacity-mobile.png',fullPage:true});await admin.locator('[data-agenda-mode="list"]').click();await admin.locator('[data-agenda-page="list"]').waitFor();await admin.locator('[data-agenda-mode="week"]').click();await admin.locator('#agendaWeekRows').waitFor();await admin.locator('[data-agenda-mode="calendar"]').click();await admin.screenshot({path:'artifacts/v3-browser/admin-agenda-mobile.png',fullPage:true});
 await admin.locator('[data-view="manual"]').click();await admin.locator('.admin-manual-integrated').waitFor();assert.equal(await admin.locator('[data-family]').count(),3);await admin.locator('[data-contact="name"]').fill('Cliente teste');await admin.locator('[data-contact="whatsapp"]').fill('61999999999');await admin.locator('#adminThemeToggle').click();assert.equal(await admin.locator('[data-contact="name"]').inputValue(),'Cliente teste');await admin.screenshot({path:'artifacts/v3-browser/admin-manual-night-mobile.png',fullPage:true});
 await adminContext.close();
 assert.deepEqual(errors,[]);assert.equal(blocked,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v3_store_journeys').get().n,0);
 console.log('Chromium: invite, Atelie, retro, three services, checkout terms, locked/unlocked customer shell, persisted draft, admin detail; test-only mock provider.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));db.sqlite.close();fixtureDb.sqlite.close();}
