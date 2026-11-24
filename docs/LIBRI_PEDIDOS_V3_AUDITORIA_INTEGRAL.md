# Auditoria de entrega integral da Libri Pedidos V3
Atualização 24/11/2026. PR #143, branch de refatoração, produção intocada.
Fontes: plano original Libri_Pedidos_V3_Plano_de_Reformulacao.md (23/11), protótipo apenas estrutural, correções recuperadas das conversas Reformular App De Pedidos / Refatoração do Libri Pedidos / Branch, TXT mestre e código do PR. A recuperação de conversas não é uma transcrição completa; detalhes estéticos não verificáveis não são considerados aprovados.

| Decisão | Evidência no código | Situação de entrega |
|---|---|---|
| Um app, três famílias, um pedido/pagamento | v3-cart-quote.js, v3-order-records.js, v3-checkout.js, checkout público comum | Corrigido desvio avulso V2/Ateliê; verificar novo CI e teste real |
| Compra por evento e intenção | client-v3.js | Implementado; ainda verificar todo evento, modelo e navegação |
| Explicar recursos antes do aceite; adicionais sem checklist | perguntas guiadas convite; opções em pop-up; extraFlow Ateliê/Retro | Corrigido; validar preço, retorno, recusa, upgrade, cancelamento do modal |
| WhatsApp gratuito diferente de RSVP | confirmação no fluxo interativo; R$ 0,00 e instrução de enviar | Implementado, validar todos formatos |
| Preço oficial, total contínuo, combinação sem desconto duplicado | quoteV3Cart e renderBasket, preço no Pix | Implementado, validar reedição e múltiplas famílias |
| Catálogos aprovados, nenhuma simulação no Ateliê, mascotinho opcional | migrations/catalogue, v3-extras-catalog.js, briefing | Implementado, verificar correspondência de todos entregáveis com decisões |
| 15 dias Ateliê/Retro após pagamento/briefing/materiais; dias úteis de capacidade | v3-production-policy.js, v3-service-agenda.js | Implementado, validar fronteiras e dependência entre famílias |
| Urgência aprovada de convite +30%, sem reduzir mínimo das demais famílias | V2 possui fluxo de solicitação/aprovação; V3 preview identifica needsUrgencyReview, mas não oferece solicitação integrada | BLOQUEADOR DE PUBLICAÇÃO: implementar aprovação integrada ou solução explicitamente compatível com regra; não substituir silenciosamente por recusa nem gerar cobrança |
| Checkout com Pix/cartão integral; 50% excepcional no Admin, sem cobrança duplicada | v3-admin-payment-policy.js, v3-order-payment.js, v3-checkout.test.mjs | Backend e testes simulados; testar recuperação, Pix, cartão, edição e capacidade |
| Black Libri, cupom e desconto combinado 5%/10% | v3-promotions.js, v3-black-libri.js | Implementado com flags desativadas; 8 estimativas de pontos provisórias precisam confirmação, não ativar sem validação |
| Briefing por serviço, após pagamento, sem repetição | v3-modular-briefing.js, client-v2-area-v3.js, admin-v2-order-v3.js | Backend/UI implementados; validação de formulários, upload e experiência real ainda necessária |
| Retro materiais WhatsApp, prévia/entrega WhatsApp ou Drive, sem R2 | v3-retro-external-media.js, v3-service-delivery.js, v3-retro-standalone.test.mjs | Testes simulados implementados |
| Agenda, produção, aprovação, entrega, prazo downloads e histórico | módulos V3 e testes | Implementados, verificar ações reais e isolamento |
| Central única, busca modelo/cena/data, financeiro, funil e notificações | admin-v2-central.js, v2-admin-search.js, v2-finance.js, v3-finance-report.js | Testes automatizados anteriores verdes; visual e custo de consultas D1 não validados |
| Complementos, upgrades, novos serviços, revisão de contratação e cancelamento pago | v3-supplement-payment.js, v3-paid-cancellation.js | Testes simulados implementados; conciliação de taxas/reembolsos complementares e datas ainda pendentes |
| Visual premium sem lavanda, mobile-first, paleta oficial | CSS V3 alinhado com V2; estrutura original com resumo | Não aprovado visualmente; capturas de código real em Chromium, não desenho ilustrativo |
| Privacidade e proteção | funil sem conteúdo de formulários, rate limit, retenção | Verificar namespace e transparência também no fluxo legado |
| Publicação integral | PR rascunho, flags desativadas, sem deploy | BLOQUEADA até CI, navegação real, pendências técnicas/comerciais e validação integral |

