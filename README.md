# Assistente IA para WhatsApp Web

Extensão para Google Chrome que adiciona um assistente de IA diretamente ao WhatsApp Web.

Ela ajuda a melhorar mensagens que você está escrevendo, sugerir a próxima mensagem de uma conversa, criar prompts personalizados por contato, resumir conversas e traduzir mensagens quando necessário.

A extensão utiliza a sua própria chave da API da OpenAI e **não envia mensagens automaticamente**. Você sempre revisa e decide o que será enviado.

## Principais recursos

- Sugestões de mensagens enquanto você escreve.
- **Sugerir mensagem** com base no contexto da conversa.
- Prompts globais e prompts específicos por contato ou grupo.
- Resumo de conversas.
- Tradução por conversa.
- Botões **Usar** e **Aplicar e enviar**.
- Atalhos de teclado para agilizar o atendimento.
- Configuração individual de IA por contato ou grupo.

---

# Instalação no Google Chrome

## 1. Baixe a extensão

Na página deste repositório no GitHub, clique em:

```text
Code
↓
Download ZIP
```

Depois de baixar, extraia o arquivo ZIP para uma pasta do computador.

Você também pode clonar o repositório com Git:

```bash
git clone <URL_DO_REPOSITORIO>
```

---

## 2. Abra a página de extensões do Chrome

No Google Chrome, abra:

```text
chrome://extensions
```

---

## 3. Ative o Modo do desenvolvedor

No canto superior direito da página, ative:

```text
Modo do desenvolvedor
```

---

## 4. Carregue a extensão

Clique em:

```text
Carregar sem compactação
```

Selecione a pasta da extensão que você extraiu ou clonou.

É a pasta onde está o arquivo:

```text
manifest.json
```

---

## 5. Abra o WhatsApp Web

Acesse:

```text
https://web.whatsapp.com/
```

Se o WhatsApp Web já estava aberto antes da instalação, atualize a página.

Você pode usar:

```text
Ctrl + Shift + R
```

---

# Configurando a OpenAI

A extensão precisa de uma chave da API da OpenAI para gerar as respostas.

Na barra lateral da extensão, clique no ícone:

```text
⚙ Configurações
```

Informe sua API key da OpenAI.

Você poderá escolher entre:

### Somente nesta sessão

A chave é usada durante a sessão atual do navegador.

### Lembrar neste navegador

A chave fica salva localmente no navegador.

Depois de informar a chave, use a opção de teste disponível nas configurações para confirmar que ela está funcionando.

> A assinatura do ChatGPT e a API da OpenAI são serviços separados. Para usar esta extensão é necessário possuir uma chave válida da API da OpenAI.

---

# Começando a usar

Abra uma conversa no WhatsApp Web.

Na barra lateral da extensão:

1. Ative **IA** para aquela conversa.
2. Digite normalmente no campo de mensagem do WhatsApp.
3. Aguarde alguns segundos ou pressione **Ctrl + Espaço** para gerar as sugestões imediatamente.
4. Revise a sugestão.
5. Clique em **Usar** para colocar o texto no campo do WhatsApp ou em **Aplicar e enviar** para substituir o texto e enviar.

A extensão nunca decide enviar uma mensagem sozinha.

---

# Sugerir a próxima mensagem

Se você não souber o que escrever, use:

```text
Sugerir mensagem
```

A extensão utiliza o resumo e o contexto disponível da conversa para criar uma mensagem de continuidade.

Você pode escolher o prompt que será usado antes de gerar a mensagem.

---

# Prompts por contato

Além dos prompts globais, você pode criar prompts específicos para uma conversa.

Exemplo:

```text
Tom pessoal
Atendimento comercial
Follow-up comercial
Atendimento técnico
```

Um prompt específico aparece somente no contato ou grupo para o qual foi criado.

---

# Tradução

A tradução pode ser ativada individualmente por conversa.

Quando ativada, configure:

```text
Meu idioma
Idioma do contato
```

As sugestões ficam prontas no idioma configurado para o contato antes de serem usadas ou enviadas.

---

# Atualizando a extensão

Se você instalou usando Git:

```bash
git pull
```

Depois abra:

```text
chrome://extensions
```

e clique no botão de **recarregar** da extensão.

Por fim, atualize o WhatsApp Web com:

```text
Ctrl + Shift + R
```

Se você instalou usando **Download ZIP**, baixe a versão mais recente, substitua a pasta antiga e recarregue a extensão no Chrome.

---

# Problemas após instalar

Se a barra lateral não aparecer:

1. confirme que a extensão está ativada em `chrome://extensions`;
2. clique em **Recarregar** na extensão;
3. abra novamente o WhatsApp Web;
4. pressione **Ctrl + Shift + R**.

Se as sugestões não forem geradas:

1. confirme que a IA está ativada para a conversa;
2. confirme que a API key foi configurada;
3. use o teste da API nas configurações;
4. verifique se a IA não está pausada.

---

## Aviso

O WhatsApp Web pode alterar sua interface ao longo do tempo. Caso alguma funcionalidade pare de funcionar após uma atualização do WhatsApp, verifique se existe uma versão mais recente desta extensão no repositório.
