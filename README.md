# WhatsApp AI Assistant

Extensão Chrome Manifest V3 para usar IA como copiloto de escrita dentro do WhatsApp Web.

O projeto é **local-first e BYOK (Bring Your Own Key)**: não existe backend próprio e cada usuário configura sua própria API key da OpenAI.

## Funcionalidades

- Barra lateral fixa à direita do WhatsApp Web.
- Checkbox **Usar IA neste contato** (ou grupo), salvo por conta e conversa. Desmarcar bloqueia sugestões e resumos, manuais e automáticos, incluindo chamadas ainda na fila. Chamadas já enviadas não podem ser desfeitas. Por padrão, a opção vem desmarcada: a IA só funciona após habilitação explícita naquela conversa.
- Oculta automaticamente a barra quando o WhatsApp abre imagem, vídeo, documento ou outro visualizador e restaura ao fechar.
- Detecta o rascunho digitado e, por padrão, espera 5 segundos sem alterações.
- Vários prompts configuráveis pelo usuário.
- Vários resultados de IA no mesmo ciclo.
- `Tab` / `Shift+Tab` percorrem sugestões.
- `Enter` e `Shift+Enter` não são interceptados: continuam enviando e quebrando linha no WhatsApp, respectivamente.
- `Ctrl+Enter` aplica e envia a sugestão selecionada (ou a primeira pronta se nenhuma estiver selecionada), com o foco no campo de mensagem. No modo tradução, traduz antes de enviar. Manter as teclas pressionadas não repete o envio.
- **Aplicar e enviar**, em cada sugestão, substitui o rascunho e aciona o envio no WhatsApp mediante clique explícito. No modo tradução, traduz primeiro para o idioma do contato. Os botões **Usar / Traduzir e aplicar** apenas preenchem o campo para revisão.
- `Alt+1..9` aplica diretamente uma sugestão pronta.
- A IA **nunca envia a mensagem automaticamente**.
- Histórico observado armazenado localmente em IndexedDB.
- Separação por conta do WhatsApp e por conversa/grupo.
- Resumo manual, automático e incremental por conversa.
- Cada prompt decide se recebe resumo e/ou mensagens recentes.
- Variáveis: `{{texto}}`, `{{resumo}}`, `{{mensagens}}`, `{{nome_contato}}`.
- API key em sessão ou persistida localmente.
- Chave nunca é entregue ao content script nem inserida no DOM do WhatsApp.
- OpenAI Responses API com `store: false`.
- Cache local, debounce, fila, limite de concorrência, rate limit e limites diários.
- Contabilização local de tokens retornados pela API.
- Sem telemetria externa.

## Instalação para desenvolvimento

1. Clone este repositório.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta do repositório.
6. Abra `https://web.whatsapp.com/`.
7. Na barra lateral, abra **Configurações** e informe sua API key.

Não há dependências de runtime ou etapa de build obrigatória. Os arquivos de `dist/` são loaders pequenos e o código principal usa ES Modules empacotados na própria extensão.

## OpenAI

O modelo padrão é:

```text
gpt-5.6-luna
```

Ele pode ser alterado nas configurações.

A extensão usa:

```text
POST https://api.openai.com/v1/responses
```

com:

```json
{
  "store": false
}
```

A assinatura do ChatGPT não é usada. O consumo ocorre na conta de API pertencente ao usuário da extensão.

## Segurança da API key

A chave nunca está no código-fonte.

Há dois modos:

### Somente nesta sessão

Usa `chrome.storage.session`.

Ao perder a sessão da extensão/navegador, a chave precisa ser informada novamente.

### Lembrar neste navegador

Usa `chrome.storage.local`.

A extensão restringe o storage para `TRUSTED_CONTEXTS`, impedindo acesso direto do content script.

Como não há backend, uma chave armazenada no navegador não possui o mesmo nível de proteção de um segredo mantido em servidor. Recomenda-se criar uma chave/projeto da OpenAI dedicado e configurar limites de gastos na conta OpenAI.

## Arquitetura

```text
WhatsApp Web
   |
   +-- content script
   |     |
   |     +-- DOM adapter
   |     +-- message observer
   |     +-- composer/debounce
   |     +-- sidebar
   |
   +--> chrome.runtime messages
               |
               v
        Service Worker
          |    |    |
          |    |    +-- rate limiter / fila
          |    +------- API key
          +------------ IndexedDB
               |
               v
          OpenAI API
```

O service worker é a fronteira confiável. O content script nunca recebe a API key.

## Histórico

### Modo tradução por conversa

Na barra lateral, marque **Usar IA neste contato**, configure **Meu idioma** e **Idioma do contato** e ative **Modo tradução nesta conversa**. Ambos os modos começam desativados.

- As mensagens recebidas ganham uma tradução junto ao balão, sem modificar o original do WhatsApp.
- Sugestões são geradas no seu idioma. **Traduzir e aplicar** traduz a sugestão para o idioma do contato e preenche o campo; não envia a mensagem.
- **Traduzir rascunho e aplicar** faz o mesmo com o texto digitado, sem precisar executar um prompt.
- Originais e traduções ficam no IndexedDB local quando **Salvar histórico** está habilitado. Traduções de rascunhos são guardadas como traduções, não como mensagens enviadas.
- Traduções salvas são reutilizadas. Texto editado, idioma ou modelo diferente gera uma nova tradução.
- Para limitar consumo, a tradução automática considera as 20 mensagens recebidas mais recentes carregadas na conversa, usa a fila e os limites automáticos existentes e para após erro. **Traduzir balões do contato** reconcilia todas as mensagens carregadas (antigas ou novas, recebidas e enviadas) com o histórico antes de traduzir os textos recebidos. O status informa progresso, conclusão ou motivo do bloqueio.
- A extensão traduz texto e legendas, não o conteúdo de áudio, imagens ou documentos. A detecção dos balões depende do DOM do WhatsApp.
- Desativar a IA ou o modo tradução impede novas traduções. Alterar o rascunho ou trocar de conversa durante uma tradução impede a aplicação do resultado antigo.
- Limpar histórico também apaga as traduções; elas seguem o prazo de retenção do histórico. Sem salvar histórico, não há persistência das traduções entre sessões.

