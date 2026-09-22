import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppAIApp } from '../src/app.js';

function keyboardFixture() {
  const previousDocument = globalThis.document;
  const composer = { contains: () => false };
  globalThis.document = {
    activeElement: composer,
    body: { classList: { contains: () => false } }
  };

  const first = { text: 'Primeira', status: 'success' };
  const second = { text: 'Segunda', status: 'success' };
  let selected = second;
  const sent = [];
  const generated = [];

  const app = Object.create(WhatsAppAIApp.prototype);
  Object.assign(app, {
    ui: {
      suggestions: [first, second],
      getSelectedSuggestion: () => selected,
      moveSelection: () => null,
      clearSelection: () => false
    },
    dom: {
      getComposer: () => composer,
      readDraft: () => 'teste envio'
    },
    applyAndSendSuggestion: value => sent.push(value),
    canRequestSuggestions: () => true,
    runAutomaticPrompts: (draft, force) => generated.push([draft, force]),
    isComposing: false
  });

  return {
    app,
    first,
    second,
    sent,
    generated,
    setSelected: value => { selected = value; },
    restore: () => {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    }
  };
}

function keyEvent(patch = {}) {
  return {
    key: 'Enter',
    code: 'Enter',
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
    stopPropagation() {},
    ...patch
  };
}

test('Ctrl+Enter usa a sugestão selecionada ou a primeira pronta', () => {
  const fixture = keyboardFixture();
  try {
    const selectedEvent = keyEvent();
    fixture.app.handleKeyboard(selectedEvent);
    assert.equal(selectedEvent.prevented, true);
    assert.equal(selectedEvent.stopped, true);
    assert.deepEqual(fixture.sent, [fixture.second]);

    fixture.setSelected(null);
    fixture.app.handleKeyboard(keyEvent());
    assert.deepEqual(fixture.sent, [fixture.second, fixture.first]);

    fixture.app.handleKeyboard(keyEvent({ repeat: true }));
    fixture.app.handleKeyboard(keyEvent({ isComposing: true }));
    assert.deepEqual(fixture.sent, [fixture.second, fixture.first]);
  } finally {
    fixture.restore();
  }
});

test('Enter e Shift+Enter continuam pertencendo ao WhatsApp', () => {
  const fixture = keyboardFixture();
  try {
    for (const shiftKey of [false, true]) {
      const event = keyEvent({
        ctrlKey: false,
        shiftKey,
        preventDefault() { assert.fail('Enter do WhatsApp não pode ser interceptado'); },
        stopPropagation() { assert.fail('Enter do WhatsApp não pode ser interceptado'); },
        stopImmediatePropagation() { assert.fail('Enter do WhatsApp não pode ser interceptado'); }
      });
      fixture.app.handleKeyboard(event);
    }
    assert.deepEqual(fixture.sent, []);
  } finally {
    fixture.restore();
  }
});

test('Ctrl+Espaço gera imediatamente sem esperar debounce', () => {
  const fixture = keyboardFixture();
  try {
    const event = keyEvent({ key: ' ', code: 'Space' });
    fixture.app.handleKeyboard(event);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.deepEqual(fixture.generated, [['teste envio', true]]);
  } finally {
    fixture.restore();
  }
});
