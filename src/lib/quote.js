import { clampInt } from './http.js';
import { catalogFromSettings } from './settings.js';

export function calculateQuote(selection, settings, options = {}) {
  const catalog = catalogFromSettings(settings);
  const experience = selection?.experience === 'reduced' ? 'reduced' : 'full';
  const format = selection?.format === 'interactive' ? 'interactive' : 'video';
  const productCents = catalog.products[format][experience];

  const addons = selection?.addons || {};
  const confirmationQty = addons.confirmation ? 1 : 0;
  const filterQty = addons.filter ? 1 : 0;
  const extraSceneQty = clampInt(addons.extraScene, 0, 10, 0);
  const extraPersonQty = clampInt(addons.extraPerson, 0, 10, 0);

  const addonLines = [
    ['confirmation', confirmationQty, catalog.addons.confirmation],
    ['filter', filterQty, catalog.addons.filter],
    ['extraScene', extraSceneQty, catalog.addons.extraScene],
    ['extraPerson', extraPersonQty, catalog.addons.extraPerson],
  ].map(([key, qty, unitCents]) => ({
    key,
    qty,
    unitCents,
    totalCents: qty * unitCents,
  }));

  const addonsCents = addonLines.reduce((sum, line) => sum + line.totalCents, 0);
  const subtotalCents = productCents + addonsCents;

  const urgencyEnabled = options.urgencyEnabled === true;
  const urgencyPercent = urgencyEnabled ? catalog.rules.urgencyPercent : 0;
  const urgencyAmountCents = urgencyEnabled
    ? Math.round((subtotalCents * urgencyPercent) / 100)
    : 0;

  const totalCents = subtotalCents + urgencyAmountCents;
  const depositPercent = catalog.rules.depositPercent;
  const depositCents = Math.round((totalCents * depositPercent) / 100);
  const balanceCents = totalCents - depositCents;

  return {
    experience,
    format,
    productCents,
    addonLines,
    addonsCents,
    subtotalCents,
    urgencyEnabled,
    urgencyPercent,
    urgencyAmountCents,
    totalCents,
    depositPercent,
    depositCents,
    balanceCents,
  };
}
