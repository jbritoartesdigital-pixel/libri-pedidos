/**
 * Libri Etapa 2 - browser smoke + non-blocking visual comparison.
 * Local-only HTTP fixtures. Never access production, D1, R2, Mercado Pago,
 * WhatsApp or real customer data. No secrets and no outgoing browser requests.
 *
 * When LIBRI_BASE_SHA is supplied by PR CI, screenshots of the base commit
 * and the proposed code are compared using identical synthetic fixtures.
 * Unexpected visual differences are reported, NOT used as deployment gates.
 * Accessibility/flow breakage, JS exceptions and horizontal overflow DO fail.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve, extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';

const out=resolve('.artifacts/etapa2');
mkdirSync(out,{recursive:true});
const base=process.env.LIBRI_BASE_SHA || '';
if(base && !/^[a-f0-9]{40}$/i.test(base))throw Error('BASE_SHA inválido');
const audit={version:1,fixture:'synthetic-only',screens:[],tests:[],warnings:[],errors:[]};
const sourceCache=new Map();
const fixture={
  central:{
    capacity:[],attention:[],partiesToday:[],partiesUpcoming:[],
    pendingPayments:[],newOrders:[],upcomingDeliveries:[],
    workload:{orders:[],count:0,scenes:0},
    finance:{
      salesCents:0,cashCents:0,receivableCents:0,
      monthlyGoal:{targetCents:200000,realizedCents:0,remainingCents:200000,progressPercent:0,reached:false}
    }
  }
};
const pretendOrder={
  code:'LIBRI-100001',honoreeName:'Criança Exemplo',
  customerName:'Cliente Fictícia',eventDate:'2026-11-15',
  status:'in_production',archived:false
};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
function source(path,reference) {
  const key=(reference||'work')+':'+path;
  if(sourceCache.has(key))return sourceCache.get(key);
  const bytes=reference
    ?execFileSync('git',['show',reference+':'+path],{maxBuffer:6*1024*1024})
    :readFileSync(path);
  sourceCache.set(key,bytes);
  return bytes;
}
function mockServer(reference, { couponOffline = false, sceneLinks = false } = {}) {
  return createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const send=(code,body,headers={})=>{
      res.writeHead(code,{'cache-control':'no-store',...headers});
      res.end(body);
    };
    const json=(code,body,headers={})=>send(code,JSON.stringify(body),
      {'content-type':'application/json; charset=utf-8',...headers});
    if(url.pathname.startsWith('/api/')) {
      if(url.pathname==='/api/v2/catalog') return json(200,{catalog:{
        products:[{code:'interactive_essential',slug:'interativo',name:'Convite Interativo',
          pricingMode:'fixed',variants:[{code:'base',label:'Padrão',isDefault:true}],
          config:{}},
          ...(sceneLinks ? [{code:'cinematic_interactive',
            slug:'cinematografico-interativo',name:'Cinematográfico Interativo',
            pricingMode:'scene_count',config:{recommendedShortScenes:3},
            variants:[
              {code:'cinematic_interactive_2',label:'2 cenas',sceneCount:2,priceCents:7500,isDefault:false,active:true},
              {code:'cinematic_interactive_3',label:'3 cenas',sceneCount:3,priceCents:10000,isDefault:false,active:true},
              {code:'cinematic_interactive_4',label:'4 cenas',sceneCount:4,priceCents:12500,isDefault:false,active:true}
            ]}] : [])],
        addons:[],combos:[]
      }});
      if(url.pathname==='/api/v2/terms/current')return json(200,{
        terms:{version:'2.0',body:'Condições fictícias do pedido'}
      });
      if(url.pathname==='/api/v2/delivery-options')return json(200,{
        delivery:{options:[{start:'2026-11-02',end:'2026-11-04',recommended:true}]}
      });
      if(url.pathname==='/api/v2/quote') {
        let raw='';
        req.on('data',part=>raw+=part);
        req.on('end',()=>{
          let selection={};
          try{selection=JSON.parse(raw).selection||{};}catch{
            return json(400,{error:'JSON de teste inválido'});
          }
          if(selection.couponCode)return json(422,{error:'Este cupom atingiu o limite de usos.'});
          if(couponOffline)return json(503,{error:'Falha temporária no preço'});
          return json(200,{quote:{
            productCents:10000,addonsCents:0,baseTotalCents:10000,totalCents:10000,
            subtotalCents:10000,cardFeeCents:0,coupon:null,couponDiscountCents:0,
            comboDiscountCents:0,payment:{method:'pix',depositCents:5000,balanceCents:5000}
          }});
        });
        return;
      }
      if(url.pathname==='/api/admin/v2/agenda')return json(200,{agenda:{
        start:url.searchParams.get('start'),end:url.searchParams.get('end'),
        defaults:{sellableCapacityUnits:400,internalBufferUnits:100},days:[]
      }});
      if(url.pathname==='/api/admin/v2/agenda/cascade')return json(200,{
        cascade:{suggestions:[],releaseable:[]}
      });
      if(url.pathname==='/api/admin/v2/agenda/period' && req.method==='POST') {
        let raw='';
        req.on('data',chunk=>raw+=chunk);
        req.on('end',()=>{
          let body;
          try{body=JSON.parse(raw);}catch{return json(400,{error:'JSON inválido'});}
          if(body.start==='2026-11-02' && body.end==='2026-11-08'
             && body.excludeWeekends === true && body.skipReservedDays === true)
            return json(200,{ok:true,result:{
              updatedDays:4,excludedWeekendDays:2,skippedReservedDays:['2026-11-03']
            }});
          return json(422,{error:'Confira período e opções antes de salvar.'});
        });
        return;
      }
      if(url.pathname==='/api/admin/v2/orders/LIBRI-100001' && req.method==='GET') {
        return json(200,{detail:{
          order:{code:'LIBRI-100001',honoreeName:'Criança Exemplo',
            customerName:'Cliente Fictícia',whatsapp:'5511999999999',
            eventDate:'2026-11-15',deliveryWindow:{start:'2026-11-01',end:'2026-11-03'},
            status:'ready_for_production',statusLabel:'Pronto para produção',
            source:'manual_whatsapp',nextAction:'Iniciar produção'},
          pricing:{totalCents:18000,depositCents:9000,paymentMethod:'pix'},
          payment:{paidCents:9000,remainingBalanceCents:9000,payments:[]},
          contractedSummary:{product:{name:'Convite Interativo',sceneCount:6,priceCents:18000},
            addons:[],paymentMethod:'pix'},
          briefing:{fields:[],data:{},completionPercent:0},
          uploads:{uploads:[]},previews:[],notes:[],history:[],
          whatsappActions:[{label:'Enviar mensagem padrão',
            url:'https://wa.me/5511999999999?text=teste'}],
          allowedActions:['start_production'],
          copy:{production:'Teste de produção',full:'Ficha do pedido'}
        }});
      }
      if(url.pathname==='/api/admin/v2/orders/LIBRI-100001/contracts'
        && req.method==='GET')return json(200,{result:{contracts:[]}});
      if(url.pathname==='/api/admin/v2/orders/LIBRI-100001/edit'){
        if(req.method==='GET')return json(200,{ok:true,result:{
          catalog:{products:[{code:'interactive_essential',name:'Interativo Essencial',
            variants:[{code:'base',label:'6 cenas',priceCents:18000,isDefault:true},
              {code:'seven',label:'7 cenas',priceCents:20000}]}],
            addons:[{code:'rsvp',name:'Confirmação Libri',priceCents:3500}]},
          current:{items:[{type:'product',code:'base',name:'Interativo Essencial',
            config:{productCode:'interactive_essential',variantCode:'base',sceneCount:6}}],
            totalCents:18000,paidCents:9000,paymentMethod:'pix',
            revision:'revision-fake',manualDiscountCents:0,priceAdjustmentCents:0}
        }});
        if(req.method==='POST'){
          let raw='';
          req.on('data',x=>raw+=x);
          req.on('end',()=>{
            const reqBody=JSON.parse(raw);
            const additional=reqBody.addonCodes.includes('rsvp')?3500:0;
            return json(200,{ok:true,result:{
              changed:true,beforeTotalCents:18000,
              newTotalCents:18000+additional-reqBody.manualDiscountCents,
              paidCents:9000,remainingCents:9000+additional-reqBody.manualDiscountCents,
              note:'Confira o saldo antes de salvar.'
            }});
          });
          return;
        }
        if(req.method==='PATCH')return json(200,{ok:true,result:{
          totalCents:19500,remainingCents:10500,paidCents:9000,briefingNeedsReview:true
        }});
      }
      if(url.pathname==='/api/admin/v2/auth/status')
        return json(200,{auth:{authenticated:true,configured:true}});
      if(url.pathname==='/api/admin/v2/central')
        return json(200,fixture);
      if(url.pathname==='/api/admin/v2/notifications')
        return json(200,{result:{unreadCount:0,notifications:[]}});
      if(url.pathname==='/api/admin/v2/orders/search') {
        if(url.searchParams.get('q')==='falha')
          return json(503,{error:'Falha fictícia do teste'},
            {'x-libri-error-id':'ERR-ABCDEF012345'});
        return json(200,{orders:[pretendOrder]});
      }
      // Failing closed: unmocked APIs must NEVER hit a real endpoint.
      return json(501,{error:'API não simulada nesta suíte'});
    }
    let asset=url.pathname;
    if(asset==='/admin-v2'||asset==='/admin-v2/')asset='/admin-v2.html';
    if(asset==='/pedido'||asset==='/pedido/'
      ||/^\/pedido\/[a-z0-9-]+\/?$/.test(asset))asset='/client-v2.html';
    if(!/^\/(?:admin-v2\.html|client-v2\.html|(?:css|js|images)\/[a-z0-9_./-]+)$/i.test(asset)
      ||asset.includes('..'))return send(404,'Not found');
    const path=join('public',asset.slice(1));
    try{return send(200,source(path,reference),{
      'content-type':mime[extname(asset)]||'application/octet-stream',
      'x-content-type-options':'nosniff'
    });}
    catch{return send(404,'Missing mock asset: '+asset);}
  });
}
async function openServer(ref, options = {}) {
  const srv=mockServer(ref,options);
  await new Promise((ok,reject)=>{srv.once('error',reject);srv.listen(0,'127.0.0.1',ok);});
  return {server:srv,url:'http://127.0.0.1:'+srv.address().port};
}
function assertLayout(metrics,width,label) {
  assert.ok(metrics.doc<=width+1 && metrics.body<=width+1,
    label+' overflow horizontal '+JSON.stringify(metrics));
  assert.ok(metrics.rootRight<=width+1 && metrics.rootLeft>=-1,
    label+' painel fora da viewport '+JSON.stringify(metrics));
}
async function capture(browser,ref,label) {
  const instance=await openServer(ref);
  const ctx=await browser.newContext({
    viewport:{width:390,height:844},isMobile:true,hasTouch:true,
    deviceScaleFactor:1,reducedMotion:'reduce',
    locale:'pt-BR',timezoneId:'America/Sao_Paulo'
  });
  const page=await ctx.newPage();
  const pageErrors=[];
  const forbidden=[];
  page.on('pageerror',e=>pageErrors.push(e.name||'JavaScriptError'));
  page.on('request',request=>{
    if(!request.url().startsWith(instance.url+'/'))forbidden.push('external-request');
  });
  await page.route('**/*',route=>{
    if(!route.request().url().startsWith(instance.url+'/'))
      return route.abort('blockedbyclient');
    return route.continue();
  });
  try {
    await page.clock.setFixedTime(new Date('2026-10-10T15:00:00Z'));
    await page.goto(instance.url+'/admin-v2/',{waitUntil:'domcontentloaded'});
    await page.locator('#viewRoot #advancedOrderSearch').waitFor({timeout:18000});
    assert.equal(await page.locator('#authGate').isVisible(),false,'login não deveria aparecer');
    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('#adminApp').isVisible(),true);
    assert.equal(await page.locator('#advancedOrderFilters').getAttribute('open'),null,
      'Busca deve iniciar compacta');
    const isOrganizedAdmin = (await page.locator('#adminMoreMenu').count()) > 0;
    if (isOrganizedAdmin) {
      assert.equal(await page.locator('#adminMoreMenu').getAttribute('open'), null,
        'Ferramentas técnicas devem iniciar recolhidas');
    } else {
      assert.equal(await page.getByRole('button',{name:'Ver diagnóstico técnico'}).isVisible(),true);
    }
    for(const width of [320,360,390,412]){
      await page.setViewportSize({width,height:844});
      const m=await page.evaluate(()=>{
        const el=document.querySelector('#adminApp');
        const rect=el.getBoundingClientRect();
        return {doc:document.documentElement.scrollWidth,body:document.body.scrollWidth,
          rootLeft:rect.left,rootRight:rect.right};
      });
      assertLayout(m,width,label);
      if(width===320||width===390) {
        const name=label+'-central-'+width+'.png';
        await page.screenshot({path:join(out,name),fullPage:true,animations:'disabled'});
        audit.screens.push(name);
      }
    }
    audit.tests.push(label+': central aberta, busca recolhida, 4 viewports sem overflow');
    await page.setViewportSize({width:390,height:844});
    await page.locator('#advOrderQuery').fill('Cliente Fictícia');
    await page.locator('[data-searched-order="LIBRI-100001"]').waitFor();
    assert.equal(await page.locator('[data-searched-order]').count(),1);
    await page.locator('#advOrderQuery').fill('falha');
    await page.getByText('Falha fictícia do teste').waitFor();
    if (isOrganizedAdmin) {
      await page.getByRole('button',{name:'Encontrar função'}).click();
      await page.locator('#featureFinderQuery').fill('cupom');
      assert.equal(await page.locator('[data-feature-index]').count(),1,
        'Localizador precisa mostrar exatamente a função Cupons');
      await page.getByRole('button',{name:'Fechar busca de funções'}).click();
      await page.locator('#adminMoreMenu summary').click();
      assert.equal(await page.getByRole('button',{name:'Ver diagnóstico técnico'}).isVisible(),true,
        'Diagnóstico deve continuar acessível dentro de Mais opções');
    }
    await page.getByRole('button',{name:'Ver diagnóstico técnico'}).click();
    const dialog=page.locator('.libri-diagnostic-dialog[open]');
    await dialog.waitFor();
    const report=await dialog.locator('#libriDiagnosticReport').inputValue();
    assert.match(report,/LIBRI PEDIDOS \| DIAGNÓSTICO/);
    assert.match(report,/HTTP 503/);
    assert.match(report,/ERR-ABCDEF012345/);
    assert.ok(!report.includes('Cliente Fictícia')&&!report.includes('q=falha'),
      'Relatório não deve expor pesquisa nem cliente');
    assert.equal(await dialog.locator('#libriDiagnosticSend').count(),1);
    audit.tests.push(label+': busca fictícia, falha 503 e 🐞 com relatório sanitizado');
    assert.deepEqual(pageErrors,[],label+' JS errors');
    assert.deepEqual(forbidden,[],label+' outgoing requests');
    return true;
  } finally {
    await ctx.close();
    await new Promise(ok=>instance.server.close(ok));
  }
}
async function checkOfferIsFullyReachable(browser) {
  const ctx = await browser.newContext({
    viewport:{width:390,height:640},isMobile:true,hasTouch:true,
    deviceScaleFactor:1,locale:'pt-BR',reducedMotion:'reduce'
  });
  const page = await ctx.newPage();
  try {
    const list=Array.from({length:16},(_,i)=>
      '<li>Detalhe fictício '+(i+1)+' sobre a confirmação da festa.</li>').join('');
    const html=[
      '<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1">',
      '<main class="app-shell"><section class="page-card promo-stage">',
      '<div class="page-head"><h1 class="page-title">Pedido de teste</h1></div>',
      '<div class="action-row"><button>Voltar</button><button>Continuar</button></div>',
      '</section>',
      '<div class="promo-backdrop" id="promoBackdrop">',
      '<div class="promo-sheet" role="dialog" aria-modal="true" aria-label="Oferta opcional" tabindex="-1">',
      '<div class="promo-content">',
      '<span class="promo-kicker">Um extra para sua festa</span>',
      '<strong class="promo-title">Confirmação de Presença Libri</strong>',
      '<p class="promo-copy">Leve a confirmação por mais R$ 35,00 neste pedido.</p>',
      '<details class="promo-details"><summary>Veja o que está incluído</summary>',
      '<div class="promo-why"><strong>Por que estou sugerindo isso?</strong>',
      '<p>Confirmação vinculada ao convite.</p></div>',
      '<div class="addon-explanation"><ul>'+list+'</ul></div>',
      '</details></div>',
      '<div class="promo-actions"><button class="btn btn-ghost" id="skipFinalOffer">Agora não</button>',
      '<button class="btn btn-primary" id="acceptFinalOffer">Adicionar por R$ 35,00</button>',
      '</div></div></div></main></html>'
    ].join('\n');
    await page.setContent(html);
    await page.addStyleTag({content:source('public/css/client-v2.css').toString('utf8')});

    for(const [width,height] of [[320,520],[360,640],[390,700],[412,844],[390,390]]) {
      await page.setViewportSize({width,height});
      await page.locator('.promo-details').evaluate(el=>el.open=false);
      const stats=await page.evaluate(()=>{
        const backdrop=document.querySelector('.promo-backdrop');
        const modal=document.querySelector('.promo-sheet');
        const content=document.querySelector('.promo-content');
        const actions=document.querySelector('.promo-actions');
        const rect=modal.getBoundingClientRect(),footer=actions.getBoundingClientRect();
        return {overlay:getComputedStyle(backdrop).position,
          modalHeight:rect.height,modalTop:rect.top,modalBottom:rect.bottom,
          footerBottom:footer.bottom,footerTop:footer.top,
          scrollable:getComputedStyle(content).overflowY,
          docWidth:document.documentElement.scrollWidth};
      });
      assert.equal(stats.overlay,'fixed','upsell should be a compact popup');
      assert.ok(stats.modalTop>=-1&&stats.modalBottom<=height+1,
        'popup outside viewport at '+width+'x'+height+': '+JSON.stringify(stats));
      assert.ok(stats.docWidth<=width+1,'horizontal overflow at '+width+'x'+height);
      assert.equal(stats.scrollable,'auto');
      for(const selector of ['#skipFinalOffer','#acceptFinalOffer']) {
        const box=await page.locator(selector).boundingBox();
        assert.ok(box&&box.y>=-1&&box.y+box.height<=height+1,
          selector+' hidden before opening details at '+width+'x'+height);
      }
      await page.locator('.promo-details summary').click();
      const contents=await page.locator('.promo-content').evaluate(el=>({
        scrollHeight:el.scrollHeight,clientHeight:el.clientHeight
      }));
      assert.ok(contents.scrollHeight>contents.clientHeight,
        'expanded details must scroll inside popup at '+width+'x'+height);
      await page.locator('.promo-content').evaluate(el=>el.scrollTop=el.scrollHeight);
      for(const selector of ['#skipFinalOffer','#acceptFinalOffer']) {
        const box=await page.locator(selector).boundingBox();
        assert.ok(box&&box.y>=-1&&box.y+box.height<=height+1,
          selector+' hidden after scrolling details at '+width+'x'+height);
      }
      if(width===390 && height===700) {
        await page.locator('.promo-details').evaluate(el=>el.open=false);
        await page.screenshot({path:join(out,'alteracao-oferta-popup-390.png'),
          animations:'disabled'});
        audit.screens.push('alteracao-oferta-popup-390.png');
      }
    }
    audit.tests.push('pop-up curto: botões visíveis e detalhes com scroll próprio em 5 viewports');
  } finally {
    await ctx.close();
  }
}

