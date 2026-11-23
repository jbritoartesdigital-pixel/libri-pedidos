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
- Blueprint artístico adaptativo já conectado a rascunhos do pedido; a conclusão final permanece bloqueada.
- Não altera produtos, adicionais, combos, cupons, pedidos ou valores da V2.

## Gate comercial obrigatório antes da próxima fase

1. Conferir catálogo V4.1 com quantidades, conteúdos, arquivos de entrega e revisões.
2. Aprovar preços, adicionais compatíveis, exclusões, regras de promoções e condições.
3. Estimar e testar carga de trabalho por pacote; não usar contagem de cenas.
4. Integrar produto principal e adicionais ao catálogo e cálculo oficiais com validação no servidor.
5. Reaproveitar checkout, Mercado Pago, agenda, reserva, Pix, notificações, contratos, histórico e área da cliente.
6. Briefing criativo privado, salvar/continuar e imagens R2 preparados no branch; homologação de segurança e usabilidade pendente.
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
- Não conclui o briefing, não altera status V2 nem gera evento financeiro. Upload privado implementado no branch; submissão final e venda ainda desabilitadas até homologação.
- Arquivos de teste: tests/atelie-customer-briefing.test.mjs (salvar, continuar, privacidade, concorrência, bloqueio pré-pagamento, visualização do Admin e isolamento dos convites).

### Condição de homologação

É necessário um checkout completo do repositório com as dependências para executar npm run check, npm test, dry-run do Worker e testes reais em Android/iPhone. O ambiente de execução desta conversa não consegue baixar o repositório GitHub, e nenhum CI foi reportado no branch. Por isso a fase continua em PR de rascunho, sem merge, migração remota ou publicação.


## Fase privada de R2: referências e fotos (branch de testes)

- Migração 0036_atelie_v3_private_uploads.sql: tabela própria de arquivos, vinculada ao pedido V2. Não altera uploads cinematográficos.
- Mesmo bucket FILES (R2) e chaves internas aleatórias sob orders/{id}/atelie/{campo}. Não há URL pública do bucket.
- Área da Cliente: POST imagem, GET conteúdo, DELETE arquivo sob o mesmo token privado do pedido; requer produto Ateliê real e pagamento confirmado.
- Imagens JPG/PNG/WebP/HEIC/HEIF, checagem de assinatura inicial, máximo de 15 MB e limites de 6 inspirações e 4 fotos da criança.
- Fotos da criança exigem pacote compatível, autorização de uso privado e confirmação de responsabilidade legal/autorização do responsável. Para revogar, exclua primeiro as imagens vinculadas. A cliente pode apagar suas imagens mesmo depois da conclusão do pedido.
- Admin Passkey visualiza imagens e respostas no detalhe do mesmo pedido, sem precisar do link privado da cliente.
- Cache privado/no-store, nosniff e ausência de publicação automática. Envios não mudam status V2, valores, prazo ou descontos.
- Remoção de imagens exclui o objeto R2 e o registro no D1, com limpeza de objetos órfãos pendente de procedimento de auditoria.
- Atenção: metadados embutidos, como EXIF e potencial localização, ainda não são eliminados automaticamente. Avaliar antes da publicação.
- Testes: novos testes Node sobre isolamento, permissão, imagens disfarçadas, limites e exclusão; smoke tests de lógica e SQL SQLite executados nesta conversa.
- PENDENTE: npm run check, npm test, Worker/R2 real, testes Android/iPhone e avaliação de retenção de dados.

**Sem merge, migração remota ou deploy até homologação completa e autorização explícita.**


## Fase seguinte: conclusão do briefing → produção e aceite da prévia

- Migração 0037_atelie_v3_briefing_submission.sql: estado e histórico auditável de envio/reabertura por pedido. Não atualiza o status financeiro/comercial V2.
- Cliente: ação de envio somente quando as respostas obrigatórias estiverem salvas; confirmação explícita, recibo, proteção contra envios repetidos e bloqueio de edição após envio.
- Admin: estado Enviado/Rascunho na ficha, reabertura justificada para complementos (somente enquanto a etapa artística ainda é Briefing).
- Após envio, novas fotos/respostas ficam bloqueadas até reabertura; a cliente pode remover imagens privadas mesmo quando o pedido é encerrado.
- Notificações reaproveitam o mecanismo V2 (evento BRIEFING_COMPLETED). Uma falha de notificação não perde o envio gravado no banco.
- A etapa Direção de Arte requer duas evidências: briefing submetido E alocação de agenda confirmada. Pagamento isolado não autoriza produzir.
- A etapa Aprovação exige prévia ativa; a passagem da aprovação para entrega exige que a versão MAIS RECENTE da prévia tenha registro de aprovação da cliente no sistema V2.
- Não se cria outra ferramenta de prévias ou aprovação: a estrutura V2 existente é reutilizada; status do pedido, pagamentos, contratos e webhook não são alterados automaticamente.
- A Área da Cliente distingue briefing recebido e pendente, sem apresentar perguntas de convite cinematográfico para o Ateliê.
- Testes acrescentados: tests/atelie-briefing-submission.test.mjs e cenários de agenda/aprovação em tests/atelie-art-production.test.mjs.
- Verificações isoladas: 6 cenários de envio/reabertura e 9 de produção/aprovação passaram em mocks; duas operações de submissão e reenvio passaram em SQLite local.
- Ainda pendente: npm run check/npm test, homologação de notificações, R2 real, Worker, permissões e testes no navegador. Não habilitar venda nem publicar antes dos gates comerciais e técnicos.

**O sistema ainda não possui produtos Ateliê ativos para compra. A implementação permanece isolada no PR #137.**
