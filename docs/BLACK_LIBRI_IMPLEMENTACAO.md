# BLACK LIBRI | Balão Premiado | Integração no Pedidos V2

**Status:** somente código em `main`, SEM DEPLOY/SEM ATIVAÇÃO. Exige autorização promocional e homologação.

## Decisões preservadas
- Após aceitar os termos e tocar **Ir para o pagamento**, uma tela premium cheia de balões aparece.
- A pessoa estoura **um balão** e revela o prêmio. A cor/posição do balão não aumenta chances.
- **1 prêmio por cliente** na campanha: identificação pelo WhatsApp normalizado e hash SHA-256 estável, sem Secret configurável. Não se oferece segunda tentativa após expirar.
- **Reserva por 24 horas** após a revelação. A saída, retorno, troca de navegador e recarga exibem o mesmo prêmio.
- 19 prêmios, com estoques distintos. Quando um estoque esgota, ele deixa a seleção e os pesos remanescentes são normalizados.
- Prêmio sem reposição automática após vencimento. Descontos e brindes são aplicados no servidor, no pedido real, antes da cobrança do Mercado Pago.
- Brindes digitais entram em `v2_order_items` sem preço; descontos aparecem no snapshot `v2_order_pricing.pricing_snapshot_json`.

## Ativação simples no Admin
Após publicação do código e aplicação das migrations (0029, 0030 e 0031),
abra **Admin V2 > Loja > Promoções > Black Libri**.

Preencha **Data de início** e **Data de término** (campos do tipo date,
como os de Cupons); registre a referência real de autorização aplicável e
ative a campanha. O backend converte as datas para o início (00h) e fim
(23h59) no horário de Brasília (-03:00) e desativa a oferta automaticamente
após o último dia. Não é necessário cadastrar variáveis ou secrets no Cloudflare.

**Publicar o código e as migrations continua sendo uma etapa técnica distinta
da ativação.** A campanha começa desligada por padrão.

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
- A identificação atual é por número de WhatsApp **declarado**. O hash sem secret não substitui validação de titularidade; terceiro que saiba um número pode tentar usá-lo. Avaliar confirmação do telefone antes de lançamento.
- Um prêmio já vinculado a pedido anterior não pode ser reaplicado em compra nova.
- O prazo de 24h é do prêmio, não da janela de reserva da agenda nem da validade da cobrança Mercado Pago.
- O sorteio opera com `crypto.getRandomValues` e seleção ponderada segura, não com estado de `localStorage`.
- Não alterar probabilidades/estoques depois de publicar regulamento sem rever consequências legais.
- A tela também aparece em pedidos manuais ainda não pagos quando a cliente abre o link de pagamento, mantendo o mesmo pedido e o mesmo percentual de entrada. Pedidos já pagos ou com checkout iniciado não são alterados. O simulador não participa.

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

**Travamento de lançamento:** (1) período válido configurado no painel,
(2) `v2_black_libri_campaign_state.admin_enabled=1`,
(3) confirmação administrativa de conformidade e referência real de autorização.
Os campos ficam no banco D1, sem secrets extras. A campanha começa pausada
após a migration. Salvar no painel não faz deploy.

**Identificação por cliente:** o WhatsApp informado, normalizado e tratado
com SHA-256, gera uma chave estável por campanha. Essa deduplicação não
verifica que a cliente é dona do número; é uma proteção básica contra
redraws, não autenticação forte.

## Homologação automatizada sem deploy
Workflow `.github/workflows/black-libri-ci.yml` executa sintaxe,
testes Node, banco SQLite com migrations e dry-run do Worker.
Os testes de integração usam clientes e pagamentos sintéticos, jamais dados reais.
Eles não substituem homologação manual no celular, webhook real do Mercado Pago,
validação de capacidade de produção ou inspeção jurídica.

## Pedido manual e texto da cliente
O link `/pedido/manual/:token` participa da Black Libri antes de criar o checkout Mercado Pago.
O WhatsApp é obtido do pedido armazenado no D1, e não de um campo fornecido pelo navegador. A mesma identidade participa uma vez em ambos os canais.
Se houver escolha de adicionais antes de pagar, a prévia calcula o benefício sobre o novo preço; o desconto ou brinde é lançado na precificação e nos itens do **mesmo pedido** antes da cobrança. A entrada Pix de 50% autorizada no atendimento é preservada. Checkout já iniciado ou Pix já recebido não recebem um sorteio retroativo.
A interface pública exibe apenas o prêmio, o total atualizado e o botão de continuar. Regras antifraude, detalhes da identidade e instruções internas ficam fora da tela.

## Valor final confirmado antes de abrir checkout | Pedido manual
O balão agora é mostrado antes do resumo final: cliente escolhe presentes,
o servidor grava a premiação no **mesmo pedido manual**, a página reabre o
resumo com o desconto/prêmio como linha de pedido, e só então exige
aceitar os termos e iniciar o Mercado Pago. Se o total mudar entre a
confirmação e a cobrança, a API recusa em vez de cobrar valor antigo.

### Prêmio de adicional que já foi comprado
Quando o adicional premiado já existe no pedido, o sistema NÃO adiciona
outro: converte o prêmio em um **crédito** registrado como item financeiro
`combo_adjustment` negativo; mantém o adicional original para produção.
O crédito é o menor entre o valor desse adicional contratado e o preço
da versão premiada, limitado ao saldo positivo do pedido.
Equivalências vigentes: Save estático/animado, Lembrete estático/animado,
Filtro de foto / Filtro Personalizado. Outros brindes são convertidos
em crédito se houver adicional contratado exatamente com o código sorteado.
Caso contrário, o presente continua como item gratuito.
O crédito Black Libri permanece separado do desconto de cupom no snapshot,
para não inflar a contabilização de cupons resgatados pelos webhooks.