async function checkCouponCanBeRemovedOnAndroid(browser) {
  const scenarios=[
    {label:'cupom vencido salvo',couponOffline:false,remove:true},
    {label:'cupom esgotado ao continuar',couponOffline:false,remove:false},
    {label:'remoção sem internet',couponOffline:true,remove:true},
  ];
  for(const scenario of scenarios) {
    const instance=await openServer('',{couponOffline:scenario.couponOffline});
    const context=await browser.newContext({
      viewport:{width:320,height:700},isMobile:true,hasTouch:true,
      locale:'pt-BR',timezoneId:'America/Sao_Paulo',
    });
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.route('**/*',route=>{
      if(!route.request().url().startsWith(instance.url+'/'))
        return route.abort('blockedbyclient');
      return route.continue();
    });
    await page.addInitScript(()=>{
      localStorage.setItem('libriV2StoreState',JSON.stringify({
        step:7,customer:{name:'Cliente Fictícia',whatsapp:'5511999999999',email:''},
        event:{type:'birthday',honoreeName:'Criança Fictícia',date:'2026-12-15'},
        selection:{productCode:'interactive_essential',productSlug:'interativo',
          variantCode:'base',addonCodes:[],comboCode:'',couponCode:'PROMO10',
          paymentMethod:'pix'},
        deliveryWindow:{start:'2026-11-02',end:'2026-11-04'},
      }));
    });
    try {
      await page.goto(instance.url+'/pedido',{waitUntil:'domcontentloaded'});
      await page.locator('#removeCoupon').waitFor({timeout:15000});
      assert.equal(await page.locator('#removeCoupon').isVisible(),true,
        scenario.label+': button missing for invalid stored coupon');
      if(scenario.remove) {
        await page.locator('#removeCoupon').click();
        await page.waitForFunction(()=>JSON.parse(localStorage.getItem('libriV2StoreState'))
          .selection.couponCode==='');
      } else {
        await page.locator('#nextBtn').click();
        await page.getByText('Confira seu pedido').waitFor({timeout:10000});
      }
      const result=await page.evaluate(()=>JSON.parse(localStorage.getItem('libriV2StoreState')));
      assert.equal(result.selection.couponCode,'',scenario.label+' coupon persisted');
      assert.equal(result.selection.productCode,'interactive_essential');
      assert.equal(result.customer.name,'Cliente Fictícia');
      if(!scenario.couponOffline) {
        if(scenario.remove) {
          await page.locator('#nextBtn').click();
          await page.getByText('Confira seu pedido').waitFor({timeout:10000});
        }
        await page.getByText('R$ 100,00').waitFor();
      } else {
        assert.equal(result.step,7,'offline removal should preserve checkout step');
        assert.equal(await page.locator('#couponCode').inputValue(),'');
      }
      const layout=await page.evaluate(()=>document.documentElement.scrollWidth);
      assert.ok(layout<=320+1,scenario.label+': horizontal overflow on Android');
      assert.deepEqual(errors,[],scenario.label+': client JS exception');
      audit.tests.push('Android checkout 320px: '+scenario.label+' sem carrinho bloqueado');
    } finally {
      await context.close();
      await new Promise(ok=>instance.server.close(ok));
    }
  }
}