## Verificação
CI anterior V49: 45421872762, aprovado. Novo teste de checkout avulso encontrou a condição order_multi_required no servidor; removida no commit 74dc404. CI 45423470153 falhou nesse teste, não considerar válido. O workflow de verificação existente foi estendido com Chromium real, servidor local, catálogo SQLite em memória, nenhuma API de escrita financeira permitida, acesso externo bloqueado, capturas do código real como artefato quando geradas. Nunca publicar por passar apenas testes estáticos.

## Correção das fontes visuais (V52)
Recuperados na biblioteca os protótipos posteriores Libri_Pedidos_V3_Premium.html (19:52), Libri_Pedidos_V3_Com_Sua_Identidade.html (20:00), Libri_V3_Conversa_Refinada.html (20:36) e Libri_V3_Compra_Guiada_Sem_Briefing.html (20:40, 23/11). Este último contém as marcas efetivamente fornecidas pela usuária e a direção escura cinematográfica, creme/rosé/terracota, sem lavanda. Utilizar o último como referência de aparência e o relato de correções de 20:54 como precedência para o fluxo. Não utilizar o protótipo de 19:37 como design definitivo. A pesquisa de conversas retornou resumos, não a transcrição integral; não declarar auditoria literal completa. Aplicados os PNGs originais do HTML (sem redesenho), abertura, cabeçalho, painel de resumo, paleta e ramificação explícita para chá de panela/bebê/revelação e outras celebrações preservando tipos de evento V2. Correções ainda não testadas. Política de privacidade, cookies/preferências, exemplos de modelos e urgência seguem pendentes. CI 45424092816 passou testes automatizados/migrations mas falhou em instabilidade do botão Consultar agenda no Chromium; ajustada espera por carregamento e rolagem, não declarar resolvido até testar.

## V53 — Privacidade e portfólio real
Implementada preferência compartilhada entre loja V2/V3. Sem aceite explícito não cria identificador de jornada nem envia etapas; recusa não bloqueia a compra, revogação interrompe eventos futuros. Retenção explicada, armazenamento essencial e pagamento externo separados, política informativa sujeita a revisão jurídica antes de publicação. Métricas passam a dizer amostra de jornadas com permissão e sem nova etapa registrada (não ausência de atividade). Modal de exemplos usa apenas API de galeria ativa por produto/evento, não fabrica mídia. V52 CI 45425322815 falhou no teste unitário checkout por acesso direto a document fora do browser; corrigido com root.ownerDocument. CI final pendente. Continua faltando validação real, urgência V3, revisão integral da área cliente/admin e conciliação. Não publicar.

## V54 — Verificação de regressões
CI V53 45425771151 falhou em contrato de carregamento da página legada (somente uma folha de estilo), após acrescentar CSS de privacidade. Mantida uma única folha no HTML V2, com import no CSS principal. Corrigida invalidação de agenda no checkout quando muda a data: remove janelas anteriores e bloqueia pagamento sem renderizar todo formulário e perder o clique/foco. A recuperação adicional das conversas confirmou escopo integral, preservação V2, preços finais Ateliê e fluxo sem checklist. Ainda não é transcrição integral nem comprovação visual. Não liberar enquanto CI/browser e urgência estiverem pendentes.

## V55 — urgência
Implementada solicitação de encaixe de convite avulso no checkout V3: valor projetado pelo servidor, taxa oficial padrão 30%, aceite explícito, pedido bloqueado sem cobrança, decisão administrativa, recuperação após aprovação, reserva revalidada e agenda de produção preservada. Ateliê e retrospectiva continuam sem atalhos de urgência (prazo mínimo protegido); combinação sem capacidade regular exige revisão humana, não gera cobrança. Novo teste cobre tentativa sem cobrança, idempotência, aprovação e criação simulada de uma única cobrança. CI e UI ainda precisam validação; sem publicação.

## V56 — consistência operacional
Corrigidos filtros cruzados por mesma linha, exclusão de históricos financeiros inválidos das filas de produção, redução de consultas D1 na Central, data de aplicação dos complementos e distinção de devolução a conciliar. Recuperação de encaixe rejeitado verificada sem cobranças e sem reservas antes de permitir nova tentativa. Novas regressões cobrem solicitação de urgência indevida/rejeitada. CI final e navegador pendentes.

