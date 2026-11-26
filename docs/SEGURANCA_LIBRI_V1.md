# Segurança Libri Pedidos — branch de revisão, NÃO publicar

Base: fcf3fabde9c93f68f7690e26cbc5490e823b55fd (main V131, cuja publicação anterior falhou). Última produção verificada: V130.1. Nenhuma alteração em main, D1, R2 ou conta Cloudflare foi autorizada.

- Limites por IP em Workers (60 s): recuperação 8, autenticação 20, contratação 12, cotações 90, escritas do cliente 120. São limites por localização Cloudflare, não um firewall global; não garantem impedir bots distribuídos. Webhooks excluídos. Sem CAPTCHA neste lote; Turnstile requer sitekey/secret, teste de UX e autorização de configuração. Validar dispositivos, Wi-Fi compartilhado, uploads múltiplos e checkout antes de publicar.
- Validação estrutural integral de JPEG, PNG (CRC), WebP e contêiner HEIF; não é decodificação completa, antivírus, análise de metadados nem inspeção retroativa. Testar fotos de iPhone reais (HEIC/HEIF) e imagens de alta resolução antes de publicar. PDF administrativo permanece fora desta validação de imagem.
- CSP mínima aplicada (frame-ancestors, base-uri, object-src), política de scripts restritiva em Report-Only sem endpoint de coleta: observar console do navegador em teste antes de aplicar integralmente. Cabeçalhos privados sem cache/referrer/indexação; links continuam credenciais portadoras e não foram rotacionados.
- Bloqueio de origens cruzadas para mutações administrativas; passkey e cookies existentes preservados.
- .gitignore reforçado. Auditoria de dependências e segredos deve executar em CI com logs redigidos. Nenhum segredo deve ser copiado para relatório. Caso haja achados, rotacionar apenas com autorização.
- Testes SEC passam pela suíte habitual; CI de revisão não realiza deploy. Aprovação da proprietária e todos os gates são pré-requisitos para integrar/publicar. Não há estimativa percentual de invasão.

## Rodada 2
Auditoria inicial: 9 alertas nas dependências (5 altos, 4 moderados); 2 alertas históricos do scanner, ainda sem classificação. Nenhuma credencial exibida ou rotacionada. Fixtures de imagens substituídas por arquivos sintéticos válidos gerados com Pillow; teste de cache confirma no-store sem exigir texto idêntico. Candidata de atualização do Wrangler será resolvida e auditada isoladamente, sem alterar o lockfile definitivo antes de verificar compatibilidade. A falha V131 preexistente continua separada.

## Rodada 3
A candidata Wrangler 4.168.0 passou em pnpm audit sem vulnerabilidades conhecidas, instalação congelada e check. Manifesto e lockfile exatos gerados no CI foram integrados somente nesta branch. Os dois alertas Gitleaks correspondem à mesma chave Pix UUID de teste em dois commits de tests/v2.test.mjs, não a credenciais de API. A origem real/fictícia não é comprovada: substituída por UUID sintético no código atual, histórico não reescrito e alertas históricos não ignorados. Não publicar até resolver/classificar o histórico. JPEG sintético produzido em ambiente local com Pillow, sem dados reais. V131 preexistente continua com falha de teste, não corrigida nesta branch.
