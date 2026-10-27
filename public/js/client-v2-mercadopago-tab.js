// Open the provider tab synchronously from a customer click. Opening it
// only after awaiting the checkout API is blocked by many mobile browsers.
export function prepareMercadoPagoTab(browser = window) {
  let tab = null;
  try {
    tab = browser.open('about:blank', '_blank');
    if (tab) {
      tab.opener = null;
      tab.document.title = 'Abrindo Mercado Pago • Libri';
      tab.document.body.style.cssText =
        'font:16px system-ui,sans-serif;padding:32px;line-height:1.6';
      tab.document.body.textContent =
        'Preparando seu pagamento seguro no Mercado Pago…';
    }
  } catch {
    // Popup blocked or browser denied access: the Libri page remains usable.
  }
  return tab;
}

export function sendToMercadoPago(tab, checkoutUrl) {
  const url = new URL(checkoutUrl);
  if (url.protocol !== 'https:') {
    throw new Error('O link de pagamento deve ser seguro (HTTPS).');
  }
  if (!tab || tab.closed) return false;
  tab.location.replace(url.href);
  return true;
}

export function closeMercadoPagoTab(tab) {
  try {
    if (tab && !tab.closed) tab.close();
  } catch {
    // The payment provider may have already changed the tab origin.
  }
}

export function waitingCustomerAreaPath(path, browser = window) {
  const url = new URL(path, browser.location.origin);
  if (url.origin !== browser.location.origin
    || !/^\/meu-pedido\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('Link de acompanhamento do pedido inválido.');
  }
  url.searchParams.set('payment', 'waiting');
  url.searchParams.delete('tab');
  return url.pathname + url.search;
}
