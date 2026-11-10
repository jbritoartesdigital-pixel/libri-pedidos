-- Black Libri: datas gerenciadas dentro do Admin V2, como os cupons.
-- Não altera as datas dos cupons existentes nem ativa a campanha.
ALTER TABLE v2_black_libri_campaign_state ADD COLUMN valid_from TEXT;
ALTER TABLE v2_black_libri_campaign_state ADD COLUMN valid_until TEXT;
