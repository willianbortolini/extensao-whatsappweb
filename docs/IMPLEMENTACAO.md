# Implementação

Este documento registra as decisões técnicas da implementação inicial.

## Regras fixas

- Projeto independente do Locenza.
- Sem backend.
- Cada usuário usa sua própria chave OpenAI.
- Manifest V3.
- Sidebar à direita.
- Nenhum envio automático de mensagem.
- Histórico e resumo locais.
- Resumo incremental.
- Prompts configuráveis.
- Resumo e mensagens recentes são opt-in por prompt.
- Nenhuma telemetria.
- OpenAI isolada no service worker.

## Storage

### chrome.storage

Usado somente para configuração pequena:

- settings;
- installation ID;
- modo de armazenamento da chave;
- API key persistente, quando o usuário escolher;
- API key de sessão em `chrome.storage.session`.

`chrome.storage.local` e `chrome.storage.session` são restringidos para `TRUSTED_CONTEXTS`.

### IndexedDB

Banco:

```text
whatsapp_ai_assistant
```

Stores:

```text
accounts
chats
messages
summaries
chat_settings
prompts
usage
suggestion_cache
meta
```

Todo IndexedDB é aberto pelo service worker, portanto pertence à origem da extensão.

## Fronteiras de segurança

O content script pode:

- ler DOM do WhatsApp;
- identificar conversa;
- ler o composer;
- escrever uma sugestão no composer;
- renderizar interface;
- enviar comandos tipados ao service worker.

O content script não pode:

- receber API key;
- escolher URL externa;
- chamar OpenAI diretamente;
- ler chrome.storage protegido;
- acessar diretamente o IndexedDB de dados privados.

O service worker valida a origem das mensagens e aceita somente a página do WhatsApp ou páginas internas da extensão.

## OpenAI

Endpoint:

```text
/v1/responses
```

Parâmetros principais:

```text
model
instructions
input
max_output_tokens
store=false
```

A saída é extraída de `output_text` ou de itens `output_text` dentro de `output[].content[]`.

Erros tratados:

```text
401
429
400
timeout
network
resposta vazia
```

## Rate limiting

Há limite rígido em memória no service worker.

Também existem limites persistentes baseados no ledger de `usage`:

- tokens por dia;
- chamadas automáticas por dia.

Chamadas manuais não são bloqueadas pelo orçamento local automático, para que o usuário mantenha controle explícito.

## Queue

A fila permite no máximo duas chamadas simultâneas.

Vários prompts são submetidos de forma independente e a interface recebe cada resultado quando concluir.

## Cache

Cache SHA-256 sobre:

```text
account
chat
prompt
draft
instruções e entrada efetivamente enviadas (incluindo contexto habilitado)
modelo
limite de tokens de saída
```

TTL padrão: 30 minutos.

Editar instruções, contexto enviado ou limite de saída invalida a resposta anterior.

Respostas de cache não acrescentam uso de tokens.

## Contexto

O `ContextBuilder` só inclui:

- resumo quando o prompt habilitou;
- mensagens recentes quando o prompt habilitou;
- rascunho atual;
- nome do contato;
- instrução do prompt.

Conteúdo de conversa é explicitamente marcado como dado não confiável.

## Histórico

O scanner lê mensagens carregadas e envia `upsert` para o service worker.

O ID preferencial é o `data-id` do WhatsApp.

Sem ID estável, usa fingerprint local mais contador de ocorrência no scan atual.

## Conta

A prioridade é um JID disponível no estado local do WhatsApp.

Sem JID confiável, é usado um namespace temporário de sessão. A decisão evita mistura acidental de contas.

## Conversa

Prioridade:

1. JID encontrado nas mensagens/DOM;
2. telefone;
3. fallback por hash do nome.

Grupos usam namespace próprio e mantêm o autor quando disponível.

## Resumo

O registro mantém:

```text
summary
summaryVersion
lastSummarizedMessageId
lastSummarizedAt
lastSummarizedCapturedAt
messagesSinceSummary
manuallyEdited
```

Atualização automática acontece quando `messagesSinceSummary >= summaryEvery`.

