import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSuggestionInput, buildSummaryInput, normalizePromptInput } from '../src/ai/context-builder.js';
import { DOM_UTILS } from '../src/whatsapp/dom.js';

test('prompt sem contexto não inclui resumo nem mensagens', () => {
  const result = buildSuggestionInput({
    prompt: {
      instructions: 'Traduza para inglês.',
      includeSummary: false,
      includeRecentMessages: false
    },
    draft: 'Olá',
    summary: 'SEGREDO DO RESUMO',
    recentMessages: [{ direction: 'incoming', senderName: 'João', text: 'SEGREDO DA MENSAGEM' }],
    contactName: 'João'
  });

  assert.match(result.input, /Olá/);
  assert.doesNotMatch(result.input, /SEGREDO DO RESUMO/);
  assert.doesNotMatch(result.input, /SEGREDO DA MENSAGEM/);
});

test('prompt com resumo e mensagens envia somente o contexto solicitado', () => {
  const result = buildSuggestionInput({
    prompt: {
      instructions: 'Responda com contexto.',
      includeSummary: true,
      includeRecentMessages: true
    },
    draft: 'vou verificar',
    summary: 'Cliente aguarda confirmação.',
    recentMessages: [{ direction: 'incoming', senderName: 'João', text: 'Consegue amanhã?' }],
    contactName: 'João'
  });

  assert.match(result.input, /Cliente aguarda confirmação/);
  assert.match(result.input, /João: Consegue amanhã/);
  assert.match(result.input, /vou verificar/);
});

test('variáveis do prompt são substituídas', () => {
  const result = buildSuggestionInput({
    prompt: {
      instructions: 'Contato={{nome_contato}}\nResumo={{resumo}}\nMsgs={{mensagens}}\nTexto={{texto}}',
      includeSummary: false,
      includeRecentMessages: false
    },
    draft: 'Teste',
    summary: 'Resumo X',
    recentMessages: [{ direction: 'outgoing', text: 'Mensagem Y' }],
    contactName: 'Maria'
  });

  assert.match(result.input, /Contato=Maria/);
  assert.match(result.input, /Resumo=Resumo X/);
  assert.match(result.input, /Eu: Mensagem Y/);
  assert.match(result.input, /Texto=Teste/);
  assert.doesNotMatch(result.input, /\{\{texto\}\}/);
});

test('normalização limita configuração de prompt', () => {
  const prompt = normalizePromptInput({
    name: '  Teste  ',
    instructions: 'Faça algo',
    recentMessagesCount: 999,
    maxOutputTokens: 9999
  });

  assert.equal(prompt.name, 'Teste');
  assert.equal(prompt.recentMessagesCount, 20);
  assert.equal(prompt.maxOutputTokens, 1200);
});

test('resumo incremental inclui resumo anterior e novas mensagens', () => {
  const result = buildSummaryInput({
    currentSummary: 'Resumo anterior',
    newMessages: [{ direction: 'incoming', senderName: 'Ana', text: 'Nova informação' }]
  });

  assert.match(result.input, /Resumo anterior/);
  assert.match(result.input, /Ana: Nova informação/);
});

test('parser de timestamp do WhatsApp usa DD/MM/AAAA', () => {
  const value = DOM_UTILS.parseWhatsAppTimestamp('[14:35, 22/09/2026] João:');
  const date = new Date(value);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 8);
  assert.equal(date.getDate(), 22);
  assert.equal(date.getHours(), 14);
  assert.equal(date.getMinutes(), 35);
});

test('hash local é determinístico', () => {
  assert.equal(DOM_UTILS.simpleHash('abc'), DOM_UTILS.simpleHash('abc'));
  assert.notEqual(DOM_UTILS.simpleHash('abc'), DOM_UTILS.simpleHash('abd'));
});