async function checkAgendaPeriodMobile(browser) {
  const instance=await openServer('');
  const ctx=await browser.newContext({
    viewport:{width:320,height:700},isMobile:true,hasTouch:true,
    deviceScaleFactor:1,reducedMotion:'reduce',locale:'pt-BR',
    timezoneId:'America/Sao_Paulo'
  });
  const page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.route('**/*',route=>{
    if(!route.request().url().startsWith(instance.url+'/'))
      return route.abort('blockedbyclient');
    return route.continue();
  });
  try {
    await page.goto(instance.url+'/admin-v2/?view=agenda',{waitUntil:'domcontentloaded'});
    await page.locator('#blockPeriod').waitFor({timeout:18000});
    await page.locator('#blockPeriod').click();
    await page.locator('#periodStart').fill('2026-11-02');
    await page.locator('#periodEnd').fill('2026-11-08');
    assert.equal(await page.locator('#periodExcludeWeekends').isChecked(),true);
    assert.equal(await page.locator('#periodSkipReserved').isChecked(),true);
    await page.getByText('5 dia(s) selecionado(s)').waitFor({timeout:4000});
    for(const width of [320,390,412]){
      await page.setViewportSize({width,height:700});
      const box=await page.locator('#savePeriod').boundingBox();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth);
      assert.ok(box && box.x>=-1 && box.x+box.width<=width+1,
        'save button outside Android '+width);
      assert.ok(overflow<=width+1,'period modal overflow on Android '+width);
    }
    await page.locator('#savePeriod').click();
    await page.locator('#agendaPeriodFeedback').waitFor({timeout:12000});
    const feedback=await page.locator('#agendaPeriodFeedback').innerText();
    assert.match(feedback,/4 dia\(s\) bloqueados/);
    assert.match(feedback,/2 dia\(s\) de fim de semana/);
    assert.match(feedback,/1 dia\(s\) com reservas/);
    assert.equal(await page.locator('#modalRoot').isVisible(),false);
    await page.locator('#openPeriod').click();
    assert.equal(await page.locator('#periodExcludeWeekends').isChecked(),false,
      'reopening a period must include weekends by default');
    assert.deepEqual(errors,[],'agenda Android browser JS errors');
    audit.tests.push('Agenda Android 320/390/412px: excluir fins de semana, preservar reservas e reabrir');
  } finally {
    await ctx.close();
    await new Promise(ok=>instance.server.close(ok));
  }
}

