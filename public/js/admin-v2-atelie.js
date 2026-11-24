import { api, esc, showToast } from './admin-v2-core.js';

// Usa a autenticação Passkey e as operações comerciais do Admin existente.
export async function renderAtelieStore(panel) {
  panel.innerHTML='<div class="card">Carregando Libri Ateliê…</div>';
  let data;
  try {data=await api('/api/admin/v2/atelie/packages');}
  catch(e){panel.innerHTML='<div class="card empty">'+esc(e.message)+'</div>';return;}
  const packages=data.packages||[];
  let selected=packages[0]?.code;
  const lines=x=>(x||[]).join('\n');
  const f=(id,label,html)=>'<div class="field"><label for="'+id+'">'+label+'</label>'+html+'</div>';
  const input=(id,value,placeholder='')=>'<input class="input" id="'+id+'" value="'+esc(value??'')+'" placeholder="'+esc(placeholder)+'">';
  const textarea=(id,value,rows=4)=>'<textarea class="input" id="'+id+'" rows="'+rows+'">'+esc(value??'')+'</textarea>';
  const box=(id,label,checked)=>'<label class="checkline"><input type="checkbox" id="'+id+'" '+(checked?'checked':'')+'><span>'+label+'</span></label>';
  function render() {
    const p=packages.find(x=>x.code===selected);
    if(!p){panel.innerHTML='<div class="card empty">Nenhum pacote cadastrado.</div>';return;}
    const tabs=packages.map(x=>'<button class="settings-tab '+(x.code===selected?'active':'')+'" type="button" data-atelie-package="'+esc(x.code)+'">'+esc(x.name)+
      '<span class="admin-v3-at-package-state">'+(x.saleEnabled?'À venda':!(x.releaseMissing||[]).length?'Pronto para liberar':'Em configuração')+'</span></button>').join('');
    const price=p.priceCents==null?'':(p.priceCents/100).toFixed(2).replace('.',',');
    const capacityPoints=p.pointsUnits==null?'':(p.pointsUnits/100).toLocaleString('pt-BR',{maximumFractionDigits:2});
    const activeCount=packages.filter(x=>x.saleEnabled).length;
    const readyCount=packages.filter(x=>!x.saleEnabled&&!(x.releaseMissing||[]).length).length;
    panel.innerHTML='<section class="card"><h2>Libri Ateliê | Identidade Visual</h2>'+
      '<p>Gerencie os pacotes e valores do Ateliê na mesma loja. A publicação depende de uma ação explícita no Admin.</p>'+
      '<div class="admin-v3-at-overview" aria-label="Situação dos pacotes">'+
      '<div><strong>'+activeCount+'</strong><span>À venda</span></div>'+
      '<div><strong>'+readyCount+'</strong><span>Prontos para liberar</span></div>'+
      '<div><strong>'+(packages.length-activeCount-readyCount)+'</strong><span>Em configuração</span></div></div>'+
      '<div class="notice info">Confira o estado de venda de cada pacote. Os valores e entregáveis cadastrados são exibidos abaixo.</div></section>'+
      '<div class="store-navigation-buttons" style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0">'+tabs+'</div>'+
      '<section class="card"><h2>Pacote '+esc(p.name)+'</h2><form id="atelieForm"><fieldset '+(p.saleEnabled?'disabled':'')+' style="border:0;padding:0;margin:0">'+
      f('atDesc','Explicação simples para a cliente',textarea('atDesc',p.shortDescription,3))+
      f('atIncluded','Entregáveis exatos: um por linha',textarea('atIncluded',lines(p.includedDraft),6))+
      '<p class="muted">Catálogo V4.1 oficial aprovado: R$159, R$299 e R$549, com paleta, tipografia e mascotinho em 3, 4 e 5 poses. Carga em pontos exibida abaixo conforme o catálogo cadastrado.</p>'+
      f('atExcluded','O que não está incluído: um por linha',textarea('atExcluded',lines(p.excludedDraft),4))+
      f('atScope','Versão oficial de referência',input('atScope',p.scopeReference,'Ex.: V4.1 aprovada'))+
      '<div class="form-grid">'+
      f('atPrice','Preço em R$ (interno)',input('atPrice',price,'Pendente'))+
      f('atPoints','Carga de produção em pontos (ex.: 1, 1,5, 2)',input('atPoints',capacityPoints,'Pendente'))+
      f('atRevisions','Rodadas de ajustes',input('atRevisions',p.revisionLimit,'Pendente'))+'</div>'+
      f('atNotes','Observações comerciais internas',textarea('atNotes',p.commercialNotes,4))+
      f('atTerms','Condições específicas para a cliente (entregas, revisões, direitos de uso e exclusões)',textarea('atTerms',p.specificTermsDraft,7))+
      box('atVisible','Exibir o pacote na vitrine V3 (preço apenas quando a venda for liberada).',p.showcaseVisible)+
      box('atApproved','Confirmei escopo, entregáveis, exclusões e rodadas contra o catálogo oficial.',p.scopeApproved)+
      '<div class="toolbar" style="margin-top:16px"><button class="btn btn-primary" type="submit" id="atSave">Salvar rascunho</button>'+
      '<button type="button" class="btn btn-secondary" id="atImportV41">Aplicar catálogo V4.1 aprovado</button></div>'+
      '</fieldset></form>'+
      '<div class="notice '+(p.saleEnabled?'success':'info')+'" style="margin-top:14px">'+
        (p.saleEnabled?'Pacote à venda no checkout existente. Para editar valores ou escopo, pause primeiro.':
          ((p.releaseMissing||[]).length?
            'Falta configurar: '+(p.releaseMissing||[]).map(esc).join('; ')+'.':
            'Este pacote está pronto para ativação comercial mediante sua confirmação.'))+'</div>'+
      '<div class="toolbar"><button type="button" class="btn '+(p.saleEnabled?'btn-secondary':'btn-primary')+
        '" id="atelieToggleSale" '+(!p.saleEnabled&&(p.releaseMissing||[]).length?'disabled':'')+'>'+
        (p.saleEnabled?'Pausar vendas deste pacote':'Liberar venda deste pacote')+'</button></div></section>';
    panel.querySelectorAll('[data-atelie-package]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.ateliePackage;render();}));
    panel.querySelector('#atImportV41')?.addEventListener('click',async()=>{
      if(p.saleEnabled)return showToast('Pause as vendas para atualizar o catálogo.');
      if(!window.confirm('Aplicar valores e entregáveis V4.1 aprovados neste pacote? Os pontos aprovados serão restaurados e as vendas continuarão desativadas.'))return;
      const button=panel.querySelector('#atImportV41');
      button.disabled=true;
      try{
        const result=await api('/api/admin/v2/atelie/packages/'+selected+'/approved-catalog',{
          method:'POST',body:'{}'
        });
        packages[packages.findIndex(x=>x.code===selected)]=result.package;
        showToast('Catálogo e pontos aprovados aplicados. As vendas continuam desativadas.');
        render();
      }catch(e){showToast(e.message||'Não foi possível aplicar o catálogo.');button.disabled=false;}
    });
    panel.querySelector('#atelieToggleSale')?.addEventListener('click',async()=>{
      const enabled=!p.saleEnabled;
      if(!window.confirm(enabled
        ? 'LIBERAR este pacote para compra com os valores, entregáveis, revisões e condições aprovados?'
        : 'PAUSAR novas vendas deste pacote? Pedidos existentes não serão cancelados.'))return;
      const button=panel.querySelector('#atelieToggleSale');
      button.disabled=true;
      try{
        const response=await api('/api/admin/v2/atelie/packages/'+selected+'/sales',{
          method:'POST',body:JSON.stringify({enabled})
        });
        packages.splice(0,packages.length,...response.packages);
        showToast(enabled?'Venda liberada!':'Novas vendas pausadas.');render();
      }catch(e){showToast(e.message||'Não foi possível alterar a venda.');button.disabled=false;}
    });
    panel.querySelector('#atelieForm').addEventListener('submit',async ev=>{
      ev.preventDefault();
      const value=id=>panel.querySelector('#'+id).value;
      const raw=value('atPrice').trim().replace(',','.');
      if(raw!==''&&!/^\d+(\.\d{1,2})?$/.test(raw)){showToast('Preço inválido. Use um valor em reais com até duas casas decimais.');return;}
      const rawPoints=value('atPoints').trim().replace(',','.');
      const rawRevisions=value('atRevisions').trim();
      if(rawPoints!=='' && (!/^\d+(?:\.\d{1,2})?$/.test(rawPoints)||Number(rawPoints)<=0)){
        showToast('Informe a carga de produção em pontos. Ex.: 1, 1,5 ou 2.');
        return;
      }
      if(rawRevisions!=='' && (!/^\d+$/.test(rawRevisions)||!Number.isSafeInteger(Number(rawRevisions)))){
        showToast('Informe o número inteiro de rodadas de revisão.');
        return;
      }
      const payload={
        shortDescription:value('atDesc'),
        includedItems:value('atIncluded').split('\n'),
        excludedItems:value('atExcluded').split('\n'),
        scopeReference:value('atScope'),
        priceCents:raw===''?null:Math.round(Number(raw)*100),
        pointsUnits:rawPoints===''?null:Math.round(Number(rawPoints)*100),
        revisionLimit:rawRevisions===''?null:Number(rawRevisions),
        commercialNotes:value('atNotes'),specificTerms:value('atTerms'),
        showcaseVisible:panel.querySelector('#atVisible').checked,
        scopeApproved:panel.querySelector('#atApproved').checked
      };
      const button=panel.querySelector('#atSave');button.disabled=true;
      try{
        const result=await api('/api/admin/v2/atelie/packages/'+selected,{
          method:'PATCH',body:JSON.stringify(payload)
        });
        packages[packages.findIndex(x=>x.code===selected)]=result.package;
        showToast('Configuração salva. A venda só muda pelo botão de liberação.');render();
      }catch(e){showToast(e.message||'Falha ao salvar.');button.disabled=false;}
    });
  }
  render();
}
