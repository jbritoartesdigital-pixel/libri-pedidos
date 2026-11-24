// Shared, first-party store privacy preference. No marketing cookies or tracking SDKs.
const KEY='libriPrivacyV1';
let sessionChoice=null;
function preference(){if(sessionChoice!==null)return sessionChoice;try{const value=localStorage.getItem(KEY);if(['allow','allow_named','deny'].includes(value))return value;}catch{}return sessionChoice;}
export function analyticsAllowed(){return ['allow','allow_named'].includes(preference());}
export function namedAnalyticsAllowed(){return preference()==='allow_named';}
function setPreference(value){
 if(!['allow','allow_named','deny'].includes(value))return;
 const previous=preference();sessionChoice=value;try{localStorage.setItem(KEY,value);}catch{}
 window.dispatchEvent(new CustomEvent('libri-privacy-change',{detail:{previous,value}}));
 if(value==='deny')try{sessionStorage.removeItem('libriStoreJourneyV1');}catch{}
}
export function mountStorePrivacy({store=true}={}){
 if(!document.body||document.getElementById('libri-privacy'))return;
 const wrapper=document.createElement('footer');wrapper.id='libri-privacy';wrapper.className='libri-privacy';
 wrapper.innerHTML='<div class="libri-privacy-links"><button type="button" data-privacy="privacy">Privacidade</button><button type="button" data-privacy="cookies">Cookies e armazenamento</button>'+(store?'<button type="button" data-privacy="preferences">Preferências de privacidade</button>':'')+'</div>';
 document.body.append(wrapper);
 const dialog=document.createElement('dialog');dialog.className='libri-privacy-dialog';dialog.setAttribute('aria-labelledby','libri-privacy-title');document.body.append(dialog);
 const content={
 privacy:'<p>Os dados de contato e da comemoração são usados para preparar a contratação, processar o pagamento, prestar o serviço e atender a cliente. O briefing pode conter fotos e referências enviadas após a contratação. O acesso ao pedido deve ser mantido privado; não compartilhe seu link pessoal.</p><p>O pagamento é processado pelo Mercado Pago. A Libri mantém registros necessários ao atendimento, histórico, comprovação das transações e obrigações aplicáveis. Prazos de acesso aos arquivos são informados nas condições do serviço.</p><p>Para solicitar acesso ou correção de dados, tratar dúvidas de privacidade ou exercer seus direitos, fale com a Libri pelos canais oficiais: <a href="https://www.instagram.com/libriconvites/" target="_blank" rel="noopener noreferrer">@libriconvites</a>.</p>',
 cookies:'<p>Utilizamos armazenamento local e de sessão para preservar escolhas, preferências e a tentativa de pagamento, evitando perda de progresso e cobranças duplicadas. Esses recursos essenciais não dependem da aceitação de análise opcional.</p><p>Se permitir análise sem nome, registramos etapas com um identificador temporário e podemos associar a jornada a um pedido para medir conversão. Ao escolher análise com nome, também registramos o nome informado na saudação e a última etapa para entender compras não concluídas. Não coletamos telefone, Instagram, respostas de briefing ou credenciais para análise. Os registros são eliminados periodicamente após 90 dias sem nova etapa. Retirar a autorização solicita a remoção do nome da jornada atual; para outras jornadas, fale com a Libri pelos canais oficiais. Recusar não altera os preços nem impede a compra.</p><p>Esta loja não instala cookies opcionais de publicidade. O ambiente de pagamento externo tem suas próprias políticas.</p>',
 preferences:'<p>O armazenamento essencial mantém o pedido e a recuperação de pagamento. A análise é opcional. Escolha se deseja permitir etapas sem nome, permitir também o nome da saudação, ou recusar. Retirar a identificação solicita a remoção do nome da jornada atual quando houver comunicação com o servidor; registros comerciais necessários ao pedido não são apagados.</p>'
 };
 function open(type){
 const title=type==='privacy'?'Privacidade':type==='cookies'?'Cookies e armazenamento':'Preferências de privacidade';
 dialog.innerHTML='<div class="libri-privacy-head"><h2 id="libri-privacy-title">'+title+'</h2><button type="button" data-privacy="close" aria-label="Fechar">×</button></div>'+content[type]+(type==='preferences'?'<p role="status">Análise opcional: '+(namedAnalyticsAllowed()?'com nome':analyticsAllowed()?'sem nome':'não permitida')+'</p><div class="libri-privacy-actions"><button type="button" data-privacy="deny">Recusar análise</button><button type="button" data-privacy="allow">Permitir sem nome</button><button type="button" data-privacy="allow_named">Permitir com nome</button></div>':'<button type="button" data-privacy="close">Entendi</button>');
 if(!dialog.open)dialog.showModal();
 }
 function action(e){const type=e.target.closest('[data-privacy]')?.dataset.privacy;if(!type)return;if(type==='close'){dialog.close();return;}if(['allow','allow_named','deny'].includes(type)){setPreference(type);dialog.close();renderBanner();return;}open(type);}
 wrapper.addEventListener('click',action);dialog.addEventListener('click',action);
 const banner=document.createElement('aside');banner.className='libri-privacy-banner';banner.setAttribute('aria-label','Análise de navegação opcional');wrapper.before(banner);banner.addEventListener('click',action);
 function renderBanner(){
  banner.hidden=!store||preference()!==null;
  if(!banner.hidden)banner.innerHTML='<strong>Privacidade e cookies</strong><p>Podemos registrar as etapas da compra para melhorar a loja. Escolha se a Libri também pode ver seu primeiro nome junto da última etapa. Sua compra funciona com qualquer opção.</p><div class="libri-privacy-actions"><button type="button" data-privacy="deny">Recusar</button><button type="button" data-privacy="allow">Aceitar sem nome</button><button type="button" data-privacy="allow_named">Aceitar com nome</button><button type="button" data-privacy="preferences">Saiba mais</button></div>';
 }
 renderBanner();
}
