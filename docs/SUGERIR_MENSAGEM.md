# Sugerir mensagem

## Objetivo

Criar uma nova mensagem para a conversa atual usando o resumo salvo e um prompt escolhido pelo usuário, sem exigir rascunho no campo do WhatsApp.

## Fluxo

```text
Resumo + Prompt
      ↓
SUGGEST_MESSAGE_GENERATE
      ↓
promptText
      ↓
Tradução, quando ativada
      ↓
finalText
      ↓
Usar / Aplicar e enviar
```

A geração é sempre manual.

## UI

A seção **Sugerir mensagem** é independente da seção **Sugestões**. Ela mostra:

- seletor de prompt;
- versão do resumo;
- aviso de mensagens ainda não incorporadas;
- **Sugerir mensagem**;
- estado de geração/tradução;
- mensagem final;
- **Usar**;
- **Aplicar e enviar**;
- **Gerar outra**.

Sem resumo, mostra **Gerar resumo**.

## Prompt padrão

ID: `default-suggest-message-v1`

Nome: **Continuação da conversa**

É instalado sem sobrescrever prompts personalizados. Uma chave de migração em `meta` impede que um usuário que posteriormente remover o prompt tenha sua exclusão desfeita a cada inicialização.

## Backend

A operação `SUGGEST_MESSAGE_GENERATE` recebe somente:

```js
{
  accountId,
  chatId,
  promptId,
  forceNew
}
```

Resumo, conversa e prompt são carregados pelo service worker.

## Contexto

`buildSuggestedMessageInput()` sempre inclui o resumo. Mensagens recentes são incluídas quando o prompt está configurado com `includeRecentMessages`.

A versão do resumo faz parte do contexto/cache e também é devolvida ao content script para validação contra corrida de atualização.

## Tradução

A mensagem sugerida segue a mesma regra das sugestões normais: somente `finalText` pode ser usado no WhatsApp.

Se o modo tradução estiver ativo, `promptText` é traduzido antes de o item ficar em `success`.

## Segurança

O resultado é vinculado a conta, conversa, versão do resumo e idiomas. Ações finais passam por `finalSuggestionTextForChat()`, que rejeita contexto divergente.

## Envio

Não existe implementação de envio específica para esta função. Ela reutiliza o composer bridge existente:

```text
Usar -> replaceText(finalText)
Aplicar e enviar -> replaceAndSend(finalText)
```

## Consumo

Não existe polling, debounce ou geração automática. Cada geração é iniciada explicitamente pelo usuário. **Gerar outra** força uma nova geração de prompt; traduções ainda podem reutilizar o cache de tradução quando o texto resultante for idêntico.
