# Google Drive | ativação da etapa 3

A conta Google Drive conectada ao ChatGPT é separada da conta
OAuth do aplicativo. Nunca copiar token do ChatGPT para Cloudflare.

## Credenciais (configurar uma única vez fora do repositório)

Crie um projeto OAuth **Web application** no Google Cloud,
habilite Google Drive API e configure o consentimento para a
conta Google proprietária dos arquivos.

Authorized redirect URI:
https://pedidos.libriconvites.com.br/api/admin/v2/drive/oauth/callback

Configure os seguintes secrets no Worker Cloudflare:
- GOOGLE_DRIVE_CLIENT_ID (client ID)
- GOOGLE_DRIVE_CLIENT_SECRET (client secret)
- GOOGLE_DRIVE_ENCRYPTION_KEY (32 bytes aleatórios codificados em base64)

A chave de criptografia deve ficar guardada: perdê-la impossibilita
descriptografar o refresh token já armazenado. Nunca registrá-la
em Git, D1 em claro, logs ou código de frontend.

### Fluxo do aplicativo

1. Acesso admin Passkey obrigatório.
2. Abre vínculo Drive recolhível dentro dos detalhes do pedido.
3. Vincula a pasta pelo link exato do Google Drive, sem buscar pelo nome.
4. Conecta a conta via OAuth Google com PKCE, state anti-replay de 10 min,
   refresh token criptografado AES-256-GCM.
5. Estado de conexão e pasta aparecem sem revelar tokens.

Escopo OAuth: drive.file, não acesso irrestrito a todo o Drive.

Limitação importante: o escopo drive.file só concede acesso aos
arquivos e pastas criados/abertos pelo aplicativo OAuth. Uma pasta
criada anteriormente pelo usuário fora desse aplicativo **não**
fica automaticamente acessível apenas porque seu ID foi vinculado.
Para usar pastas existentes, será necessário autorizar seu acesso
com Google Picker ou trabalhar com uma pasta criada pelo aplicativo.
O vínculo administrativo sozinho NÃO representa sincronização.

### O que ainda NÃO está ativo

- Upload automático de cenas e previews;
- Verificação de permissões de pasta do Drive;
- Geração de pastas por pedido no OAuth app;
- Fila de publicação ou sincronização do Project Bible;
- Publicação automática de Reels/Stories.

A API retorna status configured=false quando secrets não estão presentes.
Nenhuma migração D1 remota deve ser aplicada por uma atualização sem
CI e confirmação da conta OAuth. Nenhuma mudança no checkout.
