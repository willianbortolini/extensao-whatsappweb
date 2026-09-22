import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROMPTS, PROMPT_SCOPE } from '../src/config.js';
import {
  normalizePromptScopeRecord,
  promptAvailableForChat,
  promptScopePriority
} from '../src/storage/database.js';

test('prompt legado sem scope é tratado como global sem perder seus dados', () => {
  const legacy = {
    id: 'old',
    name: 'Melhorar',
    instructions: 'Teste',
    autoRun: true,
    order: 7
  };

  const normalized = normalizePromptScopeRecord(legacy);
  assert.equal(normalized.id, 'old');
  assert.equal(normalized.name, 'Melhorar');
  assert.equal(normalized.instructions, 'Teste');
  assert.equal(normalized.autoRun, true);
  assert.equal(normalized.order, 7);
  assert.equal(normalized.scope, PROMPT_SCOPE.GLOBAL);
  assert.equal(normalized.accountId, null);
  assert.equal(normalized.chatId, null);
});

test('todos os prompts padrão são globais', () => {
  for (const prompt of DEFAULT_PROMPTS) {
    assert.equal(prompt.scope, PROMPT_SCOPE.GLOBAL);
    assert.equal(prompt.accountId, null);
    assert.equal(prompt.chatId, null);
  }
});

test('prompt global está disponível em qualquer conversa', () => {
  const prompt = normalizePromptScopeRecord({ id: 'g', scope: PROMPT_SCOPE.GLOBAL });
  assert.equal(promptAvailableForChat(prompt, 'a', 'joao'), true);
  assert.equal(promptAvailableForChat(prompt, 'b', 'grupo'), true);
});

test('prompt de conversa exige a mesma conta e o mesmo chat', () => {
  const prompt = normalizePromptScopeRecord({
    id: 'p',
    scope: PROMPT_SCOPE.CHAT,
    accountId: 'a',
    chatId: 'joao',
    chatDisplayName: 'João'
  });

  assert.equal(promptAvailableForChat(prompt, 'a', 'joao'), true);
  assert.equal(promptAvailableForChat(prompt, 'a', 'maria'), false);
  assert.equal(promptAvailableForChat(prompt, 'b', 'joao'), false);
});

test('prompt de conversa tem prioridade sobre global no limite automático', () => {
  assert.ok(
    promptScopePriority({ scope: PROMPT_SCOPE.CHAT }) <
    promptScopePriority({ scope: PROMPT_SCOPE.GLOBAL })
  );
});
