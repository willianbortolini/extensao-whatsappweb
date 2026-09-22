import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPOSER_BRIDGE_REQUEST,
  COMPOSER_BRIDGE_RESPONSE,
  WhatsAppComposerBridge,
  normalizeComposerText
} from '../src/whatsapp/composer-bridge.js';

function fakeWindow(handler) {
  const listeners = new Set();
  const win = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
    },
    postMessage(message) {
      handler?.(message, response => {
        queueMicrotask(() => {
          for (const listener of listeners) listener({ source: win, data: response });
        });
      });
    }
  };
  return win;
}

test('bridge isolado envia uma transação e recebe o resultado correlacionado', async () => {
  const previousWindow = globalThis.window;
  const win = fakeWindow((message, respond) => {
    assert.equal(message.type, COMPOSER_BRIDGE_REQUEST);
    assert.equal(message.operation, 'REPLACE_AND_SEND');
    assert.equal(message.payload.text, 'Mensagem de teste.');
    respond({
      type: COMPOSER_BRIDGE_RESPONSE,
      requestId: message.requestId,
      result: { ok: true, stage: 'SEND_CONFIRMED' }
    });
  });
  globalThis.window = win;

  try {
    const bridge = new WhatsAppComposerBridge({ defaultTimeoutMs: 100 });
    const result = await bridge.replaceAndSend('Mensagem de teste.', { chatId: 'c' });
    assert.equal(result.ok, true);
    assert.equal(result.stage, 'SEND_CONFIRMED');
    bridge.destroy();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('bridge retorna timeout controlado quando MAIN world não responde', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = fakeWindow(() => {});

  try {
    const bridge = new WhatsAppComposerBridge({ defaultTimeoutMs: 10 });
    const result = await bridge.request('PING', {}, 10);
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'BRIDGE_TIMEOUT');
    bridge.destroy();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('normalização remove apenas artefatos invisíveis do composer', () => {
  assert.equal(normalizeComposerText('  Olá\u00a0mundo\r\n\u200eTeste  '), 'Olá mundo\nTeste');
});
