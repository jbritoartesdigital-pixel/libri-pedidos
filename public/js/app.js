const app=document.querySelector("#app"),toastEl=document.querySelector("#toast"),path=location.pathname;
let toastTimer,suggestTimer,appearanceDirty=false,activeInterfaceLanguage="pt-BR";

const DEFAULT_APPEARANCE={background_color:"#f8efec",card_color:"#fffaf7",text_color:"#4f2d2a",muted_color:"#866e68",button_color:"#b8735f",button_text_color:"#ffffff",overlay_color:"#3a1f1b",overlay_opacity:.18,card_opacity:.94,card_blur:12,card_radius:28,font_style:"elegant",card_style:"glass",background_position:"center",background_x:"center",card_width:"medium",interface_language:"pt-BR",invitation_url:"",calendar_location:"",location_url:"",calendar_end_time:"",cover_url:"",logo_url:""};
const DEFAULT_TEXTS={eyebrow:"Confirmação de presença",intro:"Confirme sua presença para que tudo seja preparado com carinho.",lookup_label:"Digite seu nome",lookup_placeholder:"Comece a digitar seu nome",yes_button:"Sim, estarei presente!",no_button:"Não poderei comparecer",message_label:"Deixe uma mensagem carinhosa 💌",message_placeholder:"Uma mensagem especial para quem está celebrando...",success_title:"Presença confirmada!",success_message:"Que bom ter você com a gente. 💛",decline_title:"Resposta registrada",decline_message:"Obrigada por avisar.",decline_hint:"Tudo bem 💛 Se quiser, você ainda pode deixar uma mensagem carinhosa abaixo.",name_label:"Seu nome",calendar_button:"Adicionar à agenda",location_button:"Abrir localização",back_button:"Voltar ao convite",closed_title:"Confirmações encerradas"};
const DEFAULT_TEXTS_EN={eyebrow:"RSVP",intro:"Please confirm your attendance so everything can be prepared with care.",lookup_label:"Enter your name",lookup_placeholder:"Start typing your name",yes_button:"Yes, I'll be there!",no_button:"I won't be able to attend",message_label:"Leave a sweet message 💌",message_placeholder:"A special message for the celebration...",success_title:"Attendance confirmed!",success_message:"We're so happy you'll be there. 💛",decline_title:"Response received",decline_message:"Thank you for letting us know.",decline_hint:"That's okay 💛 If you'd like, you can still leave a message below.",name_label:"Your name",calendar_button:"Add to calendar",location_button:"Open location",back_button:"Back to invitation",closed_title:"RSVP closed"};
const DEFAULT_PERMS={manage_guests:true,manage_appearance:true,manage_texts:true,view_messages:true,export_guests:true,manage_event_details:false};

const esc=(v="")=>String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const fmtDate=v=>fmtDateLang(v,"pt-BR");
const fmtDT=v=>fmtDTLang(v,"pt-BR");
const safeAppearance=e=>({...DEFAULT_APPEARANCE,...(e?.appearance_settings||{})});
const eventLang=e=>safeAppearance(e).interface_language==="en"?"en":"pt-BR";
const setActiveLanguage=lang=>{activeInterfaceLanguage=lang==="en"?"en":"pt-BR";document.documentElement.lang=activeInterfaceLanguage==="en"?"en":"pt-BR"};
const tr=(lang,pt,en)=>lang==="en"?en:pt;
const localeFor=lang=>lang==="en"?"en-US":"pt-BR";
const defaultTextsFor=lang=>lang==="en"?DEFAULT_TEXTS_EN:DEFAULT_TEXTS;
const safeTexts=e=>({...defaultTextsFor(eventLang(e)),...(e?.public_texts||{})});
const safePerms=e=>({...DEFAULT_PERMS,...(e?.client_permissions||{})});
const fmtDateLang=(v,lang="pt-BR")=>{if(!v)return tr(lang,"Data não informada","Date not provided");try{return new Intl.DateTimeFormat(localeFor(lang),{dateStyle:"medium"}).format(new Date(`${v}T12:00:00`))}catch{return v}};
const fmtDTLang=(v,lang="pt-BR")=>{if(!v)return"";try{return new Intl.DateTimeFormat(localeFor(lang),{dateStyle:"short",timeStyle:"short"}).format(new Date(v))}catch{return v}};
const statusLabel=(s,lang="pt-BR")=>s==="yes"?tr(lang,"Confirmado","Confirmed"):s==="no"?tr(lang,"Não irá","Not attending"):tr(lang,"Aguardando","Pending");
const attendanceLabel=(s,lang="pt-BR")=>s==="yes"?tr(lang,"Vai","Attending"):s==="no"?tr(lang,"Não vai","Not attending"):tr(lang,"Aguardando","Pending");
const sourceLabel=(s,lang="pt-BR")=>({admin:"Libri",client:tr(lang,"Cliente","Client"),public:tr(lang,"Convidado","Guest"),import:tr(lang,"Importação","Import")}[s]||s||"—");

