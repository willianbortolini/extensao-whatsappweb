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
