// Coupon recovery is intentionally independent of UI and checkout provider.
// A saved coupon can expire or reach its usage cap while a customer is shopping.
export function isCouponQuoteError(error) {
  return /cupom/i.test(String(error?.message || error?.data?.error || ''));
}

export function removeCouponFromCart(state, save, notice = '') {
  state.selection.couponCode = '';
  // A previous discounted total is never reused once its coupon is removed.
  state.quote = null;
  state.couponNotice = notice;
  save(state);
}

// Retries only errors explicitly associated with coupons. Network errors,
// invalid products and other pricing failures still block checkout safely.
export async function quoteWithCouponRecovery(state, quote, save, {
  recoverInvalidCoupon = true,
} = {}) {
  try {
    state.quote = await quote();
    return { recovered: false };
  } catch (error) {
    if (!recoverInvalidCoupon || !state.selection.couponCode
      || !isCouponQuoteError(error)) throw error;
    const code = state.selection.couponCode;
    removeCouponFromCart(state, save,
      `O cupom ${code} não está mais disponível. Confira o total atualizado antes de pagar.`);
    state.quote = await quote();
    return { recovered: true };
  }
}
