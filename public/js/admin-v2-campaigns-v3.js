import {api,esc,showToast} from './admin-v2-core.js';
const base='/api/admin/v2/store-config/v3/campaigns';
export async function renderV3Campaigns(panel){
 const render=async()=>{
  const data=await api(base);
  panel.innerHTML='<section class="card"><h3>Desconto combinado</h3><p>Padrão: 5% para dois serviços diferentes e 10% para três. A campanha substitui esses percentuais apenas durante sua vigência. Cupons monetários e combos não se acumulam.</p><form id="v3-campaign-form"><label>Nome da campanha <input class="input" name="name" required maxlength="100"></label><label>Dois serviços (%) <input class="input" name="two" type="number" min="0" max="50" value="5" required></label><label>Três serviços (%) <input class="input" name="three" type="number" min="0" max="50" value="10" required></label><label>Início (horário de Brasília) <input class="input" name="start" type="datetime-local" required></label><label>Fim (horário de Brasília) <input class="input" name="end" type="datetime-local" required></label><button class="btn btn-primary">Criar campanha</button></form></section>'+
  '<section class="card"><h3>Campanhas cadastradas</h3>'+data.campaigns.map(c=>'<p><strong>'+esc(c.name)+'</strong> · '+esc(c.two_percent)+'% / '+esc(c.three_percent)+'% · '+esc(c.active?(Date.parse(c.ends_at)<=Date.now()?'Encerrada':Date.parse(c.starts_at)>Date.now()?'Agendada':'Em vigor'):'Pausada')+'</p><p>'+esc(new Date(c.starts_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))+' a '+esc(new Date(c.ends_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))+'</p>'+(c.active&&Date.parse(c.ends_at)>Date.now()?'<button type="button" class="btn btn-secondary" data-pause-campaign="'+esc(c.id)+'">Pausar</button>':'')).join('')+'</section>';
  panel.querySelector('#v3-campaign-form').addEventListener('submit',async e=>{
   e.preventDefault();const f=new FormData(e.target),button=e.target.querySelector('button');button.disabled=true;
   try{await api(base,{method:'POST',body:JSON.stringify({name:f.get('name'),twoPercent:Number(f.get('two')),threePercent:Number(f.get('three')),startsAt:f.get('start')+':00-03:00',endsAt:f.get('end')+':00-03:00'})});showToast('Campanha criada.');await render();}catch(e){showToast(e.message);button.disabled=false;}
  });
  panel.querySelectorAll('[data-pause-campaign]').forEach(b=>b.addEventListener('click',async()=>{
    if(!confirm('Pausar esta campanha? Novas cotações voltarão ao desconto padrão.'))return;
    b.disabled=true;try{await api(base+'/'+b.dataset.pauseCampaign+'/pause',{method:'POST',body:'{}'});showToast('Campanha pausada.');await render();}catch(e){showToast(e.message);b.disabled=false;}
  }));
 };
 try{await render();}catch(e){panel.textContent=e.message;}
}
