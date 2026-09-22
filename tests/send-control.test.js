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

test('envio procura o botão fora do compose-box quando o WhatsApp o renderiza no footer/main', async () => {
  const previous = {
    Element: globalThis.Element,
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle
  };
  let clicks = 0;

  class Element {
    constructor(name = '') { this.name = name; this.disabled = false; }
    getBoundingClientRect() { return { width: 24, height: 24 }; }
    getAttribute(name) { return name === 'aria-disabled' ? 'false' : null; }
    matches(selector) { return selector === 'button, [role="button"]' && this.name === 'button'; }
    closest(selector) {
      if (selector === '[data-testid="compose-box"]') return composeBox;
      if (selector === 'footer') return footer;
      if (selector === 'button, [role="button"]' && this.name === 'icon') return button;
      return null;
    }
    click() { clicks++; }
  }

  const button = new Element('button');
  const icon = new Element('icon');
  const composeBox = { querySelectorAll: () => [] };
  const footer = {
    querySelectorAll: selector => selector === '[data-icon="send"]' ? [icon] : []
  };
  const main = { querySelectorAll: () => [] };
  const composer = new Element('composer');

  globalThis.Element = Element;
  globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
  globalThis.document = {
    querySelector: selector => selector === '#main footer' ? footer : selector === '#main' ? main : null
  };

  const dom = new WhatsAppDom();
  dom.getComposer = () => composer;
  dom.readConversation = () => ({ whatsappChatId: 'chat' });
  dom.readDraft = () => 'Sugestão';

  try {
    assert.equal(await dom.sendDraft('Sugestão', 'chat'), true);
    assert.equal(clicks, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('envio revalida conversa e texto imediatamente antes do clique', async () => {
  const dom = new WhatsAppDom();
  let allowed = true;
  let clicks = 0;
  const button = { click: () => { clicks++; } };

  dom.readConversation = () => ({ whatsappChatId: 'chat' });
  dom.readDraft = () => 'Sugestão';
  dom.findSendButton = () => {
    allowed = false;
    return button;
  };

  assert.equal(await dom.sendDraft('Sugestão', 'chat', () => allowed), false);
  assert.equal(clicks, 0);
});

