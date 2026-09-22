import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppAIApp } from '../src/app.js';

function appFixture({ translationEnabled = false, draft = 'teste envio', contactLanguage = 'en' } = {}) {
  const events = [];
  let currentDraft = draft;

  const app = Object.create(WhatsAppAIApp.prototype);
  Object.assign(app, {
    account: { id: 'a' },
    chat: { accountId: 'a', whatsappChatId: 'c', displayName: 'Contato' },
    chatSettings: {
      aiEnabled: true,
      translationEnabled,
      myLanguage: 'pt-BR',
      contactLanguage
    },
    chatSettingsRevision: 1,
    chatSettingsLoading: false,
    chatSettingsSaving: false,
    generationVersion: 1,
    draftVersion: 1,
    currentDraft,
    suppressedDraft: null,
    lastAutoDraft: null,
    replacingDraft: false,
    sendingSuggestion: false,
    applyingTranslation: false,
    settings: {
      aiPaused: false,
      automaticSuggestions: true,
      maxAutomaticPrompts: 3
    },
    keyStatus: { configured: true },
    prompts: [{
      id: 'p1',
      name: 'Melhorar',
      enabled: true,
      autoRun: true
    }],
    dom: {
      readConversation: () => ({ whatsappChatId: 'c' }),
      readDraft: () => currentDraft
    },
    composerBridge: {
      replaceText: async text => {
        currentDraft = text;
        events.push(['replace', text]);
        return { ok: true, stage: 'REPLACED', method: 'lexical' };
      },
      replaceAndSend: async text => {
        events.push(['replace-and-send', text]);
        currentDraft = '';
        return { ok: true, stage: 'SEND_CONFIRMED', confirmation: 'composer-cleared', method: 'lexical' };
      }
    },
    ui: {
      suggestions: [],
      setState() {},
      setSuggestions(items) { this.suggestions = items; },
      clearSelection() {},
      clearSuggestions() {
        this.suggestions = [];
        events.push(['clear-suggestions']);
      }
    }
  });

  app.cancelDebounce = () => {};
  app.invalidateGenerations = () => { app.generationVersion += 1; };

  return {
    app,
    events,
    getDraft: () => currentDraft,
    setDraft: value => { currentDraft = value; }
  };
}

