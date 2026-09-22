# Prompts por contato e grupo

## Objetivo

Permitir dois escopos de prompt:

```text
global -> disponível em todas as conversas
chat   -> disponível somente para accountId + chatId
```

## Modelo

```js
{
  id,
  name,
  instructions,
  scope: 'global' | 'chat',
  accountId,
  chatId,
  chatDisplayName,
  enabled,
  autoRun,
  order,
  includeSummary,
  includeRecentMessages,
  recentMessagesCount,
  generateSummaryIfMissing,
  maxOutputTokens
}
```

Para `global`, ids de conversa ficam nulos. Para `chat`, accountId e chatId são obrigatórios.

## Migração

Prompts antigos sem escopo viram globais através da migração lógica `migration:prompt-scope-v1`. Não existe mudança de schema/DB_VERSION porque não foram criados índices ou object stores.

## Listagem

`PROMPT_LIST_FOR_CHAT` é a fonte de prompts da sidebar. Ele retorna os globais e os específicos do chat exato.

## Segurança

A UI não é a fronteira de segurança. Antes de executar um prompt, o service worker confirma `promptAvailableForChat(prompt, accountId, chatId)`.

Código de erro:

```text
PROMPT_NOT_AVAILABLE_FOR_CHAT
```

## Automáticos

Quando há limite de prompts automáticos, específicos da conversa têm prioridade sobre globais. Dentro do mesmo escopo vale `order`.

## Criação e edição

Na sidebar existem:

- **+ Prompt global**
- **+ Prompt para este contato/grupo**

O escopo não pode ser convertido durante edição. Um global pode ser **Duplicado para esta conversa**, criando outro registro independente.

## Grupos

Grupo e contato usam o mesmo `scope='chat'`. A diferença é apenas visual. O vínculo real continua `accountId + whatsappChatId`.

## Integrações

Escopo é respeitado por:

- sugestões automáticas após 5 segundos;
- Ctrl+Espaço;
- execução manual;
- Sugerir mensagem;
- tradução;
- Usar;
- Aplicar e enviar.

Tradução continua acontecendo depois do prompt, produzindo `finalText` antes de qualquer ação de envio.
