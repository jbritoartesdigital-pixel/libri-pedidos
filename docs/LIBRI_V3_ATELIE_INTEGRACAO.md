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
