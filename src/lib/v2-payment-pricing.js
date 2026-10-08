// Libri Pedidos V2: fixed benchmark used to offset the observed card
// processing fee. It is a disclosed checkout price difference, not an
// additional charge from Mercado Pago and not an installment interest rate.
export const CARD_PROCESSING_RATE_BPS = 497;
export const CARD_PROCESSING_RATE_PERCENT = 4.97;

function asCents(cents) {
  const value = Number(cents);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Preço base inválido.');
  }
  return value;
}

export function priceWithCardProcessingFee(baseCents, paymentMethod) {
  const baseTotalCents = asCents(baseCents);
  if (paymentMethod !== 'card') {
    return {
      baseTotalCents,
      cardFeeCents: 0,
      totalCents: baseTotalCents,
      cardFeePercent: 0,
    };
  }

  // Gross up because the provider charges its percentage on the charged
  // total. Find the smallest amount whose estimated NET covers the base.
  let totalCents = Math.round(
    baseTotalCents * 10000 / (10000 - CARD_PROCESSING_RATE_BPS),
  );
  if (totalCents - Math.round(totalCents * CARD_PROCESSING_RATE_BPS / 10000) < baseTotalCents) {
    totalCents += 1;
  }
  return {
    baseTotalCents,
    cardFeeCents: totalCents - baseTotalCents,
    totalCents,
    cardFeePercent: CARD_PROCESSING_RATE_PERCENT,
  };
}

// For orders created before this feature, the contracted price had no card
// surcharge. Never retroactively change it until the customer changes method.
export function baseTotalFromSnapshot(pricingRow, snapshot = {}) {
  const storedTotal = asCents(pricingRow?.total_cents ?? pricingRow?.totalCents ?? 0);
  const base = snapshot.baseTotalCents;
  if (Number.isSafeInteger(base) && base >= 0) return base;
  return storedTotal;
}