async function checkAdminOrderEditorMobile(browser) {
  const inst=await openServer('');
  const ctx=await browser.newContext({
    viewport:{width:320,height:700},isMobile:true,hasTouch:true,
    locale:'pt-BR',timezoneId:'America/Sao_Paulo'
  });
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.route('**/*',route=>route.request().url().startsWith(inst.url+'/')
    ? route.continue() : route.abort('blockedbyclient'));
  try {
    // Use a blank same-origin document: the full admin app must not be
    // initialized and then removed while its async startup is still running.
    await page.goto(inst.url+'/editor-fixture',{waitUntil:'domcontentloaded'});
    await page.setContent(`<!doctype html><html lang="pt-BR">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <main style="padding:12px">
        <button id="editAdminOrder" aria-expanded="false">Editar pedido e valores</button>
        <section id="adminEditOrderPanel" class="admin-edit-order-panel hidden"></section>
        <div id="toast" class="toast hidden" role="status"></div>
      </main></html>`);
    await page.addStyleTag({content:source('public/css/admin-v2.css').toString('utf8')});
    await page.evaluate(async()=>{
      const module=await import('/js/admin-v2-edit-order.js');
      module.bindAdminOrderEditing({order:{code:'LIBRI-100001'}},
        async()=>{},()=>{},async()=>{});
    });
    await page.locator('#editAdminOrder').click();
    await page.locator('#adminEditDiscount').waitFor();
    assert.equal(await page.locator('#adminEditProduct').inputValue(),'__keep__',
      'default editing must preserve the current paid-for product');
    assert.equal(await page.locator('#adminEditVariant').isDisabled(),true);
    assert.equal(await page.locator('#adminEditLegacyScenes').isDisabled(),true);
    assert.equal(await page.locator('#adminEditSave').isDisabled(),true);
    await page.locator('#adminEditDiscount').fill('20');
    await page.locator('.admin-edit-order details summary').click();
    await page.locator('[data-edit-addon][value="rsvp"]').check();
    await page.locator('#adminEditNote').fill('Confirmação adicionada com desconto via WhatsApp');
    await page.locator('#adminEditPreview').click();
    await page.getByText('Novo total: R$ 195,00').waitFor();
    await page.waitForFunction(()=>!document.getElementById('adminEditSave').disabled);
    assert.equal(await page.locator('#adminEditSave').isEnabled(),true,
      'Saving must unlock after the updated price has been reviewed');
    for(const width of [320,390,412]){
      await page.setViewportSize({width,height:700});
      const screen=await page.evaluate(()=>document.documentElement.scrollWidth);
      assert.ok(screen<=width+1,'Order editor horizontal overflow at '+width);
      const rect=await page.locator('#adminEditSave').boundingBox();
      assert.ok(rect && rect.x>=-1 && rect.x+rect.width<=width+1,
        'Save button outside Android width '+width);
    }
    await page.locator('#adminEditDiscount').fill('25');
    assert.equal(await page.locator('#adminEditSave').isDisabled(),true,
      'Changing the agreed amount invalidates previous review');
    await page.locator('#adminEditPreview').click();
    await page.waitForFunction(()=>!document.getElementById('adminEditSave').disabled);
    assert.equal(await page.locator('#adminEditSave').isEnabled(),true,
      'Saving must unlock after the updated price has been reviewed');
    assert.deepEqual(errors,[]);
    audit.tests.push('Android 320/390/412px: editar pedido, adicionar RSVP, desconto e revisão obrigatória');
  } finally {
    await ctx.close();
    await new Promise(ok=>inst.server.close(ok));
  }
}

