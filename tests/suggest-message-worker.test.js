import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { CONFIG, DEFAULT_SETTINGS } from '../src/config.js';
import { buildSuggestedMessageInput } from '../src/ai/context-builder.js';
import { suggestionCacheId } from '../src/ai/suggestion-cache.js';
import { localizeSuggestion, translationSettings } from '../src/ai/translation.js';

const source = (await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\r?\n/gm, '');

function worker({ summary = null, prompt = null, chatSettings = null } = {}) {
  const calls = [];
  const cache = new Map();
  const localData = {
    wai_settings: { ...DEFAULT_SETTINGS, saveHistory: true },
    wai_api_key: 'test-key',
    wai_key_mode: 'local',
    wai_installation_id: 'test-installation',
    wai_last_cleanup: Date.now()
  };

  const storage = {
    async get(key) {
      if (Array.isArray(key)) return Object.fromEntries(key.map(item => [item, localData[item]]));
      if (typeof key === 'string') return { [key]: localData[key] };
      return { ...localData };
    },
    async set(values) { Object.assign(localData, values); },
    async remove(key) {
      for (const item of Array.isArray(key) ? key : [key]) delete localData[item];
    },
    async setAccessLevel() {}
  };

  const context = vm.createContext({
    CONFIG,
    DEFAULT_SETTINGS,
    AbortController,
    setTimeout,
    clearTimeout,
    crypto: webcrypto,
    TextEncoder,
    buildSuggestedMessageInput,
    suggestionCacheId,
    localizeSuggestion,
    translationSettings,
    chrome: {
      storage: { local: storage, session: storage },
      runtime: {
        getURL: () => 'chrome-extension://test/',
        openOptionsPage: async () => {},
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} }
      }
    },
    ensureDefaults: async () => {},
    cleanup: async () => {},
    getChatSettings: async () => chatSettings || {
      aiEnabled: true,
      translationEnabled: false,
      myLanguage: 'pt-BR',
      contactLanguage: 'en'
    },
    getPrompt: async () => prompt || {
      id: 'p1',
      name: 'Continuação',
      instructions: 'Continue a conversa.',
      enabled: true,
      includeRecentMessages: true,
      recentMessagesCount: 2,
      maxOutputTokens: 120
    },
    getSummary: async () => summary,
    getRecentMessages: async () => [
      { direction: 'incoming', senderName: 'Cliente', text: 'Vou verificar.' }
    ],
    getChat: async () => ({ displayName: 'Cliente Teste' }),
    getCache: async id => cache.get(id) || null,
    putCache: async value => cache.set(value.id, value),
    addUsage: async () => {},
    getUsageStats: async () => ({ today: { totalTokens: 0, automaticRequests: 0 } }),
    fetch: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return {
        ok: true,
        async json() {
          return {
            output_text: calls.length === 1 ? 'Olá, podemos continuar?' : 'Outra mensagem.',
            status: 'completed',
            model: 'gpt-test',
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
          };
        }
      };
    }
  });

  vm.runInContext(source + `
    globalThis.api = { generateSuggestedMessage };
  `, context);

  return {
    ...context.api,
    calls,
    cache
  };
}

test('sem resumo SUGGEST_MESSAGE_GENERATE falha antes da OpenAI', async () => {
  const w = worker({ summary: null });
  await assert.rejects(
    w.generateSuggestedMessage({ accountId: 'a', chatId: 'c', promptId: 'p1' }),
    { code: 'SUMMARY_REQUIRED' }
  );
  assert.equal(w.calls.length, 0);
});

test('sugerir mensagem usa resumo, prompt e mensagens recentes e reutiliza cache', async () => {
  const w = worker({
    summary: {
      summary: 'Cliente recebeu o orçamento e ainda não confirmou.',
      summaryVersion: 4
    }
  });

  const first = await w.generateSuggestedMessage({
    accountId: 'a',
    chatId: 'c',
    promptId: 'p1'
  });

  assert.equal(first.text, 'Olá, podemos continuar?');
  assert.equal(first.summaryVersion, 4);
  assert.equal(first.promptName, 'Continuação');
  assert.equal(first.cached, false);
  assert.equal(w.calls.length, 1);
  assert.match(w.calls[0].input, /Cliente recebeu o orçamento/);
  assert.match(w.calls[0].input, /Cliente: Vou verificar/);
  assert.match(w.calls[0].input, /VERSÃO 4/);

  const cached = await w.generateSuggestedMessage({
    accountId: 'a',
    chatId: 'c',
    promptId: 'p1'
  });
  assert.equal(cached.cached, true);
  assert.equal(cached.text, 'Olá, podemos continuar?');
  assert.equal(w.calls.length, 1);
});

test('Gerar outra ignora o cache e faz nova chamada explícita', async () => {
  const w = worker({
    summary: {
      summary: 'Existe uma pendência.',
      summaryVersion: 2
    }
  });

  await w.generateSuggestedMessage({ accountId: 'a', chatId: 'c', promptId: 'p1' });
  const another = await w.generateSuggestedMessage({
    accountId: 'a',
    chatId: 'c',
    promptId: 'p1',
    forceNew: true
  });

  assert.equal(w.calls.length, 2);
  assert.equal(another.cached, false);
  assert.equal(another.text, 'Outra mensagem.');
});

test('prompt desabilitado impede geração antes da API', async () => {
  const w = worker({
    summary: { summary: 'Resumo', summaryVersion: 1 },
    prompt: {
      id: 'p1',
      name: 'Desabilitado',
      instructions: 'Teste',
      enabled: false
    }
  });

  await assert.rejects(
    w.generateSuggestedMessage({ accountId: 'a', chatId: 'c', promptId: 'p1' }),
    { code: 'PROMPT_UNAVAILABLE' }
  );
  assert.equal(w.calls.length, 0);
});
