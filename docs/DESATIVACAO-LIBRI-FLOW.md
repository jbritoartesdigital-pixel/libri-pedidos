# Libri Pedidos | Desacoplar Libri Flow

Esta alteração é um **rascunho para revisão**. Não é um deploy.

## Escopo
- Remover do ponto de entrada do Worker somente as rotas que atendiam o app Libri Flow:
  - `/api/internal/flow/grant/redeem`
  - `/api/admin/v2/flow/projects`
  - `/api/admin/v2/flow/orders/:code/publication`
  - `/api/admin/v2/flow/grants`
  - `/api/admin/v2/flow/drive/*`
- Retirar a página antiga de pareamento `public/flow-connect.html`.
- Preservar todos os módulos internos e migrações históricos do Flow por enquanto; sem `DROP TABLE`, sem exclusão de pedidos e sem limpeza automática de registros.
- Preservar o OAuth e as ferramentas nativas de Google Drive do **Libri Pedidos**, bem como checkout, Pix, agenda, produção, publicações existentes e o servidor MCP do projeto separado.

## Antes de mesclar/implantar
1. Confirmar backup do R2/D1 **do Flow**, inclusive arquivos criados em Windows/Android que só estejam lá, e necessidade de vínculos de publicação do Flow.
2. Validar CI de todos os testes, inclusive rota interna 404.
3. Checar com proprietária se deseja mesmo impedir novos pareamentos e uploads pelo Flow.
4. Só após confirmação explícita fazer merge/deploy manual do Libri Pedidos.
5. Depois desligar Worker `libri-flow-sync` e, se autorizado, remover apenas os recursos Cloudflare exclusivos do Flow.

## Não confundir recursos
- Flow: `libri-flow-sync`, `libri-flow-sync-db`, `libri-flow-sync-private`.
- Pedidos: `libri-pedidos`, `libri-pedidos-db`, `libri-pedidos-files`. Estes devem continuar.

**Atenção:** fechar as rotas do Flow antes de exportar algum trabalho que ainda dependa delas interrompe a sincronização. Esta PR deve permanecer em rascunho até backup e aprovação.
