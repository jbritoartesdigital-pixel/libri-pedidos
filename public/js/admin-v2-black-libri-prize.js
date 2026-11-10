// Leitura do registro real do pedido. Não modifica valores nem a premiação.
export function summarizeBlackLibriAwards(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => String(item?.itemCode || '').startsWith('black_libri:'))
    .map(item => {
      const code = String(item.itemCode).slice('black_libri:'.length);
      const label = String(item.name || '')
        .replace(/^(?:Brinde|Desconto)\s+Black\s+Libri:\s*/i, '')
        .trim() || 'Prêmio especial';
      const rawAmount = Number(item.unitPriceCents || 0);
      const amountCents = Number.isFinite(rawAmount)
        ? Math.max(0, Math.round(Math.abs(rawAmount))) : 0;
      const credited = item.itemType === 'combo_adjustment' || rawAmount < 0;
      return {
        code,
        label,
        amountCents,
        kind: !credited ? 'gift'
          : code.startsWith('off_') ? 'discount' : 'converted_gift',
      };
    });
}
