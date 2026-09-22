# Testes

## Automatizados

Executar:

```bash
npm test
npm run check
```

Cobertura inicial:

- contexto sem resumo;
- contexto com resumo;
- mensagens recentes;
- substituição das variáveis de prompt;
- normalização e limites de prompt;
- resumo incremental;
- timestamp do WhatsApp;
- hash determinístico;
- sintaxe de todos os módulos.

## Matriz manual obrigatória

### Instalação

- carregar como extensão sem compactação;
- abrir WhatsApp Web;
- sidebar aparece;
- fechar sidebar;
- launcher reabre;
- reload preserva preferência.

### OpenAI

- salvar chave em sessão;
- testar;
- reiniciar extensão e confirmar expiração da chave de sessão;
- salvar localmente;
- reload e confirmar persistência;
- remover chave;
- chave inválida mostra erro;
- 429 não cria retry em loop.

### Prompts

- criar;
- editar;
- excluir;
- habilitar/desabilitar;
- automático/manual;
- resumo ligado/desligado;
- mensagens recentes ligadas/desligadas;
- variáveis;
- limite de saída;
- ordem.

### Debounce

- digitar continuamente > 5 s sem parar: zero chamadas durante digitação;
- parar 3 s e continuar: zero chamadas;
- parar 5 s: uma geração por prompt automático permitido;
- voltar à aba com o mesmo rascunho: não gerar novamente automaticamente;
- alterar rascunho: permitir novo ciclo;
- aplicar sugestão: não regenerar o próprio texto automaticamente.

### Teclado

- Tab seleciona primeira;
- Tab avança;
- Shift+Tab volta;
- Ctrl+Enter aplica e envia a selecionada; sem seleção, usa a primeira pronta;
- Enter envia normalmente pelo WhatsApp, mesmo com seleção;
- Shift+Enter quebra linha normalmente, mesmo com seleção;
- Esc remove seleção;
- Alt+1 aplica primeira.

### Conversas

- individual;
- grupo;
- troca rápida;
- nomes iguais quando houver JID;
- voltar para conversa recupera resumo;
- mensagens novas entram no histórico;
- mensagens já observadas não duplicam.

### Resumo

- gerar manualmente;
- atualizar incrementalmente;
- editar;
- resumo editado vira base;
- automático a cada 2 mensagens;
- modo manual não gera sozinho;
- resumo desabilitado não gera automaticamente;
- refazer pede confirmação.

### Media viewer

- abrir imagem;
- abrir vídeo;
- abrir documento;
- sidebar desaparece;
- WhatsApp ocupa largura completa;
- fechar viewer;
- sidebar retorna somente se estava aberta;
- sugestões/resumo permanecem.

### Conta

- logout/login na mesma conta;
- trocar de conta quando JID for detectável;
- confirmar namespaces distintos;
- quando identificação for fallback, confirmar uso de namespace temporário e ausência de mistura.

### Privacidade

No DevTools:

- API key não está no DOM;
- API key não aparece em IndexedDB;
- API key não aparece no bundle;
- API key não aparece em console;
- content script não consegue acessar storage protegido;
- prompt sem resumo não envia resumo;
- prompt sem mensagens não envia mensagens.

### Modo tradução — validação manual no WhatsApp autenticado

- Recarregar a extensão e a página; confirmar migração do IndexedDB para v3 preservando mensagens e resumos.
- Abrir conversa com mensagens antigas já carregadas; clicar em **Traduzir balões do contato** e confirmar registro de mensagens recebidas e enviadas antes da tradução.
- Repetir o clique; confirmar que a contagem não aumenta e que data/hora original e primeira captura não mudam. Confirmar que duas mensagens com IDs diferentes no mesmo minuto permanecem separadas.
- Sem marcar **Usar IA**, ativar tradução e confirmar ausência de chamadas à API.
- Configurar português/inglês, habilitar IA e tradução e abrir conversa com mensagens recebidas em inglês.
- Confirmar tradução junto ao balão e original intacto; comparar `messages` e `translations` no IndexedDB.
- Gerar uma sugestão: resultado em português, aplicar: campo em inglês, nenhuma mensagem enviada.
- Traduzir diretamente um rascunho; editar o campo ou trocar de conversa durante a chamada e confirmar que nada é sobrescrito.
- Reabrir a conversa e confirmar uso das traduções persistidas sem nova chamada.
- Desativar tradução e confirmar remoção dos blocos traduzidos. Desativar IA e confirmar bloqueio inclusive de chamadas na fila.
- Alterar idioma e confirmar que traduções antigas não são exibidas para o novo idioma.
- Simular falha ou limite de consumo e confirmar ausência de tentativas contínuas; usar o botão de tentar novamente.
- Limpar histórico e confirmar remoção dos registros de tradução da conversa.

### Consumo (verificações gerais)

- cache evita nova chamada;
- fila limita concorrência;
- limite diário de requisições automáticas bloqueia;
- limite diário de tokens bloqueia automáticos;
- chamadas manuais continuam sob ação explícita;
- `max_output_tokens` é enviado;
- `store=false` é enviado.


## Composer Lexical / envio — regressão obrigatória

Além dos testes gerais, executar estes casos no WhatsApp Web autenticado:

