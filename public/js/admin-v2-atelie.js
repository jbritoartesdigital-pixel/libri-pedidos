import { api, esc, showToast } from './admin-v2-core.js';

// Usa o Admin já autenticado. Não inclui botão para ativar vendas.
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
    const tabs=packages.map(x=>'<button class="settings-tab '+(x.code===selected?'active':'')+'" type="button" data-atelie-package="'+esc(x.code)+'">'+esc(x.name)+'</button>').join('');
    const price=p.priceCents==null?'':(p.priceCents/100).toFixed(2).replace('.',',');
    panel.innerHTML='<section class="card"><h2>Libri Ateliê | Identidade Visual</h2>'+
      '<p>Pacotes em estudo, no mesmo painel da Libri. <strong>Não estão disponíveis para compra.</strong></p>'+
      '<div class="notice info">Preços internos não são publicados. Venda bloqueada até confirmar escopo V4.1, capacidade, termos, briefing e checkout.</div></section>'+
      '<div class="store-navigation-buttons" style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0">'+tabs+'</div>'+
      '<section class="card"><h2>Pacote '+esc(p.name)+'</h2><form id="atelieForm">'+
      f('atDesc','Explicação simples para a cliente',textarea('atDesc',p.shortDescription,3))+
      f('atIncluded','Entregáveis exatos: um por linha',textarea('atIncluded',lines(p.includedDraft),6))+
      '<p class="muted">Aguardar a versão oficial do catálogo. Não copiar quantidades de uma tabela provisória.</p>'+
      f('atExcluded','O que não está incluído: um por linha',textarea('atExcluded',lines(p.excludedDraft),4))+
      f('atScope','Versão oficial de referência',input('atScope',p.scopeReference,'Ex.: V4.1 aprovada'))+
      '<div class="form-grid">'+
      f('atPrice','Preço em R$ (interno)',input('atPrice',price,'Pendente'))+
      f('atPoints','Carga de agenda em pontos',input('atPoints',p.pointsUnits,'Pendente'))+
      f('atRevisions','Rodadas de ajustes',input('atRevisions',p.revisionLimit,'Pendente'))+'</div>'+
      f('atNotes','Condições comerciais em estudo',textarea('atNotes',p.commercialNotes,4))+
      box('atVisible','Exibir na prévia V3, sempre sem preço e sem venda.',p.showcaseVisible)+
      box('atApproved','Confirmei escopo, entregáveis, exclusões e rodadas contra o catálogo oficial.',p.scopeApproved)+
      '<div class="toolbar" style="margin-top:16px"><button class="btn btn-primary" type="submit" id="atSave">Salvar rascunho</button></div>'+
      '</form></section>';
    panel.querySelectorAll('[data-atelie-package]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.ateliePackage;render();}));
    panel.querySelector('#atelieForm').addEventListener('submit',async ev=>{
      ev.preventDefault();
      const value=id=>panel.querySelector('#'+id).value;
      const raw=value('atPrice').trim().replace(',','.');
      if(raw!==''&&!/^\d+(\.\d{1,2})?$/.test(raw)){showToast('Preço inválido. Use um valor em reais com até duas casas decimais.');return;}
      const rawPoints=value('atPoints').trim(), rawRevisions=value('atRevisions').trim();
      const payload={
        shortDescription:value('atDesc'),
        includedItems:value('atIncluded').split('\n'),
        excludedItems:value('atExcluded').split('\n'),
        scopeReference:value('atScope'),
        priceCents:raw===''?null:Math.round(Number(raw)*100),
        pointsUnits:rawPoints===''?null:Number(rawPoints),
        revisionLimit:rawRevisions===''?null:Number(rawRevisions),
        commercialNotes:value('atNotes'),
        showcaseVisible:panel.querySelector('#atVisible').checked,
        scopeApproved:panel.querySelector('#atApproved').checked
      };
      const button=panel.querySelector('#atSave');button.disabled=true;
      try{
        const result=await api('/api/admin/v2/atelie/packages/'+selected,{
          method:'PATCH',body:JSON.stringify(payload)
        });
        packages[packages.findIndex(x=>x.code===selected)]=result.package;
        showToast('Rascunho salvo. Compra continua bloqueada.');render();
      }catch(e){showToast(e.message||'Falha ao salvar.');button.disabled=false;}
    });
  }
  render();
}
