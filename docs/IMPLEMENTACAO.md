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
summary version
IDs das mensagens recentes
modelo
```

TTL padrão: 30 minutos.

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
Enter          aplica sugestão selecionada
Esc            remove seleção
Alt+1..9       aplica resultado correspondente
```

Enter sem sugestão selecionada continua pertencendo ao WhatsApp.

## Atualizações

Novas versões do IndexedDB devem aumentar `DB_VERSION` e adicionar migração em `onupgradeneeded`.

Não limpar dados existentes por conveniência durante upgrades.