function runtime(responder) {
  const previousChrome = globalThis.chrome;
  const requests = [];
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        requests.push(message);
        const result = responder(message, requests.length - 1);
        queueMicrotask(() => callback(result));
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

function queuedItem({ automatic = false } = {}) {
  return {
    id: '1:p1',
    promptId: 'p1',
    promptName: 'Melhorar',
    status: 'queued',
    text: '',
    promptText: '',
    finalText: '',
    translationApplied: false,
    sourceLanguage: null,
    targetLanguage: null,
    error: '',
    draft: 'teste envio',
    automatic
  };
}

test('sem tradução: promptText e finalText são o resultado do prompt', async () => {
  const { app } = appFixture();
  const item = queuedItem();
  app.ui.suggestions = [item];
  const rt = runtime(message => {
    assert.equal(message.type, 'SUGGEST_GENERATE');
    return { ok: true, text: 'Mensagem de teste.', cached: false };
  });

  try {
    await app.generateSuggestionItem(item, 1);
    assert.equal(item.status, 'success');
    assert.equal(item.promptText, 'Mensagem de teste.');
    assert.equal(item.finalText, 'Mensagem de teste.');
    assert.equal(item.translationApplied, false);
    assert.equal(rt.requests.length, 1);
  } finally {
    rt.restore();
  }
});

test('com tradução: prompt é aplicado primeiro e só depois traduzido para o idioma do contato', async () => {
  const { app } = appFixture({ translationEnabled: true });
  const item = queuedItem();
  app.ui.suggestions = [item];
  const rt = runtime(message => {
    if (message.type === 'SUGGEST_GENERATE') {
      return { ok: true, text: 'Esta é uma mensagem de teste.', cached: false };
    }
    if (message.type === 'TRANSLATE_TEXT') {
      assert.equal(message.payload.text, 'Esta é uma mensagem de teste.');
      assert.equal(message.payload.direction, 'outgoing');
      assert.equal(message.payload.automatic, false);
      return { ok: true, text: 'This is a test message.', cached: false };
    }
    assert.fail('Operação inesperada: ' + message.type);
  });

  try {
    await app.generateSuggestionItem(item, 1);
    assert.deepEqual(rt.requests.map(request => request.type), ['SUGGEST_GENERATE', 'TRANSLATE_TEXT']);
    assert.equal(item.status, 'success');
    assert.equal(item.promptText, 'Esta é uma mensagem de teste.');
    assert.equal(item.finalText, 'This is a test message.');
    assert.equal(item.translationApplied, true);
    assert.equal(item.sourceLanguage, 'pt-BR');
    assert.equal(item.targetLanguage, 'en');
    assert.equal(item.translationAccountId, 'a');
    assert.equal(item.translationChatId, 'c');
  } finally {
    rt.restore();
  }
});

test('sugestão automática marca também a tradução como automática', async () => {
  const { app } = appFixture({ translationEnabled: true });
  const item = queuedItem({ automatic: true });
  app.ui.suggestions = [item];
  const rt = runtime(message => {
    if (message.type === 'SUGGEST_GENERATE') return { ok: true, text: 'Bom dia', cached: false };
    if (message.type === 'TRANSLATE_TEXT') {
      assert.equal(message.payload.automatic, true);
      return { ok: true, text: 'Good morning', cached: false };
    }
    assert.fail('Operação inesperada');
  });

  try {
    await app.generateSuggestionItem(item, 1);
    assert.equal(item.finalText, 'Good morning');
    assert.equal(item.status, 'success');
  } finally {
    rt.restore();
  }
});

test('falha na tradução deixa o item em erro e nunca disponibiliza o português para envio', async () => {
  const { app, events } = appFixture({ translationEnabled: true });
  const item = queuedItem();
  app.ui.suggestions = [item];
  const rt = runtime(message => {
    if (message.type === 'SUGGEST_GENERATE') return { ok: true, text: 'Mensagem de teste.', cached: false };
    return { ok: false, error: 'OPENAI_NETWORK', message: 'Falha de rede' };
  });

  try {
    await app.generateSuggestionItem(item, 1);
    assert.equal(item.status, 'error');
    assert.equal(item.promptText, 'Mensagem de teste.');
    assert.equal(item.finalText, '');
    assert.equal(item.translationApplied, false);
    assert.match(item.error, /Não foi possível traduzir/i);
    assert.equal(await app.applyAndSendSuggestion(item), false);
    assert.deepEqual(events, []);
  } finally {
    rt.restore();
  }
});

test('Usar e Aplicar e enviar consomem somente finalText e não fazem tradução tardia', async () => {
  const { app, events, getDraft } = appFixture({ translationEnabled: true });
  const item = {
    status: 'success',
    text: 'Esta é uma mensagem de teste.',
    promptText: 'Esta é uma mensagem de teste.',
    finalText: 'This is a test message.',
    translationApplied: true,
    translationAccountId: 'a',
    translationChatId: 'c',
    sourceLanguage: 'pt-BR',
    targetLanguage: 'en'
  };
  const rt = runtime(() => assert.fail('Ações prontas não podem chamar a API de tradução'));

  try {
    assert.equal(await app.useSuggestion(item), true);
    assert.equal(getDraft(), 'This is a test message.');

    assert.equal(await app.applyAndSendSuggestion(item), true);
    assert.deepEqual(events, [
      ['replace', 'This is a test message.'],
      ['replace-and-send', 'This is a test message.'],
      ['clear-suggestions']
    ]);
    assert.equal(rt.requests.length, 0);
    assert.equal(item.sendRequested, true);
  } finally {
    rt.restore();
  }
});

test('mudança do rascunho durante prompt ou tradução descarta a resposta antiga', async () => {
  for (const stage of ['prompt', 'translation']) {
    const { app, setDraft } = appFixture({ translationEnabled: true });
    const item = queuedItem();
    app.ui.suggestions = [item];

    const previousChrome = globalThis.chrome;
    const callbacks = [];
    globalThis.chrome = {
      runtime: {
        sendMessage(message, callback) {
          callbacks.push({ message, callback });
        }
      }
    };

    try {
      const pending = app.generateSuggestionItem(item, 1);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(callbacks[0].message.type, 'SUGGEST_GENERATE');

      if (stage === 'prompt') {
        setDraft('texto alterado');
        callbacks[0].callback({ ok: true, text: 'Mensagem antiga.', cached: false });
        await pending;
        assert.equal(callbacks.length, 1);
        assert.notEqual(item.status, 'success');
      } else {
        callbacks[0].callback({ ok: true, text: 'Mensagem de teste.', cached: false });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(callbacks[1].message.type, 'TRANSLATE_TEXT');
        setDraft('texto alterado');
        callbacks[1].callback({ ok: true, text: 'Test message.', cached: false });
        await pending;
        assert.notEqual(item.status, 'success');
        assert.equal(item.finalText, '');
      }
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  }
});

test('prompt manual usa o mesmo pipeline e termina com finalText traduzido', async () => {
  const { app } = appFixture({ translationEnabled: true });
  const rt = runtime(message => {
    if (message.type === 'SUGGEST_GENERATE') return { ok: true, text: 'Tudo bem?', cached: false };
    if (message.type === 'TRANSLATE_TEXT') return { ok: true, text: 'How are you?', cached: false };
    assert.fail('Operação inesperada');
  });

  try {
    await app.runManualPrompt({ id: 'p1', name: 'Melhorar' });
    assert.equal(app.ui.suggestions.length, 1);
    const item = app.ui.suggestions[0];
    assert.equal(item.status, 'success');
    assert.equal(item.promptText, 'Tudo bem?');
    assert.equal(item.finalText, 'How are you?');
    assert.equal(item.automatic, false);
  } finally {
    rt.restore();
  }
});

test('retry manual limpa finalText antigo e refaz prompt + tradução', async () => {
  const { app } = appFixture({ translationEnabled: true });
  const old = {
    id: 'old',
    promptId: 'p1',
    promptName: 'Melhorar',
    status: 'error',
    text: 'Antigo',
    promptText: 'Antigo',
    finalText: 'Old',
    translationApplied: true,
    sourceLanguage: 'pt-BR',
    targetLanguage: 'en',
    draft: 'teste envio',
    automatic: true
  };
  const rt = runtime(message => {
    if (message.type === 'SUGGEST_GENERATE') return { ok: true, text: 'Novo', cached: false };
    if (message.type === 'TRANSLATE_TEXT') return { ok: true, text: 'New', cached: false };
    assert.fail('Operação inesperada');
  });

  try {
    await app.retrySuggestion(old);
    const item = app.ui.suggestions[0];
    assert.equal(item.status, 'success');
    assert.equal(item.promptText, 'Novo');
    assert.equal(item.finalText, 'New');
    assert.equal(item.automatic, false);
  } finally {
    rt.restore();
  }
});
