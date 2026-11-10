import { nowIso } from './http.js';
import { loadV2Catalog, loadV2AddonsByCodes, resolveV2ProductSelection } from './v2-catalog.js';
import { calculateV2Quote } from './v2-quote.js';
import { planV2AllocationForWindow } from './v2-agenda.js';
import { priceWithCardProcessingFee } from './v2-payment-pricing.js';

function conflict(message) {
  const error = new Error(message);
  error.code = 'manual_addons_unavailable';
  error.status = 409;
  throw error;
}

function newCodes(raw) {
  if (!Array.isArray(raw) || raw.length > 20) {
    throw new Error('Escolha até 20 adicionais.');
  }
  const codes = raw.map(code => String(code || '').trim());
  if (codes.some(code => !/^[a-z0-9_\-]{1,80}$/.test(code))
    || new Set(codes).size !== codes.length) {
    throw new Error('Lista de adicionais inválida.');
  }
  return codes;
}

async function editable(db, manual) {
  if (!manual || !['awaiting_payment', 'configuring'].includes(manual.status)
    || manual.alreadyPaid || manual.payment) return false;
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM v2_payments WHERE order_id = ?) AS payments,
      (SELECT COUNT(*) FROM v2_checkout_holds WHERE order_id = ?) AS holds
  `).bind(manual.id, manual.id).first();
  // No changes are allowed once any checkout has been started, even if
  // a provider request later fails or its temporary hold expires.
  return Number(row?.payments || 0) === 0 && Number(row?.holds || 0) === 0;
}

function currentAddonCodes(manual) {
  return manual.items.filter(x => x.item_type === 'addon').map(x => x.item_code);
}

export async function getManualClientAddonOffer(db, manual) {
  if (!await editable(db, manual)) {
    return { editable: false, available: [], selected: [] };
  }
  const catalogue = await loadV2Catalog(db);
  const owned = new Set(currentAddonCodes(manual));
  const exclusiveGroups = new Set(['save_the_date', 'reminder', 'moments', 'retrospectiva']);
  const contractedGroups = new Set(catalogue.addons
    .filter(addon => owned.has(addon.code) && exclusiveGroups.has(addon.group))
    .map(addon => addon.group));
  const productCode = manual.pricing.snapshot?.product?.code;
  const available = catalogue.addons
    .filter(addon => !owned.has(addon.code))
    .filter(addon => !contractedGroups.has(addon.group))
    .filter(addon => !(productCode === 'cinematic_video' && addon.group === 'confirmation'))
    .map(addon => ({
      code: addon.code, name: addon.name, group: addon.group,
      priceCents: Number(addon.priceCents),
    }));
  const products = catalogue.products
    .filter(p => p.variants.length > 0)
    .map(p => ({
      code: p.code, name: p.name, pricingMode: p.pricingMode,
      variants: p.variants.map(v => ({
        code: v.code, label: v.label, sceneCount: v.sceneCount,
        priceCents: Number(v.priceCents),
      })),
    }));
  return { editable: true, available, selected: [], products,
    currentProductCode: productCode || '',
    currentVariantCode: manual.pricing.snapshot?.variant?.code || '' };

}

export async function quoteManualClientAddons(db, manual, rawCodes, productSelection = {}) {
  const codes = newCodes(rawCodes ?? []);
  if (!await editable(db, manual)) conflict(
    'Este pedido já iniciou o pagamento. Os adicionais precisam ser combinados com a Libri.'
  );
  const snapshot = manual.pricing.snapshot || {};
  const previousTotal = Number(manual.pricing.totalCents);
  const percent = Number(manual.pricing.depositPercent);
  if (![50, 100].includes(percent) || (percent === 50 && manual.pricing.paymentMethod !== 'pix')) {
    conflict('As condições deste pedido precisam ser conferidas pela Libri.');
  }

  const owned = currentAddonCodes(manual);
  const existingSet = new Set(owned);
  if (codes.some(code => existingSet.has(code))) {
    throw new Error('Este adicional já está incluído no seu pedido.');
  }

  const oldProduct = snapshot.product || {};
  const oldVariant = snapshot.variant || {};
  let chosenProduct = oldProduct;
  let chosenVariant = oldVariant;
  const productCode = String(productSelection.productCode || '').trim();
  const variantCode = String(productSelection.variantCode || '').trim();
  if (productCode || variantCode) {
    if (!productCode || !variantCode) {
      throw new Error('Escolha formato e quantidade de cenas.');
    }
    const resolved = await resolveV2ProductSelection(db, { productCode, variantCode });
    chosenProduct = resolved.product;
    chosenVariant = resolved.variant;
  }
  const productChanged = chosenProduct.code !== oldProduct.code
    || chosenVariant.code !== oldVariant.code;
  if (productChanged && (snapshot.combo?.code || snapshot.coupon?.code)) {
    conflict('Este pedido tem desconto ou combo negociado. Solicite a alteração à Libri.');
  }
  if (productChanged && (!Number.isSafeInteger(Number(oldVariant.priceCents))
    || !Number.isSafeInteger(Number(oldVariant.pointsUnits)))) {
    conflict('O valor original deste pedido precisa ser conferido pela Libri.');
  }

  let additions = [];
  if (codes.length || productChanged) {
    const combined = [...owned, ...codes];
    // The normal checkout validates format, scenes and addon compatibility.
    // Never silently drop an existing addon when switching format.
    const validated = await calculateV2Quote(db, {
      productCode: chosenProduct.code, variantCode: chosenVariant.code,
      paymentMethod: manual.pricing.paymentMethod, addonCodes: combined,
    });
    const exclusiveGroups = new Set(['save_the_date', 'reminder', 'moments', 'retrospectiva']);
    const byGroup = new Map();
    for (const addon of validated.addons) {
      if (!exclusiveGroups.has(addon.group)) continue;
      if (byGroup.has(addon.group)) {
        throw new Error('Escolha apenas uma versão de cada adicional.');
      }
      byGroup.set(addon.group, addon.code);
    }
    const validatedCodes = new Set(validated.addons.map(x => x.code));
    if (validatedCodes.size !== combined.length
      || combined.some(code => !validatedCodes.has(code))) {
      throw new Error('O novo formato não é compatível com os adicionais contratados.');
    }
    additions = await loadV2AddonsByCodes(db, codes);
  }

  const productDeltaCents = productChanged
    ? Number(chosenVariant.priceCents) - Number(oldVariant.priceCents) : 0;
  const productPointsDelta = productChanged
    ? Number(chosenVariant.pointsUnits) - Number(oldVariant.pointsUnits) : 0;
  const extrasCents = additions.reduce((sum, a) => sum + Number(a.priceCents), 0);
  const extraPointsUnits = additions.reduce((sum, a) => sum + Number(a.pointsUnits), 0);
  const pointsDelta = productPointsDelta + extraPointsUnits;
  const oldSubtotalCents = Number(snapshot.subtotalCents);
  const oldUrgencyCents = Number(snapshot.urgency?.amountCents || 0);
  const urgencyPercent = Number(snapshot.urgency?.percent || 0);
  const newSubtotalCents = oldSubtotalCents + productDeltaCents + extrasCents;
  if (!Number.isSafeInteger(newSubtotalCents) || newSubtotalCents < 0
    || !Number.isSafeInteger(urgencyPercent) || urgencyPercent < 0
    || urgencyPercent > 100) {
    conflict('O novo total não é válido. Solicite a revisão à Libri.');
  }
  const extraUrgencyCents = Math.round(newSubtotalCents * urgencyPercent / 100) - oldUrgencyCents;
  const extraBaseCents = extrasCents + productDeltaCents + extraUrgencyCents;
  const oldBaseCents = Number(snapshot.baseTotalCents);
  if (!Number.isSafeInteger(oldBaseCents) || oldBaseCents < 0
    || oldBaseCents + extraBaseCents < 0) {
    conflict('Não foi possível preservar o valor contratado. Fale com a Libri.');
  }
  const method = manual.pricing.paymentMethod;
  const cardIncrease = method === 'card'
    ? priceWithCardProcessingFee(oldBaseCents + extraBaseCents, 'card').totalCents
      - priceWithCardProcessingFee(oldBaseCents, 'card').totalCents
    : 0;
  const increaseCents = method === 'card' ? cardIncrease : extraBaseCents;
  const totalCents = previousTotal + increaseCents;
  const depositCents = Math.round(totalCents * percent / 100);
  const balanceCents = totalCents - depositCents;
  if (!Number.isSafeInteger(totalCents) || totalCents < 1 || totalCents > 100000000) {
    throw new Error('O total do pedido não é válido.');
  }
  if (pointsDelta > 0) {
    const plan = await planV2AllocationForWindow(db, {
      start: manual.deliveryWindow.start, end: manual.deliveryWindow.end,
      pointsUnits: Number(snapshot.pointsUnits || 0) + pointsDelta,
    });
    if (!plan.fits) conflict(
      'A janela de entrega não tem capacidade para o novo formato ou quantidade de cenas. Fale com a Libri.'
    );
  }
  return {
    previousTotalCents: previousTotal, increaseCents, totalCents,
    depositPercent: percent, depositCents, balanceCents,
    extrasCents, extraUrgencyCents, extraBaseCents, extraPointsUnits,
    pointsDelta, productDeltaCents, productPointsDelta, productChanged,
    product: { ...chosenProduct },
    variant: { ...chosenVariant, priceCents: Number(chosenVariant.priceCents),
      pointsUnits: Number(chosenVariant.pointsUnits) },
    addons: additions.map(({ code, name, group, priceCents }) =>
      ({ code, name, group, priceCents: Number(priceCents) })),
    _additions: additions,
  };
}

export async function applyManualClientAddons(
  db, manual, rawCodes, expectedTotalCents, productSelection = {}
) {
  const quote = await quoteManualClientAddons(db, manual, rawCodes, productSelection);
  if (!quote._additions.length && !quote.productChanged) return quote;
  if (!Number.isSafeInteger(expectedTotalCents)
    || expectedTotalCents !== quote.totalCents) {
    conflict('O valor mudou desde a prévia. Confira o novo total antes de pagar.');
  }
  const stamp = nowIso();
  const snapshot = manual.pricing.snapshot;
  const newSnapshot = {
    ...snapshot,
    product: quote.product,
    variant: quote.variant,
    addons: [...(snapshot.addons || []), ...quote._additions],
    lines: [
      ...(snapshot.lines || []).map(line =>
        quote.productChanged && line.type === 'product'
          ? { ...line, code: quote.variant.code, name: quote.product.name,
              amountCents: quote.variant.priceCents } : line),
      ...quote._additions.map(a => ({
        type: 'addon', code: a.code, name: a.name, amountCents: Number(a.priceCents),
      })),
    ],
    addonsCents: Number(snapshot.addonsCents || 0) + quote.extrasCents,
    subtotalCents: Number(snapshot.subtotalCents || 0) + quote.extrasCents + quote.productDeltaCents,
    pointsUnits: Number(snapshot.pointsUnits || 0) + quote.pointsDelta,
    points: (Number(snapshot.pointsUnits || 0) + quote.pointsDelta) / 100,
    urgency: {
      ...(snapshot.urgency || {}),
      amountCents: Number(snapshot.urgency?.amountCents || 0) + quote.extraUrgencyCents,
    },
    baseTotalCents: Number(snapshot.baseTotalCents) + quote.extraBaseCents,
    cardFeeCents: Number(snapshot.cardFeeCents || 0)
      + (manual.pricing.paymentMethod === 'card'
        ? quote.increaseCents - quote.extraBaseCents : 0),
    totalCents: quote.totalCents,
    payment: {
      ...(snapshot.payment || {}),
      method: manual.pricing.paymentMethod,
      depositPercent: quote.depositPercent,
      adminDepositException: quote.depositPercent === 50,
      depositCents: quote.depositCents,
      balanceCents: quote.balanceCents,
    },
  };
  const oldJson = JSON.stringify(snapshot);
  const newJson = JSON.stringify(newSnapshot);

  // D1 batch executes atomically. The first UPDATE is an optimistic lock:
  // a payment or hold created by another tab prevents *all* new additions.
  const statements = [
    db.prepare(`
      UPDATE v2_order_pricing SET
        subtotal_cents = subtotal_cents + ?,
        urgency_amount_cents = urgency_amount_cents + ?,
        total_cents = ?,
        deposit_cents = ?,
        balance_cents = ?,
        pricing_snapshot_json = ?,
        updated_at = ?
      WHERE order_id = ? AND total_cents = ? AND pricing_snapshot_json = ?
        AND EXISTS (
          SELECT 1 FROM v2_orders o
          WHERE o.id = v2_order_pricing.order_id
            AND o.source = 'manual_whatsapp'
            AND o.status IN ('awaiting_payment', 'configuring')
            AND o.briefing_status = 'locked'
        )
        AND NOT EXISTS (SELECT 1 FROM v2_payments WHERE order_id = ?)
        AND NOT EXISTS (SELECT 1 FROM v2_checkout_holds WHERE order_id = ?)
        AND (? = 0 OR EXISTS (
          SELECT 1 FROM v2_order_items original
          WHERE original.order_id = v2_order_pricing.order_id
            AND original.item_type = 'product' AND original.item_code = ?
        ))
    `).bind(
      quote.extrasCents + quote.productDeltaCents, quote.extraUrgencyCents,
      quote.totalCents, quote.depositCents, quote.balanceCents,
      newJson, stamp, manual.id, quote.previousTotalCents, oldJson,
      manual.id, manual.id,
      quote.productChanged ? 1 : 0, snapshot.variant?.code || '',
    ),
    ...(quote.productChanged ? [db.prepare(`
      UPDATE v2_order_items SET
        item_code = ?, name_snapshot = ?, unit_price_cents = ?,
        points_units = ?, configuration_json = ?
      WHERE order_id = ? AND item_type = 'product'
        AND item_code = ?
        AND EXISTS (
          SELECT 1 FROM v2_order_pricing
          WHERE order_id = ? AND pricing_snapshot_json = ?
        )
    `).bind(
      quote.variant.code,
      quote.product.pricingMode === 'scene_count'
        ? `${quote.product.name} • ${quote.variant.label}` : quote.product.name,
      quote.variant.priceCents, quote.variant.pointsUnits,
      JSON.stringify({
        productCode: quote.product.code, productSlug: quote.product.slug,
        variantCode: quote.variant.code, sceneCount: quote.variant.sceneCount,
      }),
      manual.id, snapshot.variant.code, manual.id, newJson,
    )] : []),
    ...quote._additions.map(a => db.prepare(`
      INSERT INTO v2_order_items (
        order_id, item_type, item_code, name_snapshot, quantity,
        unit_price_cents, points_units, configuration_json, created_at
      )
      SELECT ?, 'addon', ?, ?, 1, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM v2_order_pricing
        WHERE order_id = ? AND pricing_snapshot_json = ?
      )
    `).bind(
      manual.id, a.code, a.name, a.priceCents, a.pointsUnits,
      JSON.stringify(a.config || {}), stamp, manual.id, newJson,
    )),
    db.prepare(`
      INSERT INTO v2_order_history (
        order_id, action_code, description, metadata_json, created_at
      )
      SELECT ?, ?,
        'Cliente personalizou formato, cenas ou adicionais antes de pagar.',
        ?, ?
      WHERE EXISTS (
        SELECT 1 FROM v2_order_pricing
        WHERE order_id = ? AND pricing_snapshot_json = ?
      )
    `).bind(manual.id,
    quote.productChanged ? 'manual_customer_product_changed' : 'manual_customer_addons',
    JSON.stringify({
      fromProduct: snapshot.product?.code, fromVariant: snapshot.variant?.code,
      toProduct: quote.product.code, toVariant: quote.variant.code,
      productDeltaCents: quote.productDeltaCents,
      codes: quote._additions.map(a => a.code),
      beforeCents: quote.previousTotalCents,
      afterCents: quote.totalCents,
      depositPercent: quote.depositPercent,
      depositCents: quote.depositCents,
      balanceCents: quote.balanceCents,
    }), stamp, manual.id, newJson),
  ];
  const results = await db.batch(statements);
  if (!results.every(x => Number(x?.meta?.changes || 0) === 1)) {
    conflict('O pedido foi atualizado ou já iniciou pagamento. Recarregue antes de continuar.');
  }
  return quote;
}
