// Runs independently of ES modules. If a module import fails before
// authentication is mounted, avoid leaving the user with a blank page.
(() => {
  window.setTimeout(() => {
    const app = document.getElementById('adminApp');
    const gate = document.getElementById('authGate');
    if (!app || !gate || !app.classList.contains('hidden') || !gate.classList.contains('hidden')) {
      return;
    }
    gate.innerHTML = `
      <section class="auth-card" role="alert">
        <span class="eyebrow">Libri Pedidos</span>
        <h1>O painel não carregou</h1>
        <p>O carregamento foi interrompido. Seus pedidos e pagamentos não foram alterados.</p>
        <button id="adminBootRetry" type="button" class="btn btn-primary">Tentar novamente</button>
      </section>`;
    gate.classList.remove('hidden');
    document.getElementById('adminBootRetry')?.addEventListener('click', () => window.location.reload());
  }, 9000);
})();
