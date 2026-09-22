import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppAIApp } from '../src/app.js';

function fixture({ translationEnabled = false, draft = '', summary = 'Cliente aguarda retorno.' } = {}) {
  let currentDraft = draft;
  const bridgeCalls = [];
  const states = [];
  const app = Object.create(WhatsAppAIApp.prototype);

  Object.assign(app, {
    account: { id: 'a' },
    chat: { accountId: 'a', whatsappChatId: 'c', displayName: 'Cliente' },
    settings: { aiPaused: false },
    keyStatus: { configured: true },
    prompts: [{
      id: 'default-suggest-message-v1',
      name: 'Continuação da conversa',
      enabled: true,
      includeRecentMessages: true
    }],
    summary: summary ? {
      summary,
      summaryVersion: 3,
      messagesSinceSummary: 0
    } : null,
    chatSettings: {
      aiEnabled: true,
      translationEnabled,
      myLanguage: 'pt-BR',
      contactLanguage: 'en'
    },
    chatSettingsLoading: false,
    chatSettingsSaving: false,
    chatSettingsRevision: 1,
    suggestedMessage: null,
    suggestedMessagePromptId: 'default-suggest-message-v1',
    suggestedMessageGeneration: 0,
    suggestedMessageStatus: '',
    suggestedMessageSending: false,
    applyingTranslation: false,
    sendingSuggestion: false,
    replacingDraft: false,
    currentDraft,
    suppressedDraft: null,
    lastAutoDraft: null,
    draftVersion: 1,
    generationVersion: 1,
    debounceTimer: null,
    dom: {
      readConversation: () => ({ whatsappChatId: app.chat.whatsappChatId }),
      readDraft: () => currentDraft
    },
    composerBridge: {
      async replaceText(text) {
        bridgeCalls.push(['replace', text]);
        currentDraft = text;
        return { ok: true, stage: 'REPLACED' };
      },
      async replaceAndSend(text) {
        bridgeCalls.push(['send', text]);
        currentDraft = '';
        return { ok: true, stage: 'SEND_CONFIRMED' };
      }
    },
    ui: {
      suggestions: [],
      setState(patch) { states.push(patch); },
      clearSuggestions() { this.suggestions = []; },
      clearSelection() {}
    }
  });

  app.cancelDebounce = () => {};
  app.invalidateGenerations = () => { app.generationVersion += 1; };

  return {
    app,
    states,
    bridgeCalls,
    getDraft: () => currentDraft,
    setDraft: value => { currentDraft = value; }
  };
}

function installRuntime(responder) {
  const previousChrome = globalThis.chrome;
  const requests = [];
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        requests.push(message);
        const result = responder(message, requests.length - 1);
        if (result !== undefined) queueMicrotask(() => callback(result));
      }
    }
  };
  return {
    requests,
    restore() {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  };
}

test('Sugerir mensagem não exige rascunho e usa finalText sem tradução', async () => {
  const { app } = fixture({ translationEnabled: false, draft: '' });
  const rt = installRuntime(message => {
    assert.equal(message.type, 'SUGGEST_MESSAGE_GENERATE');
    assert.deepEqual(message.payload, {
      accountId: 'a',
      chatId: 'c',
      promptId: 'default-suggest-message-v1',
      forceNew: false
    });
    return {
      ok: true,
      text: 'Olá! Podemos continuar?',
      cached: false,
      summaryVersion: 3,
      promptName: 'Continuação da conversa'
    };
  });

  try {
    assert.equal(await app.generateSuggestedMessage(false), true);
    assert.equal(app.suggestedMessage.status, 'success');
    assert.equal(app.suggestedMessage.promptText, 'Olá! Podemos continuar?');
    assert.equal(app.suggestedMessage.finalText, 'Olá! Podemos continuar?');
    assert.equal(app.suggestedMessage.translationApplied, false);
    assert.equal(rt.requests.length, 1);
  } finally {
    rt.restore();
  }
});

test('com tradução ativa Sugerir mensagem só fica pronta depois de traduzida', async () => {
  const { app } = fixture({ translationEnabled: true });
  const rt = installRuntime(message => {
    if (message.type === 'SUGGEST_MESSAGE_GENERATE') {
      return {
        ok: true,
        text: 'Posso reservar para você?',
        cached: false,
        summaryVersion: 3,
        promptName: 'Continuação da conversa'
      };
    }
    if (message.type === 'TRANSLATE_TEXT') {
      assert.equal(message.payload.text, 'Posso reservar para você?');
      assert.equal(message.payload.direction, 'outgoing');
      assert.equal(message.payload.automatic, false);
      return { ok: true, text: 'Would you like me to reserve it for you?', cached: false };
    }
    assert.fail('Operação inesperada: ' + message.type);
  });

  try {
    assert.equal(await app.generateSuggestedMessage(false), true);
    assert.deepEqual(rt.requests.map(request => request.type), ['SUGGEST_MESSAGE_GENERATE', 'TRANSLATE_TEXT']);
    assert.equal(app.suggestedMessage.promptText, 'Posso reservar para você?');
    assert.equal(app.suggestedMessage.finalText, 'Would you like me to reserve it for you?');
    assert.equal(app.suggestedMessage.translationApplied, true);
    assert.equal(app.suggestedMessage.sourceLanguage, 'pt-BR');
    assert.equal(app.suggestedMessage.targetLanguage, 'en');
    assert.equal(app.suggestedMessage.status, 'success');
  } finally {
    rt.restore();
  }
});

