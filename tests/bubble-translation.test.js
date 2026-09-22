import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppDom, DOM_UTILS } from '../src/whatsapp/dom.js';
import { WhatsAppAIApp } from '../src/app.js';

test('direção dos balões funciona sem classes message-in/message-out', () => {
  const node = { matches: () => false, closest: () => null, querySelector: () => null };
  assert.equal(DOM_UTILS.messageDirection(node, 'false_123@c.us_ABC'), 'incoming');
  assert.equal(DOM_UTILS.messageDirection(node, 'true_123@c.us_DEF'), 'outgoing');
  assert.equal(DOM_UTILS.messageDirection(node, 'unrecognized'), 'unknown');
});

test('HTML atual: IDs simples, caudas, rótulos e metadados identificam os autores', () => {
  const node = { matches: () => false, closest: () => null, querySelector: () => null };
  for (const [marker, direction] of [
    ['[data-testid="tail-in"], [data-icon="tail-in"]', 'incoming'],
    ['[data-testid="tail-out"], [data-icon="tail-out"]', 'outgoing'],
    ['[data-testid="msg-meta"][role="button"]', 'outgoing']
  ]) {
    assert.equal(DOM_UTILS.messageDirection({ ...node, querySelector: selector => selector === marker ? {} : null }, '3AABC123'), direction);
  }
  for (const [label, direction] of [['Você:', 'outgoing'], ['Contato:', 'incoming']]) {
    assert.equal(DOM_UTILS.messageDirection({ ...node, querySelector: selector => selector === 'span[aria-label$=":"]' ? { getAttribute: () => label } : null }, '3AABC123'), direction);
  }
});

test('scanner encontra balão por data-id e exibe tradução sem alterar original', () => {
  const saved = { document: globalThis.document, Element: globalThis.Element };
  class Element {
    constructor(id, text = '') { this.id = id; this.textContent = text; this.isConnected = true; }
    matches(selector) { return selector === '[data-id]' && Boolean(this.id); }
    closest(selector) { return selector === '[data-id]' ? this : null; }
    getAttribute(name) { return name === 'data-id' ? this.id : ''; }
    setAttribute() {}
    querySelector(selector) { return selector === '[data-wai-translation]' ? this.translation || null : null; }
    querySelectorAll(selector) { return selector.includes('.selectable-text') ? [this.original] : []; }
    append(node) { this.translation = node; }
  }
  const bubble = new Element('false_123@c.us_ABC');
  bubble.original = new Element('', 'Hello world');
  globalThis.Element = Element;
  globalThis.document = {
    querySelector: () => ({ querySelectorAll: selector => selector.includes('[data-id^=') ? [bubble] : [] }),
    createElement: () => new Element('')
  };
  try {
    const dom = new WhatsAppDom();
    const [message] = dom.readVisibleMessages();
    assert.equal(message.direction, 'incoming');
    assert.equal(message.text, 'Hello world');
    assert.equal(dom.showTranslation(message, 'Olá mundo', 'Português'), true);
    assert.match(bubble.translation.textContent, /Olá mundo/);
    assert.equal(bubble.original.textContent, 'Hello world');
    assert.equal(dom.readVisibleMessages()[0].text, 'Hello world');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('botão informa chave ausente e ausência de balões recebidos', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { body: { classList: { contains: () => false } } };
  try {
    const states = [];
    const app = Object.create(WhatsAppAIApp.prototype);
    Object.assign(app, {
      account: { id: 'a' }, chat: { accountId: 'a', whatsappChatId: 'c' },
      chatSettings: { aiEnabled: true, translationEnabled: true },
      settings: {}, keyStatus: { configured: false }, ui: { setState: patch => states.push(patch) }
    });
    await app.translateVisibleMessages([], true);
    assert.match(states.at(-1).translationStatus, /API key/);
    app.keyStatus.configured = true;
    await app.translateVisibleMessages([{ direction: 'outgoing', text: 'Hello' }], true);
    assert.match(states.at(-1).translationStatus, /Nenhuma mensagem de texto recebida/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
