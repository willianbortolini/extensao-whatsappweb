import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppAIApp } from '../src/app.js';
import { translatedSuggestionForChat } from '../src/ai/translation.js';

test('aplicar escreve só a tradução e descarta resultado após edição, troca de conversa ou erro', async () => {
  const previousChrome = globalThis.chrome;
  try {
    for (const scenario of ['success', 'edited', 'switched', 'disabled', 'error']) {
      let callback;
      const requests = [];
      const writes = [];
      let draft = 'meu rascunho';

      globalThis.chrome = {
        runtime: {
          sendMessage: (message, done) => {
            requests.push(message);
            callback = done;
          }
        }
      };

      const app = Object.create(WhatsAppAIApp.prototype);
      Object.assign(app, {
        account: { id: 'a' },
        chat: { accountId: 'a', whatsappChatId: 'c' },
        chatSettings: { aiEnabled: true, translationEnabled: true },
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
          replaceText: async value => {
            writes.push(value);
            draft = value;
            return { ok: true, stage: 'REPLACED', method: 'lexical' };
          }
        },
        ui: { setState() {}, clearSelection() {} }
      });
      app.cancelDebounce = () => {};
      app.invalidateGenerations = () => {};

      const pending = app.useSuggestion({ text: 'Bom dia' });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].type, 'TRANSLATE_TEXT');
      assert.equal(requests[0].payload.text, 'Bom dia');
      assert.equal(requests[0].payload.direction, 'outgoing');

      await app.useSuggestion({ text: 'Clique duplicado' });
      assert.equal(requests.length, 1);

      if (scenario === 'edited') draft = 'nova mensagem';
      if (scenario === 'switched') app.dom.readConversation = () => ({ whatsappChatId: 'other' });
      if (scenario === 'disabled') app.chatSettings = { aiEnabled: false };

      callback(scenario === 'error'
        ? { ok: false, message: 'Falha' }
        : { ok: true, text: 'Good morning' });

      await pending;
      assert.deepEqual(writes, scenario === 'success' ? ['Good morning'] : []);
      assert.equal(app.applyingTranslation, false);
      assert.equal(requests.length, 1);
    }
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});


test('texto traduzido só é reutilizado na mesma conta, conversa e par de idiomas', () => {
  const item = {
    text: 'Mensagem de teste.',
    translatedText: 'Test message.',
    translationSourceText: 'Mensagem de teste.',
    translationAccountId: 'a',
    translationChatId: 'c',
    translationMyLanguage: 'pt-BR',
    translationContactLanguage: 'en'
  };
  const chat = { accountId: 'a', whatsappChatId: 'c' };
  const settings = { translationEnabled: true, myLanguage: 'pt-BR', contactLanguage: 'en' };

  assert.equal(translatedSuggestionForChat(item, settings, chat), 'Test message.');
  assert.equal(translatedSuggestionForChat(item, { ...settings, translationEnabled: false }, chat), '');
  assert.equal(translatedSuggestionForChat(item, { ...settings, contactLanguage: 'es' }, chat), '');
  assert.equal(translatedSuggestionForChat(item, settings, { ...chat, whatsappChatId: 'other' }), '');
  assert.equal(translatedSuggestionForChat(item, settings, { ...chat, accountId: 'other' }), '');
  assert.equal(translatedSuggestionForChat({ ...item, text: 'Mensagem alterada' }, settings, chat), '');
});
