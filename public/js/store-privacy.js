// Shared, first-party store privacy preference. No marketing cookies or tracking SDKs.
const KEY='libriPrivacyV1';
let sessionChoice=null;
function preference(){if(sessionChoice!==null)return sessionChoice;try{const value=localStorage.getItem(KEY);if(['allow','deny'].includes(value))return value;}catch{}return sessionChoice;}
export function analyticsAllowed(){return preference()==='allow';}
function setPreference(value){
 if(!['allow','deny'].includes(value))return;
 sessionChoice=value;try{localStorage.setItem(KEY,value);}catch{}
 if(value==='deny')try{sessionStorage.removeItem('libriStoreJourneyV1');}catch{}
 window.dispatchEvent(new Event('libri-privacy-change'));
}
export function mountStorePrivacy({store=true}={}){
 if(!document.body||document.getElementById('libri-privacy'))return;
 const wrapper=document.createElement('footer');wrapper.id='libri-privacy';wrapper.className='libri-privacy';
 wrapper.innerHTML='<div class="libri-privacy-links"><button type="button" data-privacy="privacy">Privacidade</button><button type="button" data-privacy="cookies">Cookies e armazenamento</button>'+(store?'<button type="button" data-privacy="preferences">Preferências de privacidade</button>':'')+'</div>';
 document.body.append(wrapper);
 const dialog=document.createElement('dialog');dialog.className='libri-privacy-dialog';dialog.setAttribute('aria-labelledby','libri-privacy-title');document.body.append(dialog);
 const content={
 privacy:'<p>Os dados de contato e da comemoração são usados para preparar a contratação, processar o pagamento, prestar o serviço e atender a cliente. O briefing pode conter fotos e referências enviadas após a contratação. O acesso ao pedido deve ser mantido privado; não compartilhe seu link pessoal.</p><p>O pagamento é processado pelo Mercado Pago. A Libri mantém registros necessários ao atendimento, histórico, comprovação das transações e obrigações aplicáveis. Prazos de acesso aos arquivos são informados nas condições do serviço.</p><p>Para solicitar acesso ou correção de dados, tratar dúvidas de privacidade ou exercer seus direitos, fale com a Libri pelos canais oficiais: <a href="https://www.instagram.com/libriconvites/" target="_blank" rel="noopener noreferrer">@libriconvites</a>.</p>',
 cookies:'<p>Utilizamos armazenamento local e de sessão para preservar escolhas, preferências e a tentativa de pagamento, evitando perda de progresso e cobranças duplicadas. Esses recursos essenciais não dependem da aceitação de análise opcional.</p><p>Se você permitir, registramos etapas de navegação com um identificador temporário, sem copiar respostas dos formulários. A jornada pode ser associada ao pedido criado para medir conversão. A limpeza periódica remove registros com mais de 90 dias desde a última etapa registrada. Recusar não altera os preços nem impede a compra.</p><p>Esta loja não instala cookies opcionais de publicidade. O ambiente de pagamento externo tem suas próprias políticas.</p>',
 preferences:'<p>O armazenamento essencial mantém o pedido e a recuperação de pagamento. A análise de navegação é opcional. Você pode mudar esta escolha a qualquer momento; a recusa interrompe novos registros, sem apagar registros anteriores já associados ao pedido.</p>'
 };
 function open(type){
 const title=type==='privacy'?'Privacidade':type==='cookies'?'Cookies e armazenamento':'Preferências de privacidade';
 dialog.innerHTML='<div class="libri-privacy-head"><h2 id="libri-privacy-title">'+title+'</h2><button type="button" data-privacy="close" aria-label="Fechar">×</button></div>'+content[type]+(type==='preferences'?'<p role="status">Análise opcional: '+(analyticsAllowed()?'permitida':'não permitida')+'</p><div class="libri-privacy-actions"><button type="button" data-privacy="deny">Recusar análise</button><button type="button" data-privacy="allow">Permitir análise</button></div>':'<button type="button" data-privacy="close">Entendi</button>');
 if(!dialog.open)dialog.showModal();
 }
 function action(e){const type=e.target.closest('[data-privacy]')?.dataset.privacy;if(!type)return;if(type==='close'){dialog.close();return;}if(['allow','deny'].includes(type)){setPreference(type);dialog.close();renderBanner();return;}open(type);}
 wrapper.addEventListener('click',action);dialog.addEventListener('click',action);
 const banner=document.createElement('aside');banner.className='libri-privacy-banner';banner.setAttribute('aria-label','Análise de navegação opcional');wrapper.before(banner);banner.addEventListener('click',action);
 function renderBanner(){
  banner.hidden=!store||preference()!==null;
  if(!banner.hidden)banner.innerHTML='<strong>Suas escolhas, sua privacidade</strong><p>Podemos medir as etapas da loja para melhorar a experiência? A compra funciona normalmente sem análise opcional.</p><div class="libri-privacy-actions"><button type="button" data-privacy="deny">Recusar</button><button type="button" data-privacy="allow">Permitir</button><button type="button" data-privacy="preferences">Saiba mais</button></div>';
 }
 renderBanner();
}
