-- Libri Pedidos V2: catálogo de retrospectivas como adicionais do pedido manual.
-- Valores confirmados no catálogo seed do projeto independente Libri Retrospectivas
-- (RETRO_070...RETRO_250). A venda aqui NÃO cria pedido no outro aplicativo.
-- Pontos de agenda conservadores, estimados para reserva de produção: 2-6.
-- D1: inserção aditiva e idempotente, sem modificar pedidos já contratados.
INSERT OR IGNORE INTO v2_addons
(code, name, addon_group, price_cents, points_units, sort_order, config_json)
VALUES
('retro_070','Retrospectiva • 70 fotos','retrospectiva',10000,200,70,
 '{"retroPackageCode":"RETRO_070","maxPhotos":70,"maxVideos":5,"captions":false,"fulfillment":"manual","benefits":["abertura","musicas","animacoes","dedicatoria"]}'),
('retro_100','Retrospectiva • 100 fotos','retrospectiva',15000,300,71,
 '{"retroPackageCode":"RETRO_100","maxPhotos":100,"maxVideos":10,"captions":false,"fulfillment":"manual","benefits":["abertura","musicas","animacoes","dedicatoria"]}'),
('retro_150','Retrospectiva • 150 fotos','retrospectiva',20000,400,72,
 '{"retroPackageCode":"RETRO_150","maxPhotos":150,"maxVideos":10,"captions":true,"fulfillment":"manual","benefits":["abertura","musicas","animacoes","dedicatoria","legendas"]}'),
('retro_200','Retrospectiva • 200 fotos','retrospectiva',25000,500,73,
 '{"retroPackageCode":"RETRO_200","maxPhotos":200,"maxVideos":10,"captions":true,"fulfillment":"manual","benefits":["abertura","musicas","animacoes","dedicatoria","legendas"]}'),
('retro_250','Retrospectiva • 250 fotos','retrospectiva',30000,600,74,
 '{"retroPackageCode":"RETRO_250","maxPhotos":250,"maxVideos":10,"captions":true,"fulfillment":"manual","benefits":["abertura","musicas","animacoes","dedicatoria","legendas"]}');
