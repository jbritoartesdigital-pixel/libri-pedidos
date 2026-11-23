# Libri Pedidos V3 | Integração do Libri Ateliê

**Estado:** prévia sem venda automática; fluxo V2 e trabalho V3 preservados.
**Catálogo:** Manual Único V4 consultado, mas sua tabela de pacotes está marcada como estudo. Versão comercial V4.1 ainda não validada. Nunca publicar preços ou quantidades em estudo.

## Arquitetura

O banco V2 já registra um produto principal por pedido e adicionais. A integração do Ateliê não presume múltiplos produtos principais num pedido, nem cria outro checkout ou Admin.

Produtos, variantes e capacidade ficam no mesmo banco D1; pagamentos e confirmação via Mercado Pago continuam no checkout existente, sem alterações. Briefings e mídias protegidas usam a infraestrutura existente após a integração final.

## Implementado na V3 isolada

- Migração 0033: três rascunhos Essência, Encanto e Universo sem preço, revisões ou capacidade.
- Biblioteca de catálogo e endpoint público de apresentação sem preço e sem compra.
- API administrativa de rascunhos sob autenticação Passkey já existente.
- Aba Libri Ateliê na Loja do Admin V2, para configurar descrição, itens, exclusões, preço interno, capacidade, revisões e versão de escopo.
- Duas categorias principais na prévia V3: Convites Digitais e Identidade Visual. Retrospectiva preservada como opção secundária ainda em desenvolvimento.
- Blueprint de briefing artístico adaptativo, ainda não conectado a pagamentos, dados ou uploads.
- Não altera produtos, adicionais, combos, cupons, pedidos ou valores da V2.

## Gate comercial obrigatório antes da próxima fase

1. Conferir catálogo V4.1 com quantidades, conteúdos, arquivos de entrega e revisões.
2. Aprovar preços, adicionais compatíveis, exclusões, regras de promoções e condições.
3. Estimar e testar carga de trabalho por pacote; não usar contagem de cenas.
4. Integrar produto principal e adicionais ao catálogo e cálculo oficiais com validação no servidor.
5. Reaproveitar checkout, Mercado Pago, agenda, reserva, Pix, notificações, contratos, histórico e área da cliente.
6. Conectar briefing artístico à área privada com salvar e continuar e arquivos protegidos.
7. Integrar fases artísticas, revisões, prévias e aprovação ao mesmo detalhe de pedido no Admin.
8. Exigir consentimento específico para eventual divulgação; fotos de crianças não autorizam portfólio.
9. Executar testes completos do fluxo e regressão V2 antes de publicação.
10. Fazer backup D1 e publicar manualmente, apenas com autorização.

## Limites que nunca são inclusões automáticas

Impressão física, fabricação, arquivo Silhouette, decoração executiva, convites cinematográficos ou interativos, personagens complexos a partir de fotos, poses extras e peças especiais. Todos os pacotes incluem apresentação visual e uma simulação conceitual de decoração, não uma montagem real. O case de Instagram é material interno, não produto cobrado nem publicação autorizada automaticamente.


## Evolução do Admin e produção artística (fase segura)

A migração 0034 acrescenta tabelas artísticas vinculadas ao ID do pedido V2, sem alterar o status geral da venda, os pagamentos e a agenda.

- API já existente e protegida por Passkey: GET/PATCH /api/admin/v2/atelie/orders/{LIBRI-ID}/production.
- Serviço de etapas: briefing criativo, direção de arte, criação, revisão, aprovação, preparação de arquivos finais.
- Regras: edição só para pedido cujo produto principal efetivo seja do Ateliê e com pagamento aprovado; pedidos de convites não abrem essas etapas.
- Revisionamento: contador com limite proveniente do snapshot contratual. Se o contrato não definir revisões, registrar revisão é bloqueado.
- Histórico: alterações artísticas e pedidos de orçamento extra ficam registrados, sem lançar cobrança financeira automaticamente.
- Otimismo: cada gravação exige versão atual para evitar sobrescrever uma edição simultânea.
- Tela: o mesmo detalhe de pedido apresenta o painel artístico e seu histórico somente para produto Ateliê; briefings cinematográficos não são exibidos como briefing do Ateliê.
- A área administrativa de busca de funções também encontra Libri Ateliê.

**Importante:** ainda não há produtos Ateliê ativos no checkout, logo não há pedidos reais dessa categoria para usar o novo acompanhamento. O módulo está preparado para ativação após os gates comerciais e testes ponta a ponta.

### Testes adicionados e verificação local parcial

- tests/atelie-art-production.test.mjs: convites protegidos, pagamento obrigatório, estados, revisões, limite, histórico, concorrência.
- tests/atelie-v3.test.mjs: catálogo e preços protegidos, aprovação de escopo, briefing, autenticação Passkey.
- Sintaxe dos módulos alterados verificada com parser JS de maneira isolada; smoke tests de lógica executados; SQL de concorrência e exclusão em cascata conferidos em SQLite local.
- A suíte completa npm run check e npm test ainda depende de um checkout completo do repositório e ambiente de dependências; sem CI de PR reportado. **Nenhum deploy ou merge autorizado.**


## Área da Cliente: rascunho criativo vinculado ao pedido (fase atual)

- Migração 0035: tabela v3_atelie_briefings, associada ao mesmo ID de pedido V2, preservando os dados e briefings dos convites.
- GET/PATCH /api/v2/customer-area/{token}/atelie/briefing: usa o link privado já criado pelo pedido; aceita somente produto principal real do Ateliê e pagamento aprovado. Pedido não pago permanece bloqueado.
- O formulário na aba Preencher dados da Área da Cliente passa a mostrar perguntas do Ateliê nos pedidos Ateliê, sem substituir abas de pagamento, prévias, contratos e recursos dos convites.
- Etapas curtas: celebração, tema e personagens, cores e estilo, referências, aplicações e privacidade. Pré-preenche nome e data do próprio pedido, sem duplicar compra.
- Respostas são salvas ao avançar e ao voltar, com versão para evitar sobrescrever respostas em outras abas. Não armazena fotos em localStorage.
- GET /api/admin/v2/atelie/orders/{código}/briefing: leitura interna pela Passkey existente, sem expor token da cliente. O detalhe do pedido mostra as respostas legíveis em abas e pode atualizar.
- Não conclui o briefing, não altera status V2 nem gera evento financeiro. Uploads e submissão final **continuam desabilitados** até integração segura com R2, controle de consentimento e aprovação do catálogo comercial.
- Arquivos de teste: tests/atelie-customer-briefing.test.mjs (salvar, continuar, privacidade, concorrência, bloqueio pré-pagamento, visualização do Admin e isolamento dos convites).

### Condição de homologação

É necessário um checkout completo do repositório com as dependências para executar npm run check, npm test, dry-run do Worker e testes reais em Android/iPhone. O ambiente de execução desta conversa não consegue baixar o repositório GitHub, e nenhum CI foi reportado no branch. Por isso a fase continua em PR de rascunho, sem merge, migração remota ou publicação.
