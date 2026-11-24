// Catálogo comercial Libri Ateliê V4.1, revisão 2026-11-23.
// Preços, direitos e entregáveis definidos em conversa; pontos continuam sem
// aprovação definitiva. NÃO libera vendas, altera D1 ou cobra extras por si só.
export const ATELIE_V41_APPROVED_CATALOG = Object.freeze({
  essencia: {
    name: 'Essência',
    priceCents:15900,
    pointsUnits:null,
    revisionLimit:1,
    mascotPoses:3,
    shortDescription:'Identidade visual digital personalizada com brasão, logotipo, monograma, 3 poses da criança ilustrada, elementos, estampa, paleta e tipografia.',
    includedItems:[
      '1 brasão principal',
      '1 logotipo com nome decorado',
      '1 monograma personalizado',
      '1 assinatura comemorativa com nome e ocasião',
      '1 ilustração principal: criança ilustrada (3 poses) OU ilustração temática equivalente (3 variações)',
      '2 elementos ilustrados simples',
      '1 estampa coordenada',
      '1 paleta de cores identificada por códigos',
      '1 seleção tipográfica para a identidade',
      '1 apresentação da identidade em PDF',
      '1 simulação conceitual digital de decoração',
      '1 rodada de ajustes'
    ],
    excludedItems:[
      'Artes de papelaria digital individuais (não incluídas no Essência)',
      'Impressão, fabricação ou montagem física',
      'Decoração executiva ou montagem de evento',
      'Convite cinematográfico ou interativo',
      'Arquivos editáveis, fontes comerciais e arquivos de corte',
      'Novas ilustrações individuais fora do escopo, outras crianças ou pets sob encomenda',
      'Poses ou revisões além da quantidade contratada'
    ]
  },
  encanto: {
    name:'Encanto',
    priceCents:29900,
    pointsUnits:null,
    revisionLimit:1,
    mascotPoses:4,
    shortDescription:'Identidade visual ampliada com 4 poses, mais elementos e estampas, paleta, tipografia e 2 artes de papelaria à escolha.',
    includedItems:[
      '1 brasão principal',
      '1 logotipo com nome decorado',
      '1 monograma personalizado',
      '1 assinatura comemorativa com nome e ocasião',
      '1 ilustração principal: criança ilustrada (4 poses) OU ilustração temática equivalente (4 variações)',
      '5 elementos ilustrados simples',
      '2 estampas coordenadas',
      '2 artes digitais simples de papelaria à escolha',
      '1 paleta de cores identificada por códigos',
      '1 seleção tipográfica para a identidade',
      '1 apresentação da identidade em PDF',
      '1 simulação conceitual digital de decoração',
      '1 rodada de ajustes'
    ],
    excludedItems:[
      'Impressão, fabricação ou montagem física',
      'Decoração executiva ou montagem de evento',
      'Convite cinematográfico ou interativo',
      'Arquivos editáveis, fontes comerciais e arquivos de corte',
      'Novas ilustrações individuais fora do escopo, outras crianças ou pets sob encomenda',
      'Poses, modelos de papelaria ou revisões além da quantidade contratada',
      'Embalagens complexas ou facas especiais sem orçamento'
    ]
  },
  universo: {
    name:'Universo',
    priceCents:54900,
    pointsUnits:null,
    revisionLimit:2,
    mascotPoses:5,
    shortDescription:'Identidade visual mais completa com 5 poses, brasão alternativo, monogramas, mais estampas, elementos e 4 artes de papelaria.',
    includedItems:[
      '1 brasão principal e 1 variação secundária',
      '1 logotipo com nome decorado',
      '2 variações de monograma personalizado',
      '1 assinatura comemorativa com nome e ocasião',
      '1 ilustração principal: criança ilustrada (5 poses) OU ilustração temática equivalente (5 variações)',
      '8 elementos ilustrados simples',
      '3 estampas coordenadas',
      '4 artes digitais simples de papelaria à escolha',
      '1 paleta de cores identificada por códigos',
      '1 seleção tipográfica para a identidade',
      '1 apresentação da identidade em PDF',
      '1 simulação conceitual digital de decoração',
      '2 rodadas de ajustes'
    ],
    excludedItems:[
      'Impressão, fabricação ou montagem física',
      'Decoração executiva ou montagem de evento',
      'Convite cinematográfico ou interativo',
      'Arquivos editáveis, fontes comerciais e arquivos de corte',
      'Novas ilustrações individuais fora do escopo, outras crianças ou pets sob encomenda',
      'Poses, modelos de papelaria ou revisões além da quantidade contratada',
      'Embalagens complexas ou facas especiais sem orçamento'
    ]
  }
});

export const ATELIE_V41_COMMON_TERMS = [
  'Entrega exclusivamente digital, sem marca-d\'água, em pasta organizada.',
  'Mascotinho, brasão, logotipo, monograma e elementos em PNG de alta resolução, com fundo transparente quando adequado.',
  'Estampas e composições em PNG/JPG de alta resolução, de acordo com o uso definido.',
  'Artes de papelaria contratadas em PDF dimensionado para impressão, conforme medidas e textos fornecidos no briefing.',
  'Apresentação da identidade em PDF e uma simulação conceitual digital de decoração.',
  'Paleta com códigos de cores e seleção tipográfica por nomes/referências, sem distribuição de arquivos de fontes licenciadas.',
  'Licença de uso pessoal para a festa e reprodução dos personalizados da própria comemoração; sem revenda, sublicença ou transferência de editáveis.',
  'Cada rodada de revisão permite agrupar ajustes ao conceito aprovado. Correções de erros da Libri não consomem rodada.',
  'Prazo mínimo de 15 dias corridos de produção a partir do pagamento confirmado e do briefing e materiais completos. Entrega posterior quando a agenda exigir; previsão pré-briefing sujeita à confirmação.',
  'Com mascotinho, a ilustração representa uma criança, com poses da mesma criança. Sem mascotinho, há variações equivalentes da ilustração temática.',
  'Personagens do tema previstos na composição não geram adicionais por sua simples presença. Novas ilustrações individuais fora do escopo exigem orçamento e aceite.',
  'Fotos de crianças são usadas de forma privada somente com autorização; portfólio e divulgação dependem de autorização específica.',
  'Modelos de papelaria são artes digitais simples escolhidas pela cliente; projeto técnico de embalagem e facas especiais requerem orçamento.',
  'Adicionais, revisões extraordinárias e outros personagens só são produzidos e cobrados após orçamento aprovado.',
  'Peças sujeitas a direitos de terceiros não transferem à cliente direitos autorais que não pertencem à Libri.'
].join('\n');

export function getAtelieV41CatalogDraft(code) {
  const p=ATELIE_V41_APPROVED_CATALOG[code];
  if(!p)return null;
  return {
    shortDescription:p.shortDescription,
    priceCents:p.priceCents,
    includedItems:[...p.includedItems],
    excludedItems:[...p.excludedItems],
    revisionLimit:p.revisionLimit,
    scopeReference:'Libri Ateliê V4.1 | Catálogo comercial aprovado em 23/11/2026',
    specificTerms:ATELIE_V41_COMMON_TERMS,
    // Não aprovar pontos nem ativar venda: produção e briefing tardio pendentes.
    scopeApproved:false,
    showcaseVisible:true
  };
}