- digitar \`teste envio\`, selecionar a sugestão \`Mensagem de teste.\` e usar **Usar**; o composer deve conter somente \`Mensagem de teste.\`;
- repetir com **Aplicar e enviar**; o texto antigo deve desaparecer, a sugestão deve aparecer e a mensagem deve ser enviada;
- repetir com **Ctrl+Enter**; o resultado deve ser idêntico ao botão;
- confirmar que nunca aparece \`Mensagem de teste.Mensagem de teste.teste envio\` nem qualquer outra concatenação;
- sugestão com múltiplas linhas preserva as linhas;
- sugestão com emoji e acentos preserva o conteúdo;
- ausência do botão de envio retorna erro e mantém a sugestão;
- clique no botão sem composer vazio/balão outgoing retorna \`SEND_NOT_CONFIRMED\`;
- troca de conversa durante a transação cancela o envio;
- falha da integração Lexical tenta somente o fallback de paste;
- o fallback também precisa validar texto exato antes de enviar.

Os testes automatizados específicos ficam em:

\`\`\`text
tests/composer-bridge.test.js
tests/page-bridge.test.js
tests/send-control.test.js
tests/send-suggestion.test.js
tests/translation-apply.test.js
\`\`\`


## Sugestões com tradução — matriz obrigatória

### Tradução desligada

- digitar `teste envio`;
- o prompt retorna `Mensagem de teste.`;
- `promptText = "Mensagem de teste."`;
- `finalText = "Mensagem de teste."`;
- **Usar**, **Aplicar e enviar** e **Ctrl+Enter** usam esse `finalText`.

### Tradução ligada (pt-BR -> en)

- digitar `teste envio`;
- prompt retorna `Esta é uma mensagem de teste.`;
- antes do card ficar pronto, executar `TRANSLATE_TEXT` outgoing;
- tradução retorna `This is a test message.`;
- card mostra `This is a test message.`;
- `promptText` continua sendo `Esta é uma mensagem de teste.`;
- `finalText = "This is a test message."`;
- **Usar** escreve somente `finalText`;
- **Aplicar e enviar** envia somente `finalText`;
- **Ctrl+Enter** envia somente `finalText`;
- nenhuma dessas três ações faz uma tradução tardia.

### Estados

- enquanto o prompt roda: `loading`;
- depois do prompt e durante tradução: `translating`;
- apenas depois da tradução válida: `success`;
- tradução vazia ou com erro: `error` e `finalText=""`.

### Falhas obrigatórias

- tradução falhou: não enviar `promptText`;
- rascunho mudou enquanto prompt rodava: descartar resultado;
- rascunho mudou enquanto tradução rodava: descartar tradução;
- conversa mudou: descartar resultado;
- idioma mudou: sugestão anterior deixa de ser válida;
- tradução desligada após uma sugestão traduzida: não reutilizar `finalText` antigo.

### Geração automática

- após 5 segundos: prompt automático + tradução automática, uma vez por rascunho;
- `TRANSLATE_TEXT` recebe `automatic=true`;
- não repetir enquanto o rascunho não mudar.

### Geração manual

- Ctrl+Espaço executa prompt + tradução imediatamente;
- prompt manual executa o mesmo pipeline;
- retry manual limpa `promptText`, `finalText` e metadados antigos antes de refazer;
- chamadas manuais de tradução recebem `automatic=false`.

### Tradução manual do rascunho

- **Traduzir rascunho e aplicar** continua funcionando independentemente dos cards;
- deve traduzir o rascunho atual e aplicar pelo composer bridge;
- não deve transformar esse rascunho em card de sugestão pronto para envio.


## Sugerir mensagem — testes obrigatórios

- existe prompt padrão **Continuação da conversa** com `autoRun=false`;
- builder usa resumo mesmo sem rascunho;
- mensagens recentes entram apenas quando o prompt pede;
- sem resumo retorna `SUMMARY_REQUIRED` e zero chamadas OpenAI;
- prompt desabilitado retorna `PROMPT_UNAVAILABLE`;
- mesma combinação pode reutilizar cache;
- **Gerar outra** com `forceNew=true` executa nova chamada;
- tradução desligada produz `finalText=promptText`;
- tradução ligada só chega a `success` depois de `TRANSLATE_TEXT`;
- falha de tradução mantém `finalText=""` e impede envio;
- troca de conversa durante a geração descarta resposta;
- alteração da versão do resumo descarta resultado antigo;
- **Usar** confirma antes de sobrescrever um rascunho existente;
- **Aplicar e enviar** usa exclusivamente `finalText`;
- falha no composer mantém o resultado na sidebar;
- sucesso no envio limpa o resultado e informa confirmação;
- grupos usam o mesmo `whatsappChatId` e não dependem de telefone.


## Prompts por contato/grupo — matriz obrigatória

- prompt legado sem `scope` é tratado/migrado como `global`;
- todos os prompts padrão são globais;
- prompt global está disponível para qualquer conta/conversa;
- prompt específico exige correspondência exata de `accountId + chatId`;
- mesmo `chatId` em outra conta não autoriza o prompt;
- `PROMPT_LIST_FOR_CHAT` retorna globais + específicos da conversa atual;
- prompt específico de João não aparece em Maria;
- prompt de grupo não aparece em outro grupo ou contato;
- `SUGGEST_GENERATE` bloqueia prompt de outra conversa antes da OpenAI;
- `SUGGEST_MESSAGE_GENERATE` bloqueia prompt de outra conversa antes da OpenAI;
- prompts específicos automáticos têm prioridade sobre globais antes de aplicar `maxAutomaticPrompts`;
- salvar prompt específico força ids da conversa atual;
- duplicar global cria novo id e preserva o original;
- trocar de conversa recarrega a lista e invalida gerações anteriores;
- Sugerir mensagem mostra somente prompts permitidos para a conversa;
- tradução e `finalText` continuam iguais para prompts globais e específicos.
