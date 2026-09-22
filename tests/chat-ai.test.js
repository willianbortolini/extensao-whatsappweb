import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { CONFIG, DEFAULT_SETTINGS } from '../src/config.js';
import { WhatsAppAIApp } from '../src/app.js';
import { buildTranslationInput, translationSettings, localizeSuggestion } from '../src/ai/translation.js';
import { suggestionCacheId } from '../src/ai/suggestion-cache.js';

// Execute the worker with browser/storage boundaries replaced by local fakes.
const source = (await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\r?\n/gm, '');

function worker() {
  const preferences = new Map();
  const calls = [];
  const pending = [];
  const translations = new Map();
  const storage = { get: async () => ({ wai_installation_id: 'test', wai_last_cleanup: Date.now() }), set: async () => {}, setAccessLevel: async () => {} };
  const context = vm.createContext({
    CONFIG, DEFAULT_SETTINGS, AbortController, setTimeout, clearTimeout,
    buildTranslationInput, translationSettings, localizeSuggestion, suggestionCacheId,
    chrome: { storage: { local: storage, session: storage }, runtime: {
      onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} }
    } },
    ensureDefaults: async () => {},
    getChatSettings: async (account, chat) => preferences.get(JSON.stringify([account, chat])),
    addUsage: async () => {},
    getTranslation: async id => translations.get(id),
    saveTranslation: async value => translations.set(value.id, value),
    fetch: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return new Promise(resolve => pending.push((data = { output_text: 'OK' }) => resolve({ ok: true, json: async () => data })));
    }
  });
  vm.runInContext(source + `
    enforceBudget = async () => {};
    getApiKey = async () => ({ key: 'test-key' });
    globalThis.api = { callOpenAI, generateSuggestion, generateSummary, translateText };
  `, context);
  return { ...context.api, calls, pending, translations,
    configure: (value) => preferences.set(JSON.stringify(['a', 'c']), value),
    set: (account, chat, value) => preferences.set(JSON.stringify([account, chat]), { aiEnabled: value }) };
}

