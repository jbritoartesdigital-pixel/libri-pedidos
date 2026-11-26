# Segurança Libri Pedidos — branch de revisão, NÃO publicar

Base: fcf3fabde9c93f68f7690e26cbc5490e823b55fd (main V131, cuja publicação anterior falhou). Última produção verificada: V130.1. Nenhuma alteração em main, D1, R2 ou conta Cloudflare foi autorizada.

- Limites por IP em Workers (60 s): recuperação 8, autenticação 20, contratação 12, cotações 90, escritas do cliente 120. São limites por localização Cloudflare, não um firewall global; não garantem impedir bots distribuídos. Webhooks excluídos. Sem CAPTCHA neste lote; Turnstile requer sitekey/secret, teste de UX e autorização de configuração. Validar dispositivos, Wi-Fi compartilhado, uploads múltiplos e checkout antes de publicar.
- Validação estrutural integral de JPEG, PNG (CRC), WebP e contêiner HEIF; não é decodificação completa, antivírus, análise de metadados nem inspeção retroativa. Testar fotos de iPhone reais (HEIC/HEIF) e imagens de alta resolução antes de publicar. PDF administrativo permanece fora desta validação de imagem.
- CSP mínima aplicada (frame-ancestors, base-uri, object-src), política de scripts restritiva em Report-Only sem endpoint de coleta: observar console do navegador em teste antes de aplicar integralmente. Cabeçalhos privados sem cache/referrer/indexação; links continuam credenciais portadoras e não foram rotacionados.
- Bloqueio de origens cruzadas para mutações administrativas; passkey e cookies existentes preservados.
- .gitignore reforçado. Auditoria de dependências e segredos deve executar em CI com logs redigidos. Nenhum segredo deve ser copiado para relatório. Caso haja achados, rotacionar apenas com autorização.
- Testes SEC passam pela suíte habitual; CI de revisão não realiza deploy. Aprovação da proprietária e todos os gates são pré-requisitos para integrar/publicar. Não há estimativa percentual de invasão.
