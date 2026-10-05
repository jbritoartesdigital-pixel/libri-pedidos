# Configurações externas da responsável

Nenhum deploy foi executado. O D1 existente 658c569d-60eb-4f59-8532-a321539dd073, o bucket libri-pedidos-files e seus bindings foram preservados; não criar outro banco.

## Secrets

Se já cadastrados no Worker, podem ser mantidos. Para sincronização pelo workflow manual, cadastrar nos Secrets do repositório GitHub:

- CLOUDFLARE_API_TOKEN: permissão para Workers, D1 e R2 usados pelo workflow.
- CLOUDFLARE_ACCOUNT_ID: conta que contém o D1 e o Worker.
- MERCADO_PAGO_ACCESS_TOKEN: credencial da aplicação/conta vendedora.
- MERCADO_PAGO_WEBHOOK_SECRET: assinatura gerada no painel de Webhooks dessa mesma aplicação.
- ADMIN_PASSKEY_RECOVERY_SECRET: segredo privado para o primeiro cadastro/recuperação da Passkey.
- VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY: par VAPID para Web Push. Preservar o par existente, se houver, para manter as inscrições.
- ADMIN_PASSWORD e ADMIN_SESSION_SECRET: credenciais do Admin V1. Preservar os valores existentes; o workflow agora também permite sincronizá-los.

Não adicionar valores privados a arquivos do repositório.

## Mercado Pago

Na aplicação usada pelo Access Token, cadastrar:
- Evento: Order (Mercado Pago).
- URL: https://pedidos.libriconvites.com.br/api/v2/payments/mercado-pago/webhook
- Copiar o segredo de assinatura dessa configuração para MERCADO_PAGO_WEBHOOK_SECRET.

As URLs de retorno são criadas pelo app a partir do domínio acessado, para /meu-pedido/<token>?payment=success, pending ou failure.

Usar credenciais e contas de teste coerentes entre si para conferir Pix, cartão e Webhook antes de habilitar vendas. A suite local usa um provedor simulado.

## Cloudflare e acesso

- Confirmar que pedidos.libriconvites.com.br está ligado ao Worker libri-pedidos. workers.dev e preview_urls continuam desativados.
- Se usar outro domínio, ajustar ADMIN_PASSKEY_ORIGIN e ADMIN_PASSKEY_RP_ID e cadastrar Passkey nesse domínio.
- Cadastrar a Passkey pelo Admin V2 com o segredo de recuperação e permitir notificações no dispositivo para receber Web Push.
- Se houver Cloudflare Access no Admin legado, preservar sua proteção e garantir que ela não bloqueie o endpoint público do Webhook nem o cadastro/autenticação de Passkey usado pela responsável.

## Dados comerciais próprios

Preencher no painel as informações ainda ausentes: WhatsApp da Libri, chave Pix e recebedor para saldo, exemplos do catálogo e materiais próprios da loja.

## Publicação posterior

Após autorização expressa, executar manualmente Publicar Portal de Pedidos. Ele guarda backup D1, aplica somente as migrations existentes e publica Worker/Static Assets/cron. Depois, conferir uma compra de teste completa, recebimento do Webhook, Passkey e push no dispositivo.

