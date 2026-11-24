// Admin theme is a local presentation preference, independent from the public store.
(function(){
 const key='libriAdminTheme',html=document.documentElement;
 let value='light';try{if(localStorage.getItem(key)==='dark')value='dark';}catch{}
 function apply(){html.dataset.adminTheme=value;const b=document.getElementById('adminThemeToggle');if(!b)return;const dark=value==='dark',label=dark?'Ativar modo claro':'Ativar modo noturno';b.setAttribute('aria-pressed',String(dark));b.setAttribute('aria-label',label);b.title=label;b.hidden=false;b.querySelector('svg').innerHTML=dark?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/>':'<path d="M20 15.1A8.5 8.5 0 0 1 8.9 4a8.5 8.5 0 1 0 11.1 11.1Z"/>';}
 apply();document.addEventListener('DOMContentLoaded',()=>{apply();document.getElementById('adminThemeToggle')?.addEventListener('click',()=>{value=value==='dark'?'light':'dark';apply();try{localStorage.setItem(key,value);}catch{}});});
})();
