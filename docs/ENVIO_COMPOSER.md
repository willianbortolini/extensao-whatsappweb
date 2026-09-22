# Composer do WhatsApp — substituição e envio

## Objetivo

Quando o usuário aciona **Aplicar e enviar** ou **Ctrl+Enter**, a extensão deve substituir integralmente o rascunho atual pela sugestão selecionada e só então enviar.

Exemplo obrigatório:

\`\`\`text
rascunho: teste envio
sugestão: Mensagem de teste.

resultado:
Mensagem de teste. -> enviada
\`\`\`

É proibido concatenar sugestão e rascunho.

## Arquitetura

O WhatsApp Web usa um editor Lexical. O content script da extensão roda isolado, por isso existe um bridge carregado no \`MAIN world\`:

\`\`\`text
src/app.js
  -> src/whatsapp/composer-bridge.js
  -> window.postMessage
  -> src/whatsapp/page-bridge-main.js
  -> LexicalEditor / DOM do WhatsApp
\`\`\`

O bridge principal não recebe chave OpenAI, prompts, histórico ou storage.

## Transação REPLACE_AND_SEND

1. localizar somente o composer da conversa em \`#main\`;
2. capturar uma assinatura da conversa atual;
3. localizar o \`LexicalEditor\` e \`Lexical.prod\`;
4. limpar o EditorState;
5. confirmar EditorState e DOM vazios;
6. inserir a sugestão uma única vez;
7. confirmar EditorState e DOM iguais à sugestão;
8. confirmar que a conversa continua a mesma;
9. localizar o botão real de envio no footer/form;
10. clicar;
11. confirmar composer vazio ou novo balão outgoing;
12. retornar \`SEND_CONFIRMED\`.

Se qualquer etapa falhar, não existe tentativa cega de envio.

## Fallback

O único fallback de substituição é um \`ClipboardEvent("paste")\` sobre uma seleção que cobre o composer inteiro.

O fallback só é aceito quando o texto lido de volta é exatamente a sugestão. Se o Lexical ainda for detectável, o EditorState também precisa coincidir.

Não existe fallback por Enter sintético.

## Diagnóstico

A operação \`DIAGNOSE\` informa somente metadados estruturais do composer, módulo Lexical, editor e botão de envio. O conteúdo da conversa não é persistido pelo diagnóstico.

## Critério de pronto

A funcionalidade só é considerada correta quando:

\`\`\`text
texto antigo removido
+ sugestão exata confirmada
+ conversa confirmada
+ botão real clicado
+ envio confirmado
\`\`\`
