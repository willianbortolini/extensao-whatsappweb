import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppAIApp } from '../src/app.js';
import { finalSuggestionTextForChat } from '../src/ai/translation.js';

test('finalText traduzido só é válido para a mesma conta, conversa e par de idiomas', () => {
  const item = {
    status: 'success',
    promptText: 'Mensagem de teste.',
    finalText: 'Test message.',
    translationApplied: true,
    translationAccountId: 'a',
    translationChatId: 'c',
    sourceLanguage: 'pt-BR',
    targetLanguage: 'en'
  };
  const chat = { accountId: 'a', whatsappChatId: 'c' };
  const settings = { translationEnabled: true, myLanguage: 'pt-BR', contactLanguage: 'en' };

  assert.equal(finalSuggestionTextForChat(item, settings, chat), 'Test message.');
  assert.equal(finalSuggestionTextForChat(item, { ...settings, contactLanguage: 'es' }, chat), '');
  assert.equal(finalSuggestionTextForChat(item, settings, { ...chat, whatsappChatId: 'other' }), '');
  assert.equal(finalSuggestionTextForChat(item, settings, { ...chat, accountId: 'other' }), '');
});

test('com tradução desligada rejeita uma sugestão traduzida antiga e aceita finalText local', () => {
  const chat = { accountId: 'a', whatsappChatId: 'c' };
  const settings = { translationEnabled: false, myLanguage: 'pt-BR', contactLanguage: 'en' };

  assert.equal(finalSuggestionTextForChat({
    status: 'success',
    finalText: 'Mensagem final.',
    translationApplied: false
  }, settings, chat), 'Mensagem final.');

  assert.equal(finalSuggestionTextForChat({
    status: 'success',
    finalText: 'Old translated text',
    translationApplied: true
  }, settings, chat), '');
});

test('traduzir rascunho manualmente continua separado do pipeline de sugestões', async () => {
  const previousChrome = globalThis.chrome;
  let draft = 'Bom dia';
  const writes = [];
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        assert.equal(message.type, 'TRANSLATE_TEXT');
        assert.equal(message.payload.text, 'Bom dia');
        assert.equal(message.payload.direction, 'outgoing');
        assert.equal(message.payload.automatic, false);
        queueMicrotask(() => callback({ ok: true, text: 'Good morning' }));
      }
    }
  };

  const app = Object.create(WhatsAppAIApp.prototype);
  Object.assign(app, {
    account: { id: 'a' },
    chat: { accountId: 'a', whatsappChatId: 'c' },
    chatSettings: {
      aiEnabled: true,
      translationEnabled: true,
      myLanguage: 'pt-BR',
      contactLanguage: 'en'
    },
    chatSettingsRevision: 1,
    chatSettingsLoading: false,
    chatSettingsSaving: false,
    generationVersion: 1,
    draftVersion: 1,
    currentDraft: draft,
    suppressedDraft: null,
    replacingDraft: false,
    sendingSuggestion: false,
    applyingTranslation: false,
    dom: {
      readConversation: () => ({ whatsappChatId: 'c' }),
      readDraft: () => draft
    },
    composerBridge: {
      replaceText: async text => {
        writes.push(text);
        draft = text;
        return { ok: true, stage: 'REPLACED' };
      }
    },
    ui: {
      setState() {},
      clearSuggestions() {}
    }
  });
  app.cancelDebounce = () => {};
  app.invalidateGenerations = () => { app.generationVersion += 1; };

  try {
    assert.equal(await app.translateDraftAndApply(), true);
    assert.deepEqual(writes, ['Good morning']);
    assert.equal(draft, 'Good morning');
    assert.equal(app.applyingTranslation, false);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test('mudança do idioma invalida finalText traduzido existente', () => {
  const item = {
    status: 'success',
    finalText: 'Good morning',
    translationApplied: true,
    translationAccountId: 'a',
    translationChatId: 'c',
    sourceLanguage: 'pt-BR',
    targetLanguage: 'en'
  };
  const chat = { accountId: 'a', whatsappChatId: 'c' };

  assert.equal(finalSuggestionTextForChat(item, {
    translationEnabled: true,
    myLanguage: 'pt-BR',
    contactLanguage: 'en'
  }, chat), 'Good morning');

  assert.equal(finalSuggestionTextForChat(item, {
    translationEnabled: true,
    myLanguage: 'pt-BR',
    contactLanguage: 'es'
  }, chat), '');
});
