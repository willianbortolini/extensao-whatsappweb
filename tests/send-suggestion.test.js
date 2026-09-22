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
