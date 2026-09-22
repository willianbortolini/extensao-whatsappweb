import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppAIApp } from '../src/app.js';

function appFixture(translationEnabled) {
  const events = [];
  let draft = 'Rascunho original';
  const app = Object.create(WhatsAppAIApp.prototype);
  Object.assign(app, {
    account: { id: 'a' }, chat: { accountId: 'a', whatsappChatId: 'c' },
    chatSettings: { aiEnabled: true, translationEnabled }, chatSettingsRevision: 1,
    generationVersion: 1, draftVersion: 1,
    dom: {
      readConversation: () => ({ whatsappChatId: 'c' }),
      readDraft: () => draft,
      setDraft: value => { draft = value; events.push(['apply', value]); return true; },
      sendDraft: async (text, chatId, allowed) => {
        assert.equal(chatId, 'c');
        assert.equal(allowed(), true);
        assert.equal(draft, text);
        events.push(['send', text]);
        return true;
      }
    },
    ui: { setState() {}, clearSelection() {}, clearSuggestions() {} }
  });
  return { app, events };
}

test('aplicar e enviar substitui texto antes do envio e impede repetição do mesmo card', async () => {
  const { app, events } = appFixture(false);
  const item = { text: 'Sugestão revisada' };
  await app.applyAndSendSuggestion(item);
  await app.applyAndSendSuggestion(item);
  assert.deepEqual(events, [['apply', item.text], ['send', item.text]]);
});

test('aplicar e enviar traduz primeiro e cancela se conversa mudar ou tradução falhar', async () => {
  const previousChrome = globalThis.chrome;
  try {
    for (const scenario of ['success', 'error', 'switched']) {
      const { app, events } = appFixture(true);
      let complete;
      let calls = 0;
      globalThis.chrome = { runtime: { sendMessage: (_message, callback) => { calls++; complete = callback; } } };
      const pending = app.applyAndSendSuggestion({ text: 'Bom dia' });
      await app.applyAndSendSuggestion({ text: 'Clique repetido' });
      assert.equal(calls, 1);
      assert.deepEqual(events, []);
      if (scenario === 'switched') app.dom.readConversation = () => ({ whatsappChatId: 'other' });
      complete(scenario === 'error' ? { ok: false, message: 'Falha' } : { ok: true, text: 'Good morning' });
      await pending;
      assert.deepEqual(events, scenario === 'success' ? [['apply', 'Good morning'], ['send', 'Good morning']] : []);
      assert.equal(app.sendingSuggestion, false);
    }
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome; else globalThis.chrome = previousChrome;
  }
});

test('opção Usar continua aplicando sem enviar', async () => {
  const { app, events } = appFixture(false);
  await app.useSuggestion({ text: 'Revisar antes de enviar' });
  assert.deepEqual(events, [['apply', 'Revisar antes de enviar']]);
});

test('evento input disparado durante substituição interna não apaga sugestões', () => {
  const app = Object.create(WhatsAppAIApp.prototype);
  let cleared = 0;
  Object.assign(app, {
    replacingDraft: true,
    currentDraft: 'Texto antigo',
    lastAutoDraft: null,
    draftVersion: 1,
    generationVersion: 1,
    isComposing: false,
    settings: {},
    prompts: [],
    suppressedDraft: null,
    dom: { readDraft: () => 'Sugestão nova' },
    ui: { clearSuggestions: () => { cleared++; } }
  });

  app.onDraftChanged();
  assert.equal(cleared, 0);
  assert.equal(app.currentDraft, 'Texto antigo');
});



test('mesmo texto não agenda sugestões automáticas repetidamente', () => {
  const app = Object.create(WhatsAppAIApp.prototype);
  let clears = 0;
  let scheduled = 0;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = () => { scheduled++; return 1; };
  globalThis.clearTimeout = () => {};

  Object.assign(app, {
    replacingDraft: false,
    currentDraft: 'teste',
    lastAutoDraft: null,
    draftVersion: 1,
    generationVersion: 1,
    isComposing: false,
    debounceTimer: null,
    suppressedDraft: null,
    settings: { automaticSuggestions: true },
    prompts: [{ enabled: true, autoRun: true }],
    chat: {},
    account: {},
    keyStatus: { configured: true },
    chatSettings: { aiEnabled: true },
    chatSettingsLoading: false,
    chatSettingsSaving: false,
    applyingTranslation: false,
    sendingSuggestion: false,
    dom: { readDraft: () => 'teste' },
    ui: { clearSuggestions: () => { clears++; } }
  });
  app.isChatAIEnabled = () => true;

  try {
    app.onDraftChanged();
    assert.equal(scheduled, 0);
    assert.equal(clears, 0);
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

test('Ctrl+Espaço força geração imediata e cancela a espera', () => {
  const previousDocument = globalThis.document;
  const composer = { contains: () => false };
  globalThis.document = {
    activeElement: composer,
    body: { classList: { contains: () => false } }
  };

  const calls = [];
  const app = Object.create(WhatsAppAIApp.prototype);
  Object.assign(app, {
    ui: { suggestions: [], getSelectedSuggestion: () => null },
    dom: { getComposer: () => composer, readDraft: () => 'teste envio' },
    canRequestSuggestions: () => true,
    runAutomaticPrompts: (draft, force) => calls.push([draft, force]),
    isComposing: false
  });

  const event = {
    key: ' ',
    code: 'Space',
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  };

  try {
    app.handleKeyboard(event);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.deepEqual(calls, [['teste envio', true]]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
