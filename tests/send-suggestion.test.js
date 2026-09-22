import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppAIApp } from '../src/app.js';

function appFixture(translationEnabled = false) {
  const events = [];
  let draft = 'Rascunho original';
  const app = Object.create(WhatsAppAIApp.prototype);

  Object.assign(app, {
    account: { id: 'a' },
    chat: { accountId: 'a', whatsappChatId: 'c' },
    chatSettings: { aiEnabled: true, translationEnabled },
    chatSettingsRevision: 1,
    generationVersion: 1,
    draftVersion: 1,
    currentDraft: draft,
    suppressedDraft: null,
    lastAutoDraft: null,
    replacingDraft: false,
    sendingSuggestion: false,
    applyingTranslation: false,
    dom: {
      readConversation: () => ({ whatsappChatId: 'c' }),
      readDraft: () => draft
    },
    composerBridge: {
      replaceText: async text => {
        draft = text;
        events.push(['replace', text]);
        return { ok: true, stage: 'REPLACED', method: 'lexical' };
      },
      replaceAndSend: async text => {
        events.push(['replace-and-send', text]);
        draft = '';
        return { ok: true, stage: 'SEND_CONFIRMED', confirmation: 'composer-cleared', method: 'lexical' };
      }
    },
    ui: {
      setState() {},
      clearSelection() {},
      clearSuggestions() { events.push(['clear-suggestions']); }
    }
  });

  app.cancelDebounce = () => {};
  app.invalidateGenerations = () => { app.generationVersion += 1; };
  return { app, events, getDraft: () => draft };
}

test('Aplicar e enviar usa uma única transação de substituição+envio', async () => {
  const { app, events, getDraft } = appFixture(false);
  const item = { text: 'Mensagem de teste.' };

  assert.equal(await app.applyAndSendSuggestion(item), true);
  assert.equal(await app.applyAndSendSuggestion(item), false);
  assert.deepEqual(events, [
    ['replace-and-send', 'Mensagem de teste.'],
    ['clear-suggestions']
  ]);
  assert.equal(getDraft(), '');
  assert.equal(item.sendRequested, true);
});

test('Usar substitui a mensagem sem enviar', async () => {
  const { app, events, getDraft } = appFixture(false);
  assert.equal(await app.useSuggestion({ text: 'Sugestão revisada' }), true);
  assert.equal(getDraft(), 'Sugestão revisada');
  assert.deepEqual(events, [['replace', 'Sugestão revisada']]);
});

test('falha do bridge mantém a sugestão e não declara envio', async () => {
  const { app, events } = appFixture(false);
  app.composerBridge.replaceAndSend = async () => ({ ok: false, stage: 'SEND_BUTTON_NOT_FOUND' });
  const states = [];
  app.ui.setState = state => states.push(state);

  const item = { text: 'Mensagem de teste.' };
  assert.equal(await app.applyAndSendSuggestion(item), false);
  assert.equal(item.sendRequested, undefined);
  assert.deepEqual(events, []);
  assert.match(states.find(state => state.sendStatus)?.sendStatus || '', /botão real de enviar/i);
});

test('tradução é resolvida antes da transação de envio e mudança de conversa cancela', async () => {
  const previousChrome = globalThis.chrome;
  try {
    for (const scenario of ['success', 'error', 'switched']) {
      const { app, events } = appFixture(true);
      let complete;
      let calls = 0;
      globalThis.chrome = {
        runtime: {
          sendMessage: (_message, callback) => {
            calls += 1;
            complete = callback;
          }
        }
      };

      const item = { text: 'Bom dia' };
      const pending = app.applyAndSendSuggestion(item);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls, 1);

      if (scenario === 'switched') app.dom.readConversation = () => ({ whatsappChatId: 'other' });
      complete(scenario === 'error'
        ? { ok: false, message: 'Falha' }
        : { ok: true, text: 'Good morning' });

      await pending;
      assert.deepEqual(
        events,
        scenario === 'success'
          ? [['replace-and-send', 'Good morning'], ['clear-suggestions']]
          : []
      );
      assert.equal(app.sendingSuggestion, false);
    }
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});
