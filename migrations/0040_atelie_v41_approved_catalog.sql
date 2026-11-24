-- Catálogo V4.1 e capacidade aprovados. Aplicação automática na migration.
-- Não modifica vendas ativas, produtos V2, pedidos, pagamentos ou snapshots antigos.
UPDATE v3_atelie_packages SET short_description='Identidade visual digital personalizada com brasão, logotipo, monograma, 3 poses da criança ilustrada, elementos, estampa, paleta e tipografia.',
 included_json='["1 brasão principal","1 logotipo com nome decorado","1 monograma personalizado","1 assinatura comemorativa com nome e ocasião","1 ilustração principal: criança ilustrada (3 poses) OU ilustração temática equivalente (3 variações)","2 elementos ilustrados simples","1 estampa coordenada","1 paleta de cores identificada por códigos","1 seleção tipográfica para a identidade","1 apresentação da identidade em PDF","1 simulação conceitual digital de decoração","1 rodada de ajustes"]',
 excluded_json='["Artes de papelaria digital individuais (não incluídas no Essência)","Impressão, fabricação ou montagem física","Decoração executiva ou montagem de evento","Convite cinematográfico ou interativo","Arquivos editáveis, fontes comerciais e arquivos de corte","Novas ilustrações individuais fora do escopo, outras crianças ou pets sob encomenda","Poses ou revisões além da quantidade contratada"]',
 price_cents=15900,points_units=300,revision_limit=1,
 scope_reference='Libri Ateliê V4.1 | Catálogo comercial aprovado em 23/11/2026',scope_approved=1,
 specific_terms='Entrega exclusivamente digital, sem marca-d''água, em pasta organizada.
Mascotinho, brasão, logotipo, monograma e elementos em PNG de alta resolução, com fundo transparente quando adequado.
Estampas e composições em PNG/JPG de alta resolução, de acordo com o uso definido.
Artes de papelaria contratadas em PDF dimensionado para impressão, conforme medidas e textos fornecidos no briefing.
Apresentação da identidade em PDF e uma simulação conceitual digital de decoração.
Paleta com códigos de cores e seleção tipográfica por nomes/referências, sem distribuição de arquivos de fontes licenciadas.
Licença de uso pessoal para a festa e reprodução dos personalizados da própria comemoração; sem revenda, sublicença ou transferência de editáveis.
Cada rodada de revisão permite agrupar ajustes ao conceito aprovado. Correções de erros da Libri não consomem rodada.
Prazo mínimo de 15 dias corridos de produção a partir do pagamento confirmado e do briefing e materiais completos. Entrega posterior quando a agenda exigir; previsão pré-briefing sujeita à confirmação.
Com mascotinho, a ilustração representa uma criança, com poses da mesma criança. Sem mascotinho, há variações equivalentes da ilustração temática.
Personagens do tema previstos na composição não geram adicionais por sua simples presença. Novas ilustrações individuais fora do escopo exigem orçamento e aceite.
Fotos de crianças são usadas de forma privada somente com autorização; portfólio e divulgação dependem de autorização específica.
Modelos de papelaria são artes digitais simples escolhidas pela cliente; projeto técnico de embalagem e facas especiais requerem orçamento.
Adicionais, revisões extraordinárias e outros personagens só são produzidos e cobrados após orçamento aprovado.
Peças sujeitas a direitos de terceiros não transferem à cliente direitos autorais que não pertencem à Libri.',showcase_visible=1,updated_at=datetime('now')
 WHERE code='essencia' AND sale_enabled=0;
UPDATE v3_atelie_packages SET short_description='Identidade visual ampliada com 4 poses, mais elementos e estampas, paleta, tipografia e 2 artes de papelaria à escolha.',
 included_json='["1 brasão principal","1 logotipo com nome decorado","1 monograma personalizado","1 assinatura comemorativa com nome e ocasião","1 ilustração principal: criança ilustrada (4 poses) OU ilustração temática equivalente (4 variações)","5 elementos ilustrados simples","2 estampas coordenadas","2 artes digitais simples de papelaria à escolha","1 paleta de cores identificada por códigos","1 seleção tipográfica para a identidade","1 apresentação da identidade em PDF","1 simulação conceitual digital de decoração","1 rodada de ajustes"]',
 excluded_json='["Impressão, fabricação ou montagem física","Decoração executiva ou montagem de evento","Convite cinematográfico ou interativo","Arquivos editáveis, fontes comerciais e arquivos de corte","Novas ilustrações individuais fora do escopo, outras crianças ou pets sob encomenda","Poses, modelos de papelaria ou revisões além da quantidade contratada","Embalagens complexas ou facas especiais sem orçamento"]',
 price_cents=29900,points_units=500,revision_limit=1,
 scope_reference='Libri Ateliê V4.1 | Catálogo comercial aprovado em 23/11/2026',scope_approved=1,
 specific_terms='Entrega exclusivamente digital, sem marca-d''água, em pasta organizada.