CI V55 45427531167 aprovado, incluindo Chromium real (convite avulso e Ateliê). CI 45428142409: 426 aprovados, 1 ignorado, 1 falha na data de aplicação do complemento; fixture ajustada para testar meses distintos. Rota autenticada de urgência e filtros passaram. Revisão comum não pode substituir aprovação de encaixe. Ainda pendem jornada combinada/retrospectiva/Admin/cliente no navegador e conciliação real. Sem publicação.

## V59 — pagamento tardio e capacidade
Reconstrução V3 usa prazo de produção original e valida janela, em vez de cair no planejador de convite. Revisão aparece na Central e área privada; recuperação administrativa sem cobrança, janela alternativa normal com acordo explícito, sem alterar preço e preservando histórico. Teste de regressão e fixture Chromium ajustados. CI pendente. Sem publicação.

## V60 — financeiro
Complementos conciliados exclusivamente por referência única, valor e detalhe confirmado do provedor; valores desconhecidos continuam a conciliar. Líquido e taxa efetiva (bruto menos líquido), data de aprovação verificada e rotina limitada de recuperação. Estornos ainda requerem evidência; nenhum acesso financeiro real. V59 passou Chromium ampliado. CI V60 pendente.

## V61 — Estado confirmado
V60 HEAD 99401f9c363d0c08503bceb02ef2457119ddea12, CI 45441144468 SUCCESS, inclusive Chromium e migrations. Não houve acesso a cobranças reais. PR ainda draft. Próxima prioridade: gate de publicação V3 para SHA efetivo, configuração Cloudflare/backup e ativação segura do catálogo, revisar pendências comerciais e operacionais e evidências visuais. Não publicar parcialmente.

## Gate de release
V61 CI 45443115366 aprovado. V62 adiciona gate V3 no workflow de publicação, preflight manual somente leitura por padrão, restrição de publicação à main, bookmark antes de migrations e rotas V3 explicitadas no Worker. Nenhuma escrita de produção ou confirmação de configuração remota. As flags/catalogação e a Black Libri permanecem bloqueadas até as verificações comerciais e remotas. CI V62 a confirmar.

## Aprovação comercial e configuração de lançamento
24/11: pontos de produção dos oito brindes exclusivos confirmados expressamente pela usuária, sem mudança de probabilidades, cobrança ou vigência. CI V63 45444918447 success. V64 configura release integral, ativa flags somente no código da branch, preserva URLs V2 específicas e privadas, inclui smoke pós-deploy sem cobranças e confere presença dos secrets de pagamento. CI e validação remota pendentes; não declarar publicado.

## V65–V67 — correções após rejeição visual da loja real
PR #143 mesclado, PR corretivo #144 em branch separada. Duração 3/6/personalizada e navegação direta, extras opcionais concentrados, formatos ilustrados e ficha Admin em abas, sem mexer no backend. V65 falhou legenda Ateliê, V66 falhou valor explícito WhatsApp; V67 corrige e amplia Chromium. CI novo pendente; não declarar experiência aprovada ou completa. Pendem Central, pacotes, checkout e comparação visual original.


## V81 — revisão administrativa após V80 em produção
V80 confirmada no run 45471175718. Decisão recuperada: Central, Pedidos, Produção, Agenda, Financeiro, Loja; +Novo pedido separado, Ateliê dentro da Loja. Não criar outro Admin. V81 corrige desvios concretos de navegação e entrada manual, modo noturno, marca, fonte e estados. Reutiliza API e busca/filas existentes. Não alegar cobertura de todas as telas: revisar ficha, produção, agenda, financeiro, catálogo (incluindo retrospectivas), edição e exceções, testar desktop/mobile e confirmar CI. Nenhuma mudança de dados ou regras comerciais. Branch feature/v81-admin-integrado-20261124.

V82: financeiro segmentado e correção de regex de abertura de pedido, produção com abas por família, agenda com ferramentas avançadas contextualizadas, catálogo com variantes recolhíveis, ficha V3 com Alterações separadas e ação por estado. Pendências: validar Chromium, admin de retrospectivas (catálogo próprio não é igual ao addon legado), fluxo manual, ficha legada, contraste de componentes específicos e testes da loja. Não alterar preços ou política de venda.
