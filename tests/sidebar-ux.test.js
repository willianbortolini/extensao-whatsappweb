import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SidebarUI,
  appendPresent,
  summaryCompactStatus,
  promptsCompactStatus,
  translationCompactState
} from '../src/ui.js';
import { PROMPT_SCOPE } from '../src/config.js';

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.textContent = '';
    this.className = '';
    this.style = {};
    this.listeners = {};
    this.classList = {
      add: value => {
        const values = new Set(String(this.className || '').split(/\s+/).filter(Boolean));
        values.add(value);
        this.className = [...values].join(' ');
      }
    };
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  querySelectorAll() {
    return [];
  }

  remove() {}
  focus() {}
}

function installFakeDocument() {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: tag => new FakeNode(tag)
  };
  return () => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  };
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  return [node.textContent, ...(node.children || []).map(textOf)]
    .filter(Boolean)
    .join(' ');
}

function uiFixture() {
  const ui = new SidebarUI({});
  Object.assign(ui, {
    chat: {
      accountId: 'a',
      whatsappChatId: 'c',
      displayName: 'Rafa',
      isGroup: false
    },
    settings: {
      aiPaused: false,
      defaultSummaryEnabled: true,
      defaultSummaryMode: 'manual',
      defaultSummaryEvery: 2
    },
    chatSettings: {
      aiEnabled: true,
      translationEnabled: false,
      myLanguage: 'pt-BR',
      contactLanguage: 'en',
      summaryEnabled: true,
      summaryMode: 'manual',
      summaryEvery: 2
    },
    chatSettingsLoading: false,
    keyStatus: { configured: true },
    summary: {
      summary: 'Resumo completo que deve ficar escondido quando recolhido.',
      summaryVersion: 3,
      messagesSinceSummary: 0,
      updatedAt: Date.now()
    },
    prompts: [
      { id: 'local', name: 'Rafa ❤️', scope: PROMPT_SCOPE.CHAT, enabled: true, autoRun: true },
      { id: 'global', name: 'Melhorar', scope: PROMPT_SCOPE.GLOBAL, enabled: true, autoRun: true }
    ]
  });
  return ui;
}

test('estado compacto resume tradução, resumo e prompts', () => {
  assert.deepEqual(translationCompactState({
    translationEnabled: false,
    myLanguage: 'pt-BR',
    contactLanguage: 'en'
  }, true), {
    enabled: false,
    showDetails: false,
    summary: 'Desativada'
  });

  const translated = translationCompactState({
    translationEnabled: true,
    myLanguage: 'pt-BR',
    contactLanguage: 'en'
  }, false);
  assert.equal(translated.enabled, true);
  assert.equal(translated.showDetails, false);
  assert.match(translated.summary, /Português/);
  assert.match(translated.summary, /Inglês/);

  assert.equal(summaryCompactStatus({ summary: 'Ok', messagesSinceSummary: 0 }), '✓ Atualizado');
  assert.equal(summaryCompactStatus({ summary: 'Ok', messagesSinceSummary: 4 }), '+4 novas');
  assert.equal(summaryCompactStatus(null), 'Não criado');

  assert.equal(promptsCompactStatus([
    { enabled: true, autoRun: true, scope: PROMPT_SCOPE.GLOBAL },
    { enabled: true, autoRun: true, scope: PROMPT_SCOPE.CHAT },
    { enabled: false, autoRun: true, scope: PROMPT_SCOPE.CHAT }
  ]), '2 auto • 1 aqui');
});

test('appendPresent nunca encaminha null/undefined ao append', () => {
  const appended = [];
  const parent = { append: child => appended.push(child) };
  appendPresent(parent, 'A', null, undefined, false, 'B');
  assert.deepEqual(appended, ['A', 'B']);
});

test('seções começam recolhidas e preservam expansão entre renders', () => {
  const ui = new SidebarUI({});
  assert.deepEqual(ui.expandedSections, {
    translation: false,
    summary: false,
    summarySettings: false,
    prompts: false
  });

  assert.equal(ui.toggleSection('summary'), true);
  ui.setState({ summary: { summary: 'novo' } });
  assert.equal(ui.expandedSections.summary, true);

  ui.toggleSection('summarySettings', true);
  assert.equal(ui.expandedSections.summarySettings, true);
  ui.toggleSection('summary', false);
  assert.equal(ui.expandedSections.summary, false);
  assert.equal(ui.expandedSections.summarySettings, false);
});

test('tradução desligada não renderiza seletores de idioma', () => {
  const restore = installFakeDocument();
  try {
    const ui = uiFixture();
    ui.expandedSections.translation = true;
    const text = textOf(ui.renderTranslationSection());
    assert.match(text, /Tradução/);
    assert.match(text, /Desativada/);
    assert.doesNotMatch(text, /Meu idioma/);
    assert.doesNotMatch(text, /Idioma do contato/);
    assert.doesNotMatch(text, /Traduzir rascunho/);
  } finally {
    restore();
  }
});

test('tradução ligada recolhida mostra só o par de idiomas; expandida mostra controles', () => {
  const restore = installFakeDocument();
  try {
    const ui = uiFixture();
    ui.chatSettings.translationEnabled = true;

    let text = textOf(ui.renderTranslationSection());
    assert.match(text, /Português/);
    assert.match(text, /Inglês/);
    assert.doesNotMatch(text, /Meu idioma/);

    ui.expandedSections.translation = true;
    text = textOf(ui.renderTranslationSection());
    assert.match(text, /Meu idioma/);
    assert.match(text, /Idioma do contato/);
    assert.match(text, /Traduzir rascunho/);
  } finally {
    restore();
  }
});

test('resumo recolhido esconde conteúdo e configurações; expansão é progressiva', () => {
  const restore = installFakeDocument();
  try {
    const ui = uiFixture();

    let text = textOf(ui.renderSummarySection());
    assert.match(text, /Resumo/);
    assert.match(text, /Atualizado/);
    assert.doesNotMatch(text, /Resumo completo que deve ficar escondido/);
    assert.doesNotMatch(text, /Modo/);
    assert.doesNotMatch(text, /null/);

    ui.expandedSections.summary = true;
    text = textOf(ui.renderSummarySection());
    assert.match(text, /Resumo completo que deve ficar escondido/);
    assert.match(text, /Configurações do resumo/);
    assert.doesNotMatch(text, /Resumo habilitado para esta conversa/);
    assert.doesNotMatch(text, /null/);

    ui.expandedSections.summarySettings = true;
    text = textOf(ui.renderSummarySection());
    assert.match(text, /Resumo habilitado para esta conversa/);
    assert.match(text, /Modo/);
    assert.doesNotMatch(text, /null/);
  } finally {
    restore();
  }
});

test('prompts recolhidos não renderizam lista; expandidos mostram locais e globais', () => {
  const restore = installFakeDocument();
  try {
    const ui = uiFixture();

    let text = textOf(ui.renderPromptsSection());
    assert.match(text, /Prompts/);
    assert.match(text, /2 auto/);
    assert.match(text, /1 aqui/);
    assert.doesNotMatch(text, /Rafa ❤️/);
    assert.doesNotMatch(text, /Melhorar/);

    ui.expandedSections.prompts = true;
    text = textOf(ui.renderPromptsSection());
    assert.match(text, /Rafa ❤️/);
    assert.match(text, /Melhorar/);
    assert.match(text, /Para este contato/);
    assert.match(text, /Global/);
  } finally {
    restore();
  }
});
