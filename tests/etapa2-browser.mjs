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
function mockServer(reference) {
  return createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const send=(code,body,headers={})=>{
      res.writeHead(code,{'cache-control':'no-store',...headers});
      res.end(body);
    };
    const json=(code,body,headers={})=>send(code,JSON.stringify(body),
      {'content-type':'application/json; charset=utf-8',...headers});
    if(url.pathname.startsWith('/api/')) {
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
    if(asset==='/pedido'||asset==='/pedido/')asset='/client-v2.html';
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
async function openServer(ref) {
  const srv=mockServer(ref);
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
    assert.equal(await page.getByRole('button',{name:'Ver diagnóstico técnico'}).isVisible(),true);
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
      '</div></div></div></section></main></html>'
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
  await checkOfferIsFullyReachable(browser);
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