## Media viewer guard

Arquivo independente:

```text
dist/media-viewer-guard.js
```

Detecta overlays grandes com mídia/documentos e alterna:

```text
body.wai-media-viewer-open
```

CSS oculta sidebar e devolve 100% da largura ao WhatsApp.

Nenhum estado da aplicação é destruído.

## Atalhos

No composer do WhatsApp:

```text
Tab            próxima sugestão
Shift+Tab      sugestão anterior
Ctrl+Enter     aplica e envia a selecionada ou a primeira pronta
Esc            remove seleção
Alt+1..9       aplica resultado correspondente
```

Enter e Shift+Enter sempre pertencem ao WhatsApp, mesmo com sugestão selecionada.

## Atualizações

Novas versões do IndexedDB devem aumentar `DB_VERSION` e adicionar migração em `onupgradeneeded`.

Não limpar dados existentes por conveniência durante upgrades.


## Composer e envio de sugestões — bridge MAIN world

A escrita e o envio no composer do WhatsApp não são mais executados diretamente por \`WhatsAppDom\`.

O fluxo é dividido em duas camadas:

\`\`\`text
content script isolado
  -> WhatsAppComposerBridge
  -> window.postMessage
  -> page-bridge-main.js (world: MAIN)
  -> editor Lexical do WhatsApp
\`\`\`

O \`manifest.json\` carrega \`src/whatsapp/page-bridge-main.js\` em \`document_start\` e \`world: "MAIN"\`. O bridge não usa API key, storage, OpenAI nem histórico; ele recebe somente operações de composer.

Operações aceitas:

\`\`\`text
PING
DIAGNOSE
REPLACE
REPLACE_AND_SEND
\`\`\`

### Substituição

O caminho primário usa o \`LexicalEditor\` associado ao \`contenteditable\` do composer e tenta carregar o módulo \`Lexical.prod\` da própria página.

A regra é obrigatória:

\`\`\`text
limpar
-> confirmar vazio
-> inserir uma única vez
-> confirmar DOM e EditorState
\`\`\`

Nunca ocorre uma segunda inserção sobre um editor sujo.

Se a integração Lexical não estiver acessível, existe apenas um fallback: seleção total do composer + \`ClipboardEvent("paste")\`. O fallback também precisa produzir exatamente o texto esperado; caso contrário, a operação falha.

\`execCommand\` e alteração direta repetida de \`textContent\` não fazem mais parte do fluxo de envio.

### Envio

Depois da substituição, o bridge:

1. confirma que a conversa não mudou;
2. confirma o texto exato no composer;
3. encontra o botão real de envio dentro do footer/form atual;
4. executa \`button.click()\`;
5. aguarda confirmação pelo composer vazio ou por um novo balão outgoing correspondente.

Não existe fallback por \`KeyboardEvent("Enter")\`.

O clique só é considerado sucesso quando o WhatsApp confirma o envio.

### Erros estruturados

O bridge pode retornar, entre outros:

\`\`\`text
COMPOSER_NOT_FOUND
CONVERSATION_NOT_FOUND
LEXICAL_MODULE_NOT_FOUND
LEXICAL_EDITOR_NOT_FOUND
CLEAR_FAILED
CLEAR_VERIFY_FAILED
INSERT_FAILED
TEXT_MISMATCH
EDITOR_STATE_MISMATCH
CHAT_CHANGED
SEND_BUTTON_NOT_FOUND
SEND_CLICK_FAILED
SEND_NOT_CONFIRMED
BRIDGE_TIMEOUT
\`\`\`

Em erro, a sugestão continua disponível na sidebar.

### Atalhos

\`\`\`text
Ctrl+Espaço     gera sugestões imediatamente para o rascunho atual
Ctrl+Enter      aplica e envia a sugestão selecionada ou a primeira pronta
Tab             próxima sugestão
Shift+Tab       sugestão anterior
Esc             remove seleção
Alt+1..9        aplica a sugestão correspondente
\`\`\`

\`Ctrl+Enter\` e o botão **Aplicar e enviar** chamam exatamente a mesma transação.
