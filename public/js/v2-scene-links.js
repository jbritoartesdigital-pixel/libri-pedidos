// One source of truth for shareable scene-count links in the admin and store.
// A link preselects an existing active catalogue variant; it never sets price.
export function sceneLinkUrl(origin, slug, sceneCount) {
  if (!/^[a-z0-9-]+$/.test(String(slug || ''))
    || !Number.isSafeInteger(Number(sceneCount))
    || Number(sceneCount) < 1 || Number(sceneCount) > 99) {
    throw new Error('Produto ou quantidade de cenas inválida.');
  }
  const url = new URL(`/pedido/${slug}`, origin);
  url.searchParams.set('cenas', String(sceneCount));
  return url.toString();
}

export function sceneLinkSelection(product, search = '') {
  const params = new URLSearchParams(search);
  if (!params.has('cenas')) return { requested: false, variant: null };
  const raw = params.get('cenas') || '';
  if (!/^[1-9][0-9]?$/.test(raw) || product?.pricingMode !== 'scene_count') {
    return { requested: true, variant: null };
  }
  const scenes = Number(raw);
  const variant = (product?.variants || []).find(
    item => Number(item.sceneCount) === scenes
  ) || null;
  return { requested: true, variant };
}
