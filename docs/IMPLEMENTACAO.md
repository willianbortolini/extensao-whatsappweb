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


## Pipeline de sugestão com tradução

Quando o modo tradução está ativo, tradução não é uma ação tardia de **Usar**, **Aplicar e enviar** ou **Ctrl+Enter**. Ela faz parte da própria geração da sugestão.

Contrato de uma sugestão:

```text
draft
  -> SUGGEST_GENERATE
  -> promptText (sempre no idioma do usuário quando modo tradução está ativo)
  -> TRANSLATE_TEXT outgoing
  -> finalText (idioma do contato)
  -> status=success
```

Sem tradução:

```text
promptText = resultado do prompt
finalText  = promptText
translationApplied = false
```

Com tradução:

```text
promptText = resultado do prompt no meu idioma
finalText  = tradução para o idioma do contato
translationApplied = true
sourceLanguage = myLanguage
targetLanguage = contactLanguage
```

Uma sugestão com tradução ativada **não pode** chegar ao estado `success` sem `finalText` traduzido válido.

As ações que alteram o WhatsApp usam exclusivamente `finalText`:

```text
Usar              -> replaceText(finalText)
Aplicar e enviar  -> replaceAndSend(finalText)
Ctrl+Enter        -> mesma ação de Aplicar e enviar
```

Essas ações não chamam `TRANSLATE_TEXT` e nunca voltam para `promptText`.

A interface mostra `finalText`, isto é, exatamente a mensagem que será enviada ao contato. Quando houver tradução, também mostra o idioma final.

Estados possíveis durante a geração:

```text
queued
loading
translating
success
error
```

Se o prompt funcionar mas a tradução falhar:

- `promptText` pode permanecer apenas para diagnóstico/retry;
- `finalText` fica vazio;
- o status passa para `error`;
- **Usar**, **Aplicar e enviar** e **Ctrl+Enter** não podem enviar o item.

A tradução é vinculada à conta, conversa e par de idiomas. Alterações em `translationEnabled`, `myLanguage`, `contactLanguage` ou demais configurações da conversa invalidam as sugestões existentes por meio do fluxo de `updateChatSettings()`.

### Geração automática e consumo

Sugestões após o debounce de 5 segundos usam:

```text
SUGGEST_GENERATE automatic=true
TRANSLATE_TEXT   automatic=true
```

Assim, prompt e tradução respeitam os limites locais para chamadas automáticas.

Ctrl+Espaço, prompt manual e retry manual usam `automatic=false`.

### Tradução manual do rascunho

O botão **Traduzir rascunho e aplicar** continua existindo como função separada. Ele usa `translateDraftAndApply()` e não participa do pipeline dos cards de sugestão.

### Instrução do prompt no modo tradução

`localizeSuggestion()` força o resultado do prompt para `myLanguage`. Depois, a extensão traduz esse resultado para `contactLanguage` antes de disponibilizar a sugestão para envio. Isso garante a ordem:

```text
texto digitado
-> prompt no meu idioma
-> tradução
-> mensagem final no idioma do contato
```


## Sugerir mensagem a partir do resumo

A sidebar possui uma funcionalidade manual separada das sugestões baseadas no rascunho.

Fluxo:

```text
resumo salvo
+ prompt selecionado
+ mensagens recentes, se o prompt pedir
-> SUGGEST_MESSAGE_GENERATE
-> promptText
-> tradução outgoing, se habilitada
-> finalText
-> Usar / Aplicar e enviar
```

A funcionalidade não depende de texto no composer e nunca roda automaticamente.

### Prompt padrão

O prompt `default-suggest-message-v1` / **Continuação da conversa** é adicionado a instalações novas e, por migração lógica registrada em `meta`, também a instalações já existentes sem sobrescrever prompts personalizados.

### Resumo obrigatório

`SUGGEST_MESSAGE_GENERATE` busca o resumo diretamente no IndexedDB pelo `accountId/chatId`. Sem resumo retorna `SUMMARY_REQUIRED` antes de chamar a OpenAI. A UI oferece **Gerar resumo**.

### Contexto

`buildSuggestedMessageInput()` sempre inclui:

- tarefa do prompt;
- nome exibido da conversa;
- resumo local e sua versão;
- mensagens recentes somente quando `includeRecentMessages=true`.

