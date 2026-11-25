import {handleStoreFunnel,getStoreFunnel} from '../../src/lib/v3-store-funnel.js';
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
import {previewV3ManualOrder,createV3ManualOrder} from '../../src/lib/v3-order-revisions.js';
import {getV3CheckoutTerms,startV3Checkout} from '../../src/lib/v3-checkout.js';
import {previewV3CartDelivery} from '../../src/lib/v3-cart-delivery.js';
import {syncMercadoPagoOrder} from '../../src/lib/v2-mercadopago.js';
import {randomToken} from '../../src/lib/http.js';
import {handlePublicV2Api} from '../../src/routes/public-v2.js';
import {handlePublicCartV3Api} from '../../src/routes/public-cart-v3.js';
import {setAtelieSaleStatus} from '../../src/lib/v3-atelie-release.js';
import {saveBlackLibriCampaign} from '../../src/lib/v2-black-libri-admin.js';
const {chromium}=await import(pathToFileURL(process.env.LIBRI_PLAYWRIGHT_MODULE).href);
const db=database();await setAtelieSaleStatus(db,'essencia',true);
db.sqlite.exec("UPDATE v3_retrospective_packages SET sale_enabled=1 WHERE code='RETRO_070'");
const env={DB:db,LIBRI_V3_CHECKOUT_ENABLED:'false'};
// Isolated, synthetic campaign; never touches production or a payment provider.
const blackDb=database();const blackEnv={DB:blackDb,LIBRI_V3_CHECKOUT_ENABLED:'true',LIBRI_V3_BLACK_LIBRI_ENABLED:'true'};
await saveBlackLibriCampaign(blackEnv,{adminEnabled:true,complianceConfirmed:true,authorizationReference:'TESTE-INTERNO',adminNote:'Dados sintéticos',validFrom:'2020-01-01',validUntil:'2030-12-31'});
blackDb.sqlite.exec("UPDATE v2_black_libri_prizes SET enabled=CASE WHEN code='save_static' THEN 1 ELSE 0 END");
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
const manualDb=database();
const manualEnv={DB:manualDb,LIBRI_V3_CHECKOUT_ENABLED:'true',LIBRI_V3_BLACK_LIBRI_ENABLED:'true',LIBRI_V3_ADMIN_PAYMENT_ENABLED:'true',MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'};
await saveBlackLibriCampaign(manualEnv,{adminEnabled:true,complianceConfirmed:true,authorizationReference:'TESTE-INTERNO',adminNote:'Dados sintéticos',validFrom:'2020-01-01',validUntil:'2030-12-31'});
manualDb.sqlite.exec("UPDATE v2_black_libri_prizes SET enabled=CASE WHEN code='save_static' THEN 1 ELSE 0 END");
const manualInput={customer:{name:'Cliente manual',whatsapp:'+351 912345678',email:''},event:{type:'birthday',honoreeName:'Vicente teste',date:day(65)},items:[{productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]}],paymentMethod:'pix',depositPercent:50,reason:'Entrada autorizada pelo atendimento'};
const manualPreview=await previewV3ManualOrder(manualDb,manualInput);
const manualFixture=await createV3ManualOrder(manualEnv,{...manualInput,deliveryWindow:manualPreview.options[0],expectedTotalCents:manualPreview.totalCents,requestKey:randomToken(),confirmed:true});
manualFixture.publicToken=manualFixture.customerAreaPath.split('/').pop();
let manualMP,manualFetch;
try{manualMP=providerMock({mock:{method:(obj,key,fn)=>{obj[key]=fn;}}});manualFetch=globalThis.fetch;}finally{globalThis.fetch=originalFetch;}

