# Libri V4.1 | Produção de Ateliê e Retrospectivas — mínimo de 15 dias

**Decisão aprovada em 23/11/2026.** Válida para novos pedidos; históricos permanecem com data e alocações originais.

## Regra comercial
- Libri Ateliê (Essência, Encanto, Universo): **mínimo de 15 dias corridos de produção**.
- Libri Retrospectivas (serviço principal futuro e adicionais novos): **mínimo de 15 dias corridos de produção**.
- O marco operacional correto é o **mais recente entre confirmação do pagamento e recebimento de briefing/materiais completos**.
- A data de entrega pode ficar além do 15º dia se a agenda estiver cheia. Não transformar mínimo em data garantida.
- Convites digitais e pedidos históricos conservam regras e datas já contratadas.

## Distribuição dos pontos
- Os pontos são unidades de capacidade partilhadas com os demais pedidos, NÃO dias nem horas.
- A janela pública de entrega continua com 3 dias. Para os novos serviços abrangidos, a alocação de pontos ocorre nos dias anteriores à primeira data de entrega, ao longo de até 15 dias, respeitando capacidade e bloqueios diários.
- O algoritmo reserva unidades proporcionalmente à capacidade disponível, sem ultrapassá-la, e não multiplica a cobrança pelo número de dias.
- Cargas de 3/5/8 pontos para Essência/Encanto/Universo continuam **sugestão**, não estão autorizadas no catálogo/Admin. Preços e escopo também exigem liberação comercial.

## Estado técnico (PR #141)
- Implementada política discriminada por serviço, cálculo inicial de opções, validação, reservas de checkout, retomadas e pedidos manuais novos.
- Snapshot dos novos pedidos permite preservar regras históricas e evita reinterpretar preços/contratos antigos.
- Proibido oferecer encaixe urgente automático que burle os 15 dias nesses serviços.
- O checkout do Ateliê alerta que a data pré-briefing é uma previsão.

## Bloqueio antes da venda do produto principal
**PENDENTE:** revalidar e, se necessário, reagendar a promessa de entrega e redistribuir os pontos quando o briefing e os arquivos estiverem completos, respeitando o marco operacional acima. A mudança de data deve ser comunicada e aceita, sem sobrescrever reservas ou histórico; identificar material entregue em atraso, caso contrário não prometer entrega em 15 dias a partir do briefing.

Não liberar o Ateliê nem uma Retrospectiva independente apenas por este PR; ainda faltam preços, catálogo, termos, briefing próprio de Retrospectivas, pós-briefing, carrinho etc. Não declarar que as vendas estão ativas.
