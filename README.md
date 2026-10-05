# LIBRI PEDIDOS V2

Portal V2 em /pedido, área da cliente em /meu-pedido/<token> e Admin em /admin-v2. O portal V1 em / e seu Admin em /admin/ permanecem disponíveis.

## Fluxo implementado

- Sem janela normal, a cliente solicita análise de encaixe, sem cobrança.
- O Admin aprova com janela e capacidade conferidas, ou rejeita com motivo.
- Urgência: adicional fixo de 30% sobre o subtotal depois de combo e cupom, arredondado em centavos.
- Pix: entrada de 50%; cartão: pagamento integral. Capacidade revalidada e reservada antes do checkout.
- Retomada na área privada: consulta o pagamento anterior, reutiliza checkout válido, cancela tentativa pendente sem reserva antes de substituí-la e preserva o mesmo pedido.
- Idempotência por reserva e serialização por pedido protegem tentativas repetidas.
- Mercado Pago Checkout Pro via Orders: POST /v1/orders, consulta autenticada, assinatura HMAC do webhook, validação do valor e referência.
- A aprovação libera o briefing uma vez. Webhooks repetidos não reiniciam produção nem duplicam alocações.
- Pagamento tardio sem capacidade gera alerta no Admin e mantém o briefing bloqueado para revisão.
- Cron a cada cinco minutos: sincronização de pagamentos, notificações e Web Push, eventos do dia em São Paulo, expiração de reservas/prévias e limpeza de desafios e operações abandonadas.
- Agenda administrativa restaurada: dias, períodos, sugestões de cascata, antecipação e liberação explícita de excedente.
- D1, R2 privado, Static Assets, Passkey e Web Push mantidos. Nenhuma migration nova.

## Validação

Node 24 e pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm exec wrangler deploy --dry-run --outdir .wrangler/validation
```

O check percorre todos os JS/MJS de src, public, scripts e tests, aplica node --check, confere imports relativos e bindings. Os testes aplicam as 12 migrations existentes em SQLite em memória e exercitam os fluxos V2 e rotas V1.

Mercado Pago é simulado nos testes: nenhum pagamento real é criado. Testes locais não confirmam credenciais, Webhooks, push em dispositivos ou configuração da conta Cloudflare.

## Publicação

O workflow Validar Libri Pedidos V2 roda em push/PR, sem publicar. Publicar Portal de Pedidos permanece exclusivamente manual (workflow_dispatch), com validação, teste SQLite e backup D1 antes das migrations remotas.

Não executar a publicação até a autorização da responsável. Commit na main não dispara deploy por estes workflows.

Consulte PROXIMOS_PASSOS.md para as configurações externas.