test('falha de tradução nunca disponibiliza promptText para envio', async () => {
  const { app, bridgeCalls } = fixture({ translationEnabled: true });
  const rt = installRuntime(message => {
    if (message.type === 'SUGGEST_MESSAGE_GENERATE') {
      return {
        ok: true,
        text: 'Posso reservar para você?',
        summaryVersion: 3,
        promptName: 'Continuação'
      };
    }
    return { ok: false, error: 'OPENAI_NETWORK', message: 'Falha de rede' };
  });

  try {
    assert.equal(await app.generateSuggestedMessage(false), false);
    assert.equal(app.suggestedMessage.status, 'error');
    assert.equal(app.suggestedMessage.promptText, 'Posso reservar para você?');
    assert.equal(app.suggestedMessage.finalText, '');
    assert.equal(await app.sendSuggestedMessage(), false);
    assert.deepEqual(bridgeCalls, []);
  } finally {
    rt.restore();
  }
});

test('conversa sem resumo não dispara nenhuma chamada de IA', async () => {
  const { app } = fixture({ summary: '' });
  const rt = installRuntime(() => assert.fail('Não deve chamar runtime sem resumo'));

  try {
    assert.equal(await app.generateSuggestedMessage(false), false);
    assert.match(app.suggestedMessageStatus, /ainda não possui resumo/i);
    assert.equal(rt.requests.length, 0);
  } finally {
    rt.restore();
  }
});

test('Usar pede confirmação antes de substituir um rascunho existente', async () => {
  const previousConfirm = globalThis.confirm;
  const { app, bridgeCalls, getDraft } = fixture({ draft: 'Meu rascunho' });
  app.suggestedMessage = {
    status: 'success',
    accountId: 'a',
    chatId: 'c',
    promptText: 'Mensagem final',
    finalText: 'Mensagem final',
    translationApplied: false
  };

  try {
    globalThis.confirm = () => false;
    assert.equal(await app.useSuggestedMessage(), false);
    assert.deepEqual(bridgeCalls, []);
    assert.equal(getDraft(), 'Meu rascunho');

    globalThis.confirm = () => true;
    assert.equal(await app.useSuggestedMessage(), true);
    assert.deepEqual(bridgeCalls, [['replace', 'Mensagem final']]);
    assert.equal(getDraft(), 'Mensagem final');
  } finally {
    if (previousConfirm === undefined) delete globalThis.confirm;
    else globalThis.confirm = previousConfirm;
  }
});

test('Aplicar e enviar usa exclusivamente finalText e mantém resultado em caso de falha', async () => {
  const { app, bridgeCalls } = fixture({ translationEnabled: true });
  app.suggestedMessage = {
    status: 'success',
    accountId: 'a',
    chatId: 'c',
    promptText: 'Mensagem em português',
    finalText: 'Message in English',
    translationApplied: true,
    translationAccountId: 'a',
    translationChatId: 'c',
    sourceLanguage: 'pt-BR',
    targetLanguage: 'en'
  };

  app.composerBridge.replaceAndSend = async text => {
    bridgeCalls.push(['send', text]);
    return { ok: false, stage: 'SEND_BUTTON_NOT_FOUND' };
  };

  assert.equal(await app.sendSuggestedMessage(), false);
  assert.deepEqual(bridgeCalls, [['send', 'Message in English']]);
  assert.ok(app.suggestedMessage);
  assert.equal(app.suggestedMessage.finalText, 'Message in English');
});

test('Aplicar e enviar com sucesso limpa a mensagem sugerida', async () => {
  const { app, bridgeCalls } = fixture();
  app.suggestedMessage = {
    status: 'success',
    accountId: 'a',
    chatId: 'c',
    promptText: 'Podemos continuar?',
    finalText: 'Podemos continuar?',
    translationApplied: false
  };

  assert.equal(await app.sendSuggestedMessage(), true);
  assert.deepEqual(bridgeCalls, [['send', 'Podemos continuar?']]);
  assert.equal(app.suggestedMessage, null);
  assert.match(app.suggestedMessageStatus, /enviada/i);
});

test('troca de conversa durante geração descarta a resposta antiga', async () => {
  const { app } = fixture();
  const previousChrome = globalThis.chrome;
  let callback;
  globalThis.chrome = {
    runtime: {
      sendMessage(_message, done) { callback = done; }
    }
  };

  try {
    const pending = app.generateSuggestedMessage(false);
    await new Promise(resolve => setImmediate(resolve));
    app.chat = { accountId: 'a', whatsappChatId: 'other', displayName: 'Outro' };
    callback({
      ok: true,
      text: 'Mensagem antiga',
      summaryVersion: 3,
      promptName: 'Continuação'
    });
    assert.equal(await pending, false);
    assert.notEqual(app.suggestedMessage?.status, 'success');
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test('Gerar outra envia forceNew=true', async () => {
  const { app } = fixture();
  const rt = installRuntime(message => ({
    ok: true,
    text: 'Outra mensagem',
    cached: false,
    summaryVersion: 3,
    promptName: 'Continuação'
  }));

  try {
    await app.generateSuggestedMessage(true);
    assert.equal(rt.requests[0].payload.forceNew, true);
  } finally {
    rt.restore();
  }
});