Resumo e mensagens continuam rotulados como dados não confiáveis.

### Cache e Gerar outra

A chave inclui operação, prompt, versão/conteúdo efetivo do resumo, mensagens recentes, modelo e limite de saída.

**Sugerir mensagem** pode reutilizar cache. **Gerar outra** envia `forceNew=true`, ignora a leitura do cache e executa nova chamada explícita. O novo resultado substitui o cache daquela combinação.

### Estado separado

`suggestedMessage` é separado de `ui.suggestions`. Possui `accountId`, `chatId`, `promptId`, `summaryVersion`, `promptText`, `finalText`, metadados de tradução e status próprio.

Estados:

```text
generating
translating
success
error
```

### Tradução

Com tradução desativada:

```text
finalText = promptText
```

Com tradução ativada:

```text
promptText
-> TRANSLATE_TEXT outgoing automatic=false
-> finalText no idioma do contato
```

Falha de tradução deixa `finalText` vazio e status `error`.

### Aplicação e envio

**Usar** chama `composerBridge.replaceText(finalText)`. Se já houver outro rascunho, pede confirmação antes de substituí-lo.

**Aplicar e enviar** chama `composerBridge.replaceAndSend(finalText)` e reutiliza a transação segura já implementada. Em falha, a mensagem sugerida permanece disponível.

Ctrl+Enter continua exclusivo da lista normal de sugestões, mantendo comportamento previsível.

### Invalidação

A mensagem sugerida é invalidada ao trocar de conta/conversa, ao mudar configurações da conversa (incluindo idiomas), ou quando a versão do resumo muda. Respostas assíncronas de outra conversa, configuração ou versão de resumo são descartadas.


## Prompts globais e prompts por conversa

Cada prompt possui um escopo:

```text
global
chat
```

Prompt global:

```js
{
  scope: 'global',
  accountId: null,
  chatId: null,
  chatDisplayName: null
}
```

Prompt específico:

```js
{
  scope: 'chat',
  accountId,
  chatId,
  chatDisplayName
}
```

A identidade é sempre `accountId + chatId`; nome do contato/grupo é somente metadado visual.

### Migração

Prompts legados sem `scope` são migrados uma única vez como globais. A migração usa `meta["migration:prompt-scope-v1"]` e preserva id, instruções, ordem, autoRun e demais configurações.

Todos os prompts padrão possuem `scope="global"`.

### Listagem por conversa

`PROMPT_LIST` continua servindo administração geral.

`PROMPT_LIST_FOR_CHAT` recebe:

```js
{ accountId, chatId }
```

e retorna:

```text
todos os globais
+
somente os prompts chat daquela conta/conversa
```

A sidebar trabalha com essa lista filtrada.

### Segurança

`SUGGEST_GENERATE` e `SUGGEST_MESSAGE_GENERATE` consultam o prompt no service worker e executam `promptAvailableForChat()` antes de qualquer chamada OpenAI.

Um prompt específico de João enviado artificialmente em uma requisição para Maria retorna:

```text
PROMPT_NOT_AVAILABLE_FOR_CHAT
```

e não gera chamada de IA.

A edição de um prompt existente não pode mudar `global -> chat` ou `chat -> global`. Para isso existe **Duplicar para esta conversa**.

### Automáticos

Os prompts automáticos disponíveis são ordenados por:

```text
1. específicos desta conversa
2. globais
3. order
4. name
```

Depois é aplicado `maxAutomaticPrompts`.

Assim, uma regra criada especificamente para o contato tem prioridade quando o limite é atingido.

### Sidebar

A seção Prompts separa visualmente:

```text
Somente esta conversa/grupo
Globais
```

Ações:

- **+ Prompt global**
- **+ Prompt para este contato/grupo**
- executar manualmente;
- habilitar/desabilitar;
- editar;
- excluir;
- duplicar prompt global para a conversa atual.

O escopo de um prompt existente é somente leitura no editor.

### Sugerir mensagem

O seletor da função **Sugerir mensagem** recebe a mesma lista filtrada. Logo um prompt de João aparece no seletor de João, mas não em Maria.

O restante do pipeline permanece:

```text
prompt permitido
-> promptText
-> tradução, se ativa
-> finalText
-> Usar / Aplicar e enviar
```
