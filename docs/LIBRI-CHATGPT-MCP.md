# Integração privada Libri Pedidos ↔ ChatGPT (em preparação)

Escopo aprovado em 26/10/2026: **somente Libri Pedidos**. Não integrar Presença Confirmada nem Libri Flow.

## Objetivo

Criar um plugin **privado e autenticado** para consultar informações operacionais diretamente da base D1 do Libri Pedidos, sem replicar o banco e sem expor informações pessoais desnecessárias.

## Primeiro componente implementado nesta branch

Arquivo `src/lib/v2-assistant-readonly.js` com três operações exclusivamente de leitura:

- `listLibriAssistantOrders(db, filters)`: lista até 25 pedidos não arquivados com busca por nome/código, status e período de entrega.
- `getLibriAssistantOrder(db, orderCode)`: consulta pontual por código.
- `getLibriAssistantSceneLink(db, productCode, sceneCount)`: cria URL da loja validando produto e variante de cenas **ativos** no catálogo real, sem forçar preço.

Os resumos retornam nomes de cliente e homenageado, status, janela de entrega, valor total, pagamentos aprovados líquidos de reembolsos, saldo restante e produto. Não retornam WhatsApp, e-mail, tokens da área da cliente, briefing, anexos, dados do Mercado Pago nem credenciais.

NÃO há novo endpoint HTTP nesta branch. NÃO há servidor MCP ativo. NÃO foi feito deploy.

## Segunda camada: protocolo MCP (adicionada em 26/10)

`src/lib/v2-assistant-mcp.js` implementa a interface JSON-RPC necessária para três ferramentas MCP:

- `listar_pedidos`
- `consultar_pedido`
- `gerar_link_por_cenas`

O transportador só deve ser chamado **depois** de o gateway OAuth verificar o token e construir uma identidade confiável (`verified: true`, `subject`, `scopes: ['libri:read']`). Propriedades fornecidas pelo cliente não são confiáveis como identidade. Não há qualquer rota HTTP pública apontando para esta função, portanto ela ainda não pode ser conectada ao ChatGPT.

O contrato cobre `initialize`, `ping`, `tools/list`, `tools/call` e notificação de inicialização via POST JSON, com validação de argumentos, limite de corpo e `securitySchemes` OAuth. Ainda será necessário realizar testes formais de interoperabilidade com MCP Inspector após autenticação e roteamento. Não declarar compatibilidade de produção antes disso.

## Plano concreto do gateway OAuth

Implementar junto ao Worker existente, preferencialmente com biblioteca auditada como `@cloudflare/workers-oauth-provider` (não criar emissor OAuth próprio em código improvisado). Requisitos:

1. Criar namespace Cloudflare KV exclusivo para OAuth, com IDs e segredos **fora do repositório**. A biblioteca também pode exigir compatibilidade `global_fetch_strictly_public` para CIMD.
2. Publicar recurso HTTPS `https://pedidos.libriconvites.com.br/mcp`, metadata em `/.well-known/oauth-protected-resource` e autorização em `/.well-known/oauth-authorization-server`.
3. Implementar `/authorize` somente com usuário efetivamente autenticado por Passkey no **mesmo domínio**, seguido de página explícita de consentimento. Impedir CSRF, open redirects, associação a outro usuário e autoaprovação indevida.
4. Usar OAuth 2.1 Authorization Code + PKCE S256, CIMD com clientes confiáveis ou DCR conforme suporte verificado, `resource`/audience obrigatório e único, refresh seguro e revogação.
5. Anunciar somente escopo `libri:read`; validar o escopo e identidade real para **cada requisição**. Qualquer rota sem token correto retorna `401`, nunca dados administrativos.
6. Fornecer rate limit, verificação de origem, auditoria sem conteúdo de clientes, expiração, revogação e `Cache-Control: no-store`. Não usar tokens de sessão do Admin como bearer MCP, nem copiar cookies para ChatGPT.
7. Manter rotas existentes do portal e do Admin isoladas. Testar regressão completa, a autorização e a revogação antes de qualquer deploy.
8. Registrar URL e credenciais conforme a tela real de Plugins do ChatGPT e realizar consentimento da proprietária; testar `tools/list` e uma consulta autorizada de leitura.

O ambiente desta conversa não tem conexão autenticada com Cloudflare para provisionar KV ou fazer deploy, então o gateway OAuth ainda está **pendente**. Não criar plugin que aponte para endpoint inexistente.

## Etapa necessária para conectar de verdade

1. Implementar servidor MCP autenticado, hospedado junto à infraestrutura Cloudflare existente ou em Worker separado.
2. Autorização individual com consentimento, associada ao login administrativo com passkey, usando o fluxo OAuth suportado pelo cliente MCP. Nunca transferir cookies de sessão, API keys ou tokens por chat.
3. Restringir o acesso às três operações explicitamente permitidas e aplicar escopos read-only. Identificar o usuário autorizado no servidor, limites de requisições e auditoria mínima, sem registrar dados pessoais em logs.
4. Cobrir cenários de autorização ausente/expirada, desvinculação, CORS/origem, respostas MCP e tratamento de erros.
5. Validar as rotas e o protocolo em homologação. Só então publicar mediante autorização explícita e conectar o plugin privado ao endpoint MCP real.
6. Verificar a conexão com uma operação de leitura sem divulgar informações indevidas; a criação do plugin isoladamente não prova que ele está funcionando.

## Itens fora do escopo

- Alterar pedidos, saldos ou formas de pagamento.
- Criar Pix, cobrar clientes ou alterar transações Mercado Pago.
- Remover pedidos, publicar convites, baixar anexos ou disparar mensagens.
- Implantar automaticamente em produção.
- Integrar Flow, RSVP ou outras plataformas.

## Segurança e precisão financeira

Os valores são retornados em centavos. Pagamentos aprovados são somados; registros aprovados classificados como reembolso são subtraídos. Pendências, reprovações e cobranças sem confirmação não contam como recebidas. Esses números devem ser confrontados com o painel Financeiro antes de automatizar qualquer decisão monetária.

O repositório é público: **nenhuma credencial deve ser comitada**. Autenticação e segredos devem permanecer nos segredos do Worker, e dados administrativos nunca podem ficar em caminhos públicos.

## Critério de aceite da fase atual

- Testes automatizados da camada de consultas aprovados.
- Nenhuma modificação nos dados ou nos endpoints existentes.
- Nenhuma publicação disparada pela PR.

A fase MCP/OAuth deverá ser revisada separadamente antes do deploy.
