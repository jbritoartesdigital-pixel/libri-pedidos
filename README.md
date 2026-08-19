# Libri Pedidos | Starter V1

Esqueleto funcional do Portal de Pedidos da Libri Convites.

## O que já está incluído

- Portal público sem login para a cliente
- Rascunho salvo por etapas
- Escolha Completo/Reduzido antes do preço
- Escolha Vídeo/Interativo
- Preços e adicionais carregados do D1
- Cálculo automático de total, entrada de 50% e saldo
- Briefing em 6 etapas curtas
- Termos versionados
- Autorização de divulgação separada
- Pedido final `LIBRI-XXXX`
- Tela final com Pix e um único botão para enviar fotos, referências e comprovante pelo WhatsApp
- Painel `/admin/`
- Tema e data da festa explícitos no painel
- Status de fotos, entrada, mascote, falas, convite e saldo
- Controle de rodadas de ajustes
- Início, pausa e retomada do prazo
- Histórico automático
- Observações internas
- Botões de WhatsApp
- Destaque de festa no dia + botão de parabéns
- Configuração de preços, Pix, WhatsApp e links de exemplo pelo painel
- Urgência ativada somente pelo admin

## Valores iniciais cadastrados

- Vídeo Completo: R$ 150
- Vídeo Reduzido: R$ 75
- Interativo Completo: R$ 180
- Interativo Reduzido: R$ 105
- Confirmação Libri: +R$ 25
- Filtro: +R$ 30
- Cena extra: +R$ 30
- Pessoa extra: +R$ 30
- Entrada: 50%
- Urgência: +30%
- Prazo padrão: 5 dias úteis

Todos podem ser alterados depois pelo painel.

## Estrutura

```text
libri-pedidos/
├── src/
│   ├── index.js
│   ├── lib/
│   └── routes/
├── public/
│   ├── index.html
│   ├── admin/
│   ├── css/
│   └── js/
├── migrations/
│   └── 0001_initial.sql
├── .github/workflows/
│   └── publicar.yml
├── wrangler.jsonc
└── package.json
```

## 1. Criar o D1

No terminal do repositório:

```bash
npm install
npx wrangler d1 create libri-pedidos-db
```

Copie o `database_id` retornado e substitua:

```text
REPLACE_WITH_D1_DATABASE_ID
```

no `wrangler.jsonc`.

## 2. Aplicar o banco localmente

```bash
npm run db:migrate:local
npm run dev
```

## 3. Aplicar o banco em produção

```bash
npm run db:migrate:remote
```

O workflow `Publicar Portal de Pedidos` também aplica as migrations antes do deploy.

## 4. GitHub Secrets

No repositório, configurar:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Nunca colocar o token da Cloudflare no código.

## 5. Publicação manual

O workflow foi criado somente com `workflow_dispatch`.

Fluxo esperado:

```text
GitHub
→ Actions
→ Publicar Portal de Pedidos
→ Run workflow
```

## 6. Domínio

Depois do primeiro deploy, configurar o Worker para responder em:

```text
pedidos.libriconvites.com.br
```

## 7. Proteção obrigatória do admin

Antes de usar em produção, configure Cloudflare Access para proteger, no mínimo:

```text
pedidos.libriconvites.com.br/admin/*
pedidos.libriconvites.com.br/api/admin/*
```

As duas rotas precisam ficar protegidas. Não basta proteger somente a página `/admin/`.

A área pública do pedido continua sem login.

## 8. Primeira configuração no painel

Depois do deploy, entre em:

```text
https://pedidos.libriconvites.com.br/admin/
```

Abra **Configurações** e preencha:

- chave Pix
- nome do recebedor
- WhatsApp da Libri
- link do Interativo Completo
- link do Interativo Reduzido
- exemplos em vídeo, quando disponíveis
- exemplo da Confirmação Libri
- exemplo do filtro

Os campos começam vazios de propósito para não inventar dados.

## 9. Sobre o prazo

O starter calcula dias úteis considerando segunda a sexta-feira.

Feriados nacionais, estaduais e municipais ainda não são descontados automaticamente na V1. O painel permite registrar uma data de prazo manual quando necessário.

## 10. Fotos e comprovante

O Portal não armazena fotos da criança, referências nem comprovante.

Depois do pedido ser finalizado, a cliente recebe um único botão para abrir o WhatsApp e enviar tudo na mesma conversa, já com o número `LIBRI-XXXX` na mensagem.

## 11. Termos

A migration cria a versão inicial `1.0` dos termos já discutidos no projeto.

Antes de colocar o Portal em produção comercial, recomenda-se revisão jurídica dos termos, especialmente nas partes de cancelamento, direito de arrependimento, uso de imagem e dados de menores.

Quando uma nova versão dos termos for criada, pedidos antigos continuam vinculados à versão aceita na data da contratação.

## 12. Segurança e V1

Este starter foi pensado para uma primeira versão simples. Antes de produção:

- habilite Cloudflare Access no admin e na API administrativa
- use HTTPS no domínio
- mantenha os secrets somente no GitHub/Cloudflare
- não publique arquivos de configuração contendo tokens
- teste o fluxo inteiro com um pedido fictício

## Testes feitos neste pacote

- sintaxe de todos os arquivos JavaScript verificada com `node --check`
- migration SQL executada em SQLite em memória
- tabela `settings` criada com 20 configurações iniciais
- termos `1.0` criados como versão ativa
- cálculo de preço testado para combinações com adicionais e urgência

