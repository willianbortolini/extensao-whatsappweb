import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppAIApp } from '../src/app.js';

test('aplicar escreve só a tradução e descarta resultado após edição, troca de conversa ou erro', async () => {
  const previousChrome = globalThis.chrome;
  try {
    for (const scenario of ['success', 'edited', 'switched', 'disabled', 'error']) {
      let callback;
      const requests = [];
      const writes = [];
      let draft = 'meu rascunho';
      globalThis.chrome = { runtime: {
        sendMessage: (message, done) => { requests.push(message); callback = done; }
      } };
      const app = Object.create(WhatsAppAIApp.prototype);
      Object.assign(app, {
        account: { id: 'a' }, chat: { accountId: 'a', whatsappChatId: 'c' },
        chatSettings: { aiEnabled: true, translationEnabled: true },
        chatSettingsRevision: 1, generationVersion: 1, draftVersion: 1,
        dom: { readDraft: () => draft, setDraft: value => { writes.push(value); return true; } },
        ui: { setState() {}, clearSelection() {} }
      });
      const pending = app.useSuggestion({ text: 'Bom dia' });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].type, 'TRANSLATE_TEXT');
      assert.equal(requests[0].payload.text, 'Bom dia');
      assert.equal(requests[0].payload.direction, 'outgoing');
      await app.useSuggestion({ text: 'Clique duplicado' });
      assert.equal(requests.length, 1);
      if (scenario === 'edited') draft = 'nova mensagem';
      if (scenario === 'switched') app.chat = { accountId: 'a', whatsappChatId: 'other' };
      if (scenario === 'disabled') app.chatSettings = { aiEnabled: false };
      callback(scenario === 'error' ? { ok: false, message: 'Falha' } : { ok: true, text: 'Good morning' });
      await pending;
      assert.deepEqual(writes, scenario === 'success' ? ['Good morning'] : []);
      assert.equal(app.applyingTranslation, false);
      // No send-message action exists in this path; only composer insertion.
      assert.equal(requests.length, 1);
    }
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});
