(() => {
  "use strict";
  let promptEvent;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault(); promptEvent=event;
    const show=()=>{if(!promptEvent || document.getElementById("libri-pwa-install")) return;
      const button=document.createElement("button"); button.id="libri-pwa-install"; button.type="button"; button.textContent="Instalar aplicativo";
      button.style.cssText="position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:1000;background:#292622;color:#fff;border:1px solid #ffffff66;border-radius:12px;padding:10px 14px;font:600 14px system-ui;box-shadow:0 2px 12px #0003;cursor:pointer";
      button.addEventListener("click",async()=>{const p=promptEvent;promptEvent=null;button.remove();if(p){try{await p.prompt();await p.userChoice}catch{}}});
      document.body.appendChild(button);
    }; if(document.body)show();else document.addEventListener("DOMContentLoaded",show,{once:true});
  });
  window.addEventListener("appinstalled",()=>{promptEvent=null;document.getElementById("libri-pwa-install")?.remove()});
})();