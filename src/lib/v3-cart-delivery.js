// Read-only delivery preview. Both price and capacity are recomputed on the server.
// No order, checkout hold, payment or urgency request can be created here.
import {quoteV3Cart,V3CartValidationError} from './v3-cart-quote.js';
import {findV2DeliveryOptions,validateV2DeliveryWindow,planV2AllocationForWindow,validateV2UrgencyWindow} from './v2-agenda.js';
import {loadV2Settings,v2IntSetting} from './v2-catalog.js';
import {priceWithCardProcessingFee} from './v2-payment-pricing.js';
export async function priceV3Urgency(db,q){
 if(q.items.length!==1||q.items[0].family!=='convite'||q.productionDays!==0)throw new V3CartValidationError('O encaixe urgente é exclusivo de convites. Ateliê e Retrospectivas preservam o prazo mínimo.','v3_urgency_family');
 const settings=await loadV2Settings(db),percent=Math.max(1,Math.min(100,v2IntSetting(settings,'urgency_percent',30)));
 const amountCents=Math.round(q.baseTotalCents*percent/100),line=q.items[0],baseTotalCents=q.baseTotalCents+amountCents;
 const pricing=priceWithCardProcessingFee(baseTotalCents,q.paymentMethod),urgency={percent,amountCents,requested:true};
 const snapshot=line.commercialSnapshot?{...line.commercialSnapshot,urgency,baseTotalCents:line.totalCents+amountCents,totalCents:line.totalCents+amountCents,payment:{...line.commercialSnapshot.payment,depositCents:line.totalCents+amountCents,balanceCents:0}}:undefined;
 return {...q,urgency,urgencyPercent:percent,urgencyAmountCents:amountCents,items:[{...line,grossCents:line.grossCents+amountCents,totalCents:line.totalCents+amountCents,urgencyAmountCents:amountCents,...(snapshot?{commercialSnapshot:snapshot}:{})}],grossCents:q.grossCents+amountCents,baseTotalCents,totalCents:pricing.totalCents,cardFeeCents:pricing.cardFeeCents};
}
export async function assertV3UrgencyAvailable(db,q,eventDate){
 if(!validDate(eventDate))throw new V3CartValidationError('Confira a data do evento.','cart_event_date_invalid');
 try{validateV2UrgencyWindow(eventDate,eventDate,eventDate);}catch{throw new V3CartValidationError('A data do evento já passou.','cart_event_date_invalid');}
 const delivery=await findV2DeliveryOptions(db,{eventDate,pointsUnits:q.pointsUnits,productionDays:q.productionDays,limit:8});
 if(delivery.options?.length||!delivery.needsUrgencyReview)throw new V3CartValidationError('Ainda existem janelas normais de entrega. Consulte a agenda.','regular_delivery_available');
 return priceV3Urgency(db,q);
}

function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}

export async function previewV3CartDelivery(db,body={}){
  if(!validDate(body.eventDate))
    throw new V3CartValidationError('Confira a data do evento.','cart_event_date_invalid');
  const quote=await quoteV3Cart(db,body);
  const productionDays=quote.productionDays;
  const params={eventDate:body.eventDate,pointsUnits:quote.pointsUnits,productionDays};
  // A common delivery window must accommodate the sum of all work, not one slot per service.
  const delivery=await findV2DeliveryOptions(db,{...params,limit:8});
  const options=(delivery.options||[]).map(x=>({
    start:x.start,end:x.end,recommended:!!x.recommended
  }));
  let selected=null;
  if(body.deliveryWindow!=null){
    const {start,end}=body.deliveryWindow;
    if(!validDate(start)||!validDate(end))
      throw new V3CartValidationError('Confira a janela de entrega.','cart_delivery_invalid');
    await validateV2DeliveryWindow(db,{...params,start,end});
    const plan=await planV2AllocationForWindow(db,{...params,start,end});
    if(!plan.fits)throw new V3CartValidationError('Essa janela não tem mais capacidade para todos os serviços. Escolha outra.','cart_delivery_unavailable');
    selected={start,end};
  }
  let urgencyQuote=null;
  if(!options.length&&delivery.needsUrgencyReview&&quote.items.length===1&&quote.items[0].family==='convite'&&productionDays===0){try{validateV2UrgencyWindow(body.eventDate,body.eventDate,body.eventDate);urgencyQuote=await priceV3Urgency(db,quote);}catch{}}
  return {
    quote,urgencyQuote,
    delivery:{
      options,selected,
      recommendedTargetDate:delivery.recommendedTargetDate,
      needsUrgencyReview:!!delivery.needsUrgencyReview,
      minimumProductionDays:productionDays,
      provisionalUntilBriefing:productionDays>0,
      reserved:false,
      canCheckout:false
    }
  };
}
