# Pipeline Prompt → Tradução → Envio

## Regra central

```text
draft
  ↓
prompt
  ↓
promptText (meu idioma)
  ↓
tradução, se habilitada
  ↓
finalText (idioma do contato)
  ↓
Usar / Aplicar e enviar / Ctrl+Enter
```

`finalText` é o único texto que pode ser colocado no composer por uma sugestão pronta.

## Contrato do item

Campos relevantes:

```js
{
  draft,
  promptText,
  finalText,
  translationApplied,
  sourceLanguage,
  targetLanguage,
  translationAccountId,
  translationChatId,
  status
}
```

`text` permanece apenas como compatibilidade com o resultado bruto do prompt e não pode ser usado pelas ações de envio.

## Tradução ativa

O service worker já possui `TRANSLATE_TEXT`, cache de tradução e validação da configuração da conversa. A camada da aplicação chama essa operação imediatamente depois de `SUGGEST_GENERATE`.

A tradução automática recebe `automatic=true`, para respeitar limites de consumo automático.

## Segurança

Se tradução está ativa, `finalSuggestionTextForChat()` só devolve texto quando:

- item está em `success`;
- `finalText` existe;
- `translationApplied === true`;
- conta e chat coincidem;
- `sourceLanguage === myLanguage`;
- `targetLanguage === contactLanguage`.

Caso contrário, a ação é bloqueada.

## Interface

O card mostra a mensagem final. Durante tradução mostra `Traduzindo para <idioma>…`. O botão de cards volta a se chamar **Usar**, pois não existe mais tradução tardia do card.

## Tradução manual

A ação de traduzir o rascunho fora dos cards é independente e usa `translateDraftAndApply()`.