async function checkSceneDeepLinkAndroid(browser) {
  const inst=await openServer('',{sceneLinks:true});
  const ctx=await browser.newContext({
    viewport:{width:320,height:700},isMobile:true,hasTouch:true,
    locale:'pt-BR',timezoneId:'America/Sao_Paulo'
  });
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.route('**/*',route=>route.request().url().startsWith(inst.url+'/')
    ? route.continue() : route.abort('blockedbyclient'));
  try {
    // Old saved checkout may have another number of scenes. The exact link
    // must return to configuration without clearing contact information.
    await page.addInitScript(()=>{
      localStorage.setItem('libriV2StoreState',JSON.stringify({
        step:7,deepProductSlug:'cinematografico-interativo',
        event:{type:'birthday',honoreeName:'Criança Teste',date:'2026-12-15'},
        customer:{name:'Cliente Fictícia',whatsapp:'5511999999999',email:''},
        selection:{productSlug:'cinematografico-interativo',
          productCode:'cinematic_interactive',variantCode:'cinematic_interactive_4',
          addonCodes:[],comboCode:'',couponCode:'',paymentMethod:'pix'}
      }));
    });
    await page.goto(inst.url+'/pedido/cinematografico-interativo?cenas=3',
      {waitUntil:'domcontentloaded'});
    const third=page.locator('[name="variant"][value="cinematic_interactive_3"]');
    await third.waitFor({timeout:12000});
    assert.equal(await third.isChecked(),true,'shared link must select three scenes');
    assert.equal(await page.getByText('R$ 100,00').count()>0,true);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('libriV2StoreState')));
    assert.equal(saved.selection.variantCode,'cinematic_interactive_3');
    assert.equal(saved.step,2,'resumed checkout returns to scene selection safely');
    assert.equal(saved.customer.name,'Cliente Fictícia');
    const second=page.locator('[name="variant"][value="cinematic_interactive_2"]');
    await second.check();
    await page.waitForFunction(()=>
      JSON.parse(localStorage.getItem('libriV2StoreState')).selection.variantCode
      === 'cinematic_interactive_2');
    assert.equal(await second.isChecked(),true,'customer may change scenes');
    const scrollWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
    assert.ok(scrollWidth<=321,'no horizontal overflow at 320px');

    // Admin side: exact variant button must copy a shareable URL; do not
    // present one for a disabled variant.
    await page.goto(inst.url+'/editor-fixture',{waitUntil:'domcontentloaded'});
    await page.setContent(`<!doctype html><html lang="pt-BR">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <main><section id="sceneLinksPanel"></section>
        <div id="toast" class="toast hidden" role="status"></div></main></html>`);
    const copied=await page.evaluate(async()=>{
      let value='';
      Object.defineProperty(navigator,'clipboard',{configurable:true,
        value:{writeText:async text=>{value=text;}}});
      const admin=await import('/js/admin-v2-store-products.js');
      const config={products:[{name:'Cinematográfico Interativo',
        code:'cinematic_interactive',active:true,
        slug:'cinematografico-interativo',pricingMode:'scene_count',
        variants:[
          {code:'cinematic_interactive_2',label:'2 cenas',sceneCount:2,
            priceCents:7500,pointsUnits:200,active:true},
          {code:'cinematic_interactive_3',label:'3 cenas',sceneCount:3,
            priceCents:10000,pointsUnits:300,active:true},
          {code:'cinematic_interactive_4',label:'4 cenas',sceneCount:4,
            priceCents:12500,pointsUnits:400,active:false}
        ]}]};
      admin.renderStoreProducts(document.querySelector('#sceneLinksPanel'),config,()=>{});
      const button=document.querySelector('[data-copy-scene-link][data-scene-count="3"]');
      if(!button)throw Error('3 scene link button missing');
      button.click();
      await Promise.resolve();
      return {value,activeButtons:document.querySelectorAll('[data-copy-scene-link]').length};
    });
    assert.equal(copied.activeButtons,2,'never copy disabled-variant links');
    assert.equal(new URL(copied.value).pathname,'/pedido/cinematografico-interativo');
    assert.equal(new URL(copied.value).searchParams.get('cenas'),'3');
    assert.deepEqual(errors,[],'scene links should not throw on Android');
    audit.tests.push('Android: link de 3 cenas copia, preseleciona preço e permite alterar cenas');
  } finally {
    await ctx.close();
    await new Promise(resolve=>inst.server.close(resolve));
  }
}

