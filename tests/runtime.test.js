import test from 'node:test';
import assert from 'node:assert/strict';
import { sendRuntime } from '../src/runtime.js';

test('sendRuntime transforma contexto invalidado em resposta controlada', async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendMessage() {
        throw new Error('Extension context invalidated.');
      }
    }
  };

  try {
    const result = await sendRuntime('TEST');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'EXTENSION_CONTEXT_INVALIDATED');
    assert.match(result.message, /Recarregue a aba do WhatsApp Web/i);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test('sendRuntime trata worker indisponível sem lançar exceção', async () => {
  const previousChrome = globalThis.chrome;
  const runtime = {
    lastError: null,
    sendMessage(_message, done) {
      runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
      done(undefined);
      runtime.lastError = null;
    }
  };
  globalThis.chrome = { runtime };

  try {
    const result = await sendRuntime('TEST');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'BACKGROUND_UNAVAILABLE');
    assert.match(result.message, /serviço interno da extensão/i);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test('sendRuntime continua retornando respostas normais do background', async () => {
  const previousChrome = globalThis.chrome;
  const runtime = {
    lastError: null,
    sendMessage(message, done) {
      done({ ok: true, requestId: message.requestId, value: 123 });
    }
  };
  globalThis.chrome = { runtime };

  try {
    const result = await sendRuntime('TEST');
    assert.equal(result.ok, true);
    assert.equal(result.value, 123);
    assert.match(result.requestId, /^wai-/);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});