function translateServerMessage(message,lang=activeInterfaceLanguage){
 if(lang!=="en")return message||"";
 let m=String(message||"");
 const exact={
  "Não foi possível concluir.":"Unable to complete the request.",
  "Acesso inválido.":"Invalid access.",
  "Este link não é válido ou foi substituído.":"This private link is invalid or has been replaced.",
  "Convidado não encontrado.":"Guest not found.",
  "Convidado não encontrado neste evento.":"Guest not found for this event.",
  "Digite seu nome.":"Enter your name.",
  "Informe seu nome.":"Enter your name.",
  "Informe pelo menos uma pessoa que irá à festa.":"Please add at least one person who will attend.",
  "Escolha se poderá comparecer.":"Please choose whether you will attend.",
  "Localize seu nome na lista antes de confirmar.":"Find your name on the guest list before submitting your RSVP.",
  "Não encontramos esse nome na lista. Confira a escrita ou fale com o anfitrião.":"We couldn't find that name on the guest list. Check the spelling or contact the host.",
  "Este evento não utiliza lista pré-cadastrada.":"This event does not use a pre-registered guest list.",
  "Pessoas pré-cadastradas não podem ser removidas pelo convite.":"Pre-registered guests cannot be removed from the invitation.",
  "Este convite permite confirmar apenas as pessoas já cadastradas.":"This invitation only allows RSVP for pre-registered guests.",
  "As confirmações deste evento estão encerradas.":"RSVPs for this event are closed.",
  "As confirmações estão temporariamente pausadas.":"RSVPs are temporarily paused.",
  "O prazo para confirmação de presença foi encerrado.":"The RSVP deadline has passed.",
  "A personalização visual está bloqueada para este evento.":"Visual customization is disabled for this event.",
  "A edição dos textos está bloqueada para este evento.":"Text editing is disabled for this event.",
  "A edição dos dados do evento está bloqueada.":"Event details editing is disabled.",
  "Esta função está bloqueada para o painel da cliente.":"This feature is disabled for the private dashboard.",
  "Use imagem JPG, PNG, WebP ou AVIF.":"Use a JPG, PNG, WebP or AVIF image.",
  "A imagem pode ter no máximo 10 MB.":"Images can be up to 10 MB.",
  "Use vídeo MP4 ou WebM para o fundo.":"Use an MP4 or WebM video for the background.",
  "O vídeo de fundo pode ter no máximo 20 MB.":"Background videos can be up to 20 MB.",
  "O arquivo pode ter no máximo 20 MB.":"Files can be up to 20 MB.",
  "Escolha um arquivo para enviar.":"Choose a file to upload.",
  "Mídia não encontrada.":"Media not found."
 };
 if(exact[m])return exact[m];
 m=m.replace(/^Esta confirmação permite no máximo (\d+) pessoa\(s\) presentes\.$/,"This RSVP allows up to $1 attendees.");
 m=m.replace(/^Esta confirmação permite no máximo (\d+) pessoa\(s\)\.$/,"This RSVP allows up to $1 people.");
 m=m.replace(/^(.+) já está nesta confirmação\.$/,"$1 is already included in this RSVP.");
 m=m.replace(/^(.+) já consta em outra confirmação deste evento\.$/,"$1 is already included in another RSVP for this event.");
 return m;
}
const effectiveLimit=(e,g)=>Number(g?.max_people_allowed||0)||Number(e?.max_people_per_rsvp||0)||null;
const clone=v=>JSON.parse(JSON.stringify(v));
const rgb=(h,f="255,253,251")=>{h=String(h||"").replace("#","");if(!/^[0-9a-f]{6}$/i.test(h))return f;return`${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`};
const rgba=(h,a)=>{const r=rgb(h,"58,31,27");return`rgba(${r},${Number(a||0)})`};
const normalizeHex=v=>{
 let h=String(v||"").trim().replace(/^#/,"");
 if(/^[0-9a-f]{3}$/i.test(h))h=h.split("").map(c=>c+c).join("");
 if(!/^[0-9a-f]{6}$/i.test(h))return null;
 return`#${h.toUpperCase()}`;
};

const bgPositionCss=(v,x="center")=>`${x==="left"?"left":x==="right"?"right":"center"} ${v==="top"?"top":v==="bottom"?"bottom":"center"}`;
const publicCardWidthCss=v=>v==="narrow"?"min(82vw,430px)":v==="wide"?"min(94vw,590px)":"min(88vw,510px)";
const previewInset=v=>v==="narrow"?24:v==="wide"?8:16;

const isRecentResponse=v=>{
 if(!v)return false;
 const t=new Date(v).getTime();
 return Number.isFinite(t)&&Date.now()-t>=0&&Date.now()-t<24*60*60*1000;
};

const dateKeySao=d=>{
 try{
  const parts=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const pick=k=>parts.find(p=>p.type===k)?.value||"";
  return`${pick("year")}-${pick("month")}-${pick("day")}`;
 }catch{return""}
};

const fmtResponseTime=(v,lang="pt-BR")=>{
 if(!v)return"";
 try{
  const d=new Date(v),now=new Date(),yesterday=new Date(Date.now()-86400000);
  const time=new Intl.DateTimeFormat(localeFor(lang),{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit"}).format(d);
  if(dateKeySao(d)===dateKeySao(now))return tr(lang,`Hoje às ${time}`,`Today at ${time}`);
  if(dateKeySao(d)===dateKeySao(yesterday))return tr(lang,`Ontem às ${time}`,`Yesterday at ${time}`);
  const day=new Intl.DateTimeFormat(localeFor(lang),{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit"}).format(d);
  return tr(lang,`${day} às ${time}`,`${day} at ${time}`);
 }catch{return fmtDTLang(v,lang)}
};

function scrollToProblem(el){
 if(!el)return;
 try{el.scrollIntoView({behavior:"smooth",block:"center"})}catch{}
 setTimeout(()=>{if(typeof el.focus==="function")el.focus({preventScroll:true})},260);
}

function bindInvalidScroll(form){
 if(!form)return;
 form.addEventListener("invalid",e=>scrollToProblem(e.target),true);
}

function syncPublicViewport(){
 const apply=()=>{
  const h=window.visualViewport?.height||window.innerHeight;
  document.documentElement.style.setProperty("--public-vh",`${Math.max(320,Math.round(h))}px`);
 };
 apply();
 window.visualViewport?.addEventListener("resize",apply,{passive:true});
 window.addEventListener("orientationchange",()=>setTimeout(apply,120),{passive:true});
}

function uploadWithProgress(url,formData,onProgress){
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  xhr.open("POST",url,true);
  xhr.responseType="json";
  xhr.upload.onprogress=e=>{
   if(e.lengthComputable)onProgress?.(Math.min(100,Math.round(e.loaded/e.total*100)));
  };
  xhr.onerror=()=>reject(new Error("Não foi possível enviar a mídia."));
  xhr.onload=()=>{
   const data=xhr.response||{};
   if(xhr.status>=200&&xhr.status<300)return resolve(data);
   reject(new Error(data?.error||"Não foi possível concluir o upload."));
  };
  xhr.send(formData);
 });
}

const pad2=n=>String(n).padStart(2,"0");
const compactDate=v=>String(v||"").replaceAll("-","");
const compactTime=v=>String(v||"00:00").replace(":","")+"00";

function addCalendarHours(date,time,hours=4){
 if(!date)return{date:"",time:""};
 const [y,m,d]=date.split("-").map(Number);
 const [hh,mm]=String(time||"00:00").split(":").map(Number);
 const dt=new Date(Date.UTC(y,m-1,d,hh,mm,0));
 dt.setUTCHours(dt.getUTCHours()+hours);
 return{
  date:`${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-${pad2(dt.getUTCDate())}`,
  time:`${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`
 };
}

function calendarRange(e,a){
 const date=e.event_date;
 if(!date)return null;

 if(!e.event_time){
  const next=addCalendarHours(date,"00:00",24);
  return{allDay:true,start:compactDate(date),end:compactDate(next.date)};
 }

 let endDate=date,endTime=a.calendar_end_time;
 if(endTime){
  const [sh,sm]=e.event_time.split(":").map(Number);
  const [eh,em]=endTime.split(":").map(Number);
  if(eh*60+em<=sh*60+sm){
   endDate=addCalendarHours(date,"00:00",24).date;
  }
 }else{
  const end=addCalendarHours(date,e.event_time,4);
  endDate=end.date;
  endTime=end.time;
 }

 return{
  allDay:false,
  start:`${compactDate(date)}T${compactTime(e.event_time)}`,
  end:`${compactDate(endDate)}T${compactTime(endTime)}`
 };
}

function calendarDescription(e,a){
 const bits=["Evento adicionado pelo Libri RSVP."];
 if(a.invitation_url)bits.push(`Convite: ${a.invitation_url}`);
 return bits.join("\n");
}

function googleCalendarUrl(e){
 const a=safeAppearance(e),range=calendarRange(e,a);
 if(!range)return"";
 const q=new URLSearchParams({
  action:"TEMPLATE",
  text:e.title||"Evento",
  dates:`${range.start}/${range.end}`,
  details:calendarDescription(e,a),
  location:a.calendar_location||""
 });
 if(!range.allDay)q.set("ctz","America/Sao_Paulo");
 return`https://calendar.google.com/calendar/render?${q.toString()}`;
}

function icsEscape(v=""){
 return String(v)
  .replace(/\\/g,"\\\\")
  .replace(/\r?\n/g,"\\n")
  .replace(/,/g,"\\,")
  .replace(/;/g,"\\;");
}

function downloadCalendarIcs(e){
 const a=safeAppearance(e),range=calendarRange(e,a);
 if(!range)return toast(tr(eventLang(e),"Este evento ainda não tem data configurada.","This event does not have a date yet."),true);

 const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
 const start=range.allDay
  ?`DTSTART;VALUE=DATE:${range.start}`
  :`DTSTART;TZID=America/Sao_Paulo:${range.start}`;
 const end=range.allDay
  ?`DTEND;VALUE=DATE:${range.end}`
  :`DTEND;TZID=America/Sao_Paulo:${range.end}`;

 const body=[
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Libri Convites//Libri RSVP//PT-BR",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "BEGIN:VEVENT",
  `UID:${icsEscape(e.id||e.slug||crypto.randomUUID())}@confirmacao.libriconvites.com.br`,
  `DTSTAMP:${stamp}`,
  start,
  end,
  `SUMMARY:${icsEscape(e.title||"Evento")}`,
  `DESCRIPTION:${icsEscape(calendarDescription(e,a))}`,
  a.calendar_location?`LOCATION:${icsEscape(a.calendar_location)}`:"",
  "END:VEVENT",
  "END:VCALENDAR"
 ].filter(Boolean).join("\r\n");

 const blob=new Blob([body],{type:"text/calendar;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 const link=document.createElement("a");
 link.href=url;
 link.download=`${String(e.slug||e.title||"evento").replace(/[^a-z0-9_-]+/gi,"-")}.ics`;
 document.body.append(link);
 link.click();
 link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function locationTarget(a){
 if(a.location_url)return a.location_url;
 if(a.calendar_location)return`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.calendar_location)}`;
 return"";
}

function openCalendarMenu(e){
 const L=eventLang(e),google=googleCalendarUrl(e);
 if(!google)return toast(tr(L,"Este evento ainda não tem data configurada.","This event does not have a date yet."),true);

 const w=modal(
  tr(L,"Adicionar à agenda","Add to calendar"),
  `<div class="calendar-options">
    <a class="btn block" href="${esc(google)}" target="_blank" rel="noopener">Google Calendar</a>
    <button class="btn secondary block" type="button" id="calendarIcs">Apple / iPhone / ${tr(L,"outros","others")}</button>
   </div>`,
  tr(L,"Escolha onde deseja salvar este evento.","Choose where you'd like to save this event.")
 );
 w.querySelector("#calendarIcs").onclick=()=>downloadCalendarIcs(e);
}

function setAppearanceDirty(value=true){
 appearanceDirty=Boolean(value);
 window.onbeforeunload=appearanceDirty?()=>"":null;
 const el=document.querySelector("#appearanceUnsaved");
 if(el){
  el.className=`unsaved-indicator ${appearanceDirty?"dirty":"saved"}`;
  el.textContent=appearanceDirty?"● Alterações não salvas":"✓ Tudo salvo";
 }
}

function canLeaveAppearance(){
 if(!appearanceDirty)return true;
 if(confirm("Você tem alterações de aparência que ainda não foram salvas. Deseja sair mesmo assim?")){
  setAppearanceDirty(false);
  return true;
 }
 return false;
}

async function api(url,options={}){
 const headers={...(options.headers||{})};
 if(options.body!==undefined&&!(options.body instanceof FormData)&&!headers["Content-Type"])headers["Content-Type"]="application/json";
 const res=await fetch(url,{...options,headers}),ct=res.headers.get("content-type")||"",data=ct.includes("json")?await res.json():await res.text();
 if(!res.ok)throw new Error(translateServerMessage(data?.error||tr(activeInterfaceLanguage,"Não foi possível concluir.","Unable to complete the request."),activeInterfaceLanguage));
 return data;
}
function toast(msg,error=false){clearTimeout(toastTimer);toastEl.textContent=msg;toastEl.className=`toast show${error?" error":""}`;toastTimer=setTimeout(()=>toastEl.className="toast",3500)}
async function copy(text){try{await navigator.clipboard.writeText(text);toast(tr(activeInterfaceLanguage,"Link copiado.","Link copied."))}catch{toast(tr(activeInterfaceLanguage,"Não foi possível copiar o link.","Unable to copy the link."),true)}}
function brand(event){const p=event?.primary_color||"#b8735f",a=event?.accent_color||"#f8efec";document.documentElement.style.setProperty("--brand",p);document.documentElement.style.setProperty("--brand-strong",p);document.documentElement.style.setProperty("--soft",a)}
function topbar(extra="",lang=activeInterfaceLanguage){return`<div class="topbar"><a class="brand" href="/"><div class="mark">L</div><div><h1>Libri RSVP</h1><small>${tr(lang,"Convites virtuais e arte digital","Virtual invitations & digital art")}</small></div></a>${extra}</div>`}
function modal(title,html,subtitle="",large=false){const w=document.createElement("div");document.body.classList.add("modal-open");w.className="modal-backdrop";w.innerHTML=`<div class="modal${large?" large":""}"><button class="close" type="button">×</button><h2>${esc(title)}</h2>${subtitle?`<p class="subtle">${esc(subtitle)}</p>`:""}${html}</div>`;document.body.append(w);const close=()=>{w.remove();if(!document.querySelector(".modal-backdrop"))document.body.classList.remove("modal-open")};w.querySelector(".close").onclick=close;w.onclick=e=>{if(e.target===w)close()};w.closeModal=close;return w}
const loading=(lang=activeInterfaceLanguage)=>`<div class="card panel"><div class="loading-inline"><span class="spinner"></span>${tr(lang,"Carregando...","Loading...")}</div></div>`;

if(path==="/admin"||path==="/admin/")adminApp();
else if(path.startsWith("/cliente/"))clientApp(decodeURIComponent(path.split("/")[2]||""));
else if(path.startsWith("/e/"))publicApp(decodeURIComponent(path.split("/")[2]||""));
else home();

function home(){brand();app.innerHTML=`<main class="shell">${topbar()}<section class="card hero"><div><span class="chip">LIBRI RSVP</span><h2>Confirmações bonitas por fora e organizadas por dentro.</h2><p>Gestão de convidados, famílias, mensagens e presença.</p></div><a class="btn" href="/admin">Área Libri</a></section></main>`}

async function adminApp(){
 brand();
 app.innerHTML=`<main class="shell">${topbar()}<section class="card panel panel-narrow"><span class="eyebrow">Área administrativa</span><h1>Entrar na Libri</h1><form id="login"><div class="field"><label>Senha</label><input name="password" type="password" required></div><button class="btn block">Entrar</button></form></section></main>`;
 try{await api("/api/admin/me");return renderAdminDashboard()}catch{}
 document.querySelector("#login").onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api("/api/admin/login",{method:"POST",body:JSON.stringify({password:new FormData(e.currentTarget).get("password")})});renderAdminDashboard()}catch(err){toast(err.message,true);b.disabled=false}};
}

async function renderAdminDashboard(archived=false){
 brand();
 const d=await api(`/api/admin/events${archived?"?archived=1":""}`);
 app.innerHTML=`<main class="shell">${topbar(`<button class="btn secondary small" id="logout">Sair</button>`)}
 <section class="card hero"><div><span class="chip">PAINEL LIBRI</span><h2>Seus eventos, sem caça ao tesouro.</h2><p>Confirmações, listas, mensagens e aparência em um só lugar.</p></div><button class="btn large" id="newEvent">+ Criar evento</button></section>
 <div class="section-title"><div><h2>${archived?"Eventos arquivados":"Eventos ativos"}</h2><span class="meta">${d.events.length} evento(s)</span></div><button class="btn secondary small" id="toggleArchived">${archived?"← Ativos":"Ver arquivados"}</button></div>
 <div class="events">${d.events.length?d.events.map(e=>eventCard(e,archived)).join(""):`<div class="empty">Nenhum evento aqui.</div>`}</div></main>`;
 document.querySelector("#logout").onclick=async()=>{await api("/api/admin/logout",{method:"POST",body:"{}"});adminApp()};
 document.querySelector("#newEvent").onclick=()=>eventModal();
 document.querySelector("#toggleArchived").onclick=()=>renderAdminDashboard(!archived);
 document.querySelectorAll("[data-event]").forEach(b=>b.onclick=()=>renderAdminEvent(b.dataset.event));
 document.querySelectorAll("[data-unarchive]").forEach(b=>b.onclick=async()=>{try{await api(`/api/admin/events/${b.dataset.unarchive}/unarchive`,{method:"POST",body:"{}"});toast("Evento restaurado.");renderAdminDashboard(true)}catch(e){toast(e.message,true)}});
}
function eventCard(e,archived){
 const total=Number(e.yes_responses||0)+Number(e.no_responses||0)+Number(e.pending_responses||0),answered=Number(e.yes_responses||0)+Number(e.no_responses||0),pct=total?Math.round(answered/total*100):0;
 return`<article class="event-card card-hover"><div class="meta">${fmtDate(e.event_date)}${e.event_time?` • ${esc(e.event_time)}`:""}</div><h3>${esc(e.title)}</h3><div class="chips"><span class="chip">${e.rsvp_mode==="list"?"Lista fechada":"Livre"}</span><span class="chip">${e.archived_at?"Arquivado":e.accepting_rsvp?"Recebendo":"Fechado"}</span></div>
 <div class="stats"><div class="stat good"><strong>${e.people_confirmed||0}</strong><span>pessoas</span></div><div class="stat"><strong>${e.adults_confirmed||0}</strong><span>adultos</span></div><div class="stat"><strong>${e.children_confirmed||0}</strong><span>crianças</span></div><div class="stat pending"><strong>${e.pending_responses||0}</strong><span>aguardando</span></div></div>
 <div class="progress-card" style="padding:14px 0 0"><div class="progress-head"><span class="subtle">Respostas</span><b class="subtle">${pct}%</b></div><div class="progress-track"><div class="progress-bar" style="--progress:${pct}%"></div></div></div>
 <div class="actions" style="margin-top:14px"><button class="btn secondary" data-event="${e.id}">Abrir painel</button>${archived?`<button class="btn secondary" data-unarchive="${e.id}">Restaurar</button>`:""}</div></article>`;
}

function checkbox(name,label,checked){return`<label class="check"><input type="checkbox" name="${name}" ${checked?"checked":""}>${esc(label)}</label>`}
function eventForm(e=null){
 const f=e?.extra_fields||{},p=safePerms(e),a=safeAppearance(e);
 return`<form id="eventForm"><div class="form-section"><div class="field"><label>Nome do evento</label><input name="title" required value="${esc(e?.title||"")}"></div><div class="row"><div class="field"><label>Data</label><input type="date" name="event_date" value="${esc(e?.event_date||"")}"></div><div class="field"><label>Horário</label><input type="time" name="event_time" value="${esc(e?.event_time||"")}"></div></div><div class="field"><label>Mensagem inicial</label><textarea name="welcome_message">${esc(e?.welcome_message||"")}</textarea></div></div>
 <div class="form-section"><div class="row"><div class="field"><label>Tipo</label><select name="rsvp_mode"><option value="free" ${!e||e.rsvp_mode==="free"?"selected":""}>Confirmação livre</option><option value="list" ${e?.rsvp_mode==="list"?"selected":""}>Lista fechada</option></select></div><div class="field"><label>Idioma da interface</label><select name="interface_language"><option value="pt-BR" ${a.interface_language!=="en"?"selected":""}>Português (Brasil)</option><option value="en" ${a.interface_language==="en"?"selected":""}>English</option></select></div></div><div class="field"><label>Lista fechada</label><select name="list_behavior"><option value="strict" ${e?.list_behavior!=="flexible"?"selected":""}>Estrita • só cadastrados</option><option value="flexible" ${e?.list_behavior==="flexible"?"selected":""}>Flexível • permite adicionar até o limite</option></select></div>
 <div class="row"><div class="field"><label>Prazo</label><input type="date" name="rsvp_deadline" value="${esc(e?.rsvp_deadline||"")}"></div><div class="field"><label>Limite padrão</label><input type="number" min="1" max="100" name="max_people_per_rsvp" value="${esc(e?.max_people_per_rsvp??"")}" placeholder="Sem limite"></div></div></div>
 <div class="form-section"><h3>Campos opcionais</h3><div class="checks">${checkbox("phone","Telefone",f.phone)}${checkbox("dietary","Restrição alimentar",f.dietary)}${checkbox("notes","Observações",f.notes)}${checkbox("love_message","Mensagem carinhosa 💌",e?f.love_message!==false:true)}</div></div>
 <div class="form-section"><h3>Permissões do painel privado</h3><div class="checks">${checkbox("pmg","Cadastrar e editar convidados",p.manage_guests)}${checkbox("pma","Editar aparência e enviar mídia",p.manage_appearance)}${checkbox("pmt","Editar textos",p.manage_texts)}${checkbox("pvm","Ver mensagens",p.view_messages)}${checkbox("peg","Exportar CSV",p.export_guests)}${checkbox("ped","Editar data, horário e mensagem",p.manage_event_details)}</div></div>
 <button class="btn block large">${e?"Salvar alterações":"Criar evento"}</button></form>`;
}
function eventPayload(form,e=null){
 const d=new FormData(form),currentAppearance=safeAppearance(e),oldLang=e?eventLang(e):"pt-BR",newLang=d.get("interface_language")==="en"?"en":"pt-BR",oldDefaults=defaultTextsFor(oldLang),currentTexts=e?.public_texts||{},looksDefault=e?Object.keys(oldDefaults).every(k=>currentTexts[k]===undefined||currentTexts[k]===oldDefaults[k]):true,publicTexts=e?(oldLang!==newLang&&looksDefault?defaultTextsFor(newLang):currentTexts):defaultTextsFor(newLang);
 return{title:d.get("title"),event_date:d.get("event_date"),event_time:d.get("event_time"),welcome_message:d.get("welcome_message"),rsvp_mode:d.get("rsvp_mode"),list_behavior:d.get("list_behavior"),rsvp_deadline:d.get("rsvp_deadline"),max_people_per_rsvp:d.get("max_people_per_rsvp"),primary_color:e?.primary_color||"#b8735f",accent_color:e?.accent_color||"#f8efec",background_type:e?.background_type||"none",background_image_url:e?.background_image_url||"",background_video_url:e?.background_video_url||"",appearance_settings:{...currentAppearance,interface_language:newLang},public_texts:publicTexts,extra_fields:{phone:d.has("phone"),dietary:d.has("dietary"),notes:d.has("notes"),love_message:d.has("love_message")},client_permissions:{manage_guests:d.has("pmg"),manage_appearance:d.has("pma"),manage_texts:d.has("pmt"),view_messages:d.has("pvm"),export_guests:d.has("peg"),manage_event_details:d.has("ped")}}
}
function eventModal(e=null){
 const w=modal(e?"Editar evento":"Novo evento",eventForm(e),e?"O link público não muda quando o nome é alterado.":"A aparência pode ser refinada depois.",true);
 w.querySelector("#eventForm").onsubmit=async ev=>{ev.preventDefault();const b=ev.submitter;b.disabled=true;try{const r=await api(e?`/api/admin/events/${e.id}`:"/api/admin/events",{method:e?"PATCH":"POST",body:JSON.stringify(eventPayload(ev.currentTarget,e))});w.closeModal();toast(e?"Evento atualizado.":"Evento criado. ✨");renderAdminEvent(r.event.id,e?"settings":"overview")}catch(err){toast(err.message,true);b.disabled=false}};
}

function eventHeader(e,client=false){
 const L=client?eventLang(e):"pt-BR";
 return`<section class="event-head" style="background:linear-gradient(135deg,${esc(e.primary_color||"#b8735f")},${esc(e.accent_color||"#f8efec")})"><div class="eyebrow" style="color:#fff">${client?tr(L,"PAINEL PRIVADO","PRIVATE DASHBOARD"):"PAINEL LIBRI"}</div><h1>${esc(e.title)}</h1><p>${fmtDateLang(e.event_date,L)}${e.event_time?` • ${esc(e.event_time)}`:""} • ${e.rsvp_mode==="list"?tr(L,"Lista fechada","Guest list"):tr(L,"Confirmação livre","Open RSVP")}</p></section>`
}

async function renderAdminEvent(id,tab="overview"){
 const info=await api(`/api/admin/events/${id}`),e=info.event,s=info.summary;brand(e);
 const tabs=[["overview","Visão geral"],["guests","Convidados"],["messages","Mensagens"],["appearance","Aparência"],["settings","Configurações"]];
 app.innerHTML=`<main class="shell">${topbar(`<div class="actions"><button class="btn secondary small" id="back">← Eventos</button><button class="btn secondary small" id="openPublic">Ver RSVP</button></div>`)}${eventHeader(e)}
 <div class="tabs-shell"><div class="tabs">${tabs.map(([k,l])=>`<button class="tab${tab===k?" active":""}" data-tab="${k}">${l}</button>`).join("")}</div></div><div id="tabRoot">${loading()}</div></main>`;
 document.querySelector("#back").onclick=()=>{if(canLeaveAppearance())renderAdminDashboard()};
 document.querySelector("#openPublic").onclick=()=>window.open(info.public_url,"_blank","noopener");
 document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{if(b.dataset.tab===tab||canLeaveAppearance())renderAdminEvent(id,b.dataset.tab)});
 const root=document.querySelector("#tabRoot");
 if(tab==="guests")return guestsTab({root,event:e,role:"admin",eventId:id});
 if(tab==="messages")return messagesTab({root,event:e,role:"admin",eventId:id});
 if(tab==="appearance")return appearanceTab({root,event:e,role:"admin",eventId:id,allowAppearance:true,allowTexts:true});
 if(tab==="settings")return adminSettings(root,info);
 overview(root,e,s,info,"admin");
}
function overview(root,e,s,info,role){
 const L=role==="client"?eventLang(e):"pt-BR",total=Number(s.yes_responses||0)+Number(s.no_responses||0)+Number(s.pending_responses||0),pct=total?Math.round((Number(s.yes_responses||0)+Number(s.no_responses||0))/total*100):0;
 root.innerHTML=`<div class="overview-stats"><div class="overview-stat primary"><span>${tr(L,"Pessoas confirmadas","Confirmed people")}</span><strong>${s.people_confirmed||0}</strong></div><div class="overview-stat"><span>${tr(L,"Adultos","Adults")}</span><strong>${s.adults_confirmed||0}</strong></div><div class="overview-stat"><span>${tr(L,"Crianças","Children")}</span><strong>${s.children_confirmed||0}</strong></div><div class="overview-stat"><span>${tr(L,"Aguardando","Pending")}</span><strong>${s.pending_responses||0}</strong></div></div>
 <section class="card panel progress-card" style="margin-top:14px"><div class="progress-head"><div><strong>${tr(L,`${pct}% da lista já respondeu`,`${pct}% of the guest list has responded`)}</strong><div class="subtle">${tr(L,`${s.people_registered||0} pessoa(s) cadastrada(s)`,`${s.people_registered||0} registered guest(s)`)}</div></div></div><div class="progress-track"><div class="progress-bar" style="--progress:${pct}%"></div></div></section>
 ${e.rsvp_mode==="list"?`<section class="guide-card" style="margin-top:14px"><div class="guide-icon">✦</div><div><h3>${tr(L,"Como funciona a lista?","How does the guest list work?")}</h3><p>${tr(L,"Cadastre as pessoas autorizadas. No convite, basta começar a digitar o nome e escolher a sugestão correta.","Add each authorized guest. On the invitation, they can start typing their name and select the correct suggestion.")} ${e.list_behavior==="flexible"?tr(L,"Nesta lista, também é possível acrescentar pessoas até o limite permitido.","This list also allows adding guests up to the permitted limit."):tr(L,"Nesta lista, somente os nomes cadastrados podem responder.","Only pre-registered names can RSVP on this list.")}</p></div></section>`:""}
 ${role==="admin"?`<div class="grid two" style="margin-top:14px"><section class="card panel"><h3>Link público</h3><div class="codebox">${esc(info.public_url)}</div><div class="actions" style="margin-top:9px"><button class="btn secondary small" id="cpub">Copiar</button></div></section><section class="card panel"><h3>Painel privado</h3><div class="codebox">${esc(info.client_url||"Indisponível")}</div><div class="actions" style="margin-top:9px"><button class="btn secondary small" id="ccli">Copiar</button></div></section></div>`:""}`;
 if(role==="admin"){root.querySelector("#cpub").onclick=()=>copy(info.public_url);root.querySelector("#ccli").onclick=()=>copy(info.client_url)}
}
async function guestsTab({root,event,role,eventId,token}){
 const L=role==="client"?eventLang(event):"pt-BR",p=safePerms(event),canManage=role==="admin"||p.manage_guests,canExport=role==="admin"||p.export_guests,base=role==="admin"?`/api/admin/events/${eventId}`:`/api/client/${encodeURIComponent(token)}`;
 root.innerHTML=`${event.rsvp_mode==="list"?`<section class="guide-card"><div class="guide-icon">✦</div><div><h3>${tr(L,"Lista fechada","Guest list")}</h3><p>${tr(L,"Cadastre cada adulto e criança pelo nome. Qualquer integrante poderá ser encontrado no convite.","Add every adult and child by name. Any family member can be found on the invitation.")}</p></div></section>`:""}
 <div class="section-title"><div><h2>${tr(L,"Convidados","Guests")}</h2><span class="meta">${tr(L,"Busca por família, responsável ou qualquer integrante.","Search by family, primary contact or any guest.")}</span></div><div class="actions">${canExport?`<button class="btn secondary small" id="export">${tr(L,"Exportar CSV","Export CSV")}</button><button class="btn secondary small" id="exportPdf">${tr(L,"Exportar PDF","Export PDF")}</button>`:""}${canManage?`<button class="btn secondary small" id="bulk">${tr(L,"+ Adicionar vários","+ Add multiple")}</button><button class="btn" id="add">${tr(L,"+ Cadastrar convidado/família","+ Add guest/family")}</button>`:""}</div></div>
 <div class="toolbar"><div class="search-shell"><input id="search" placeholder="${tr(L,"Digite para buscar...","Type to search...")}" autocomplete="off"><button type="button" class="search-clear" id="clearSearch" aria-label="${tr(L,"Limpar busca","Clear search")}" title="${tr(L,"Limpar busca","Clear search")}" hidden>×</button></div><div class="segmented"><button class="active" data-filter=""><span>${tr(L,"Todos","All")}</span><b data-count="total">0</b></button><button data-filter="yes"><span>${tr(L,"Confirmados","Confirmed")}</span><b data-count="yes">0</b></button><button data-filter="pending"><span>${tr(L,"Aguardando","Pending")}</span><b data-count="pending">0</b></button><button data-filter="no"><span>${tr(L,"Não irão","Not attending")}</span><b data-count="no">0</b></button></div></div><div id="guestList">${loading(L)}</div>`;
 let q="",status="",timer;
 const search=root.querySelector("#search"),clear=root.querySelector("#clearSearch");
 const updateCounts=counts=>{for(const [k,v] of Object.entries(counts||{})){const el=root.querySelector(`[data-count="${k}"]`);if(el)el.textContent=Number(v||0)}};
 const refresh=async()=>{try{const d=await api(`${base}/guests?q=${encodeURIComponent(q)}&status=${status}`);updateCounts(d.counts);root.querySelector("#guestList").innerHTML=guestCards(d.guests,canManage,L);if(canManage)bindGuestActions(root,{event,role,eventId,token,L})}catch(e){root.querySelector("#guestList").innerHTML=`<div class="empty">${esc(e.message)}</div>`}};
 search.oninput=e=>{q=e.target.value;clear.hidden=!q;clearTimeout(timer);timer=setTimeout(refresh,220)};
 clear.onclick=()=>{q="";search.value="";clear.hidden=true;search.focus();refresh()};
 root.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{root.querySelectorAll("[data-filter]").forEach(x=>x.classList.remove("active"));b.classList.add("active");status=b.dataset.filter;refresh()});
 if(canExport){
  root.querySelector("#export").onclick=()=>location.href=role==="admin"?`/api/admin/events/${eventId}/export.csv`:`/api/client/${encodeURIComponent(token)}/export.csv`;
  root.querySelector("#exportPdf").onclick=()=>exportEventPdf({event,base});
 }
 if(canManage){root.querySelector("#add").onclick=()=>guestModal({event,role,eventId,token,onSaved:refresh});root.querySelector("#bulk").onclick=()=>bulkModal({event,role,eventId,token,onSaved:refresh})}
 await refresh();
}
function guestCards(guests,editable,L="pt-BR"){
 if(!guests.length)return`<div class="empty">${tr(L,"Nenhum convidado encontrado.","No guests found.")}</div>`;
 return`<div class="guest-list">${guests.map(g=>`<article class="guest-card${isRecentResponse(g.responded_at)?" recent-response":""}"><div class="guest-card-head"><div><div class="chips"><span class="status ${g.response_status}">${statusLabel(g.response_status,L)}</span>${isRecentResponse(g.responded_at)?`<span class="chip new-response">${tr(L,"NOVA","NEW")}</span>`:""}${g.max_people_allowed?`<span class="chip">${tr(L,"limite","limit")} ${g.max_people_allowed}</span>`:""}</div><h3 class="guest-card-name">${esc(g.group_label||g.primary_name)}</h3>${g.group_label?`<div class="guest-card-group">${tr(L,"Contato","Primary contact")}: ${esc(g.primary_name)}</div>`:""}</div><span class="subtle">${esc(sourceLabel(g.source,L))}</span></div>
 <div class="guest-card-members">${g.members.length?g.members.map(m=>`<div class="guest-member"><span class="guest-member-icon">${m.person_type==="child"?"🧒":"👤"}</span><span class="guest-member-name">${esc(m.name)}</span><span class="badge ${m.attendance_status==="yes"?"good":m.attendance_status==="no"?"bad":"pending"}">${attendanceLabel(m.attendance_status,L)}</span></div>`).join(""):`<div class="subtle">${tr(L,"Nenhuma pessoa cadastrada.","No people registered.")}</div>`}</div>
 ${g.love_message?`<div class="notice" style="margin-top:10px">💌 ${esc(g.love_message)}</div>`:""}
 <div class="guest-card-footer"><div class="guest-card-contact">${g.phone?`☎ ${esc(g.phone)}`:tr(L,"Sem telefone","No phone")}${g.responded_at?`<span class="response-time"> • ${esc(fmtResponseTime(g.responded_at,L))}</span>`:""}</div>${editable?`<div class="guest-card-actions"><button class="btn secondary small" data-edit='${esc(JSON.stringify(g))}'>${tr(L,"Editar","Edit")}</button><button class="btn danger small" data-delete="${g.id}" data-name="${esc(g.group_label||g.primary_name)}">${tr(L,"Excluir","Delete")}</button></div>`:""}</div></article>`).join("")}</div>`;
}
function bindGuestActions(root,ctx){
 const L=ctx.L||"pt-BR";
 root.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>guestModal({...ctx,guest:JSON.parse(b.dataset.edit),onSaved:()=>ctx.role==="admin"?renderAdminEvent(ctx.eventId,"guests"):clientApp(ctx.token,"guests")}));
 root.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(!confirm(tr(L,`Excluir ${b.dataset.name}?`,`Delete ${b.dataset.name}?`)))return;const base=ctx.role==="admin"?`/api/admin/events/${ctx.eventId}`:`/api/client/${encodeURIComponent(ctx.token)}`;try{await api(`${base}/guests/${b.dataset.delete}`,{method:"DELETE",body:"{}"});toast(tr(L,"Convidado excluído.","Guest deleted."));ctx.role==="admin"?renderAdminEvent(ctx.eventId,"guests"):clientApp(ctx.token,"guests")}catch(e){toast(e.message,true)}})
}
function guestModal({event,role,eventId,token,guest=null,onSaved}){
 const L=role==="client"?eventLang(event):"pt-BR";
 const w=modal(guest?tr(L,"Editar confirmação","Edit RSVP"):tr(L,"Cadastrar convidado/família","Add guest/family"),`<form id="gf"><div class="field"><label>${tr(L,"Nome da família / grupo","Family / group name")}</label><input name="group_label" placeholder="${tr(L,"Ex.: Família Brito","e.g. Brito Family")}" value="${esc(guest?.group_label||"")}"></div><div class="field"><label>${tr(L,"Contato principal","Primary contact")}</label><input name="primary_name" id="primary" required value="${esc(guest?.primary_name||"")}"></div><div class="row"><div class="field"><label>${tr(L,"Telefone","Phone")}</label><input name="phone" value="${esc(guest?.phone||"")}"></div><div class="field"><label>${tr(L,"Limite desta família","Family limit")}</label><input name="max_people_allowed" type="number" min="1" max="100" placeholder="${event.max_people_per_rsvp?tr(L,`Padrão: ${event.max_people_per_rsvp}`,`Default: ${event.max_people_per_rsvp}`):tr(L,"Sem limite","No limit")}" value="${esc(guest?.max_people_allowed??"")}"></div></div><div class="form-section"><h3>${tr(L,"Pessoas deste convite","People on this invitation")}</h3><div id="members"></div><div class="actions"><button type="button" class="btn secondary small" id="aa">+ ${tr(L,"Adulto","Adult")}</button><button type="button" class="btn secondary small" id="ac">+ ${tr(L,"Criança","Child")}</button></div></div><details><summary>${tr(L,"Informações opcionais","Optional information")}</summary><div style="margin-top:10px"><div class="field"><label>${tr(L,"Restrição alimentar","Dietary restrictions")}</label><input name="dietary" value="${esc(guest?.dietary||"")}"></div><div class="field"><label>${tr(L,"Observações","Notes")}</label><textarea name="notes">${esc(guest?.notes||"")}</textarea></div><div class="field"><label>${tr(L,"Mensagem carinhosa 💌","Sweet message 💌")}</label><textarea name="love_message">${esc(guest?.love_message||"")}</textarea></div></div></details><button class="btn block large" style="margin-top:16px">${guest?tr(L,"Salvar alterações","Save changes"):tr(L,"Cadastrar família","Add family")}</button></form>`,event.rsvp_mode==="list"?tr(L,"Esses nomes poderão ser encontrados na busca do convite.","These names will be searchable on the invitation."):tr(L,"Cadastre cada pessoa individualmente.","Add each person individually."),true);
 const form=w.querySelector("#gf"),root=w.querySelector("#members"),primary=w.querySelector("#primary");let touched=false;
 const add=(type,m={})=>{const row=document.createElement("div");row.className="members-editor";row.innerHTML=`<input type="hidden" class="mid" value="${esc(m.id||"")}"><div class="row"><div class="field"><label>${type==="child"?`🧒 ${tr(L,"Criança","Child")}`:`👤 ${tr(L,"Adulto","Adult")}`}</label><input class="mname" data-type="${type}" value="${esc(m.name||"")}" placeholder="${tr(L,"Nome","Name")}"></div><div class="field"><label>${tr(L,"Situação","Status")}</label><select class="mstatus"><option value="pending" ${!m.attendance_status||m.attendance_status==="pending"?"selected":""}>${tr(L,"Aguardando","Pending")}</option><option value="yes" ${m.attendance_status==="yes"?"selected":""}>${tr(L,"Vai","Attending")}</option><option value="no" ${m.attendance_status==="no"?"selected":""}>${tr(L,"Não vai","Not attending")}</option></select></div></div><button type="button" class="btn danger small rm">${tr(L,"Remover","Remove")}</button>`;row.querySelector(".mname").oninput=()=>{if(root.firstElementChild===row)touched=true};row.querySelector(".rm").onclick=()=>row.remove();root.append(row)};
 (guest?.members||[]).forEach(m=>add(m.person_type,m));if(!guest?.members?.length)add("adult");
 primary.oninput=()=>{const i=root.firstElementChild?.querySelector(".mname");if(i&&(!touched||!i.value.trim()))i.value=primary.value};
 w.querySelector("#aa").onclick=()=>add("adult");w.querySelector("#ac").onclick=()=>add("child");
 form.onsubmit=async ev=>{ev.preventDefault();const d=new FormData(form),members=[...root.children].map(r=>({id:r.querySelector(".mid").value||undefined,name:r.querySelector(".mname").value.trim(),person_type:r.querySelector(".mname").dataset.type,attendance_status:r.querySelector(".mstatus").value,is_preapproved:true})).filter(x=>x.name),body={group_label:d.get("group_label"),primary_name:d.get("primary_name"),phone:d.get("phone"),max_people_allowed:d.get("max_people_allowed"),dietary:d.get("dietary"),notes:d.get("notes"),love_message:d.get("love_message"),members},base=role==="admin"?`/api/admin/events/${eventId}`:`/api/client/${encodeURIComponent(token)}`;try{await api(guest?`${base}/guests/${guest.id}`:`${base}/guests`,{method:guest?"PATCH":"POST",body:JSON.stringify(body)});w.closeModal();toast(guest?tr(L,"Alterações salvas.","Changes saved."):tr(L,"Convidado cadastrado.","Guest added."));onSaved?.()}catch(e){toast(e.message,true)}};
}
function bulkModal({event,role,eventId,token,onSaved}){
 const L=role==="client"?eventLang(event):"pt-BR";
 const w=modal(tr(L,"Adicionar vários convidados","Add multiple guests"),`<form id="bf"><div class="notice"><strong>${tr(L,"Um nome por linha.","One name per line.")}</strong>${tr(L,"Cada nome entra como 1 adulto aguardando confirmação. Depois você pode editar e montar as famílias.","Each name is added as one adult with a pending RSVP. You can edit and group families afterward.")}</div><div class="field" style="margin-top:12px"><label>${tr(L,"Lista","List")}</label><textarea name="names" rows="12" required></textarea></div><button class="btn block large">${tr(L,"Cadastrar lista","Add list")}</button></form>`);
 w.querySelector("#bf").onsubmit=async ev=>{ev.preventDefault();const names=String(new FormData(ev.currentTarget).get("names")||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean),rows=names.map(name=>({primary_name:name,response_status:"pending",members:[{name,person_type:"adult",attendance_status:"pending",is_preapproved:true}]})),base=role==="admin"?`/api/admin/events/${eventId}`:`/api/client/${encodeURIComponent(token)}`;try{const r=await api(`${base}/guests/bulk`,{method:"POST",body:JSON.stringify({rows})});w.closeModal();toast(tr(L,`${r.created.length} cadastrado(s)${r.failed.length?`, ${r.failed.length} falharam`:""}.`,`${r.created.length} added${r.failed.length?`, ${r.failed.length} failed`:""}.`),!!r.failed.length);onSaved?.()}catch(e){toast(e.message,true)}};
}
async function exportEventPdf({event,base}){
 const L=eventLang(event),win=window.open("","_blank");
 if(!win){
  toast(tr(L,"O navegador bloqueou a janela do PDF. Libere pop-ups para este site.","Your browser blocked the PDF window. Allow pop-ups for this site."),true);
  return;
 }

 win.document.open();
 win.document.write(`<!doctype html><html lang="${L==="en"?"en":"pt-BR"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${tr(L,"Preparando PDF...","Preparing PDF...")}</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#4f2d2a;background:#fffaf7}p{color:#866e68}</style></head><body><h2>${tr(L,"Preparando o PDF...","Preparing the PDF...")}</h2><p>${tr(L,"Carregando convidados e mensagens.","Loading guests and messages.")}</p></body></html>`);
 win.document.close();

 try{
  const pdfAppearance=safeAppearance(event);
  const guestsData=await api(`${base}/guests?q=&status=`);
  let messages=[];

  try{
   const messagesData=await api(`${base}/messages?q=`);
   messages=messagesData.messages||[];
  }catch{
   messages=[];
  }

  const guests=guestsData.guests||[];
  const members=guests.flatMap(g=>(g.members||[]).map(m=>({...m,group_name:g.group_label||g.primary_name})));
  const peopleConfirmed=members.filter(m=>m.attendance_status==="yes").length;
  const adultsConfirmed=members.filter(m=>m.attendance_status==="yes"&&m.person_type==="adult").length;
  const childrenConfirmed=members.filter(m=>m.attendance_status==="yes"&&m.person_type==="child").length;
  const peoplePending=members.filter(m=>m.attendance_status==="pending").length;
  const peopleNo=members.filter(m=>m.attendance_status==="no").length;
  const statusText=s=>attendanceLabel(s,L);
  const statusSymbol=s=>s==="yes"?"✓":s==="no"?"×":"•";
  const statusClass=s=>s==="yes"?"yes":s==="no"?"no":"pending";

  const guestSections=guests.length
   ? guests.map(g=>`
      <section class="family">
       <div class="family-head">
        <div>
         <h3>${esc(g.group_label||g.primary_name)}</h3>
         ${g.group_label?`<div class="contact">${tr(L,"Responsável","Primary contact")}: ${esc(g.primary_name)}</div>`:""}
        </div>
        <span class="group-status ${statusClass(g.response_status)}">${esc(statusLabel(g.response_status,L))}</span>
       </div>
       <div class="people">
        ${(g.members||[]).length
         ? g.members.map(m=>`
           <div class="person">
            <div>
             <span class="symbol ${statusClass(m.attendance_status)}">${statusSymbol(m.attendance_status)}</span>
             <strong>${esc(m.name)}</strong>
             <small>${m.person_type==="child"?tr(L,"Criança","Child"):tr(L,"Adulto","Adult")}</small>
            </div>
            <span class="person-status ${statusClass(m.attendance_status)}">${statusText(m.attendance_status)}</span>
           </div>`).join("")
         : `<div class="muted">${tr(L,"Nenhuma pessoa cadastrada.","No people registered.")}</div>`}
       </div>
       ${g.phone?`<div class="meta-line"><strong>${tr(L,"Telefone","Phone")}:</strong> ${esc(g.phone)}</div>`:""}
       ${g.dietary?`<div class="meta-line"><strong>${tr(L,"Restrição alimentar","Dietary restrictions")}:</strong> ${esc(g.dietary)}</div>`:""}
       ${g.notes?`<div class="meta-line"><strong>${tr(L,"Observações","Notes")}:</strong> ${esc(g.notes)}</div>`:""}
      </section>`).join("")
   : `<div class="empty">${tr(L,"Nenhum convidado cadastrado.","No guests registered.")}</div>`;

  const messageSections=messages.length
   ? messages.map(m=>`
      <article class="message">
       <div class="quote">“${esc(m.message)}”</div>
       <div class="message-author"><strong>${esc(m.name)}</strong>${m.responded_at?`<span> • ${esc(fmtDTLang(m.responded_at,L))}</span>`:""}</div>
      </article>`).join("")
   : `<div class="empty">${tr(L,"Nenhuma mensagem carinhosa registrada.","No messages have been submitted.")}</div>`;

  const html=`<!doctype html>
<html lang="${L==="en"?"en":"pt-BR"}">
<head>
 <meta charset="utf-8">
 <meta name="viewport" content="width=device-width,initial-scale=1">
 <title>${esc(event.title)} • ${tr(L,"Lista de presença","Guest list")}</title>
 <style>
  @page{size:A4;margin:14mm}
  *{box-sizing:border-box}
  body{margin:0;color:#4b302c;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.45}
  .page{max-width:900px;margin:0 auto}
  .header{padding:22px 24px;border:1px solid ${pdfAppearance.button_color}33;border-radius:20px;background:linear-gradient(135deg,${pdfAppearance.card_color},#ffffff)}
  .event-logo{display:block;max-width:110px;max-height:80px;object-fit:contain;margin:0 0 12px}
  .brand{font-family:Georgia,serif;font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:${pdfAppearance.button_color}}
  h1{margin:8px 0 4px;font-family:Georgia,serif;font-size:30px;font-weight:500;color:${pdfAppearance.text_color}}
  .event-date{color:#806a64;font-size:12px}
  .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:14px 0 22px}
  .stat{padding:12px 10px;border:1px solid #eadbd5;border-radius:13px;background:#fffaf7;text-align:center}
  .stat b{display:block;font-size:20px;color:${pdfAppearance.button_color}}
  .stat span{display:block;margin-top:3px;color:#8b746e;font-size:9px}
  h2{margin:26px 0 12px;padding-bottom:7px;border-bottom:1px solid ${pdfAppearance.button_color}44;font-family:Georgia,serif;font-size:20px;font-weight:500;color:${pdfAppearance.text_color}}
  .family{break-inside:avoid;margin:0 0 10px;padding:13px 14px;border:1px solid #eadbd5;border-radius:14px}
  .family-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px}
  .family h3{margin:0;font-size:14px;color:#533530}
  .contact,.muted{color:#8b746e;font-size:9px}
  .group-status,.person-status{padding:4px 7px;border-radius:999px;font-size:8px;font-weight:700}
  .yes{color:#47705a}.no{color:#9d4e4e}.pending{color:#9a6c2d}
  .group-status.yes,.person-status.yes{background:#edf5ef}
  .group-status.no,.person-status.no{background:#f9eeee}
  .group-status.pending,.person-status.pending{background:#fbf3e5}
  .people{border-top:1px solid #f0e4df}
  .person{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid #f4ebe7}
  .person:last-child{border-bottom:0}
  .person strong{font-size:10px}
  .person small{margin-left:5px;color:#9a8580;font-size:8px}
  .symbol{display:inline-block;width:17px;font-weight:800}
  .meta-line{margin-top:5px;color:#715a54;font-size:9px}
  .message{break-inside:avoid;margin:0 0 10px;padding:15px 16px;border:1px solid #eadbd5;border-radius:14px;background:#fffaf7}
  .quote{font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#604039}
  .message-author{margin-top:8px;color:#8b746e;font-size:9px}
  .footer{margin-top:26px;padding-top:10px;border-top:1px solid #eadbd5;color:#9a8580;font-size:8px;text-align:center}
  .empty{padding:16px;border:1px dashed #dcc7c0;border-radius:12px;color:#8b746e;text-align:center}
  .print-btn{position:fixed;right:18px;bottom:18px;padding:11px 16px;border:0;border-radius:12px;background:${pdfAppearance.button_color};color:${pdfAppearance.button_text_color};font-weight:700;box-shadow:0 8px 24px rgba(60,30,35,.2);cursor:pointer}
  @media print{.print-btn{display:none}.page{max-width:none}.family,.message{box-shadow:none}}
  @media(max-width:650px){.stats{grid-template-columns:repeat(2,1fr)}.stats .stat:first-child{grid-column:1/-1}}
 </style>
</head>
<body>
 <div class="page">
  <header class="header">
   ${pdfAppearance.logo_url?`<img class="event-logo" src="${esc(pdfAppearance.logo_url)}" alt="">`:""}
   <div class="brand">Libri RSVP</div>
   <h1>${esc(event.title)}</h1>
   <div class="event-date">${esc(fmtDateLang(event.event_date,L))}${event.event_time?` • ${esc(event.event_time)}`:""}</div>
  </header>
  <div class="stats">
   <div class="stat"><b>${peopleConfirmed}</b><span>${tr(L,"pessoas confirmadas","confirmed people")}</span></div>
   <div class="stat"><b>${adultsConfirmed}</b><span>${tr(L,"adultos","adults")}</span></div>
   <div class="stat"><b>${childrenConfirmed}</b><span>${tr(L,"crianças","children")}</span></div>
   <div class="stat"><b>${peoplePending}</b><span>${tr(L,"aguardando","pending")}</span></div>
   <div class="stat"><b>${peopleNo}</b><span>${tr(L,"não irão","not attending")}</span></div>
  </div>
  <h2>${tr(L,"Lista de presença","Guest list")}</h2>
  ${guestSections}
  <h2>${tr(L,"Mensagens dos convidados 💌","Guest messages 💌")}</h2>
  ${messageSections}
  <div class="footer">${tr(L,"Relatório gerado pelo Libri RSVP","Report generated by Libri RSVP")} • ${esc(fmtDTLang(new Date().toISOString(),L))}</div>
 </div>
 <button class="print-btn" onclick="window.print()">${tr(L,"Salvar / imprimir PDF","Save / print PDF")}</button>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(()=>{try{win.focus();win.print()}catch{}},500);
 }catch(e){
  win.document.open();
  win.document.write(`<p style="font-family:Arial;padding:24px">${tr(L,"Não foi possível preparar o PDF","Unable to prepare the PDF")}: ${esc(e.message)}</p>`);
  win.document.close();
  toast(e.message,true);
 }
}
async function messagesTab({root,event,role,eventId,token}){
 const L=role==="client"?eventLang(event):"pt-BR";
 if(role==="client"&&!safePerms(event).view_messages){root.innerHTML=`<div class="empty">${tr(L,"Mensagens não liberadas para este evento.","Messages are not available for this event.")}</div>`;return}
 const base=role==="admin"?`/api/admin/events/${eventId}`:`/api/client/${encodeURIComponent(token)}`;
 root.innerHTML=`<div class="section-title"><div><h2>${tr(L,"Mensagens 💌","Messages 💌")}</h2><span class="meta">${tr(L,"Recadinhos dos convidados em um lugar só.","Guest messages, all in one place.")}</span></div></div><div class="toolbar"><div class="search-shell"><input id="ms" placeholder="${tr(L,"Buscar...","Search...")}"></div></div><div id="ml">${loading(L)}</div>`;let timer;
 const refresh=async(q="")=>{const d=await api(`${base}/messages?q=${encodeURIComponent(q)}`);root.querySelector("#ml").innerHTML=d.messages.length?`<div class="message-grid">${d.messages.map(m=>`<article class="message-card"><blockquote>“${esc(m.message)}”</blockquote><footer><strong>${esc(m.name)}</strong> • ${esc(fmtDTLang(m.responded_at,L))}</footer></article>`).join("")}</div>`:`<div class="empty">${tr(L,"Ainda não há mensagens carinhosas.","There are no guest messages yet.")}</div>`};
 root.querySelector("#ms").oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>refresh(e.target.value),220)};await refresh();
}
async function appearanceTab({root,event,role,eventId,token,allowAppearance,allowTexts}){
 const L=role==="client"?eventLang(event):"pt-BR";
 if(!allowAppearance&&!allowTexts){root.innerHTML=`<div class="empty">${tr(L,"Personalização bloqueada para este evento.","Customization is disabled for this event.")}</div>`;return}
 const a=safeAppearance(event),t=safeTexts(event),base=role==="admin"?`/api/admin/events/${eventId}`:`/api/client/${encodeURIComponent(token)}`;let media=[];
 if(allowAppearance){try{media=(await api(`${base}/media`)).media||[]}catch{}}
 root.innerHTML=`<div class="appearance-layout"><div class="appearance-controls">${allowAppearance?appearanceControls(event,a,media,L):""}${allowTexts?textControls(t,L):""}<div class="appearance-save-row"><span id="appearanceUnsaved" class="unsaved-indicator saved">${tr(L,"✓ Tudo salvo","✓ All changes saved")}</span><button class="btn large" id="saveAppearance">${tr(L,"Salvar personalização","Save customization")}</button></div></div><aside class="appearance-preview" id="appearancePreview"><div class="preview-floating-head"><div><h3>${tr(L,"Como o convidado verá","Guest preview")}</h3><span class="subtle">${tr(L,"Acompanha você durante a edição.","Stays visible while you edit.")}</span></div><div class="preview-actions"><a class="preview-real-link" href="/e/${encodeURIComponent(event.slug)}" target="_blank" rel="noopener" title="${tr(L,"Abrir confirmação real","Open live RSVP")}">↗ <span>${tr(L,"Abrir confirmação real","Open live RSVP")}</span></a><button class="icon-btn" type="button" id="previewToggle" title="${tr(L,"Recolher prévia","Collapse preview")}">−</button><button class="icon-btn" type="button" id="previewExpand" title="${tr(L,"Ampliar prévia","Expand preview")}">⛶</button></div></div><div class="preview-wrap"><div id="preview"></div></div></aside></div>`;
 const state={event:clone(event),appearance:{...a},texts:{...t}},refresh=()=>root.querySelector("#preview").innerHTML=previewHtml(state);refresh();
 if(allowAppearance){
  root.querySelectorAll('input[type="color"],input[type="range"],select[name="background_type"],select[name="background_position"],select[name="background_x"],select[name="card_width"],select[name="card_style"]').forEach(i=>i.oninput=()=>{
   if(i.name==="background_type")state.event.background_type=i.value;else state.appearance[i.name]=i.type==="range"?Number(i.value):i.value;
   if(i.type==="color"){const hexField=root.querySelector(`[data-color-text="${i.name}"]`),hexLabel=root.querySelector(`[data-color-label="${i.name}"]`);if(hexField)hexField.value=i.value.toUpperCase();if(hexLabel)hexLabel.textContent=i.value.toUpperCase()}
   const o=root.querySelector(`[data-output="${i.name}"]`);if(o)o.textContent=["overlay_opacity","card_opacity"].includes(i.name)?`${Math.round(Number(i.value)*100)}%`:`${i.value}px`;refresh();setAppearanceDirty(true);
  });
  root.querySelectorAll("[data-color-text]").forEach(i=>{
   const sync=()=>{const hex=normalizeHex(i.value),colorName=i.dataset.colorText,picker=root.querySelector(`input[type="color"][name="${colorName}"]`),label=root.querySelector(`[data-color-label="${colorName}"]`);if(!hex||!picker)return false;i.value=hex;picker.value=hex;state.appearance[colorName]=hex;if(label)label.textContent=hex;refresh();return true};
   i.oninput=()=>{const hex=normalizeHex(i.value);if(!hex)return;const colorName=i.dataset.colorText,picker=root.querySelector(`input[type="color"][name="${colorName}"]`),label=root.querySelector(`[data-color-label="${colorName}"]`);if(picker)picker.value=hex;state.appearance[colorName]=hex;if(label)label.textContent=hex;refresh();setAppearanceDirty(true)};
   i.onblur=()=>{if(!sync()){const picker=root.querySelector(`input[type="color"][name="${i.dataset.colorText}"]`);if(picker)i.value=picker.value.toUpperCase()}};
  });
  root.querySelectorAll("[data-font]").forEach(b=>b.onclick=()=>{root.querySelectorAll("[data-font]").forEach(x=>x.classList.remove("active"));b.classList.add("active");root.querySelector('[name="font_style"]').value=b.dataset.font;state.appearance.font_style=b.dataset.font;refresh();setAppearanceDirty(true)});
  root.querySelectorAll("[data-upload]").forEach(i=>i.onchange=async()=>{const file=i.files?.[0];if(!file)return;if(appearanceDirty){i.value="";return toast(tr(L,"Salve as alterações atuais antes de enviar uma nova mídia.","Save your current changes before uploading new media."),true)}const fd=new FormData();fd.append("file",file);fd.append("kind",i.dataset.upload);const zone=i.closest(".upload-zone"),progress=zone?.querySelector("[data-upload-progress]"),bar=zone?.querySelector("[data-upload-bar]"),pct=zone?.querySelector("[data-upload-percent]");i.disabled=true;zone?.classList.add("uploading");if(progress)progress.hidden=false;if(pct)pct.textContent="0%";if(bar)bar.style.width="0%";try{const r=await uploadWithProgress(`${base}/media`,fd,n=>{if(bar)bar.style.width=`${n}%`;if(pct)pct.textContent=n>=100?tr(L,"Processando...","Processing..."):`${n}%`});if(bar)bar.style.width="100%";if(pct)pct.textContent=tr(L,"Concluído ✓","Done ✓");toast(tr(L,"Mídia enviada.","Media uploaded."));setAppearanceDirty(false);setTimeout(()=>appearanceTab({root,event:r.event,role,eventId,token,allowAppearance,allowTexts}),250)}catch(e){toast(e.message,true);i.disabled=false;zone?.classList.remove("uploading");if(progress)progress.hidden=true;i.value=""}});
  root.querySelectorAll("[data-delmedia]").forEach(b=>b.onclick=async()=>{if(appearanceDirty)return toast(tr(L,"Salve as alterações atuais antes de remover uma mídia.","Save your current changes before removing media."),true);if(!confirm(tr(L,"Remover esta mídia?","Remove this media?")))return;try{const r=await api(`${base}/media/${b.dataset.delmedia}`,{method:"DELETE",body:"{}"});toast(tr(L,"Mídia removida.","Media removed."));setAppearanceDirty(false);appearanceTab({root,event:r.event,role,eventId,token,allowAppearance,allowTexts})}catch(e){toast(e.message,true)}})
 }
 if(allowTexts)root.querySelectorAll('[name^="text_"]').forEach(i=>i.oninput=()=>{state.texts[i.name.replace("text_","")]=i.value;refresh();setAppearanceDirty(true)});
 if(allowAppearance)root.querySelectorAll('[name="invitation_url"],[name="calendar_location"],[name="location_url"],[name="calendar_end_time"]').forEach(i=>i.oninput=()=>setAppearanceDirty(true));
 root.querySelector("#saveAppearance").onclick=async()=>{const payload={};if(allowAppearance)payload.appearance_settings=collectAppearance(root,a),payload.background_type=root.querySelector('[name="background_type"]').value;if(allowTexts)payload.public_texts=collectTexts(root,t,L);try{await api(role==="admin"?`/api/admin/events/${eventId}`:`/api/client/${encodeURIComponent(token)}/event`,{method:"PATCH",body:JSON.stringify(payload)});toast(tr(L,"Personalização salva. ✨","Customization saved. ✨"));setAppearanceDirty(false);role==="admin"?renderAdminEvent(eventId,"appearance"):clientApp(token,"appearance")}catch(e){toast(e.message,true)}};
 const previewAside=root.querySelector("#appearancePreview"),togglePreview=root.querySelector("#previewToggle"),expandPreview=root.querySelector("#previewExpand");
 togglePreview.onclick=()=>{previewAside.classList.toggle("preview-collapsed");togglePreview.textContent=previewAside.classList.contains("preview-collapsed")?"+":"−"};
 expandPreview.onclick=()=>{previewAside.classList.remove("preview-collapsed");previewAside.classList.toggle("preview-expanded");expandPreview.textContent=previewAside.classList.contains("preview-expanded")?"↘":"⛶"};
 setAppearanceDirty(false);
}
function appearanceControls(e,a,media,L="pt-BR"){
 const upload=(kind,title,help,accept)=>`<label class="upload-zone"><input type="file" accept="${accept}" data-upload="${kind}"><span><span class="upload-icon">↑</span><strong>${title}</strong><small>${help}</small><span class="upload-progress" data-upload-progress hidden><span class="upload-progress-track"><span class="upload-progress-bar" data-upload-bar></span></span><small data-upload-percent>0%</small></span></span></label>`;
 const color=(n,l,v)=>`<div class="color-field"><input type="color" name="${n}" value="${esc(v)}"><span style="min-width:0;flex:1"><strong style="display:block;font-size:11px">${l}</strong><input type="text" inputmode="text" autocomplete="off" spellcheck="false" data-color-text="${n}" value="${esc(String(v||"").toUpperCase())}" aria-label="${tr(L,"Código HEX de","HEX code for")} ${esc(l)}" style="min-height:30px;margin-top:4px;padding:5px 8px;border-radius:9px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;text-transform:uppercase"><small class="subtle" data-color-label="${n}" style="display:none">${esc(String(v||"").toUpperCase())}</small></span></div>`;
 const range=(n,l,min,max,step,v,pct=false)=>`<div class="field" style="margin-top:12px"><label>${l}</label><div class="range-row"><input type="range" name="${n}" min="${min}" max="${max}" step="${step}" value="${v}"><output data-output="${n}">${pct?Math.round(Number(v)*100)+"%":v+"px"}</output></div></div>`;
 const font=(v,l,c)=>`<button type="button" class="font-option${c===v?" active":""}" data-font="${v}"><strong>${l}</strong><span class="sample ${v==="modern"?"font-modern":v==="classic"?"font-classic":v==="playful"?"font-soft":"font-elegant"}">Helena</span></button>`;
 return`<section class="card panel" style="margin-bottom:14px"><h3>${tr(L,"Fundo","Background")}</h3><div class="field"><label>${tr(L,"Tipo","Type")}</label><select name="background_type"><option value="none" ${e.background_type==="none"?"selected":""}>${tr(L,"Sem mídia","No media")}</option><option value="image" ${e.background_type==="image"?"selected":""}>${tr(L,"Imagem","Image")}</option><option value="video" ${e.background_type==="video"?"selected":""}>${tr(L,"Vídeo em loop","Looping video")}</option></select></div><div class="row"><div class="field"><label>${tr(L,"Posição vertical","Vertical position")}</label><select name="background_position"><option value="top" ${a.background_position==="top"?"selected":""}>${tr(L,"Topo","Top")}</option><option value="center" ${a.background_position==="center"?"selected":""}>${tr(L,"Centro","Center")}</option><option value="bottom" ${a.background_position==="bottom"?"selected":""}>${tr(L,"Inferior","Bottom")}</option></select></div><div class="field"><label>${tr(L,"Posição horizontal","Horizontal position")}</label><select name="background_x"><option value="left" ${a.background_x==="left"?"selected":""}>${tr(L,"Esquerda","Left")}</option><option value="center" ${a.background_x==="center"?"selected":""}>${tr(L,"Centro","Center")}</option><option value="right" ${a.background_x==="right"?"selected":""}>${tr(L,"Direita","Right")}</option></select></div></div><div class="grid two">${upload("background_image",tr(L,"Imagem de fundo","Background image"),tr(L,"JPG, PNG, WebP ou AVIF • até 10 MB","JPG, PNG, WebP or AVIF • up to 10 MB"),"image/jpeg,image/png,image/webp,image/avif")}${upload("background_video",tr(L,"Vídeo de fundo","Background video"),tr(L,"MP4 ou WebM • até 20 MB","MP4 or WebM • up to 20 MB"),"video/mp4,video/webm")}</div>${media.length?`<div class="section-title"><h3>${tr(L,"Mídias enviadas","Uploaded media")}</h3></div><div class="grid two">${media.map(m=>mediaHtml(m,L)).join("")}</div>`:""}</section>
 <section class="card panel" style="margin-bottom:14px"><h3>${tr(L,"Identidade do evento","Event identity")}</h3><div class="grid two">${upload("cover",tr(L,"Capa / detalhe superior","Cover / top detail"),tr(L,"Imagem opcional • até 10 MB","Optional image • up to 10 MB"),"image/jpeg,image/png,image/webp,image/avif")}${upload("logo",tr(L,"Monograma / logo","Monogram / logo"),tr(L,"Imagem opcional • até 10 MB","Optional image • up to 10 MB"),"image/jpeg,image/png,image/webp,image/avif")}</div></section>
 <section class="card panel" style="margin-bottom:14px"><h3>${tr(L,"Links e agenda","Links & calendar")}</h3><p class="subtle" style="margin-bottom:12px">${tr(L,"Esses dados aparecem depois da resposta do convidado. Se um campo ficar vazio, o botão correspondente não aparece.","These details are used after the guest responds. Empty fields simply remain hidden.")}</p><div class="field"><label>${tr(L,"URL do convite","Invitation URL")}</label><input type="url" name="invitation_url" value="${esc(a.invitation_url||"")}" placeholder="https://libriconvites.com.br/..."><small>${tr(L,"Usado no botão “Voltar ao convite”.","Used by the “Back to invitation” button.")}</small></div><div class="field"><label>${tr(L,"Local / endereço do evento","Event venue / address")}</label><input name="calendar_location" value="${esc(a.calendar_location||"")}" placeholder="${tr(L,"Ex.: Espaço Encanto, Rua...","e.g. Venue name, street...")}"><small>${tr(L,"Entra no calendário e no resumo após a confirmação.","Included in the calendar event and confirmation summary.")}</small></div><div class="row"><div class="field"><label>${tr(L,"Link da localização (opcional)","Location link (optional)")}</label><input type="url" name="location_url" value="${esc(a.location_url||"")}" placeholder="https://maps.google.com/..."><small>${tr(L,"Se ficar vazio, usamos uma busca pelo endereço acima.","If empty, the address above is used.")}</small></div><div class="field"><label>${tr(L,"Horário de término (opcional)","End time (optional)")}</label><input type="time" name="calendar_end_time" value="${esc(a.calendar_end_time||"")}"><small>${tr(L,"Se ficar vazio, a agenda considera 4 horas de evento.","If empty, the calendar uses a 4-hour duration.")}</small></div></div></section>
 <section class="card panel" style="margin-bottom:14px"><h3>${tr(L,"Cores e card","Colors & card")}</h3><div class="field"><label>${tr(L,"Largura do card no convite","RSVP card width")}</label><select name="card_width"><option value="narrow" ${a.card_width==="narrow"?"selected":""}>${tr(L,"Estreito • mostra mais o fundo","Narrow • shows more background")}</option><option value="medium" ${a.card_width==="medium"?"selected":""}>${tr(L,"Médio","Medium")}</option><option value="wide" ${a.card_width==="wide"?"selected":""}>${tr(L,"Largo • mais espaço para texto","Wide • more room for text")}</option></select></div><div class="color-grid">${color("background_color",tr(L,"Fundo","Background"),a.background_color)}${color("card_color","Card",a.card_color)}${color("text_color",tr(L,"Texto","Text"),a.text_color)}${color("muted_color",tr(L,"Texto secundário","Secondary text"),a.muted_color)}${color("button_color",tr(L,"Botão","Button"),a.button_color)}${color("button_text_color",tr(L,"Texto do botão","Button text"),a.button_text_color)}${color("overlay_color","Overlay",a.overlay_color)}</div>${range("overlay_opacity",tr(L,"Transparência do overlay","Overlay opacity"),0,.9,.01,a.overlay_opacity,true)}${range("card_opacity",tr(L,"Transparência do card","Card opacity"),.45,1,.01,a.card_opacity,true)}${range("card_blur",tr(L,"Desfoque do card","Card blur"),0,30,1,a.card_blur)}${range("card_radius",tr(L,"Arredondamento","Corner radius"),8,44,1,a.card_radius)}</section>
 <section class="card panel" style="margin-bottom:14px"><h3>${tr(L,"Tipografia","Typography")}</h3><div class="font-preview">${font("elegant",tr(L,"Elegante","Elegant"),a.font_style)}${font("delicate",tr(L,"Delicada","Delicate"),a.font_style)}${font("classic",tr(L,"Clássica","Classic"),a.font_style)}${font("modern",tr(L,"Moderna","Modern"),a.font_style)}${font("playful",tr(L,"Infantil suave","Soft playful"),a.font_style)}</div><input type="hidden" name="font_style" value="${a.font_style}"><div class="field" style="margin-top:12px"><label>${tr(L,"Estilo do card","Card style")}</label><select name="card_style"><option value="glass" ${a.card_style==="glass"?"selected":""}>${tr(L,"Translúcido","Translucent")}</option><option value="solid" ${a.card_style==="solid"?"selected":""}>${tr(L,"Sólido","Solid")}</option><option value="soft" ${a.card_style==="soft"?"selected":""}>${tr(L,"Suave","Soft")}</option></select></div></section>`;
}
function mediaHtml(m,L="pt-BR"){return`<div class="media-preview">${m.mime_type?.startsWith("video/")?`<video src="${esc(m.public_url)}" autoplay muted loop playsinline></video>`:`<img src="${esc(m.public_url)}" alt="">`}<span class="media-pill">${({background_image:tr(L,"Fundo","Background"),background_video:tr(L,"Vídeo","Video"),cover:tr(L,"Capa","Cover"),logo:"Logo"}[m.media_kind]||tr(L,"Mídia","Media"))}</span><div class="media-preview-actions"><button type="button" class="btn danger small" data-delmedia="${m.id}">${tr(L,"Remover","Remove")}</button></div></div>`}
function textControls(t,L="pt-BR"){
 const input=(k,l)=>`<div class="field"><label>${l}</label><input name="text_${k}" value="${esc(t[k])}"></div>`;
 return`<section class="card panel" style="margin-bottom:14px"><h3>${tr(L,"Textos do RSVP","RSVP text")}</h3>${input("eyebrow",tr(L,"Título pequeno","Eyebrow"))}<div class="field"><label>${tr(L,"Introdução","Introduction")}</label><textarea name="text_intro">${esc(t.intro)}</textarea></div>${input("name_label",tr(L,"Rótulo do nome","Name label"))}<div class="row">${input("yes_button",tr(L,"Botão positivo","Yes button"))}${input("no_button",tr(L,"Botão negativo","No button"))}</div><div class="row">${input("lookup_label",tr(L,"Rótulo da busca","Search label"))}${input("lookup_placeholder",tr(L,"Texto dentro da busca","Search placeholder"))}</div>${input("message_label",tr(L,"Rótulo da mensagem","Message label"))}${input("message_placeholder",tr(L,"Placeholder da mensagem","Message placeholder"))}${input("decline_hint",tr(L,"Recado mostrado após clicar em “Não”","Message shown after selecting “No”"))}<div class="row">${input("success_title",tr(L,"Título após confirmar","Confirmation title"))}${input("success_message",tr(L,"Mensagem após confirmar","Confirmation message"))}</div><div class="row">${input("decline_title",tr(L,"Título após recusar","Decline title"))}${input("decline_message",tr(L,"Mensagem após recusar","Decline message"))}</div>${input("calendar_button",tr(L,"Botão de agenda","Calendar button"))}${input("back_button",tr(L,"Botão para voltar ao convite","Back-to-invitation button"))}${input("closed_title",tr(L,"Título quando encerrar","Closed RSVP title"))}</section>`;
}
function collectAppearance(root,f){const g=n=>root.querySelector(`[name="${n}"]`)?.value;return{...f,background_color:g("background_color"),card_color:g("card_color"),text_color:g("text_color"),muted_color:g("muted_color"),button_color:g("button_color"),button_text_color:g("button_text_color"),overlay_color:g("overlay_color"),overlay_opacity:Number(g("overlay_opacity")),card_opacity:Number(g("card_opacity")),card_blur:Number(g("card_blur")),card_radius:Number(g("card_radius")),font_style:g("font_style"),card_style:g("card_style"),background_position:g("background_position"),background_x:g("background_x"),card_width:g("card_width"),invitation_url:g("invitation_url")||"",calendar_location:g("calendar_location")||"",location_url:g("location_url")||"",calendar_end_time:g("calendar_end_time")||""}}
function collectTexts(root,f,L=activeInterfaceLanguage){const r={...f},defaults=defaultTextsFor(L);Object.keys(defaults).forEach(k=>{const i=root.querySelector(`[name="text_${k}"]`);if(i)r[k]=i.value.trim()||defaults[k]});return r}
function previewHtml(s){
 const e=s.event,a=s.appearance,t=s.texts,op=a.card_style==="solid"?1:a.card_style==="soft"?Math.max(Number(a.card_opacity),.96):Number(a.card_opacity),pos=bgPositionCss(a.background_position,a.background_x),inset=previewInset(a.card_width),media=e.background_type==="video"&&e.background_video_url?`<video src="${esc(e.background_video_url)}" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;object-position:${pos}"></video>`:e.background_type==="image"&&e.background_image_url?`<img src="${esc(e.background_image_url)}" style="width:100%;height:100%;object-fit:cover;object-position:${pos}">`:"";
 return`<div class="preview-phone"><div class="preview-screen" style="background:${a.background_color}">${media}<div class="preview-overlay" style="background:${rgba(a.overlay_color,a.overlay_opacity)}"></div><div class="preview-card" style="left:${inset}px;right:${inset}px;background:rgba(${rgb(a.card_color)},${op});border-radius:${a.card_radius}px;backdrop-filter:blur(${a.card_blur}px)"><span class="eyebrow" style="color:${a.button_color}">${esc(t.eyebrow)}</span><h3 style="color:${a.text_color}">${esc(e.title)}</h3><p style="color:${a.muted_color}">${esc(t.intro)}</p><button class="btn block" type="button" style="background:${a.button_color};color:${a.button_text_color};pointer-events:none">${esc(t.yes_button)}</button></div></div></div>`;
}

function adminSettings(root,info){
 const e=info.event;
 root.innerHTML=`<div class="grid two"><section class="card panel"><h3>Dados e regras</h3><div class="settings-list">${setting("Tipo",e.rsvp_mode==="list"?"Lista fechada":"Livre")}${setting("Comportamento",e.rsvp_mode==="list"?(e.list_behavior==="flexible"?"Flexível":"Estrita"):"Não se aplica")}${setting("Prazo",e.rsvp_deadline?fmtDate(e.rsvp_deadline):"Sem prazo")}${setting("Limite padrão",e.max_people_per_rsvp?`${e.max_people_per_rsvp} pessoa(s)`:"Sem limite")}</div><button class="btn" id="editSettings" style="margin-top:12px">Editar evento</button></section>
 <section class="card panel"><h3>Links</h3><div class="field"><label>Público</label><div class="codebox">${esc(info.public_url)}</div></div><div class="field"><label>Cliente</label><div class="codebox">${esc(info.client_url||"Indisponível")}</div></div><div class="actions"><button class="btn secondary small" id="cp">Copiar público</button><button class="btn secondary small" id="cc">Copiar cliente</button><button class="btn danger small" id="reset">Trocar link cliente</button></div></section></div>
 <section class="card panel" style="margin-top:14px"><h3>Ferramentas Libri</h3><div class="actions"><button class="btn secondary" id="dup">Duplicar evento</button><button class="btn secondary" id="history">Histórico</button><button class="btn secondary" id="trash">Lixeira</button>${!e.archived_at?`<button class="btn secondary" id="status">${e.status==="active"?"Pausar confirmações":"Reativar confirmações"}</button><button class="btn danger" id="archive">Arquivar</button>`:`<button class="btn" id="unarchive">Restaurar evento</button>`}</div></section>`;
 root.querySelector("#editSettings").onclick=()=>eventModal(e);root.querySelector("#cp").onclick=()=>copy(info.public_url);root.querySelector("#cc").onclick=()=>copy(info.client_url);
 root.querySelector("#reset").onclick=async()=>{if(!confirm("O link privado atual deixará de funcionar. Continuar?"))return;try{const r=await api(`/api/admin/events/${e.id}/client-link/reset`,{method:"POST",body:"{}"});toast("Novo link criado.");copy(r.client_url);renderAdminEvent(e.id,"settings")}catch(x){toast(x.message,true)}};
 root.querySelector("#dup").onclick=async()=>{if(!confirm("Duplicar configurações e aparência sem convidados?"))return;try{const r=await api(`/api/admin/events/${e.id}/duplicate`,{method:"POST",body:"{}"});toast("Evento duplicado.");renderAdminEvent(r.event.id)}catch(x){toast(x.message,true)}};
 root.querySelector("#history").onclick=()=>historyModal(e.id);root.querySelector("#trash").onclick=()=>trashModal(e.id);
 const st=root.querySelector("#status");if(st)st.onclick=async()=>{try{await api(`/api/admin/events/${e.id}/status`,{method:"POST",body:JSON.stringify({status:e.status==="active"?"inactive":"active"})});renderAdminEvent(e.id,"settings")}catch(x){toast(x.message,true)}};
 const ar=root.querySelector("#archive");if(ar)ar.onclick=async()=>{if(!confirm("Arquivar evento?"))return;await api(`/api/admin/events/${e.id}/archive`,{method:"POST",body:"{}"});renderAdminDashboard()};
 const un=root.querySelector("#unarchive");if(un)un.onclick=async()=>{await api(`/api/admin/events/${e.id}/unarchive`,{method:"POST",body:"{}"});renderAdminEvent(e.id,"settings")};
}
const setting=(l,v)=>`<div class="setting-card"><div><h4>${esc(l)}</h4><p>${esc(v)}</p></div></div>`;

async function historyModal(id){try{const d=await api(`/api/admin/events/${id}/audit?limit=200`),w=modal("Histórico",d.logs.length?`<div class="history-list">${d.logs.map(x=>`<div class="history-item"><strong>${esc(({event_created:"Evento criado",event_updated:"Evento editado",guest_created:"Convidado cadastrado",guest_updated:"Convidado editado",guest_deleted:"Convidado excluído",guest_restored:"Convidado restaurado",rsvp_submitted:"Confirmação enviada",media_uploaded:"Mídia enviada",media_deleted:"Mídia removida",event_duplicated:"Evento duplicado"}[x.action]||x.action))}</strong><div class="subtle">${esc(fmtDT(x.created_at))}</div></div>`).join("")}</div>`:`<div class="empty">Sem registros.</div>`)}catch(e){toast(e.message,true)}}
async function trashModal(id){try{const d=await api(`/api/admin/events/${id}/trash`),w=modal("Lixeira",d.guests.length?`<div class="guest-list">${d.guests.map(g=>`<article class="guest-card"><div class="guest-card-head"><div><h3>${esc(g.group_label||g.primary_name)}</h3><div class="subtle">${esc(fmtDT(g.deleted_at))}</div></div><button class="btn secondary small" data-rest="${g.id}">Restaurar</button></div></article>`).join("")}</div>`:`<div class="empty">Lixeira vazia.</div>`);w.querySelectorAll("[data-rest]").forEach(b=>b.onclick=async()=>{await api(`/api/admin/events/${id}/guests/${b.dataset.rest}/restore`,{method:"POST",body:"{}"});w.closeModal();toast("Restaurado.");renderAdminEvent(id,"guests")})}catch(e){toast(e.message,true)}}

async function clientApp(token,requested="overview"){
 try{
  const info=await api(`/api/client/${encodeURIComponent(token)}/event`),e=info.event,L=eventLang(e),p=safePerms(e);setActiveLanguage(L);
  const tabs=[["overview",tr(L,"Visão geral","Overview"),true],["guests",tr(L,"Convidados","Guests"),true],["messages",tr(L,"Mensagens","Messages"),p.view_messages],["appearance",tr(L,"Aparência","Appearance"),p.manage_appearance||p.manage_texts],["settings",tr(L,"Configurações","Settings"),p.manage_event_details]].filter(x=>x[2]),tab=tabs.some(x=>x[0]===requested)?requested:"overview";brand(e);
  app.innerHTML=`<main class="shell">${topbar("",L)}${eventHeader(e,true)}<div class="tabs-shell"><div class="tabs">${tabs.map(([k,l])=>`<button class="tab${tab===k?" active":""}" data-ctab="${k}">${l}</button>`).join("")}</div></div><div id="clientRoot">${loading(L)}</div></main>`;
  document.querySelectorAll("[data-ctab]").forEach(b=>b.onclick=()=>{if(b.dataset.ctab===tab||canLeaveAppearance())clientApp(token,b.dataset.ctab)});const root=document.querySelector("#clientRoot");
  if(tab==="guests")return guestsTab({root,event:e,role:"client",eventId:e.id,token});
  if(tab==="messages")return messagesTab({root,event:e,role:"client",eventId:e.id,token});
  if(tab==="appearance")return appearanceTab({root,event:e,role:"client",eventId:e.id,token,allowAppearance:p.manage_appearance,allowTexts:p.manage_texts});
  if(tab==="settings")return clientSettings(root,e,token);
  overview(root,e,info.summary,{},"client");
 }catch(err){app.innerHTML=`<main class="shell">${topbar("",activeInterfaceLanguage)}<section class="card panel"><h1>${tr(activeInterfaceLanguage,"Acesso indisponível","Access unavailable")}</h1><p>${esc(err.message)}</p></section></main>`}
}
function clientSettings(root,e,token){
 const L=eventLang(e);
 root.innerHTML=`<section class="card panel panel-narrow"><h3>${tr(L,"Dados do evento","Event details")}</h3><form id="cdf"><div class="row"><div class="field"><label>${tr(L,"Data","Date")}</label><input type="date" name="event_date" value="${esc(e.event_date||"")}"></div><div class="field"><label>${tr(L,"Horário","Time")}</label><input type="time" name="event_time" value="${esc(e.event_time||"")}"></div></div><div class="field"><label>${tr(L,"Mensagem inicial","Welcome message")}</label><textarea name="welcome_message">${esc(e.welcome_message||"")}</textarea></div><button class="btn">${tr(L,"Salvar","Save")}</button></form></section>`;
 root.querySelector("#cdf").onsubmit=async ev=>{ev.preventDefault();const d=new FormData(ev.currentTarget);try{await api(`/api/client/${encodeURIComponent(token)}/event`,{method:"PATCH",body:JSON.stringify({event_date:d.get("event_date"),event_time:d.get("event_time"),welcome_message:d.get("welcome_message")})});toast(tr(L,"Atualizado.","Updated."));clientApp(token,"settings")}catch(x){toast(x.message,true)}}
}
async function publicApp(slug){
 try{
  const d=await api(`/api/public/events/${encodeURIComponent(slug)}`),e=d.event,a=safeAppearance(e),t=safeTexts(e),L=eventLang(e);setActiveLanguage(L);
  syncPublicViewport();
  document.documentElement.style.setProperty("--brand",a.button_color);document.documentElement.style.setProperty("--brand-strong",a.button_color);document.documentElement.style.setProperty("--event-primary",a.button_color);document.documentElement.style.setProperty("--event-text",a.text_color);document.documentElement.style.setProperty("--event-card",rgb(a.card_color));document.documentElement.style.setProperty("--event-card-opacity",String(a.card_opacity));document.documentElement.style.setProperty("--event-overlay",rgba(a.overlay_color,a.overlay_opacity));document.documentElement.style.setProperty("--event-blur",`${a.card_blur}px`);document.documentElement.style.setProperty("--event-radius",`${a.card_radius}px`);document.documentElement.style.setProperty("--event-button-text",a.button_text_color);
  const cardOpacity=a.card_style==="solid"?1:a.card_style==="soft"?Math.max(Number(a.card_opacity),.96):Number(a.card_opacity),pos=bgPositionCss(a.background_position,a.background_x),media=e.background_type==="video"&&e.background_video_url?`<div class="public-media"><video class="public-bg-video" src="${esc(e.background_video_url)}" autoplay muted loop playsinline preload="metadata" style="object-position:${pos}"></video></div>`:e.background_type==="image"&&e.background_image_url?`<div class="public-media"><img class="public-bg-image" src="${esc(e.background_image_url)}" alt="" style="object-position:${pos}"></div>`:"";
  app.innerHTML=`<main class="public-page${e.background_type!=="none"?" has-media":""}" style="background:${a.background_color}">${media}${e.background_type!=="none"?`<div class="public-overlay" style="background:${rgba(a.overlay_color,a.overlay_opacity)}"></div><div class="public-vignette"></div>`:""}
  <section class="public-card" style="width:${publicCardWidthCss(a.card_width)};background:rgba(${rgb(a.card_color)},${cardOpacity});color:${a.text_color};border-radius:${a.card_radius}px;backdrop-filter:blur(${a.card_style==="solid"?0:a.card_blur}px)">
  ${a.logo_url?`<img class="public-event-logo" src="${esc(a.logo_url)}" alt="">`:""}${a.cover_url?`<img src="${esc(a.cover_url)}" alt="" style="width:100%;max-height:190px;object-fit:cover;border-radius:18px;margin-bottom:16px">`:""}
  <div class="eyebrow">${esc(t.eyebrow)}</div><h1>${esc(e.title)}</h1><div class="date" style="color:${a.muted_color}">${fmtDateLang(e.event_date,L)}${e.event_time?` • ${esc(e.event_time)}`:""}</div><p style="color:${a.muted_color}">${esc(e.welcome_message||t.intro)}</p>${e.rsvp_deadline?`<span class="chip" style="margin-bottom:14px">${tr(L,"Confirme até","RSVP by")} ${fmtDateLang(e.rsvp_deadline,L)}</span>`:""}<div id="publicFlow"></div></section></main>`;
  if(!e.accepting_rsvp)return closedPublic(e);
  e.rsvp_mode==="list"?publicLookup(e):freeRsvp(e);
 }catch(err){app.innerHTML=`<main class="public-page"><section class="public-card"><h1>${tr(activeInterfaceLanguage,"Convite indisponível","Invitation unavailable")}</h1><p>${esc(err.message)}</p></section></main>`}
}
function closedPublic(e){const L=eventLang(e),t=safeTexts(e);document.querySelector("#publicFlow").innerHTML=`<div class="success"><div class="bubble">♡</div><h2>${esc(t.closed_title)}</h2><p>${esc(translateServerMessage(e.closed_reason||tr(L,"O período de confirmação foi encerrado.","The RSVP period has ended."),L))}</p></div>`}
function publicLookup(e){
 const root=document.querySelector("#publicFlow"),t=safeTexts(e),L=eventLang(e);
 root.innerHTML=`<div class="notice" style="margin:16px 0">${tr(L,"Digite pelo menos 2 letras. As sugestões aparecem abreviadas para proteger a lista.","Type at least 2 letters. Suggestions are abbreviated to protect the guest list.")}</div><div class="field public-search"><label>${esc(t.lookup_label)}</label><input id="lookup" autocomplete="off" placeholder="${esc(t.lookup_placeholder)}"><div id="suggestions" class="public-search-results" style="display:none"></div></div>`;
 const input=root.querySelector("#lookup"),box=root.querySelector("#suggestions");
 input.oninput=()=>{const q=input.value.trim();clearTimeout(suggestTimer);if(q.length<2){box.style.display="none";return}suggestTimer=setTimeout(async()=>{try{const d=await api(`/api/public/events/${encodeURIComponent(e.slug)}/suggestions?q=${encodeURIComponent(q)}`);box.innerHTML=d.suggestions.length?d.suggestions.map(s=>`<button type="button" class="public-search-result" data-guest="${s.guest_id}"><span class="public-search-avatar">${s.person_type==="child"?"🧒":"👤"}</span><span><strong>${esc(s.display_name)}</strong><small>${tr(L,"Toque para abrir sua confirmação","Tap to open your RSVP")}</small></span></button>`).join(""):`<div class="search-result"><span class="subtle">${tr(L,"Nenhuma sugestão encontrada.","No matches found.")}</span></div>`;box.style.display="block";box.querySelectorAll("[data-guest]").forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await api(`/api/public/events/${encodeURIComponent(e.slug)}/lookup`,{method:"POST",body:JSON.stringify({guest_id:b.dataset.guest})});listRsvp(e,r.guest)}catch(x){toast(x.message,true);b.disabled=false}})}catch(x){toast(x.message,true)}},220)};
}
function listRsvp(e,g){
 const root=document.querySelector("#publicFlow"),f=e.extra_fields||{},t=safeTexts(e),L=eventLang(e),flex=g.list_behavior==="flexible",limit=Number(g.effective_limit||0)||null;
 root.innerHTML=`<div class="public-family"><div class="public-family-title">${esc(g.group_label||g.primary_name)}</div><p class="subtle">${tr(L,"Marque individualmente quem poderá comparecer.","Select each person who will attend.")}${flex&&limit?` ${tr(L,`Até ${limit} pessoa(s) presentes.`,`Up to ${limit} attendee(s).`)}`:""}</p><div id="existing">${g.members.map(m=>`<div class="public-person" data-member="${m.id}" data-status="${m.attendance_status}"><div><span class="public-person-name">${esc(m.name)}</span><small>${m.person_type==="child"?tr(L,"Criança","Child"):tr(L,"Adulto","Adult")}</small></div><div class="member-attendance"><button type="button" class="yes ${m.attendance_status==="yes"?"active":""}" data-choice="yes">✓ ${tr(L,"Vai","Attending")}</button><button type="button" class="no ${m.attendance_status==="no"?"active":""}" data-choice="no">${tr(L,"Não vai","Not attending")}</button></div></div>`).join("")}</div></div>
 ${flex?`<div class="members-editor"><h3>${tr(L,"Adicionar alguém","Add someone")}</h3><div id="newMembers"></div><div class="actions"><button type="button" class="btn secondary small" id="na">+ ${tr(L,"Adulto","Adult")}</button><button type="button" class="btn secondary small" id="nc">+ ${tr(L,"Criança","Child")}</button></div></div>`:""}
 <form id="lrf"><div style="position:absolute;left:-9999px"><input name="website" autocomplete="off"></div>${f.phone?`<div class="field"><label>${tr(L,"Telefone","Phone")}</label><input name="phone" inputmode="tel"></div>`:""}${f.dietary?`<div class="field"><label>${tr(L,"Restrição alimentar","Dietary restrictions")}</label><input name="dietary"></div>`:""}${f.notes?`<div class="field"><label>${tr(L,"Observações","Notes")}</label><textarea name="notes"></textarea></div>`:""}${f.love_message!==false?`<div class="field"><label>${esc(t.message_label)}</label><textarea name="love_message" placeholder="${esc(t.message_placeholder)}"></textarea></div>`:""}<button class="btn block large">${tr(L,"Enviar confirmação","Submit RSVP")}</button><button type="button" class="btn ghost block" id="backLookup">← ${tr(L,"Procurar outro nome","Search another name")}</button></form>`;
 root.querySelectorAll("[data-member]").forEach(row=>row.querySelectorAll("[data-choice]").forEach(b=>b.onclick=()=>{row.querySelectorAll("[data-choice]").forEach(x=>x.classList.remove("active"));b.classList.add("active");row.dataset.status=b.dataset.choice}));
 const newRoot=flex?root.querySelector("#newMembers"):null;
 const addNew=type=>{const confirmed=[...root.querySelectorAll("[data-member]")].filter(r=>r.dataset.status==="yes").length+(newRoot?[...newRoot.children].length:0);if(limit&&confirmed>=limit)return toast(tr(L,`Limite de ${limit} pessoa(s).`,`Limit of ${limit} people.`),true);const r=document.createElement("div");r.className="member-editor-row";r.innerHTML=`<div class="member-type-badge">${type==="child"?`🧒 ${tr(L,"Criança","Child")}`:`👤 ${tr(L,"Adulto","Adult")}`}</div><input class="newname" data-type="${type}" placeholder="${tr(L,"Nome","Name")}"><button type="button" class="btn danger small rm">×</button>`;r.querySelector(".rm").onclick=()=>r.remove();newRoot.append(r)};
 if(flex){root.querySelector("#na").onclick=()=>addNew("adult");root.querySelector("#nc").onclick=()=>addNew("child")}
 root.querySelector("#backLookup").onclick=()=>publicLookup(e);
 const listForm=root.querySelector("#lrf");bindInvalidScroll(listForm);
 listForm.onsubmit=async ev=>{ev.preventDefault();const d=new FormData(ev.currentTarget),responses=[...root.querySelectorAll("[data-member]")].map(r=>({id:r.dataset.member,attendance_status:r.dataset.status||"pending"})),newMembers=flex?[...newRoot.children].map(r=>({name:r.querySelector(".newname").value.trim(),person_type:r.querySelector(".newname").dataset.type,attendance_status:"yes"})).filter(x=>x.name):[],confirmed=responses.filter(x=>x.attendance_status==="yes").length+newMembers.length;if(limit&&flex&&confirmed>limit){scrollToProblem(root.querySelector(".public-family"));return toast(tr(L,`Limite de ${limit} pessoa(s).`,`Limit of ${limit} people.`),true)}if(!responses.some(x=>x.attendance_status==="yes"||x.attendance_status==="no")&&!newMembers.length){scrollToProblem(root.querySelector(".public-family"));return toast(tr(L,"Marque quem vai ou não vai.","Select who is attending or not attending."),true)}const b=ev.submitter;b.disabled=true;try{const r=await api(`/api/public/events/${encodeURIComponent(e.slug)}/rsvp`,{method:"POST",body:JSON.stringify({website:d.get("website"),guest_id:g.id,member_responses:responses,new_members:newMembers,phone:d.get("phone"),dietary:d.get("dietary"),notes:d.get("notes"),love_message:d.get("love_message")})}),yes=r.guest.members?.some(m=>m.attendance_status==="yes");success(e,yes?"yes":"no")}catch(x){toast(x.message,true);b.disabled=false}};
}
function freeRsvp(e){
 const root=document.querySelector("#publicFlow"),f=e.extra_fields||{},t=safeTexts(e),L=eventLang(e),limit=Number(e.max_people_per_rsvp||0)||null;
 root.innerHTML=`<form id="frf"><div style="position:absolute;left:-9999px"><input name="website" autocomplete="off"></div><div class="field"><label>${esc(t.name_label)}</label><input id="fp" name="primary_name" required></div><div class="choice"><button type="button" data-r="yes">${esc(t.yes_button)}</button><button type="button" data-r="no">${esc(t.no_button)}</button></div><div id="declineHint" class="decline-hint" style="display:none">${esc(t.decline_hint)}</div><input type="hidden" name="response_status" value=""><div id="freeSection" style="display:none"><div class="members-editor"><h3>${tr(L,"Quem irá?","Who will attend?")}</h3><div id="freeMembers"></div><div class="actions"><button type="button" class="btn secondary small" id="fa">+ ${tr(L,"Adulto","Adult")}</button><button type="button" class="btn secondary small" id="fc">+ ${tr(L,"Criança","Child")}</button></div></div></div>${f.phone?`<div class="field"><label>${tr(L,"Telefone","Phone")}</label><input name="phone"></div>`:""}${f.dietary?`<div id="attendeeOnlyDietary" class="attendee-only" style="display:none"><div class="field"><label>${tr(L,"Restrição alimentar","Dietary restrictions")}</label><input name="dietary"></div></div>`:""}${f.notes?`<div class="field"><label>${tr(L,"Observações","Notes")}</label><textarea name="notes"></textarea></div>`:""}${f.love_message!==false?`<div class="field"><label>${esc(t.message_label)}</label><textarea name="love_message" placeholder="${esc(t.message_placeholder)}"></textarea></div>`:""}<button class="btn block large">${tr(L,"Enviar confirmação","Submit RSVP")}</button></form>`;
 const form=root.querySelector("#frf"),mr=root.querySelector("#freeMembers"),primary=root.querySelector("#fp"),status=form.querySelector('[name="response_status"]'),declineHint=root.querySelector("#declineHint"),attendeeDietary=root.querySelector("#attendeeOnlyDietary");let touched=false;
 const add=(type,isPrimary=false)=>{if(limit&&mr.children.length>=limit)return toast(tr(L,`Limite de ${limit} pessoa(s).`,`Limit of ${limit} people.`),true);const r=document.createElement("div");r.className=`member-editor-row${isPrimary?" primary-member-row":""}`;r.innerHTML=`<div class="member-type-badge">${type==="child"?`🧒 ${tr(L,"Criança","Child")}`:`👤 ${tr(L,"Adulto","Adult")}`}</div><input class="fname" data-type="${type}" placeholder="${tr(L,"Nome","Name")}">${isPrimary?`<span class="primary-lock" title="${tr(L,"Pessoa responsável","Primary contact")}">${tr(L,"Você","You")}</span>`:`<button type="button" class="btn danger small rm">×</button>`}`;r.querySelector(".fname").oninput=()=>{if(mr.firstElementChild===r)touched=true};const remove=r.querySelector(".rm");if(remove)remove.onclick=()=>r.remove();mr.append(r)};add("adult",true);
 primary.oninput=()=>{const i=mr.firstElementChild?.querySelector(".fname");if(i&&(!touched||!i.value.trim()))i.value=primary.value};
 root.querySelector("#fa").onclick=()=>add("adult");root.querySelector("#fc").onclick=()=>add("child");
 root.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{root.querySelectorAll("[data-r]").forEach(x=>x.classList.remove("active"));b.classList.add("active");status.value=b.dataset.r;const yes=status.value==="yes",section=root.querySelector("#freeSection");section.style.display=yes?"":"none";if(attendeeDietary)attendeeDietary.style.display=yes?"":"none";declineHint.style.display=yes?"none":"";if(yes)setTimeout(()=>{try{section.scrollIntoView({behavior:"smooth",block:"nearest"})}catch{}},80)});
 bindInvalidScroll(form);
 form.onsubmit=async ev=>{ev.preventDefault();const d=new FormData(form);if(!status.value){scrollToProblem(root.querySelector(".choice"));return toast(tr(L,"Escolha se você poderá comparecer.","Please choose whether you will attend."),true)}const members=status.value==="yes"?[...mr.querySelectorAll(".fname")].map(i=>({name:i.value.trim(),person_type:i.dataset.type,attendance_status:"yes"})).filter(x=>x.name):[];if(status.value==="yes"&&!members.length){scrollToProblem(root.querySelector("#freeSection"));return toast(tr(L,"Informe pelo menos uma pessoa.","Please add at least one person."),true)}const b=ev.submitter;b.disabled=true;try{await api(`/api/public/events/${encodeURIComponent(e.slug)}/rsvp`,{method:"POST",body:JSON.stringify({website:d.get("website"),primary_name:d.get("primary_name"),response_status:status.value,members,phone:d.get("phone"),dietary:status.value==="yes"?d.get("dietary"):"",notes:d.get("notes"),love_message:d.get("love_message")})});success(e,status.value)}catch(x){toast(x.message,true);b.disabled=false}};
}
function success(e,status){
 const t=safeTexts(e),a=safeAppearance(e),yes=status==="yes";
 const details=yes&&e.event_date
  ?`<div class="success-event-summary">
      <strong>${esc(fmtDateLang(e.event_date,eventLang(e)))}${e.event_time?` • ${esc(e.event_time)}`:""}</strong>
      ${a.calendar_location?`<span>${esc(a.calendar_location)}</span>`:""}
    </div>`
  :"";
 const calendar=yes&&e.event_date
  ?`<button class="btn block" type="button" id="successCalendar">📅 ${esc(t.calendar_button)}</button>`
  :"";
 const back=a.invitation_url
  ?`<a class="btn ghost block" href="${esc(a.invitation_url)}">← ${esc(t.back_button)}</a>`
  :"";

 document.querySelector("#publicFlow").innerHTML=`<div class="success"><div class="bubble">${yes?"✓":"♡"}</div><h2>${esc(yes?t.success_title:t.decline_title)}</h2><p>${esc(yes?t.success_message:t.decline_message)}</p>${details}<div class="success-actions">${calendar}${back}</div></div>`;

 const calendarBtn=document.querySelector("#successCalendar");
 if(calendarBtn)calendarBtn.onclick=()=>openCalendarMenu(e);
}