async function checkAdminOrderDetailAndroid(browser) {
  const inst=await openServer('');
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,
    hasTouch:true,deviceScaleFactor:1,locale:'pt-BR'});
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.name||'JavaScriptError'));
  try {
    await page.goto(inst.url+'/admin-v2/',{waitUntil:'domcontentloaded'});
    await page.locator('#advOrderQuery').fill('Cliente Fictícia');
    await page.locator('[data-searched-order="LIBRI-100001"]').click();
    await page.locator('#orderSummary').waitFor();
    assert.equal(await page.locator('.order-section-nav [data-order-jump]').count(),7,
      'Todas as categorias do pedido precisam aparecer');
    const labels=await page.locator('.order-section-nav-links button').allTextContents();
    assert.deepEqual(labels,['Resumo','Dados e fotos','Pagamentos','Prévias',
      'Contrato','Histórico','Outras ações']);
    assert.equal(await page.locator('#toggleOrderPixReceipt').isVisible(),true,
      'Registrar Pix deve continuar visível quando o pedido permite');
    assert.equal(await page.locator('#editAdminOrder').isVisible(),true);
    assert.equal(await page.locator('#orderPixReceiptPanel').isVisible(),false);
    await page.locator('[data-order-jump="payment"]').click();
    assert.equal(await page.locator('#orderPaymentDetails').getAttribute('open'),'',
      'Ir para pagamento abre o painel');
    await page.locator('[data-order-jump="briefing"]').click();
    assert.equal(await page.locator('#orderBriefingPanel').isVisible(),true);
    await page.locator('[data-order-jump="preview"]').click();
    assert.equal(await page.locator('#orderPreviewDetails').getAttribute('open'),'');
    await page.locator('[data-order-jump="contract"]').click();
    assert.equal(await page.locator('#orderContractDetails').getAttribute('open'),'');
    await page.locator('[data-order-jump="history"]').click();
    assert.equal(await page.locator('#orderHistoryDetails').getAttribute('open'),'');
    await page.locator('[data-order-jump="actions"]').click();
    assert.equal(await page.locator('#orderMoreActions').getAttribute('open'),'');
    for(const width of [320,390,412]){
      await page.setViewportSize({width,height:844});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth);
      assert.ok(overflow<=width+1,'Order details overflow on mobile '+width+'px');
    }
    await page.setViewportSize({width:390,height:844});
    const snap='alteracao-detalhe-pedido-390.png';
    await page.screenshot({path:join(out,snap),fullPage:false,animations:'disabled'});
    audit.screens.push(snap);
    assert.deepEqual(errors,[],'Modal do pedido não deve gerar erro JavaScript');
    audit.tests.push('Android: detalhe do pedido com 7 atalhos, Pix e edição preservados');
  } finally {
    await ctx.close();
    await new Promise(resolve=>inst.server.close(resolve));
  }
}

