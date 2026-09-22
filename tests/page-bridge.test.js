import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/whatsapp/page-bridge-main.js', import.meta.url), 'utf8');

function createFixture({ lexical = true, sendButton = true, confirmSend = true, pasteFallback = false } = {}) {
  let text = 'teste envio';
  let clicks = 0;
  const posted = [];
  const messageListeners = [];

  class FakeElement {
    constructor(tagName = 'DIV') {
      this.tagName = tagName;
      this.parentElement = null;
      this.disabled = false;
      this.attrs = new Map();
    }
    getBoundingClientRect() { return { width: 100, height: 30 }; }
    getAttribute(name) { return this.attrs.get(name) || null; }
    setAttribute(name, value) { this.attrs.set(name, value); }
    matches(selector) { return selector === 'button, [role="button"]' && this.tagName === 'BUTTON'; }
    focus() {}
  }

  const composer = new FakeElement('DIV');
  composer.setAttribute('contenteditable', 'true');
  composer.setAttribute('role', 'textbox');
  Object.defineProperty(composer, 'innerText', { get: () => text, set: value => { text = String(value); } });
  Object.defineProperty(composer, 'textContent', { get: () => text, set: value => { text = String(value); } });

  const footer = new FakeElement('FOOTER');
  const main = new FakeElement('MAIN');
  const sendIcon = new FakeElement('SPAN');
  sendIcon.setAttribute('data-icon', 'wds-ic-send-filled');
  const button = new FakeElement('BUTTON');
  button.setAttribute('aria-label', 'Enviar');

  composer.parentElement = footer;
  composer.closest = selector => (selector === 'footer' || selector === '[role="form"]') ? footer : null;
  sendIcon.closest = selector => selector === 'button, [role="button"]' ? button : null;
  button.closest = selector => selector === 'button, [role="button"]' ? button : null;
  button.click = () => {
    clicks += 1;
    if (confirmSend) text = '';
  };

  footer.querySelectorAll = selector => {
    if (selector.includes('contenteditable="true"')) return [composer];
    if (sendButton && selector === '[data-icon="wds-ic-send-filled"]') return [sendIcon];
    if (sendButton && selector.includes('aria-label="Enviar"')) return [button];
    return [];
  };
  footer.querySelector = selector => footer.querySelectorAll(selector)[0] || null;
  main.querySelectorAll = () => [];
  main.querySelector = () => null;

  const title = new FakeElement('SPAN');
  title.setAttribute('title', 'Contato');
  title.textContent = 'Contato';

  const jid = new FakeElement('DIV');
  jid.setAttribute('data-id', 'false_5511999999999@c.us_ABC');

  let lexicalText = text;
  const CLEAR = { type: 'CLEAR_EDITOR_COMMAND' };
  const INSERT = { type: 'CONTROLLED_TEXT_INSERTION_COMMAND' };
  const root = {
    getTextContent: () => lexicalText,
    clear: () => { lexicalText = ''; text = ''; },
    append() {}
  };
  const editor = {
    focus() {},
    getEditorState: () => ({ read: callback => callback() }),
    dispatchCommand(command, payload) {
      if (command === CLEAR) {
        lexicalText = '';
        text = '';
        return true;
      }
      if (command === INSERT) {
        lexicalText = String(payload);
        text = String(payload);
        return true;
      }
      return false;
    },
    update(callback) { callback(); }
  };
  if (lexical) composer.__lexicalEditor = editor;

  const lexicalModule = {
    $getRoot: () => root,
    CLEAR_EDITOR_COMMAND: CLEAR,
    CONTROLLED_TEXT_INSERTION_COMMAND: INSERT,
    $createParagraphNode: () => ({ append() {}, selectEnd() {} }),
    $createTextNode: value => ({ value: String(value) }),
    $createLineBreakNode: () => ({ value: '\n' })
  };

  composer.dispatchEvent = event => {
    if (event.type === 'paste' && pasteFallback) {
      text = event.clipboardData.getData('text/plain');
      return true;
    }
    return true;
  };

  const document = {
    querySelector(selector) {
      if (selector === '#main footer' || selector === '#main [role="form"]') return footer;
      if (selector === '#main') return main;
      if (selector.startsWith('#main header')) return title;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '#main [data-id]') return [jid];
      if (selector.includes('.message-out') || selector.includes('[data-id^="true_"]')) return [];
      return [];
    },
    createRange() { return { selectNodeContents() {} }; }
  };

  class FakeDataTransfer {
    constructor() { this.values = new Map(); }
    setData(type, value) { this.values.set(type, String(value)); }
    getData(type) { return this.values.get(type) || ''; }
  }
  class FakeClipboardEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.clipboardData = options.clipboardData;
    }
  }
  class FakeEvent {
    constructor(type) { this.type = type; }
  }

  const selection = { removeAllRanges() {}, addRange() {} };
  const window = {
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
    },
    postMessage(message) { posted.push(message); },
    getSelection: () => selection,
    require(name) {
      if (!lexical) throw new Error('module unavailable');
      if (name === 'Lexical.prod' || name === 'cr:370' || name === 'Lexical') return lexicalModule;
      throw new Error('unknown module');
    }
  };
  window.window = window;

  const context = vm.createContext({
    window,
    document,
    Element: FakeElement,
    DataTransfer: FakeDataTransfer,
    ClipboardEvent: FakeClipboardEvent,
    Event: FakeEvent,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    String,
    Number,
    Object,
    Array,
    Map,
    RegExp,
    Boolean
  });
  vm.runInContext(source, context);

  async function request(operation, payload) {
    const requestId = 'test-' + Math.random();
    const before = posted.length;
    messageListeners[0]({
      source: window,
      data: { type: 'WAI_COMPOSER_BRIDGE_REQUEST', requestId, operation, payload }
    });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = posted.slice(before).find(item =>
        item.type === 'WAI_COMPOSER_BRIDGE_RESPONSE' && item.requestId === requestId
      );
      if (response) return response.result;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('bridge response timeout in test');
  }

  return { request, getText: () => text, getClicks: () => clicks };
}

