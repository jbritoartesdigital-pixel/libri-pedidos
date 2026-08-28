(() => {
  'use strict';

  /*
   * LIBRI CONVITES
   * PROTEÇÃO DE HISTÓRICO
   *
   * O painel não oferece exclusão
   * permanente de pedidos.
   *
   * Pedidos encerrados permanecem
   * preservados no histórico e são
   * tratados por status/arquivamento.
   */

  function removeLegacyDeleteZone() {
    document
      .querySelector(
        '#deleteOrderZone',
      )
      ?.remove();
  }

  function installProtection() {
    removeLegacyDeleteZone();

    const detailBody =
      document.querySelector(
        '#detailBody',
      );

    if (!detailBody) {
      return;
    }

    const observer =
      new MutationObserver(
        () => {
          removeLegacyDeleteZone();
        },
      );

    observer.observe(
      detailBody,
      {
        childList:
          true,

        subtree:
          true,
      },
    );
  }

  if (
    document.readyState
    === 'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      installProtection,
      {
        once:
          true,
      },
    );
  } else {
    installProtection();
  }
})();