function visualDiff(previous,current,output) {
  const before=PNG.sync.read(readFileSync(join(out,previous)));
  const after=PNG.sync.read(readFileSync(join(out,current)));
  if(before.width!==after.width||before.height!==after.height){
    audit.warnings.push('Tamanho alterado em '+current+': '+before.width+'x'+before.height+
      ' para '+after.width+'x'+after.height+'. Conferir screenshots lado a lado.');
    return null;
  }
  const diff=new PNG({width:before.width,height:before.height});
  let modified=0;
  for(let i=0;i<before.data.length;i+=4){
    const d=Math.max(Math.abs(before.data[i]-after.data[i]),
      Math.abs(before.data[i+1]-after.data[i+1]),
      Math.abs(before.data[i+2]-after.data[i+2]));
    if(d>25){modified++;diff.data[i]=220;diff.data[i+1]=50;diff.data[i+2]=70;}
    else {diff.data[i]=before.data[i]*.25+after.data[i]*.75;
      diff.data[i+1]=before.data[i+1]*.25+after.data[i+1]*.75;
      diff.data[i+2]=before.data[i+2]*.25+after.data[i+2]*.75;}
    diff.data[i+3]=255;
  }
  writeFileSync(join(out,output),PNG.sync.write(diff));
  const changedPercent=+(100*modified/(before.width*before.height)).toFixed(2);
  audit.screens.push(output);
  audit.warnings.push('Mudança visual em '+current+': '+changedPercent+
    '% dos pixels. Inspecionar imagem diff; diferença não bloqueia deploy.');
  return changedPercent;
}
let browser;
try{
  browser=await chromium.launch({headless:true,channel:'chrome'});
  if(base)await capture(browser,base,'main');
  await capture(browser,'','alteracao');
  await checkAdminOrderDetailAndroid(browser);
  await checkOfferIsFullyReachable(browser);
  await checkCouponCanBeRemovedOnAndroid(browser);
  await checkAgendaPeriodMobile(browser);
  await checkAdminOrderEditorMobile(browser);
  await checkSceneDeepLinkAndroid(browser);
  if(base)for(const width of [320,390]) {
    visualDiff('main-central-'+width+'.png',
      'alteracao-central-'+width+'.png','diff-central-'+width+'.png');
  }
  audit.result='success';
  console.log('✓ Etapa 2: smoke Android, fixture isolado, 🐞, screenshots e comparação');
}catch(e){
  audit.result='failure';
  audit.errors.push(String(e?.message||e).slice(0,2000));
  console.error('✗ Etapa 2 bloqueada:',String(e?.message||e));
  process.exitCode=1;
}finally{
  await browser?.close();
  writeFileSync(join(out,'resumo.json'),JSON.stringify(audit,null,2)+'\n');
  const lines=[
    '# Libri Pedidos | Etapa 2', '',
    'Ambiente: dados inteiramente fictícios; nenhuma API externa acionada.',
    '', 'Resultado: '+audit.result,'',
    '## Verificações',...audit.tests.map(x=>'- '+x),
    '', '## Comparações visuais',...audit.warnings.map(x=>'- '+x),
    '', '## Erros sanitizados',...audit.errors.map(x=>'- '+x)
  ];
  writeFileSync(join(out,'diagnostico-para-chatgpt.md'),lines.join('\n')+'\n');
}
