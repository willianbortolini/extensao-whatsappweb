import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppDom } from '../src/whatsapp/dom.js';
import { WhatsAppAIApp } from '../src/app.js';

test('envio encontra o ícone atual dentro de compose-box sem depender de footer', async () => {
  const previous = { Element: globalThis.Element, getComputedStyle: globalThis.getComputedStyle };
  let clicks = 0;
  class Element {
    getBoundingClientRect() { return { width: 24, height: 24 }; }
    closest() { return button; }
    getAttribute() { return 'false'; }
    click() { clicks++; }
  }
  const button = new Element();
  const icon = new Element();
  const root = { querySelectorAll: selector => selector === '[data-testid="wds-ic-send-filled"]' ? [icon] : [] };
  const dom = new WhatsAppDom();
  dom.getComposer = () => ({ closest: selector => selector === '[data-testid="compose-box"]' ? root : null });
  dom.readConversation = () => ({ whatsappChatId: 'chat' });
  dom.readDraft = () => 'Sugestão';
  globalThis.Element = Element;
  globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
  try {
    assert.equal(await dom.sendDraft('Sugestão', 'chat'), true);
    assert.equal(clicks, 1);
    dom.readDraft = () => 'Texto alterado';
    assert.equal(await dom.sendDraft('Sugestão', 'chat'), false);
    dom.readDraft = () => 'Sugestão';
    assert.equal(await dom.sendDraft('Sugestão', 'outro'), false);
    assert.equal(await dom.sendDraft('Sugestão', 'chat', () => false), false);
    assert.equal(clicks, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('Ctrl+Enter envia selecionada ou primeira pronta; repetição e composição não enviam', () => {
  const previousDocument = globalThis.document;
  const composer = { contains: () => false };
  globalThis.document = { activeElement: composer, body: { classList: { contains: () => false } } };
  const first = { text: 'Primeira', status: 'success' };
  const second = { text: 'Segunda', status: 'success' };
  let selected = second;
  const sent = [];
  const applied = [];
  const app = Object.create(WhatsAppAIApp.prototype);
  Object.assign(app, {
    ui: { suggestions: [first, second], getSelectedSuggestion: () => selected },
    dom: { getComposer: () => composer },
    applyAndSendSuggestion: value => sent.push(value),
    useSuggestion: value => applied.push(value)
  });
  const event = () => ({ key: 'Enter', ctrlKey: true, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, stopPropagation() {} });
  try {
    const key = event();
    app.handleKeyboard(key);
    assert.equal(key.prevented, true);
    assert.equal(key.stopped, true);
    selected = null;
    app.handleKeyboard(event());
    app.handleKeyboard({ ...event(), repeat: true });
    app.handleKeyboard({ ...event(), isComposing: true });
    assert.deepEqual(sent, [second, first]);
    selected = second;
    for (const shiftKey of [false, true]) {
      const nativeEnter = { ...event(), ctrlKey: false, shiftKey,
        preventDefault() { assert.fail('Enter/Shift+Enter não podem ser interceptados'); },
        stopPropagation() { assert.fail('Enter/Shift+Enter devem chegar ao WhatsApp'); },
        stopImmediatePropagation() { assert.fail('Enter/Shift+Enter devem chegar ao WhatsApp'); }
      };
      app.handleKeyboard(nativeEnter);
    }
    assert.deepEqual(applied, []);
    assert.deepEqual(sent, [second, first]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