test('MAIN bridge apaga o rascunho, aplica somente a sugestão e confirma o envio', async () => {
  const fixture = createFixture();
  const result = await fixture.request('REPLACE_AND_SEND', { text: 'Mensagem de teste.' });
  assert.equal(result.ok, true);
  assert.equal(result.stage, 'SEND_CONFIRMED');
  assert.equal(result.method, 'lexical');
  assert.equal(fixture.getClicks(), 1);
  assert.equal(fixture.getText(), '');
});

test('REPLACE deixa exatamente a sugestão e nunca concatena com o rascunho antigo', async () => {
  const fixture = createFixture();
  const result = await fixture.request('REPLACE', { text: 'Mensagem de teste.' });
  assert.equal(result.ok, true);
  assert.equal(fixture.getText(), 'Mensagem de teste.');
  assert.doesNotMatch(fixture.getText(), /teste envio/);
});

test('sem botão real de envio a mensagem não é declarada como enviada', async () => {
  const fixture = createFixture({ sendButton: false });
  const result = await fixture.request('REPLACE_AND_SEND', { text: 'Mensagem de teste.' });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'SEND_BUTTON_NOT_FOUND');
  assert.equal(fixture.getText(), 'Mensagem de teste.');
  assert.equal(fixture.getClicks(), 0);
});

test('sem confirmação após o clique o bridge retorna SEND_NOT_CONFIRMED', async () => {
  const fixture = createFixture({ confirmSend: false });
  const result = await fixture.request('REPLACE_AND_SEND', { text: 'Mensagem de teste.' });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'SEND_NOT_CONFIRMED');
  assert.equal(fixture.getClicks(), 1);
  assert.equal(fixture.getText(), 'Mensagem de teste.');
});

test('quando Lexical não está acessível, o fallback de paste substitui sem concatenar', async () => {
  const fixture = createFixture({ lexical: false, pasteFallback: true });
  const result = await fixture.request('REPLACE', { text: 'Mensagem de teste.' });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'paste');
  assert.equal(fixture.getText(), 'Mensagem de teste.');
});
