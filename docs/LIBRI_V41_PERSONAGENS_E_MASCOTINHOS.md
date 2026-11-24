# Libri Ateliê V4.1 e Convites | Pessoas, mascotinhos e personagens extras

**Decisões comerciais expressas em 23/11/2026.** Este documento complementa o catálogo V4.1 e o plano da V3, sem alterar nem liberar os produtos já vendidos. Não atribuir automaticamente preços a extras.

## 1. Valores-base propostos para manter
| Pacote | Valor-base indicado pela proprietária | Ilustração principal inclusa | Poses da mesma ilustração |
| --- | ---: | --- | ---: |
| Essência | R$ 159 | 1 | 1 |
| Encanto | R$ 299 | 1 | 2 |
| Universo | R$ 549 | 1 | 3 |

Um sujeito ilustrado principal pode ser **mascotinho da criança** (desenhado com referências fotográficas e autorização) OU **ilustração temática principal equivalente** quando a cliente não quiser fotos da criança. A opção é feita no briefing. Poses são variações do MESMO sujeito, não personagens novos. A assinatura comemorativa (nome + ocasião) também integra todos os pacotes, além de brasão, logotipo e monograma.

**Atenção:** preços escolhidos não significam que preço, quantidade de horas, capacidade e termos estejam cadastrados ou liberados no Admin. A carga e margem devem ser medidas. Nunca ativar pacote apenas pela aprovação de valores em conversa.

## 2. Quando pedir orçamento de personagem adicional
- Segunda criança ilustrada, irmão/irmã ilustrado(a), cão, gato, papagaio ou outro animal ilustrado com identidade própria;
- nova ilustração individual sob encomenda fora da composição temática prevista e do escopo contratado;
- poses extras acima do limite contratado precisam de adicional específico, diferente do adicional por sujeito.
- Roupa, fantasia e caracterização temática do MESMO personagem principal não contam automaticamente como outro sujeito; complexidades fora do pacote podem exigir avaliação individual previamente explicada.
- Exemplo da Tiana e Kurama na prancha: Kurama original já prevista como elemento da composição temática NÃO é adicional, mesmo que Tiana também apareça; Tiana caracterizada como Kurama não gera uma segunda personagem por causa da fantasia. Cobrar apenas se houver nova ilustração individual encomendada fora do escopo aprovado. A quantidade de figuras visíveis na cena não equivale à quantidade de adicionais cobrados.
- Personagens temáticos já incluídos no conceito da festa não devem ser reclassificados como extras no briefing; evitar cobrar por reaproveitamento ou composição de elementos já planejados.
- Não dar preço automático a figuras adicionais sem catálogo, custos e aceite. Enviar proposta no MESMO pedido, com preço, descrição e prazo, antes de criar ou cobrar.
- Franquias e personagens de terceiros podem exigir autorização/licença; não prometer cessão de direitos de propriedade intelectual não pertencentes à Libri.

## 3. Homenageados versus personagens desenhados
Convite com dois ou mais nomes ou aniversariantes NÃO aciona automaticamente cobrança de segundo sujeito ilustrado.
A árvore comercial e o briefing devem distinguir:
1. Número de homenageados/nome, idade, ocasião, textos;
2. Quem aparece ilustrado e com qual papel, incluindo se os irmãos aparecerão juntos;
3. Quantidade de sujeitos ilustrados incluída no contrato;
4. Sujeitos adicionais solicitados para orçamento, pendentes de aceite.
Quando os dois irmãos forem ilustrados individualmente, contratar ou aprovar a ilustração extra primeiro. Não presumir segundo mascotinho incluso em pacote de um só.

## 4. Briefing e privacidade
Ateliê: pergunta 'criança ilustrada ou ilustração temática', se são vários homenageados, quem é a criança principal, se deseja outras crianças/animais/personagens, quem são e quantos. Pedir fotos somente após pagamento, escolha afirmativa e autorização do responsável. Fotos de personagens extras apenas após aceite do adicional.
Convites: identificar festa de irmãos/mais de um aniversariante, nomes e idades de todos, e perguntar SE querem personagens adicionais ilustrados. Exibir campos de referência conforme o produto contratado.
Nunca transformar resposta de orçamento em contratação ou inserir valor no checkout por inferência. Não compartilhar fotos privadas no portfólio sem autorização específica.
Quando a mesma ilustração for reutilizada em produtos da Libri no mesmo pedido, avaliar esforço de adaptação sem cobrar novamente a mesma criação automaticamente.

## 5. Implementação técnica desta etapa
- Branch: `feature/libri-v41-multiplos-personagens-20261123`.
- Schema adaptativo de briefing Ateliê; campos de solicitação de orçamento; autorização de imagens da criança condicionada à modalidade escolhida; snapshot futuro registra poses e direito a uma figura principal.
- Briefing de convite reconhece vários aniversariantes e separa nomes da quantidade de sujeitos ilustrados.
- Testes de esquemas, fotografias e snapshot.
- **Ainda pendente**: preço-base a cadastrar por pacote na produção, capacidade validada, preços dos adicionais, motor de orçamento/aceite/cobrança real, upload individualizado por pessoa/animal extra e sua autorização, eventual carrinho com vários serviços. Não ligar cobrança automática nem declarar fluxo de extras pronto antes desses itens.

