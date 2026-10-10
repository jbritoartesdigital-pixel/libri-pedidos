# Etapas 3 e 4 | Integração segura do projeto com Drive e divulgação

## Situação

Esta etapa instala somente **núcleo offline**, testes e contratos de dados.
Não ativa sincronização automática no site, não acessa Google Drive, não
publica redes sociais e não movimenta dados da cliente.

### 3. Project Bible e envio organizado

Fonte de verdade: evento de aprovação validado pela API administrativa,
com ID imutável do projeto, ID do pedido, mídia interna e hash SHA-256.

O usuário pode aprovar **Cena 1**, **Preview**, **Card Final** ou outros assets.
A função `buildProjectBible` gera:

- Project_Bible.json com decisões, cenas e histórico imutável de aprovações;
- Plano_Envio_Drive.json com nome simples para versão atual, por exemplo
  `Cena 1.png` e `Preview.mp4`;
- versões anteriores com nomes exclusivos em `Historico/`, sem apagar originals.

O envio real **não deve** ocorrer diretamente a partir do navegador.
Requer uma conexão Google OAuth delegada à Libri, com token guardado em
secret seguro, escopo mínimo, isolamento por pedido, confirmação de hash
e registro de transferências sem vazamento de URLs assinadas.

**Obrigatório antes de ativar**: ID da pasta Drive associado ao pedido
autenticado. Não buscar por nome, CPF, honoree ou slug. Não confiar numa
pasta enviada pelo convidado. Duas clientes chamadas Aurora são projetos
diferentes e nunca podem compartilhar a mesma pasta por heurística.

Sem Drive conectado ou vínculo correto: manter estado `aguardando-integracao`,
sem fingir que o upload funcionou.

### 4. Divulgação com FFmpeg

`buildSocialDraft` prepara plano de Reels 9:16, Stories 9:16,
capa JPG e legenda editável sem dados privados de evento.

`renderSocialDraft` renderiza **somente na máquina de execução** com
FFmpeg instalado, entrada de vídeo local já aprovada e autorização
explícita de uso promocional. Não busca vídeos da cliente, não adiciona
música nem posta automaticamente.

As versões passam pelo processo de revisão de conteúdo antes de
qualquer publicação no Instagram.

## Exemplo exclusivamente com dados sintéticos

```bash
node scripts/libri-project-automation.mjs --manifest exemplo-fixture.json --out /tmp/libri-teste
# Sem upload ou publicação. NUNCA habilitar --render sem consentimento.
node --test tests/project-automation.test.mjs
```

## Próxima integração com Libri Pedidos e Studio

1. Relacionar aprovação real ao ID do pedido e do asset no R2 ou na
   origem permitida, sem recomputar por nome.
2. Adicionar tabela própria de destinos por pedido, sem guardar OAuth
   nem tokens na mesma tabela.
3. Acionar uma fila idempotente por `approvalId` com checagem de hash
   do destino; permitir repetição segura e falhas visíveis.
4. Escrever no Drive apenas após confirmação do upload pela API do Google.
5. Oferecer os rascunhos sociais somente à administradora, sem autoplay
   de postagem, cron ou compartilhamento público.

### Política de produção

Nenhuma alteração de pedidos, aprovação, cobrança, fluxo de cliente,
R2, D1 ou credenciais neste pacote. Não publicar novos recursos no
frontend até a integração OAuth, revisão dos limites e QA específicos.
