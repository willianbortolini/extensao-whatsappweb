import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppAIApp } from '../src/app.js';
import { PROMPT_SCOPE } from '../src/config.js';

function fixture() {
  const app = Object.create(WhatsAppAIApp.prototype);
  const rendered = [];
  Object.assign(app, {
    account: { id: 'a' },
    chat: { accountId: 'a', whatsappChatId: 'joao', displayName: 'João', isGroup: false },
    settings: {
      maxAutomaticPrompts: 1,
      automaticSuggestions: true,
      aiPaused: false
    },
    keyStatus: { configured: true },
    prompts: [],
    allPrompts: [],
    suggestedMessagePromptId: '',
    suggestedMessageGeneration: 0,
    lastAutoDraft: null,
    generationVersion: 1,
    chatSettings: { aiEnabled: true },
    chatSettingsLoading: false,
    chatSettingsSaving: false,
    currentDraft: 'teste',
    suppressedDraft: null,
    ui: {
      suggestions: [],
      setState(value) { rendered.push(value); },
      setSuggestions(value) { this.suggestions = value; },
      clearSuggestions() { this.suggestions = []; }
    }
  });
  app.cancelDebounce = () => {};
  app.onDraftChanged = () => {};
  app.canRequestSuggestions = () => true;
  app.canAutoSuggest = () => true;
  return { app, rendered };
}

function runtime(responder) {
  const previousChrome = globalThis.chrome;
  const requests = [];
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        requests.push(message);
        queueMicrotask(() => callback(responder(message)));
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

test('loadPromptsForChat carrega globais e prompts somente da conversa atual', async () => {
  const { app } = fixture();
  const rt = runtime(message => {
    assert.equal(message.type, 'PROMPT_LIST_FOR_CHAT');
    assert.equal(message.payload.accountId, 'a');
    assert.equal(message.payload.chatId, 'joao');
    return {
      ok: true,
      prompts: [
        { id: 'joao', name: 'João', scope: PROMPT_SCOPE.CHAT, accountId: 'a', chatId: 'joao', enabled: true },
        { id: 'global', name: 'Global', scope: PROMPT_SCOPE.GLOBAL, enabled: true }
      ]
    };
  });

  try {
    assert.equal(await app.loadPromptsForChat(app.chat), true);
    assert.deepEqual(app.prompts.map(prompt => prompt.id), ['joao', 'global']);
  } finally {
    rt.restore();
  }
});

test('prompts específicos têm prioridade sobre globais no ciclo automático', async () => {
  const { app } = fixture();
  app.prompts = [
    { id: 'global', name: 'Global', scope: PROMPT_SCOPE.GLOBAL, order: 1, enabled: true, autoRun: true },
    { id: 'joao', name: 'João', scope: PROMPT_SCOPE.CHAT, order: 99, enabled: true, autoRun: true }
  ];

  const generated = [];
  app.generateSuggestionItem = async item => generated.push(item.promptId);

  assert.equal(await app.runAutomaticPrompts('teste', false), true);
  assert.deepEqual(app.ui.suggestions.map(item => item.promptId), ['joao']);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(generated, ['joao']);
});

test('salvar prompt de conversa força accountId e chatId da conversa atual', async () => {
  const { app } = fixture();
  app.reloadPrompts = async () => true;
  const rt = runtime(message => {
    if (message.type === 'PROMPT_SAVE') return { ok: true, prompt: message.payload.prompt };
    if (message.type === 'PROMPT_LIST') return { ok: true, prompts: [] };
    assert.fail('Operação inesperada: ' + message.type);
  });

  try {
    assert.equal(await app.savePrompt({
      name: 'Follow-up',
      instructions: 'Continue.',
      scope: PROMPT_SCOPE.CHAT,
      enabled: true,
      autoRun: false
    }), true);

    const saved = rt.requests.find(request => request.type === 'PROMPT_SAVE').payload.prompt;
    assert.equal(saved.scope, PROMPT_SCOPE.CHAT);
    assert.equal(saved.accountId, 'a');
    assert.equal(saved.chatId, 'joao');
    assert.equal(saved.chatDisplayName, 'João');
  } finally {
    rt.restore();
  }
});

test('duplicar global para conversa cria outro id e mantém o global intacto', async () => {
  const { app } = fixture();
  let received;
  app.savePrompt = async prompt => {
    received = prompt;
    return true;
  };

  const globalPrompt = {
    id: 'global',
    name: 'Melhorar',
    instructions: 'Melhore.',
    scope: PROMPT_SCOPE.GLOBAL,
    enabled: true,
    autoRun: false
  };

  assert.equal(await app.duplicatePromptToCurrentChat(globalPrompt), true);
  assert.equal(received.id, undefined);
  assert.equal(received.scope, PROMPT_SCOPE.CHAT);
  assert.equal(received.accountId, 'a');
  assert.equal(received.chatId, 'joao');
  assert.equal(globalPrompt.scope, PROMPT_SCOPE.GLOBAL);
  assert.equal(globalPrompt.id, 'global');
});
