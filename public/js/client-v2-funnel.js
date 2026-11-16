// Anonymous first-party checkout progression. No customer or purchase content.
const KEY="libriV2AnonymousFunnelSession";
let lastReport={step:-1,at:0,checkout:false};
function anonymousSessionId(){
  try{
    let id=sessionStorage.getItem(KEY);
    if(!id || !/^[a-f0-9-]{36}$/i.test(id)){
      id=crypto.randomUUID();
      sessionStorage.setItem(KEY,id);
    }
    return id;
  }catch{return null}
}
export async function recordCheckoutStep(step,{checkoutCreated=false}={}){
  const current=Number(step);
  if(!Number.isInteger(current)||current<0||current>10)return;
  const now=Date.now();
  if(!checkoutCreated && lastReport.step===current && now-lastReport.at<120000)return;
  const id=anonymousSessionId();
  if(!id)return; // Private browsing can disable sessionStorage entirely.
  lastReport={step:current,at:now,checkout:checkoutCreated};
  try{
    await fetch("/api/v2/analytics/funnel",{
      method:"POST",mode:"same-origin",credentials:"same-origin",
      keepalive:true,
      headers:{"content-type":"application/json"},
      body:JSON.stringify({sessionId:id,step:current,checkoutCreated})
    });
  }catch{
    // Noncritical telemetry must never block or delay a customer's purchase.
  }
}