const request = { accountId: 'a', chatId: 'c', instructions: 'Improve', input: 'Hello', operation: 'suggestion' };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function waitForCalls(w, count) {
  for (let attempt = 0; attempt < 100 && w.calls.length < count; attempt++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(w.calls.length, count);
}

const enabledTranslation = { aiEnabled: true, translationEnabled: true, myLanguage: 'pt-BR', contactLanguage: 'en' };
const incoming = { accountId: 'a', chatId: 'c', text: 'Hello', direction: 'incoming', messageId: 'message-1' };

test('tradução preserva original, deduplica chamadas simultâneas e reutiliza histórico', async () => {
  const w = worker();
  w.configure(enabledTranslation);
  const first = w.translateText(incoming);
  const duplicate = w.translateText(incoming);
  await waitForCalls(w, 1);
  assert.match(w.calls[0].instructions, /Inglês para Português/);
  w.pending.shift()({ output_text: 'Olá', status: 'completed' });
  assert.equal((await first).text, 'Olá');
  assert.equal((await duplicate).text, 'Olá');
  assert.equal((await w.translateText(incoming)).cached, true);
  assert.equal(w.calls.length, 1);
  const [stored] = w.translations.values();
  assert.equal(stored.originalText, 'Hello');
  assert.equal(stored.translatedText, 'Olá');
  assert.equal(stored.messageId, 'message-1');
  const edited = w.translateText({ ...incoming, text: 'Hello again' });
  await waitForCalls(w, 2);
  w.pending.shift()({ output_text: 'Olá novamente' });
  await edited;
  assert.equal(w.translations.size, 2);
});

test('saída usa idioma do contato; resposta parcial não é armazenada', async () => {
  const w = worker();
  w.configure(enabledTranslation);
  const outgoing = w.translateText({ ...incoming, direction: 'outgoing', text: 'Bom dia' });
  const rejected = assert.rejects(outgoing, { code: 'TRANSLATION_INCOMPLETE' });
  await waitForCalls(w, 1);
  assert.match(w.calls[0].instructions, /Português \(Brasil\) para Inglês/);
  w.pending.shift()({ output_text: 'Good', status: 'incomplete', usage: { total_tokens: 2 } });
  await rejected;
  assert.equal(w.translations.size, 0);
});

test('desativar modo impede chamada; mudar idioma na fila cancela tradução pendente', async () => {
  const w = worker();
  w.set('a', 'c', true);
  await assert.rejects(w.translateText(incoming), { code: 'TRANSLATION_DISABLED' });
  w.configure(enabledTranslation);
  const first = w.callOpenAI(request);
  const second = w.callOpenAI(request);
  await waitForCalls(w, 2);
  const queued = w.translateText(incoming);
  const rejected = assert.rejects(queued, { code: 'TRANSLATION_CHANGED' });
  await new Promise(resolve => setTimeout(resolve, 20));
  w.configure({ ...enabledTranslation, contactLanguage: 'es' });
  w.pending.splice(0).forEach(finish => finish());
  await Promise.all([first, second, rejected]);
  assert.equal(w.calls.length, 2);
});

test('sugestões ficam no meu idioma; modo desligado mantém o prompt existente', () => {
  const built = { instructions: 'Regras', input: 'Traduza para espanhol' };
  assert.equal(localizeSuggestion(built, {}).instructions, 'Regras');
  assert.match(localizeSuggestion(built, enabledTranslation).instructions, /exclusivamente em Português/);
  assert.equal(translationSettings({}).enabled, false);
});

test('contato bloqueado impede sugestões e resumos manuais e automáticos antes da API', async () => {
  const w = worker();
  w.set('a', 'c', false);
  for (const automatic of [false, true]) {
    for (const action of [w.generateSuggestion, w.generateSummary, w.callOpenAI, w.translateText]) {
      await assert.rejects(action({ ...request, automatic }), { code: 'CHAT_AI_DISABLED' });
    }
  }
  assert.equal(w.calls.length, 0);
});

test('requisição na fila revalida bloqueio; outras contas e contatos continuam funcionando', async () => {
  const w = worker();
  w.set('a', 'other', true);
  w.set('other', 'c', true);
  w.set('a', 'c', true);
  const first = w.callOpenAI({ ...request, chatId: 'other' });
  const second = w.callOpenAI({ ...request, accountId: 'other' });
  await tick();
  assert.equal(w.calls.length, 2);
  const queued = w.callOpenAI(request);
  const rejected = assert.rejects(queued, { code: 'CHAT_AI_DISABLED' });
  await tick();
  w.set('a', 'c', false);
  w.pending.splice(0).forEach(finish => finish());
  await Promise.all([first, second, rejected]);
  assert.equal(w.calls.length, 2);
  w.set('a', 'c', true);
  const enabled = w.callOpenAI(request);
  await tick();
  assert.equal(w.calls.length, 3);
  w.pending.shift()();
  await enabled;
});

test('conversas sem preferência explícita não fazem nenhuma requisição de IA', async () => {
  const w = worker();
  for (const chatId of ['new-contact', 'new-group']) {
    for (const automatic of [false, true]) {
      for (const action of [w.generateSuggestion, w.generateSummary, w.callOpenAI, w.translateText]) {
        await assert.rejects(action({ ...request, chatId, automatic }), { code: 'CHAT_AI_DISABLED' });
      }
    }
  }
  assert.equal(w.calls.length, 0);
  const app = Object.create(WhatsAppAIApp.prototype);
  Object.assign(app, { account: { id: 'a' }, chat: { whatsappChatId: 'c' } });
  for (const chatSettings of [null, {}, { summaryEnabled: true }, { aiEnabled: false }]) {
    app.chatSettings = chatSettings;
    assert.equal(app.isChatAIEnabled(), false);
  }
  app.chatSettings = { aiEnabled: true };
  assert.equal(app.isChatAIEnabled(), true);
});

test('interface bloqueia todos os caminhos de IA enquanto desativada ou carregando', async () => {
  const app = Object.create(WhatsAppAIApp.prototype);
  Object.assign(app, { account: { id: 'a' }, chat: { whatsappChatId: 'c' }, chatSettings: { aiEnabled: false }, generationVersion: 0 });
  // No DOM/runtime is provided: any attempt to generate would fail this test.
  for (const loading of [false, true]) {
    app.chatSettingsLoading = loading;
    assert.equal(app.canAutoSuggest('Hello'), false);
    await app.runManualPrompt({});
    await app.retrySuggestion({});
    await app.generateSuggestionItem({}, 0);
    assert.equal(await app.generateSummary(), false);
  }
});
