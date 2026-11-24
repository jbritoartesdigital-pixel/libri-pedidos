// Theme is a presentation preference only: no account, cart or payment changes.
(function(){
  const key='libriV3Theme',html=document.documentElement;
  let theme='light';
  try{if(localStorage.getItem(key)==='dark')theme='dark';}catch{}
  function apply(value){
    theme=value;html.dataset.v3Theme=theme;
    const button=document.getElementById('v3-theme-toggle');
    if(button){
      const dark=theme==='dark',label=dark?'Ativar modo claro':'Ativar modo noturno';
      button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label',label);button.title=label;
      button.querySelector('svg').innerHTML=dark?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/>':'<path d="M20 15.1A8.5 8.5 0 0 1 8.9 4a8.5 8.5 0 1 0 11.1 11.1Z"/>';
      button.hidden=false;
    }
  }
  apply(theme);
  document.addEventListener('DOMContentLoaded',()=>{
    apply(theme);
    document.getElementById('v3-theme-toggle')?.addEventListener('click',()=>{apply(theme==='dark'?'light':'dark');try{localStorage.setItem(key,theme);}catch{}});
  });
})();
