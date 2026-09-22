import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSuggestionInput } from '../src/ai/context-builder.js';
import { suggestionCacheId } from '../src/ai/suggestion-cache.js';

const context = {
  prompt: { instructions: 'Traduza para inglês.', includeRecentMessages: true },
  draft: 'Olá', contactName: 'Ana',
  recentMessages: [{ id: 'same-id', text: 'Pedido original' }]
};
const request = {
  accountId: 'account-a', chatId: 'chat-a', promptId: 'prompt-a',
  model: 'test-model', maxOutputTokens: 150
};
const key = (value = context, overrides = {}) => suggestionCacheId({
  ...request, ...buildSuggestionInput(value), ...overrides
});

test('cache reutiliza requisições idênticas', async () => {
  assert.equal(await key(), await key(structuredClone(context)));
});

test('editar o prompt ou o contexto invalida a sugestão anterior', async () => {
  const original = await key();
  for (const change of [
    { prompt: { ...context.prompt, instructions: 'Traduza para espanhol.' } },
    { recentMessages: [{ id: 'same-id', text: 'Pedido editado' }] },
    { contactName: 'Maria' },
    { draft: 'Bom dia' },
    { prompt: { ...context.prompt, includeRecentMessages: false } }
  ]) {
    assert.notEqual(await key({ ...context, ...change }), original);
  }
});

test('cache separa contas, conversas, prompts, modelos e limites de saída', async () => {
  const original = await key();
  for (const overrides of [
    { accountId: 'account-b' }, { chatId: 'chat-b' },
    { promptId: 'prompt-b' }, { model: 'another-model' }, { maxOutputTokens: 300 }
  ]) assert.notEqual(await key(context, overrides), original);
});
