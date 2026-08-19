# Próximos passos para colocar no ar

1. Criar um repositório GitHub chamado `libri-pedidos`.
2. Subir este starter para o repositório.
3. Criar o D1 `libri-pedidos-db`.
4. Colocar o `database_id` real no `wrangler.jsonc`.
5. Adicionar `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` nos Secrets do GitHub.
6. Rodar `Publicar Portal de Pedidos` manualmente.
7. Ligar o domínio `pedidos.libriconvites.com.br` ao Worker.
8. Proteger `/admin/*` e `/api/admin/*` com Cloudflare Access.
9. Entrar no painel e preencher Pix, WhatsApp e links de exemplo.
10. Fazer um pedido fictício completo antes de abrir para clientes.

## Pontos que ainda podem ser refinados depois do primeiro teste

- visual final da marca no Portal
- mensagens prontas de WhatsApp por etapa
- texto exato dos exemplos do catálogo
- feriados no cálculo do prazo
- limpeza automática de rascunhos antigos
- criação manual de pedido pelo admin
- painel específico da cliente para Libri RSVP, que continua sendo um sistema separado
