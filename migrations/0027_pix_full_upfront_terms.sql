-- Update only the unmodified original published terms. Preserve every
-- prior acceptance under immutable version 2.0 and never overwrite a
-- customized active version that the administrator published separately.
INSERT OR IGNORE INTO v2_terms_versions
  (version, body, content_hash, active, published_at, created_at)
SELECT '2.0-pix-full-20261027',
  replace(body,
    'Nos pedidos pagos por Pix, é necessário o pagamento de 50% do valor total para confirmar a contratação, reservar a vaga e liberar o briefing. Os outros 50% serão pagos depois que o convite for aprovado e antes da entrega final.',
    'Nos pedidos pagos por Pix, o pagamento integral (100%) do pedido é feito antecipadamente para confirmar a contratação, reservar a vaga e liberar o briefing. A Libri Convites poderá autorizar expressamente, em casos excepcionais, entrada de 50% para um pedido específico. Nessa condição, os 50% restantes serão pagos após a aprovação do convite e antes da entrega final. O valor devido agora e o eventual saldo são informados antes da confirmação.'
  ),
  NULL, 1, datetime('now'), datetime('now')
FROM v2_terms_versions
WHERE version = '2.0' AND active = 1
  AND instr(body,
    'Nos pedidos pagos por Pix, é necessário o pagamento de 50% do valor total para confirmar a contratação, reservar a vaga e liberar o briefing. Os outros 50% serão pagos depois que o convite for aprovado e antes da entrega final.'
  ) > 0;

UPDATE v2_terms_versions SET active = 0
WHERE version = '2.0' AND active = 1
  AND EXISTS (SELECT 1 FROM v2_terms_versions
    WHERE version = '2.0-pix-full-20261027' AND active = 1);
