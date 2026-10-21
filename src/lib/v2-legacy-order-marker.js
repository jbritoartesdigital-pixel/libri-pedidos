// V1 imports can carry the original marker in the event subtype, the
// historical pricing snapshot, or the imported product item code. Use the
// same evidence in admin presentation and write authorization.
export function isV2LegacyImport(order = {}, items = []) {
  if (order.event_subtype === 'legacy_v1') return true;
  let snapshot = {};
  try {
    const parsed = JSON.parse(order.pricing_snapshot_json || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) snapshot = parsed;
  } catch { /* old snapshots may be incomplete */ }
  if (snapshot.legacyV1 === 1 || snapshot.legacyV1 === true
    || snapshot.adminNegotiatedOriginalTotalCents > 0) return true;
  return items.some(item => {
    const code = String(item.item_code || item.itemCode || '');
    return (item.item_type || item.itemType) === 'product'
      && /^legacy_[a-z0-9_-]+$/i.test(code);
  });
}
