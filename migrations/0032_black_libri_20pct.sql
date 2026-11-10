-- Black Libri: novo desconto de 20% raro e limitado.
-- Campanhas já ativas NÃO têm suas chances alteradas automaticamente.
-- O prêmio é cadastrado desativado; ativação consciente via Admin após pausar.
-- Peso 1 entre os 200 pesos atualmente disponíveis (~0,50% se todos ativos).
-- Limite de 3 premiações. Não reinicia reservas nem altera prêmios concedidos.
UPDATE v2_black_libri_prizes SET sort_order=sort_order+1
WHERE sort_order>=7;

INSERT OR IGNORE INTO v2_black_libri_prizes
  (code,label,kind,value,weight,max_claims,enabled,description,sort_order)
VALUES
  ('off_20p','20% OFF','percent',20,1,3,0,
   'Prêmio raro: desconto de 20% com somente 3 unidades disponíveis.',7);
