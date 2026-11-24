// Política de produção por linha de serviço. Não altera prazos dos convites existentes.
export const MIN_PRODUCTION_DAYS_ATELIE_RETRO = 15;

// 15 dias corridos de antecedência mínima para a PRIMEIRA data da faixa de entrega.
// A reserva de pontos considera os dias de produção anteriores à entrega, e não
// somente os 3 dias da janela comercial.
export function productionDaysForQuote(quote = {}) {
  const code = String(quote?.product?.code || quote?.productCode || '');
  const atelie = /^atelie_(essencia|encanto|universo)$/.test(code);
  const retrospectiveMain = /^retrospectiva(?:_|$)/.test(code);
  const retrospectiveAddon = Array.isArray(quote?.addons) &&
    quote.addons.some(addon =>
      addon?.group === 'retrospectiva' ||
      /^retro_(?:070|100|150|200|250)$/.test(String(addon?.code || '')) ||
      Boolean(addon?.config?.retroPackageCode)
    );
  return atelie || retrospectiveMain || retrospectiveAddon
    ? MIN_PRODUCTION_DAYS_ATELIE_RETRO : 0;
}

// Pedidos antigos continuam com a reserva e o prazo originais. A política nova
// é gravada no snapshot dos NOVOS pedidos, evitando mudar retroativamente
// encomendas já criadas ou pagamentos pendentes.
export function productionDaysForStoredQuote(snapshot = {}) {
  return snapshot?.productionDays === MIN_PRODUCTION_DAYS_ATELIE_RETRO
    ? MIN_PRODUCTION_DAYS_ATELIE_RETRO : 0;
}
