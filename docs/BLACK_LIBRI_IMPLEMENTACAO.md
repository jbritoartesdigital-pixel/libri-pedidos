# BLACK LIBRI | Balão Premiado | Integração no Pedidos V2

**Status:** somente código em `main`, SEM DEPLOY/SEM ATIVAÇÃO. Exige autorização promocional e homologação.

## Decisões preservadas
- Após aceitar os termos e tocar **Ir para o pagamento**, uma tela premium cheia de balões aparece.
- A pessoa estoura **um balão** e revela o prêmio. A cor/posição do balão não aumenta chances.
- **1 prêmio por cliente** na campanha: identificação por WhatsApp normalizado e HMAC com segredo privado. Não se oferece segunda tentativa após expirar.
- **Reserva por 24 horas** após a revelação. A saída, retorno, troca de navegador e recarga exibem o mesmo prêmio.
- 19 prêmios, com estoques distintos. Quando um estoque esgota, ele deixa a seleção e os pesos remanescentes são normalizados.
- Prêmio sem reposição automática após vencimento. Descontos e brindes são aplicados no servidor, no pedido real, antes da cobrança do Mercado Pago.
- Brindes digitais entram em `v2_order_items` sem preço; descontos aparecem no snapshot `v2_order_pricing.pricing_snapshot_json`.

## Variáveis necessárias antes de ativar
`BLACK_LIBRI_ENABLED=1` + `BLACK_LIBRI_START` + `BLACK_LIBRI_END` em ISO 8601 com offset + segredo **Cloudflare Secret** `BLACK_LIBRI_IDENTITY_SECRET` com ao menos 24 caracteres.
A configuração é intencionalmente ausente do wrangler. Não publicar nem ativar antes de revisão e autorização da promoção.

## Pontos para homologação
1. Aplicar migration 0029 em **ambiente de teste**; validar 19 registros e nenhum prêmio repetido.
2. Verificar links de compra Pix/cartão e atualização do preço com cupom/combo; confirmar política de cumulatividade antes da ativação.
3. Testar dois navegadores/abas com mesmo WhatsApp e dois celulares concorrendo ao último brinde.
4. Confirmar 24h, cron, expiração, pagamento no limite da reserva e webhooks atrasados.
5. Testar iOS/Android: popup, scroll, foco, reduzir movimento e aba do Mercado Pago.
6. Testar erros de conexão, cancelamento, volta ao carrinho, pagamento pendente, cupom vencido e fim da campanha.
7. Registrar responsabilidade dos brindes e prazos de entrega conforme capacidade da agenda.
8. Validar cronograma, quantidades e a regra de participação com assessoria jurídica; promoções aleatórias vinculadas à compra podem necessitar autorização prévia da SPA/MF.

## Segurança e limitações
- A identificação atual é por número de WhatsApp **declarado**. Sem validação OTP/identidade, não é antifraude forte: terceiro que saiba um número pode tentar usá-lo. Avaliar confirmação do telefone antes de lançamento.
- Um prêmio já vinculado a pedido anterior não pode ser reaplicado em compra nova.
- O prazo de 24h é do prêmio, não da janela de reserva da agenda nem da validade da cobrança Mercado Pago.
- O sorteio opera com `crypto.getRandomValues` e seleção ponderada segura, não com estado de `localStorage`.
- Não alterar probabilidades/estoques depois de publicar regulamento sem rever consequências legais.
- A nova tela e a flag não afetam pedidos manuais nem o simulador.

## Distribuição inicial proposta (ainda não aprovada)
O peso inicial é 200 unidades; probabilidade = peso / 200 enquanto todos os prêmios estão disponíveis.
Descontos: R$10 15%, R$15 10%, R$20 4%, 5% 15%, 8% 7%, 10% 3%.
Brindes digitais: Save the Date estático 9%, animado 3%, filtro 7%, agradecimento 6%, lembrete estático 6%, contagem regressiva 4%, arte para um personalizado 4%, placa digital 3%.
Prêmios especiais: lembrete animado 1,5%, vídeo de agradecimento 1%, mini retrospectiva 0,5%, vídeo de personagem 0,5%, vídeo da criança para Stories 0,5%.

## Administração integrada ao Admin V2
A aba **Loja > Promoções > Black Libri** exibe os controles da campanha. O painel protegido por Passkey mostra:
- 19 prêmios, pesos e chance relativa dos prêmios ainda disponíveis;
- reservas de 24 horas, prêmios confirmados e estoque restante;
- edição de pesos/limites/habilitação de cada prêmio com auditoria;
- ativação/pausa administrativa com confirmação expressa e referência de autorização.

**Travamento de lançamento por três condições simultâneas:** (1) variáveis Cloudflare
`BLACK_LIBRI_ENABLED=1`, `BLACK_LIBRI_START`, `BLACK_LIBRI_END` e segredo imutável
`BLACK_LIBRI_IDENTITY_SECRET`; (2) linha `v2_black_libri_campaign_state.admin_enabled=1`;
(3) confirmação administrativa de conformidade e referência de autorização.
O código começa com `admin_enabled=0`. Salvar o painel não faz deploy e não aplica migrations.

**Não alterar o segredo HMAC depois de começar a ação.** Ele identifica a cliente
pelo WhatsApp, e trocar o segredo quebraria a garantia de recuperação do prêmio
original. A identificação por WhatsApp informado não constitui validação de posse;
requer verificação adicional se for necessária proteção contra fraude.

**Limitação:** a referência digitada no painel não verifica por si só a validade
de uma autorização; deve corresponder a documento real conferido fora do sistema.
Como a distribuição usa sorteio e depende de compra, verificar exigências da SPA/MF
antes do lançamento. Cupons e descontos acumulados ainda demandam decisão comercial.

## Homologação automatizada sem deploy
Workflow `.github/workflows/black-libri-ci.yml` executa sintaxe,
testes Node, banco SQLite com migrations e dry-run do Worker.
Os testes de integração usam clientes e pagamentos sintéticos, jamais dados reais.
Eles não substituem homologação manual no celular, webhook real do Mercado Pago,
validação de capacidade de produção ou inspeção jurídica.