Mascotinho, brasão, logotipo, monograma e elementos em PNG de alta resolução, com fundo transparente quando adequado.
Estampas e composições em PNG/JPG de alta resolução, de acordo com o uso definido.
Artes de papelaria contratadas em PDF dimensionado para impressão, conforme medidas e textos fornecidos no briefing.
Apresentação da identidade em PDF e uma simulação conceitual digital de decoração.
Paleta com códigos de cores e seleção tipográfica por nomes/referências, sem distribuição de arquivos de fontes licenciadas.
Licença de uso pessoal para a festa e reprodução dos personalizados da própria comemoração; sem revenda, sublicença ou transferência de editáveis.
Cada rodada de revisão permite agrupar ajustes ao conceito aprovado. Correções de erros da Libri não consomem rodada.
Prazo mínimo de 15 dias corridos de produção a partir do pagamento confirmado e do briefing e materiais completos. Entrega posterior quando a agenda exigir; previsão pré-briefing sujeita à confirmação.
Com mascotinho, a ilustração representa uma criança, com poses da mesma criança. Sem mascotinho, há variações equivalentes da ilustração temática.
Personagens do tema previstos na composição não geram adicionais por sua simples presença. Novas ilustrações individuais fora do escopo exigem orçamento e aceite.
Fotos de crianças são usadas de forma privada somente com autorização; portfólio e divulgação dependem de autorização específica.
Modelos de papelaria são artes digitais simples escolhidas pela cliente; projeto técnico de embalagem e facas especiais requerem orçamento.
Adicionais, revisões extraordinárias e outros personagens só são produzidos e cobrados após orçamento aprovado.
Peças sujeitas a direitos de terceiros não transferem à cliente direitos autorais que não pertencem à Libri.',showcase_visible=1,updated_at=datetime('now')
 WHERE code='encanto' AND sale_enabled=0;
UPDATE v3_atelie_packages SET short_description='Identidade visual mais completa com 5 poses, brasão alternativo, monogramas, mais estampas, elementos e 4 artes de papelaria.',
 included_json='["1 brasão principal e 1 variação secundária","1 logotipo com nome decorado","2 variações de monograma personalizado","1 assinatura comemorativa com nome e ocasião","1 ilustração principal: criança ilustrada (5 poses) OU ilustração temática equivalente (5 variações)","8 elementos ilustrados simples","3 estampas coordenadas","4 artes digitais simples de papelaria à escolha","1 paleta de cores identificada por códigos","1 seleção tipográfica para a identidade","1 apresentação da identidade em PDF","1 simulação conceitual digital de decoração","2 rodadas de ajustes"]',
 excluded_json='["Impressão, fabricação ou montagem física","Decoração executiva ou montagem de evento","Convite cinematográfico ou interativo","Arquivos editáveis, fontes comerciais e arquivos de corte","Novas ilustrações individuais fora do escopo, outras crianças ou pets sob encomenda","Poses, modelos de papelaria ou revisões além da quantidade contratada","Embalagens complexas ou facas especiais sem orçamento"]',
 price_cents=54900,points_units=800,revision_limit=2,
 scope_reference='Libri Ateliê V4.1 | Catálogo comercial aprovado em 23/11/2026',scope_approved=1,
 specific_terms='Entrega exclusivamente digital, sem marca-d''água, em pasta organizada.
Mascotinho, brasão, logotipo, monograma e elementos em PNG de alta resolução, com fundo transparente quando adequado.
Estampas e composições em PNG/JPG de alta resolução, de acordo com o uso definido.
Artes de papelaria contratadas em PDF dimensionado para impressão, conforme medidas e textos fornecidos no briefing.
Apresentação da identidade em PDF e uma simulação conceitual digital de decoração.
Paleta com códigos de cores e seleção tipográfica por nomes/referências, sem distribuição de arquivos de fontes licenciadas.
Licença de uso pessoal para a festa e reprodução dos personalizados da própria comemoração; sem revenda, sublicença ou transferência de editáveis.
Cada rodada de revisão permite agrupar ajustes ao conceito aprovado. Correções de erros da Libri não consomem rodada.
Prazo mínimo de 15 dias corridos de produção a partir do pagamento confirmado e do briefing e materiais completos. Entrega posterior quando a agenda exigir; previsão pré-briefing sujeita à confirmação.
Com mascotinho, a ilustração representa uma criança, com poses da mesma criança. Sem mascotinho, há variações equivalentes da ilustração temática.
Personagens do tema previstos na composição não geram adicionais por sua simples presença. Novas ilustrações individuais fora do escopo exigem orçamento e aceite.
Fotos de crianças são usadas de forma privada somente com autorização; portfólio e divulgação dependem de autorização específica.
Modelos de papelaria são artes digitais simples escolhidas pela cliente; projeto técnico de embalagem e facas especiais requerem orçamento.
Adicionais, revisões extraordinárias e outros personagens só são produzidos e cobrados após orçamento aprovado.
Peças sujeitas a direitos de terceiros não transferem à cliente direitos autorais que não pertencem à Libri.',showcase_visible=1,updated_at=datetime('now')
 WHERE code='universo' AND sale_enabled=0;