O histórico é o **histórico observado pela extensão**, não um backup oficial do WhatsApp.

Quando uma conversa é aberta:

1. mensagens atualmente carregadas são reconciliadas;
2. somente mensagens ainda não armazenadas são gravadas;
3. um `MutationObserver` acompanha novas mensagens;
4. a extensão não rola a conversa automaticamente para buscar histórico antigo.

Se o WhatsApp fornecer um ID de mensagem, ele é usado. Caso contrário, existe um fingerprint local com tratamento de ocorrências repetidas.

Cada registro é identificado pela combinação de conta, conversa e ID da mensagem. A extensão guarda `whatsappTimestamp` (data/hora original), `messageTime` (horário exibido), `rawTimestamp` (metadado original), `capturedAt` (primeira leitura) e `lastObservedAt` (última leitura). Relê-los não cria duplicatas; mensagens distintas no mesmo minuto continuam separadas pelo ID. Quando só há horário e não há data confiável, a data fica desconhecida, em vez de usar o horário da leitura como se fosse o de envio. O contexto recente usa a ordem da data/hora original.

## Identificação da conta

A extensão tenta localizar um identificador/JID estável da conta no estado local do WhatsApp Web.

Quando consegue:

```text
wa:<jid>
```

é usado como namespace local.

Se não for possível obter uma identidade confiável, a extensão cria um namespace temporário por sessão. Isso prioriza **não misturar dados de contas diferentes**, mesmo que o histórico desse fallback não sobreviva de forma estável a um reload.

## Resumo

O resumo pode ser:

- manual;
- automático;
- desativado.

No automático é possível escolher o número de mensagens.

Exemplo:

```text
a cada 2 mensagens
```

As atualizações são incrementais:

```text
resumo atual + novas mensagens -> novo resumo
```

e não reprocessam toda a conversa em cada atualização.

O usuário também pode editar o resumo manualmente. Essa edição passa a ser a base da próxima atualização incremental.

## Prompts

Um prompt contém:

- nome;
- instruções;
- habilitado;
- execução automática;
- ordem;
- enviar resumo;
- enviar mensagens recentes;
- número de mensagens recentes;
- gerar resumo se estiver ausente;
- limite de tokens de saída.

Exemplo:

```text
Nome: Inglês

Traduza a mensagem para inglês natural.
Preserve significado, nomes, datas, números e valores.
Retorne somente a tradução.
```

Prompts podem utilizar:

```text
{{texto}}
{{resumo}}
{{mensagens}}
{{nome_contato}}
```

## Proteção contra consumo acidental

A extensão possui várias barreiras independentes:

- debounce;
- tamanho mínimo do rascunho;
- não repetir automaticamente o mesmo rascunho;
- cache de 30 minutos para a mesma combinação;
- fila;
- no máximo 2 requisições simultâneas;
- hard rate limit local;
- máximo configurável de prompts automáticos;
- limite diário local de tokens;
- limite diário local de chamadas automáticas;
- `max_output_tokens` em cada prompt;
- cancelamento lógico de resultados obsoletos;
- nenhuma repetição automática agressiva em erro.

## Privacidade

Sem telemetria na primeira versão.

A extensão não envia para servidores próprios:

- API key;
- histórico;
- resumo;
- prompts;
- métricas.

Conteúdo só deixa o computador quando o usuário executa uma operação de IA, e somente o contexto selecionado para aquele prompt é enviado à OpenAI.

## Visualizador de mídia

Quando o WhatsApp abre mídia/documentos:

```text
sidebar -> oculta
WhatsApp -> 100% da largura
```

Ao fechar:

```text
sidebar -> retorna
estado -> preservado
```

O estado manual da sidebar é independente. Se o usuário a fechou, abrir/fechar uma mídia não a reabre sozinho.

## Testes

```bash
npm test
npm run check
```

`npm test` executa testes de regras puras.

`npm run check` valida a sintaxe de todos os arquivos JavaScript.

Veja também `docs/TESTES.md`.

## Estrutura

```text
dist/
  background.js
  content-script.js
  media-viewer-guard.js

src/
  app.js
  config.js
  runtime.js
  styles.js
  ui.js

  ai/
    context-builder.js

  background/
    service-worker.js

  options/
    options.html
    options.css
    options.js

  storage/
    database.js

  whatsapp/
    dom.js

tests/
  core.test.js

docs/
  IMPLEMENTACAO.md
  TESTES.md
```

## Limitações conhecidas

O WhatsApp Web é uma aplicação privada e pode alterar sua estrutura de DOM. Por isso todos os seletores de WhatsApp ficam centralizados em `src/whatsapp/dom.js`.

A extensão evita classes CSS ofuscadas sempre que possível e prefere `data-testid`, `role`, `aria-*`, `contenteditable` e estrutura semântica.

Caso o WhatsApp mude, a correção deve ficar concentrada nessa camada.
