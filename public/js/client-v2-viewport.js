// Keep a form choice at the same visible position after its dependent fields change.
// Both the real customer briefing and the read-only simulation share this behavior.
export function captureFieldViewport(input) {
  const anchor = input?.closest?.('.field') || input;
  return {
    scrollY: window.scrollY,
    key: input?.dataset?.field || '',
    value: input?.value ?? '',
    top: anchor?.getBoundingClientRect?.().top ?? null,
  };
}

export function restoreFieldViewport(snapshot, container) {
  if (!snapshot) return;
  const input = [...container.querySelectorAll('[data-field]')]
    .find(item => item.dataset.field === snapshot.key
      && item.value === snapshot.value);
  const anchor = input?.closest?.('.field') || input;
  const top = anchor && snapshot.top !== null
    ? window.scrollY + anchor.getBoundingClientRect().top - snapshot.top
    : snapshot.scrollY;
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  input?.focus?.({ preventScroll: true });
}
