// Read-only delivery preview. Both price and capacity are recomputed on the server.
// No order, checkout hold, payment or urgency request can be created here.
import {quoteV3Cart,V3CartValidationError} from './v3-cart-quote.js';
import {findV2DeliveryOptions,validateV2DeliveryWindow,planV2AllocationForWindow} from './v2-agenda.js';

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
  return {
    quote,
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
