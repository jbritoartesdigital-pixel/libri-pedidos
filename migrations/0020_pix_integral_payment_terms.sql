-- New payment terms are published as a separate immutable version.
-- Old terms and acceptances remain untouched for existing contracts.
-- Preserve the active contract's other clauses/customizations.
INSERT OR IGNORE INTO v2_terms_versions(version, body, active)
SELECT
  '2.1-pix-integral-20261027',
  'ADENDO ÀS CONDIÇÕES DE PAGAMENTO (vigente para novos pedidos): Pix integral antecipado como padrão; entrada de 50% somente mediante exceção autorizada em atendimento. Os pedidos anteriores mantêm os valores e condições já contratados. Em caso de divergência com a redação anterior da cláusula de pagamento, prevalece este adendo.' || char(10) || char(10)
    || REPLACE(body,
      'Nos pedidos pagos por Pix, é necessário o pagamento de 50% do valor total para confirmar a contratação, reservar a vaga e liberar o briefing. Os outros 50% serão pagos depois que o convite for aprovado e antes da entrega final.',
      'Nos novos pedidos pagos por Pix, é necessário o pagamento integral antecipado para confirmar a contratação, reservar a vaga e liberar o briefing. Excepcionalmente, quando a Libri autorizar por escrito uma entrada de 50% em pedido preparado por atendimento, o saldo restante de 50% será pago depois da aprovação do convite e antes da entrega final. O resumo financeiro do pedido indicará a modalidade autorizada. Pedidos anteriores mantêm as condições de pagamento já contratadas.'),
  1
FROM v2_terms_versions
WHERE active = 1
ORDER BY published_at DESC, version DESC LIMIT 1;

UPDATE v2_terms_versions
SET active = CASE WHEN version='2.1-pix-integral-20261027' THEN 1 ELSE 0 END
WHERE EXISTS(SELECT 1 FROM v2_terms_versions WHERE version='2.1-pix-integral-20261027');