let blocked=0;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:'+server.address().port);
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const c of req)chunks.push(c);
   const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body:Buffer.concat(chunks)})});
   let result;
   if(url.pathname==='/api/v3/store/stage')result=await handleStoreFunnel(request,readEnv,url);
   else if(req.headers['x-libri-test-black']==='1'&&['/api/v3/cart/quote','/api/v3/cart/terms','/api/v3/cart/delivery-options','/api/v3/cart/black/status','/api/v3/cart/black/reveal','/api/v3/cart/black/preview'].includes(url.pathname))result=await handlePublicCartV3Api(request,blackEnv,url);
   else if(allowed.has(url.pathname))result=await (url.pathname.startsWith('/api/v3/')?handlePublicCartV3Api(request,env,url):handlePublicV2Api(request,env,url));
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
   else if(url.pathname.startsWith('/api/v2/customer-area/'+manualFixture.publicToken+'/v3/')){globalThis.fetch=manualFetch;try{result=await handleCustomerBriefingV3Api(request,manualEnv,url);}finally{globalThis.fetch=originalFetch;}}
   else if([paidFixture,unpaidFixture].some(o=>url.pathname==='/api/v2/customer-area/'+o.publicToken+'/v3/briefing')&&req.method==='GET')result=await handleCustomerBriefingV3Api(request,readEnv,url);
   else if(url.pathname==='/api/v2/customer-area/'+paidFixture.publicToken+'/v3/briefing/shared'&&req.method==='PATCH')result=await handleCustomerBriefingV3Api(request,readEnv,url);
   else if(url.pathname==='/api/v3/cart/recover'&&req.method==='POST'){const body=await request.clone().json();assert.ok([paidFixture,unpaidFixture,manualFixture].some(o=>o.publicToken===body.publicToken));const manual=body.publicToken===manualFixture.publicToken;globalThis.fetch=manual?manualFetch:mockFetch;try{result=await handlePublicCartV3Api(request,manual?manualEnv:fixtureEnv,url);}finally{globalThis.fetch=originalFetch;}}
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
async function pageFor(width,height,preferredName='',consent='deny'){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
 // No outgoing requests to production or payment providers.
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 if(consent==='allow_named')await context.addInitScript(()=>localStorage.setItem('libriPrivacyV1','allow_named'));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/loja');await page.locator('#v3-welcome-name').waitFor();if(preferredName){await page.locator('#v3-welcome-name').fill(preferredName);await page.locator('#v3-welcome-form button[type="submit"]').click();await page.locator('.v3-title').filter({hasText:preferredName}).waitFor();assert.equal(await page.evaluate(name=>JSON.stringify(localStorage.getItem('libriV3Draft')).includes(name),preferredName),false);}else await page.locator('[data-action="welcome-skip"]').click();await page.locator('[data-action="event"]').first().waitFor();assert.equal(await page.locator('a[href*="versao=2"]').count(),0);assert.equal(await page.locator('#v3-live-basket').isVisible(),false);
 if(consent!=='allow_named'){assert.equal(await page.locator('.libri-privacy-banner .libri-privacy-actions button').count(),2);await page.locator('.libri-privacy-banner [data-privacy="'+consent+'"]').click();}
 assert.equal(await page.evaluate(()=>localStorage.getItem('libriPrivacyV1')),consent);
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
 await p.locator('#v3-modal [data-action="dismiss-offer"],#v3-modal [data-action="added-view"]').first().waitFor();if(await p.locator('[data-action="dismiss-offer"]').count())await click(p,'dismiss-offer');await click(p,'added-view');
 await p.locator('[data-action="cart-unified-checkout"]').waitFor();
}
async function checkout(p){
 assert.equal(await p.locator('[data-action="cart-delivery"]').count(),0);
 assert.equal(await p.locator('#v3CartEventDate').count(),0);
 await click(p,'cart-unified-checkout');
 await p.locator('#v3-unified-checkout').waitFor();await p.locator('#v3-app[aria-busy="false"]').waitFor();
 await p.locator('#v3c-eventDate').fill(day(65));
 await p.locator('#v3-app[aria-busy="false"]').waitFor();
 await p.screenshot({path:'artifacts/v3-browser/checkout-before-agenda-'+p.viewportSize().width+'.png',fullPage:true});
 assert.equal(await p.locator('[data-v3-checkout="agenda"]').count(),0);
 assert.equal(await p.locator('[name="email"]').count(),0);
 await p.locator('[name="deliveryWindow"]').first().waitFor();assert.ok(await p.locator('[name="deliveryWindow"]').count()<=3);assert.equal(await p.locator('[name="requestedDeliveryEnd"]').count(),0);
 await p.locator('#v3-app[aria-busy="false"]').waitFor();await p.waitForFunction(()=>{const el=document.querySelector('.v3-checkout-block h2');return el&&getComputedStyle(el).fontFamily.includes('Georgia')});
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
 await loadPage.locator('.v3-status-line').waitFor();assert.equal(await loadPage.locator('.v3-panel--status').evaluate(el=>getComputedStyle(el).backgroundImage),'none');await loadPage.evaluate(()=>document.fonts.ready);
 assert.match(await loadPage.locator('.v3-status-title').evaluate(el=>getComputedStyle(el).fontFamily),/Manrope/);
 assert.equal(await loadPage.locator('.v3-status-line').count(),1);assert.equal(await loadPage.locator('.v3-status-line').evaluate(el=>getComputedStyle(el).borderTopStyle),'solid');
 assert.equal(await loadPage.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true);
 await loadPage.screenshot({path:'artifacts/v3-browser/loading-mobile.png',fullPage:true});
 releaseCatalog();await loadPage.locator('#v3-welcome-name').waitFor();await loadPage.screenshot({path:'artifacts/v3-browser/welcome-mobile.png',fullPage:true});await loadPage.locator('[data-action="welcome-skip"]').click();await loadPage.locator('[data-action="event"]').first().waitFor();await loadContext.close();
 const named=await pageFor(390,844,'Tereza consentiu','allow_named');await named.page.waitForFunction(()=>!!sessionStorage.getItem('libriStoreJourneyV1'));await named.page.locator('[data-action="event"][data-value="birthday"]').click();for(let i=0;i<30;i++){if((await getStoreFunnel(fixtureDb)).named.some(x=>x.name==='Tereza consentiu'&&x.stage==='servico'))break;await new Promise(r=>setTimeout(r,100));}assert.ok((await getStoreFunnel(fixtureDb)).named.some(x=>x.name==='Tereza consentiu'&&x.stage==='servico'));await named.page.locator('#libri-privacy [data-privacy="preferences"]').click();await named.page.locator('.libri-privacy-dialog [data-privacy="deny"]').click();for(let i=0;i<30;i++){if(!(await getStoreFunnel(fixtureDb)).named.some(x=>x.name==='Tereza consentiu'))break;await new Promise(r=>setTimeout(r,100));}assert.equal((await getStoreFunnel(fixtureDb)).named.some(x=>x.name==='Tereza consentiu'),false);await named.context.close();
 const blackDemo=await pageFor(390,640);await blackDemo.page.evaluate(async()=>{const {openBlackLibriDemo}=await import('/js/black-libri-demo.js?v=93');await openBlackLibriDemo();});await blackDemo.page.locator('.black-libri-panel').waitFor();assert.equal(await blackDemo.page.locator('[data-demo-slot]').count(),12);assert.match(await blackDemo.page.locator('.black-libri-panel').evaluate(el=>getComputedStyle(el).backgroundImage),/linear-gradient/);await blackDemo.page.screenshot({path:'artifacts/v3-browser/black-studio-mobile.png',fullPage:true});await blackDemo.page.locator('[data-demo-sound]').click();await blackDemo.page.locator('[data-demo-slot]').last().click();await blackDemo.page.locator('.black-libri-result').waitFor();await blackDemo.page.screenshot({path:'artifacts/v3-browser/black-studio-reveal-mobile.png',fullPage:true});await blackDemo.page.locator('[data-demo-continue]').click();await blackDemo.page.locator('.black-libri-overlay').waitFor({state:'detached'});await blackDemo.context.close();
 // Use the actual checkout, not the standalone illustrative demo. No checkout write is allowed.
 const liveBlack=await pageFor(390,844);const bp=liveBlack.page;
 await bp.setExtraHTTPHeaders({'x-libri-test-black':'1'});
 await click(bp,'event','birthday');await click(bp,'creation','invitation');await click(bp,'intent','simple');await click(bp,'product','interactive_essential');await click(bp,'guided-finish');
 await bp.locator('#v3-offer-title').waitFor();assert.match(await bp.locator('#v3-offer-title').innerText(),/confirmações em um painel/);const originalDraft=await bp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).addonCodes);await click(bp,'dismiss-offer');await click(bp,'added-view');assert.deepEqual(await bp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).cartItems[0].addonCodes),originalDraft);
 await click(bp,'cart-unified-checkout');await bp.locator('#v3-app[aria-busy="false"]').waitFor();await bp.locator('#v3c-eventDate').fill(day(65));await bp.locator('[name="deliveryWindow"]').first().waitFor();await bp.locator('#v3-app[aria-busy="false"]').waitFor();
 await bp.locator('#v3c-name').fill('Cliente teste');await bp.locator('#v3c-whatsapp').fill('5561987654321');await bp.locator('#v3c-honoreeName').fill('Festa teste');
 await bp.locator('[data-v3-term]').first().check();await bp.locator('#v3-unified-checkout button[type="submit"]').click();
 await bp.locator('.black-libri-panel').waitFor();assert.equal(await bp.locator('[data-black-slot]').count(),12);await bp.screenshot({path:'artifacts/v3-browser/black-live-checkout.png',fullPage:true});
 await bp.locator('[data-black-sound]').click();await bp.locator('[data-black-slot]').first().click();await bp.locator('[data-black-continue]:enabled').waitFor();
 assert.equal(blackDb.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_black_libri_claims').get().n,1);
 await bp.locator('[data-black-continue]').click();await bp.locator('.black-libri-overlay').waitFor({state:'detached'});await bp.locator('#v3-app[aria-busy="false"]').waitFor();await bp.getByText('Presente incluído, sem custo.',{exact:false}).waitFor();
 assert.equal(blackDb.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);await liveBlack.context.close();
 const sim=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await sim.addInitScript(()=>localStorage.setItem('libriV3Draft','{"sentinel":"pedido real preservado"}'));
 await sim.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const sp=await sim.newPage();sp.on('pageerror',e=>errors.push(e.message));
 const prohibited=[];sp.on('request',req=>{if(/\/api\/v3\/(cart\/(checkout|recover|black\/)|store\/stage)/.test(req.url()))prohibited.push(req.url());});
 await sp.goto(origin+'/loja?simular=1');await sp.locator('.v3-simulation-banner').waitFor();await click(sp,'welcome-skip');await click(sp,'event','birthday');await click(sp,'creation','invitation');await click(sp,'intent','simple');await click(sp,'product','interactive_essential');await click(sp,'guided-finish');await sp.locator('#v3-modal [data-action="dismiss-offer"],#v3-modal [data-action="added-view"]').first().waitFor();if(await sp.locator('[data-action="dismiss-offer"]').count())await click(sp,'dismiss-offer');await click(sp,'added-view');
 await click(sp,'cart-unified-checkout');await sp.locator('#v3-app[aria-busy="false"]').waitFor();await sp.locator('#v3c-eventDate').fill(day(65));await sp.locator('[name="deliveryWindow"]').first().waitFor();await sp.locator('#v3-app[aria-busy="false"]').waitFor();await sp.locator('#v3c-name').fill('Cliente teste');await sp.locator('#v3c-whatsapp').fill('5561987654321');await sp.locator('#v3c-honoreeName').fill('Festa teste');await sp.locator('[data-v3-term]').first().check();await sp.locator('#v3-unified-checkout button[type="submit"]').click();await sp.locator('[data-demo-slot]').first().waitFor();await sp.locator('[data-demo-sound]').click();await sp.locator('[data-demo-slot]').first().click();await sp.locator('[data-demo-continue]').click();await sp.getByRole('heading',{name:'Simulação concluída!'}).waitFor();assert.deepEqual(prohibited,[]);assert.equal(await sp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).sentinel),'pedido real preservado');await sim.close();
 // Five initial events, vertically stacked and visible without any scrolling.
 for(const [width,height] of [[390,844],[360,640],[320,568]]){
  const ev=await pageFor(width,height);await ev.page.locator('.v3-stage-event .v3-grid').waitFor();
  await ev.page.evaluate(()=>document.fonts.ready);
  const measured=await ev.page.evaluate(()=>{const body=document.querySelector('.v3-stage-event .v3-stage-body'),cards=[...body.querySelectorAll('[data-action="event"]')],r=body.getBoundingClientRect();return {count:cards.length,stacked:cards.every((c,i)=>!i||c.getBoundingClientRect().top>=cards[i-1].getBoundingClientRect().bottom-1),fits:cards.every(c=>c.getBoundingClientRect().top>=r.top-1&&c.getBoundingClientRect().bottom<=r.bottom+1&&c.scrollHeight<=c.clientHeight+1),noScroll:body.scrollHeight<=body.clientHeight+1&&document.scrollingElement.scrollHeight<=innerHeight+1};});
  assert.deepEqual(measured,{count:5,stacked:true,fits:true,noScroll:true},'Todos os eventos devem caber na primeira tela '+width+'x'+height);
  await ev.page.screenshot({path:'artifacts/v3-browser/event-v106-'+width+'x'+height+'.png',fullPage:true});await ev.context.close();
 }
 // Replicate the mobile simulation banner from the customer's video.
 const videoFit=await browser.newContext({viewport:{width:390,height:740},reducedMotion:'reduce'});
 await videoFit.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const vf=await videoFit.newPage();await vf.goto(origin+'/loja?simular=1');await vf.locator('.v3-simulation-banner').waitFor();await click(vf,'welcome-skip');await click(vf,'event','birthday');await click(vf,'creation','invitation');await click(vf,'intent','story');
 await vf.locator('.v3-format-card').last().waitFor();await vf.evaluate(()=>document.fonts.ready);
 assert.equal(await vf.locator('.v3-stage-body').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'Simulação: dois cinematográficos sem rolagem interna');await vf.screenshot({path:'artifacts/v3-browser/v107-video-formats.png',fullPage:true});await click(vf,'product','cinematic_video');await vf.locator('[data-scenes="3"]').waitFor();
 assert.equal(await vf.locator('.v3-stage-body').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'Simulação: três durações sem rolagem');await vf.screenshot({path:'artifacts/v3-browser/v107-video-duration.png',fullPage:true});await click(vf,'variant',await vf.locator('[data-scenes="3"]').getAttribute('data-value'));await vf.locator('[data-action="guided-finish"]').waitFor();assert.equal(await vf.locator('.v3-stage-body').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'Simulação: quatro adicionais sem rolagem');await vf.screenshot({path:'artifacts/v3-browser/v107-video-extras.png',fullPage:true});await videoFit.close();
 const extraFit=await browser.newContext({viewport:{width:390,height:740},reducedMotion:'reduce'});
 await extraFit.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const ef=await extraFit.newPage();await ef.goto(origin+'/loja?simular=1');await ef.locator('.v3-simulation-banner').waitFor();await click(ef,'welcome-skip');await click(ef,'event','birthday');await click(ef,'creation','invitation');await click(ef,'intent','simple');await click(ef,'product','interactive_essential');await ef.locator('[data-action="guided-finish"]').waitFor();await ef.evaluate(()=>document.fonts.ready);
 assert.equal(await ef.locator('.v3-optional-card').count(),5);await ef.screenshot({path:'artifacts/v3-browser/v107-interactive-extras-before-assert.png',fullPage:true});const extraMetrics=await ef.locator('.v3-stage-body').evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,cards:[...el.querySelectorAll('.v3-optional-card')].map(c=>({height:c.clientHeight,scrollHeight:c.scrollHeight,font:getComputedStyle(c.querySelector('strong')).fontFamily,weight:getComputedStyle(c.querySelector('strong')).fontWeight}))}));console.log('V107 interactive extras',JSON.stringify(extraMetrics));assert.ok(extraMetrics.scrollHeight<=extraMetrics.height+1,'Simulação: cinco adicionais do interativo sem rolagem '+JSON.stringify(extraMetrics));assert.ok(extraMetrics.cards.every(c=>c.scrollHeight<=c.height+1&&c.font.includes('Georgia')&&c.weight==='400'),'Todos os adicionais devem permanecer legíveis e com tipografia do Curtinho');assert.deepEqual((await ef.locator('.v3-optional-card').evaluateAll(els=>els.map(e=>e.dataset.value))).filter(x=>['confirmation','filter','moments'].includes(x)),['confirmation','filter','moments']);assert.equal(await ef.locator('.v107-extras-footer .v3-total').count(),1);await ef.screenshot({path:'artifacts/v3-browser/v107-interactive-extras.png',fullPage:true});await extraFit.close();
 const durations=await pageFor(390,844,'Tereza');const dp=durations.page;
 await click(dp,'event','birthday');assert.equal(await dp.locator('.v3-title').innerText(),'O que gostaria de criar?');assert.equal(await dp.locator('.v97-card-overline').count(),3);assert.equal(await dp.locator('[data-action="creation"]').evaluateAll(els=>new Set(els.map(el=>getComputedStyle(el).backgroundImage)).size),1);assert.equal(await dp.locator(".v3-panel--guided").evaluate(el=>getComputedStyle(el).borderTopWidth),"0px");await dp.screenshot({path:'artifacts/v3-browser/creation-v102-mobile.png',fullPage:true});await click(dp,'creation','invitation');assert.match(await dp.locator('.v3-title').innerText(),/Tereza, como imagina seu convite/);assert.deepEqual(await dp.locator('[data-action="intent"][data-value="story"] .v106-title-line').allTextContents(),['Convite','cinematográfico']);assert.ok(await dp.locator('[data-action="intent"][data-value="story"] strong').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=27));await dp.screenshot({path:'artifacts/v3-browser/intent-v106-mobile.png',fullPage:true});await click(dp,'intent','story');await dp.locator('[data-action="product"][data-value="cinematic_video"]').waitFor();assert.equal(await dp.locator('.v3-format-demo,.v3-choice-icon,.v3-arrow').count(),0);assert.equal(await dp.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true);await dp.evaluate(()=>document.fonts.ready);assert.equal(await dp.evaluate(()=>[...document.fonts].some(f=>f.family==='Manrope'&&f.status==='loaded')),true,'Manrope precisa carregar o arquivo local');const glass=await dp.evaluate(()=>{const panel=getComputedStyle(document.querySelector('.v3-panel--guided'));const card=getComputedStyle(document.querySelector('.v3-format-card'));return {panelImage:panel.backgroundImage,cardImage:card.backgroundImage,cardBlur:card.backdropFilter}});assert.equal(glass.panelImage,'none','O contêiner deve manter o fundo claro original');assert.match(glass.cardImage,/linear-gradient/);assert.match(glass.cardBlur,/blur\(18px\)/);assert.equal(await dp.locator('.v3-format-card .v3-price').first().evaluate(el=>getComputedStyle(el).color),'rgb(117, 73, 66)','Preço precisa usar o rosé escuro legível');assert.equal(await dp.locator('.v3-format-card .v3-example-link').first().evaluate(el=>getComputedStyle(el).color),'rgb(117, 73, 66)','Link precisa manter contraste');assert.match(await dp.locator('.v3-format-card .v3-choice-copy strong').first().evaluate(el=>getComputedStyle(el).fontFamily),/Georgia/);assert.equal(await dp.locator('.v3-format-card .v3-choice-copy strong').first().evaluate(el=>getComputedStyle(el).fontWeight),'400');const formatFont=await dp.locator('.v3-format-card .v3-choice-copy strong').first().evaluate(el=>{const s=getComputedStyle(el);return [s.fontFamily,s.fontWeight,s.letterSpacing]});assert.equal(await dp.locator('.v3-stage-body').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'Os dois formatos cinematográficos devem caber sem rolagem interna');assert.deepEqual(await dp.locator('[data-format="cinematic_video"] .v106-title-line').allTextContents(),['Cinematográfico','em vídeo']);assert.deepEqual(await dp.locator('[data-format="cinematic_interactive"] .v106-title-line').allTextContents(),['Cinematográfico','interativo']);assert.equal(await dp.locator('.v106-title-line').first().evaluate(el=>getComputedStyle(el).display),'block');await dp.screenshot({path:'artifacts/v3-browser/formats-mobile.png',fullPage:true});await click(dp,'product','cinematic_video');
 await dp.locator('[data-scenes="3"]').waitFor();const stageBefore=await dp.locator('.v3-title').innerText();const night=dp.locator('#v3-theme-toggle');await night.click();assert.equal(await dp.locator('html').getAttribute('data-v3-theme'),'dark');assert.equal(await night.getAttribute('aria-pressed'),'true');assert.equal(await dp.locator('.v3-title').innerText(),stageBefore);assert.equal(await dp.evaluate(()=>localStorage.getItem('libriV3Theme')),'dark');assert.equal(await dp.evaluate(()=>getComputedStyle(document.querySelector('.v3-panel--guided')).backgroundColor),'rgba(0, 0, 0, 0)');await dp.screenshot({path:'artifacts/v3-browser/night-mode-mobile.png',fullPage:true});await night.click();assert.equal(await dp.locator('html').getAttribute('data-v3-theme'),'light');assert.equal(await dp.locator('[data-action="variant"]').count(),2);const durationFont=await dp.locator('[data-scenes="3"] strong').evaluate(el=>{const s=getComputedStyle(el);return [s.fontFamily,s.fontWeight,s.letterSpacing]});assert.deepEqual(durationFont.slice(0,2),formatFont.slice(0,2),'Curtinho e cinematográfico usam exatamente a mesma família e peso');assert.equal(await dp.locator('.v3-stage-body').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'As três durações cabem juntas');assert.equal(await dp.locator('#v3-scene-select').count(),0);await dp.screenshot({path:'artifacts/v3-browser/duration-mobile.png',fullPage:true});assert.equal(await dp.evaluate(()=>{const m=document.querySelector('.v3-main'),p=document.querySelector('.v3-panel--guided'),b=document.querySelector('#v3-live-basket');const a=m.getBoundingClientRect(),q=b.getBoundingClientRect();return getComputedStyle(m).flexDirection==='column'&&getComputedStyle(p).backgroundImage==='none'&&b.hidden&&document.scrollingElement.scrollHeight<=innerHeight+1}),true,'Uma única coluna sem resumo vazio e viewport travado');
 const short=await dp.locator('[data-scenes="3"]').getAttribute('data-value');await dp.locator('[data-scenes="3"]').click();await dp.locator('[data-action="guided-finish"]').waitFor();assert.equal(await dp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).variantCode),short);assert.equal(await dp.evaluate(()=>{const p=document.querySelector('.v3-panel--guided'),c=document.querySelector('.v3-optional-card'),h=document.querySelector('.v3-stage-heading');return getComputedStyle(p).backgroundImage==='none'&&getComputedStyle(c).backdropFilter.includes('blur(22px)')&&getComputedStyle(h).textAlign==='left'&&document.scrollingElement.scrollHeight<=innerHeight+1}),true,'Adicionais com mesma linguagem e cabeçalho editorial alinhado à esquerda');assert.equal(await dp.locator('.v3-optional-card').first().evaluate(el=>getComputedStyle(el).display),'grid');assert.ok(await dp.locator('.v97-extra-cta').count()>0);assert.equal(await dp.locator('.v107-extras-footer .v3-total').count(),1);assert.equal(await dp.locator('.v3-stage-body').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'Adicionais do vídeo cabem juntos');await dp.screenshot({path:'artifacts/v3-browser/extras-mobile.png',fullPage:true});
 await click(dp,'guided-back');const long=await dp.locator('[data-scenes="6"]').getAttribute('data-value');await dp.locator('[data-scenes="6"]').click();await dp.locator('[data-action="guided-finish"]').waitFor();assert.equal(await dp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).variantCode),long);
 await click(dp,'guided-back');await click(dp,'custom-scenes');const choices=dp.locator('#v3-scene-select option');assert.ok(await choices.count()>3);const custom=await choices.nth(1).getAttribute('value');await dp.locator('#v3-scene-select').selectOption(custom);await click(dp,'custom-scenes-confirm');await dp.locator('[data-action="guided-finish"]').waitFor();assert.equal(await dp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).variantCode),custom);await durations.context.close();
 const {context,page}=await pageFor(390,844,'Tereza');
 await invite(page);
 assert.equal(await page.locator('.v97-cart-summary').count(),1);assert.equal(await page.locator('.v97-cart-summary .v3-total').count(),1);assert.equal(await page.locator('[data-action="cart-unified-checkout"]').innerText(),'Continuar para os dados');assert.ok(await page.locator('.v105-cart-addons').count()>0);assert.equal(await page.evaluate(()=>{const t=document.querySelector('.v97-cart-summary'),b=document.querySelector('[data-action="cart-unified-checkout"]');return t.getBoundingClientRect().bottom<=b.getBoundingClientRect().top+1&&b.getBoundingClientRect().bottom<=innerHeight&&document.scrollingElement.scrollHeight<=innerHeight+1}),true,'Total e ação principal permanecem visíveis fora da lista rolável');await page.screenshot({path:'artifacts/v3-browser/cart-mobile.png',fullPage:true});
 await click(page,'cart-edit','0');await page.locator('[data-action="add-invitation"]').waitFor();await click(page,'add-invitation');await click(page,'added-view');await page.locator('[data-action="cart-unified-checkout"]').waitFor();
 await checkout(page);
 assert.equal(await page.locator('#v3c-name').inputValue(),'Tereza');await page.locator('.v3-instagram-optional summary').click();await page.locator('#v3c-instagram').fill('@tereza.teste');assert.equal(await page.locator('#v3c-instagram').inputValue(),'@tereza.teste');await page.locator('[data-v3-checkout="back"]').click();await page.locator('[data-action="cart-unified-checkout"]').waitFor();await click(page,'cart-unified-checkout');await page.locator('#v3-app[aria-busy="false"]').waitFor();assert.equal(await page.locator('#v3c-instagram').inputValue(),'@tereza.teste');await page.locator('#v3c-name').fill('Tereza da Silva');assert.equal(await page.locator('#v3c-name').inputValue(),'Tereza da Silva');
 assert.equal(await page.locator('.v97-step-no').count(),4);await page.screenshot({path:'artifacts/v3-browser/checkout-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await context.close();
 const desktop=await pageFor(1280,900);const p=desktop.page;
 await click(p,'event','birthday');await p.locator('[data-action="creation"]').first().waitFor();assert.equal(await p.locator('.v3-panel--guided').evaluate(el=>getComputedStyle(el).display),'grid');assert.equal(await p.locator('.studio-art').isVisible(),true);await p.screenshot({path:'artifacts/v3-browser/creation-v102-desktop.png',fullPage:true});await click(p,'creation','identity');
 await click(p,'atelie-package','essencia');await click(p,'atelie-buy');await click(p,'added-view');
 await p.locator('[data-action="cart-unified-checkout"]').waitFor();
 await click(p,'cart-extra-start');await p.locator('#v3-modal [data-action="guided-cart-expand"]').waitFor();await click(p,'guided-cart-expand');await click(p,'guided-cart-plus','atelie_pose');await click(p,'guided-cart-next');
 await click(p,'guided-cart-skip');await click(p,'guided-cart-skip');p.once('dialog',d=>d.accept());await click(p,'guided-cart-skip');await p.locator('[data-action="cart-unified-checkout"]').waitFor();await p.getByText('1 × Pose extra',{exact:true}).waitFor();
 await p.screenshot({path:'artifacts/v3-browser/atelie-cart-desktop.png',fullPage:true});
 // Add a retrospective and invitation to the existing Ateliê cart.
 await click(p,'cart-more');await click(p,'creation','retrospective');
 await p.locator('[data-action="retro-buy"]').first().waitFor();await p.locator('[data-action="retro-buy"]').first().click();await click(p,'added-view');
 await p.locator('[data-action="cart-unified-checkout"]').waitFor();assert.equal(await p.locator('.v3-cart-item').count(),2);
 await click(p,'cart-more');await invite(p,true);assert.equal(await p.locator('.v3-cart-item').count(),3);
 await p.getByText('Desconto combinado (10%)',{exact:true}).waitFor();
 await p.screenshot({path:'artifacts/v3-browser/three-services-cart-desktop.png',fullPage:true});
 await checkout(p);assert.equal(await p.locator('[data-v3-term]').count(),3);
 await p.screenshot({path:'artifacts/v3-browser/three-services-checkout-desktop.png',fullPage:true});
 await desktop.context.close();
 const standalone=await pageFor(390,844);const rp=standalone.page;
 await click(rp,'event','birthday');await click(rp,'creation','retrospective');await rp.locator('.v101-retro-row').first().waitFor();assert.equal(await rp.locator('.v101-retro-row').last().evaluate(el=>{const r=el.getBoundingClientRect(),s=el.closest('.v3-stage-body').getBoundingClientRect();return r.bottom<=s.bottom+2}),true,'As cinco opções de retrospectiva precisam aparecer sem rolar a página.');assert.equal(await rp.locator('.v101-retro-row').count(),5);assert.equal(await rp.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true);assert.equal(await rp.locator('.v3-stage-unready .v3-stage-body').evaluate(el=>el.scrollTop),0);await rp.screenshot({path:'artifacts/v3-browser/retrospective-v102-mobile.png',fullPage:true});await rp.locator('[data-action="retro-details"]').first().click();await rp.locator('.v101-retro-detail').waitFor();await rp.locator('.v101-retro-detail [data-action="close-modal"]').click();
 await rp.locator('[data-action="retro-buy"]').first().click();await click(rp,'added-view');await rp.locator('[data-action="cart-unified-checkout"]').waitFor();
 assert.equal(await rp.locator('.v3-cart-item').count(),1);await checkout(rp);
 await rp.screenshot({path:'artifacts/v3-browser/retro-checkout-mobile.png',fullPage:true});await standalone.context.close();
 // A real eligible combo must outrank a decorative upgrade; never advertise a zero discount.
 const oldCombos=db.sqlite.prepare('SELECT code,discount_type,discount_value FROM v2_combos').all();
 try{
  db.sqlite.exec("UPDATE v2_combos SET discount_type='percent',discount_value=CASE WHEN code='organizacao' THEN 10 ELSE 0 END");
  const comboCase=await pageFor(390,844);const cp=comboCase.page;
  await click(cp,'event','birthday');await click(cp,'creation','invitation');await click(cp,'intent','simple');await click(cp,'product','interactive_essential');
  await click(cp,'guided-options','reminder');await cp.locator('#v3-modal [data-action="guided-addon"][data-value="reminder_static"]').click();
  await cp.locator('[data-action="guided-options"][data-value="reminder"][aria-pressed="true"]').waitFor();
  await click(cp,'guided-finish');await cp.locator('#v3-offer-title').waitFor();
  assert.match(await cp.locator('#v3-offer-title').innerText(),/Complete o combo Organização/);
  await click(cp,'accept-offer');await click(cp,'added-view');await cp.locator('[data-action="cart-unified-checkout"]').waitFor();
  const comboDraft=await cp.evaluate(()=>JSON.parse(localStorage.getItem('libriV3Draft')).cartItems[0]);assert.equal(comboDraft.comboCode,'organizacao');assert.equal(comboDraft.addonCodes.length,2);assert.ok(comboDraft.addonCodes.includes('reminder_static'));
  await comboCase.context.close();
 }finally{for(const c of oldCombos)db.sqlite.prepare('UPDATE v2_combos SET discount_type=?,discount_value=? WHERE code=?').run(c.discount_type,c.discount_value,c.code);}
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
 await admin.locator('[data-view="manual"]').click();await admin.locator('.admin-manual-integrated').waitFor();assert.equal(await admin.locator('[data-family]').count(),3);await admin.locator('[data-contact="name"]').fill('Cliente teste');await admin.locator('[data-contact="whatsapp"]').fill('+351 912345678');await admin.locator('[data-event="date"]').fill('25122026');assert.equal(await admin.locator('[data-event="date"]').inputValue(),'25/12/2026');await admin.locator('[data-delivery="start"]').fill('01122026');await admin.locator('[data-delivery="end"]').fill('03122026');assert.equal(await admin.locator('[data-delivery="start"]').inputValue(),'01/12/2026');assert.equal(await admin.locator('[data-native-date="data-delivery-start"]').inputValue(),'2026-12-01');await admin.locator('[data-native-date="data-delivery-end"]').fill('2026-12-04');assert.equal(await admin.locator('[data-delivery="end"]').inputValue(),'04/12/2026');await admin.locator('#adminThemeToggle').click();assert.equal(await admin.locator('[data-contact="name"]').inputValue(),'Cliente teste');await admin.screenshot({path:'artifacts/v3-browser/admin-manual-night-mobile.png',fullPage:true});
 await adminContext.close();
 const manualContext=await browser.newContext({viewport:{width:390,height:740},reducedMotion:'reduce'});
 await manualContext.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.request().url().startsWith('https://www.mercadopago.com.br/checkout/v1/redirect')?route.fulfill({status:200,contentType:'text/html',body:'<h1>Pagamento simulado</h1>'}):route.abort());
 const manualPage=await manualContext.newPage();manualPage.on('pageerror',e=>errors.push(e.message));
 await manualPage.goto(origin+manualFixture.customerAreaPath);await manualPage.locator('.libri-manual-checkout .manual-extra').first().waitFor();
 assert.equal(await manualPage.getByText('Aceitar proposta',{exact:true}).count(),0);
 assert.equal(await manualPage.locator('.manual-total').count(),1);
 for(const size of [{width:390,height:740},{width:360,height:640},{width:320,height:568}]){
  await manualPage.setViewportSize(size);
  const fit=await manualPage.evaluate(()=>{const button=document.querySelector('[data-manual-action="cart"]').getBoundingClientRect();const total=document.querySelector('.manual-total').getBoundingClientRect();const scroll=document.querySelector('.manual-scroll');return {bottom:button.bottom,top:total.top,viewport:innerHeight,wide:document.documentElement.scrollWidth>innerWidth,rows:document.querySelectorAll('.manual-extra').length,overflow:scroll.scrollHeight-scroll.clientHeight};});
  assert.ok(fit.bottom<=fit.viewport+1&&fit.top>=0,JSON.stringify(fit));
  assert.equal(fit.wide,false);
  if(size.height===740&&fit.rows<=8)assert.ok(fit.overflow<=2,JSON.stringify(fit));
 }
 await manualPage.setViewportSize({width:390,height:740});
 await manualPage.screenshot({path:'artifacts/v3-browser/manual-v110-extras.png',fullPage:true});
 const add=manualPage.locator('[data-manual-addon="confirmation"]');
 await add.click();await manualPage.locator('[data-manual-addon="confirmation"]').filter({hasText:'Retirar'}).waitFor();await manualPage.locator('#app[aria-busy="false"]').waitFor();
 await manualPage.locator('[data-manual-action="cart"]').click();
 await manualPage.locator('[data-manual-terms]').waitFor();assert.equal(await manualPage.locator('.manual-cart-item').count(),1);
 assert.equal(await manualPage.getByText('Aceitar proposta',{exact:true}).count(),0);
 await manualPage.screenshot({path:'artifacts/v3-browser/manual-v109-cart.png',fullPage:true});
 await manualPage.locator('[data-manual-action="pay"]').click();await manualPage.locator('.manual-error').waitFor();assert.equal(manualMP.posts,0);
 await manualPage.locator('[data-manual-terms]').check();await manualPage.locator('[data-manual-action="pay"]').click();
 await manualPage.locator('.black-libri-overlay [data-black-slot]').first().waitFor();
 await manualPage.screenshot({path:'artifacts/v3-browser/manual-v109-black.png',fullPage:true});
 await manualPage.locator('[data-black-sound]').click();await manualPage.locator('[data-black-slot]').first().click();await manualPage.locator('[data-black-continue]:enabled').waitFor();
 await manualPage.locator('[data-black-continue]').click();await manualPage.waitForURL('https://www.mercadopago.com.br/checkout/v1/redirect?order=1');
 assert.equal(manualMP.posts,1);assert.equal(manualDb.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,1);
 const manualOrder=manualDb.sqlite.prepare('SELECT * FROM v2_orders WHERE public_token=?').get(manualFixture.publicToken);const manualPay=manualDb.sqlite.prepare('SELECT * FROM v2_payments WHERE order_id=?').get(manualOrder.id);
 assert.equal(manualDb.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_black_libri_claims WHERE order_id=? AND status='attached'").get(manualOrder.id).n,1);
 manualMP.approve(manualPay.provider_order_id);globalThis.fetch=manualFetch;try{await syncMercadoPagoOrder(manualEnv,manualPay.provider_order_id);}finally{globalThis.fetch=originalFetch;}
 await manualPage.goto(origin+manualFixture.customerAreaPath);await manualPage.locator('[data-v3-tab="shared"]').waitFor();await manualPage.screenshot({path:'artifacts/v3-browser/manual-v109-paid.png',fullPage:true});
 await manualContext.close();
 assert.deepEqual(errors,[]);assert.equal(blocked,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v3_store_journeys').get().n,0);
 console.log('Chromium: invite, Atelie, retro, three services, checkout terms, locked/unlocked customer shell, persisted draft, admin detail; test-only mock provider.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));db.sqlite.close();fixtureDb.sqlite.close();manualDb.sqlite.close();}
