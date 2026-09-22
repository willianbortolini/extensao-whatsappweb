(() => {
  'use strict';

  const REQUEST_TYPE = 'WAI_COMPOSER_BRIDGE_REQUEST';
  const RESPONSE_TYPE = 'WAI_COMPOSER_BRIDGE_RESPONSE';
  const BRIDGE_VERSION = 2;
  const INSTALL_MARKER = '__waiComposerBridgeV2';

  if (window[INSTALL_MARKER]) return;
  window[INSTALL_MARKER] = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200e\u200f\u2066-\u2069]/g, '')
      .trim();
  }

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function firstVisible(root, selectors) {
    if (!root) return null;
    for (const selector of selectors) {
      let candidates = [];
      try { candidates = root.querySelectorAll(selector); } catch {}
      for (const candidate of candidates) if (visible(candidate)) return candidate;
    }
    return null;
  }

  function findComposer() {
    const roots = [
      document.querySelector('#main footer'),
      document.querySelector('#main [role="form"]'),
      document.querySelector('#main')
    ].filter(Boolean);

    const selectors = [
      'div[contenteditable="true"][data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][role="textbox"][data-tab]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-tab]',
      'div[contenteditable="true"]'
    ];

    for (const root of roots) {
      const composer = firstVisible(root, selectors);
      if (composer) return composer;
    }
    return null;
  }

  function findSendButton(composer = findComposer()) {
    if (!composer) return null;
    const scope = composer.closest('footer') ||
      composer.closest('[role="form"]') ||
      document.querySelector('#main footer') ||
      document.querySelector('#main');
    if (!scope) return null;

    const iconNames = ['wds-ic-send-filled', 'wds-ic-send-outline', 'wds-ic-send', 'send'];
    for (const name of iconNames) {
      for (const attr of ['data-icon', 'data-testid']) {
        let marker = null;
        try { marker = scope.querySelector('[' + attr + '="' + name + '"]'); } catch {}
        if (!marker) continue;
        const control = marker.matches('button, [role="button"]')
          ? marker
          : marker.closest('button, [role="button"]');
        if (control && visible(control) && !control.disabled && control.getAttribute('aria-disabled') !== 'true') {
          return control;
        }
      }
    }

    return firstVisible(scope, [
      'button[aria-label="Enviar"]',
      'button[aria-label="Send"]',
      '[role="button"][aria-label="Enviar"]',
      '[role="button"][aria-label="Send"]',
      'button[aria-label*="enviar" i]',
      'button[aria-label*="send" i]',
      '[role="button"][aria-label*="enviar" i]',
      '[role="button"][aria-label*="send" i]',
      'button[type="submit"]'
    ]);
  }

  function conversationSignature() {
    const titleNode =
      document.querySelector('#main header [data-testid="conversation-info-header-chat-title"]') ||
      document.querySelector('#main header [title]') ||
      document.querySelector('#main header span[dir="auto"]');
    const title = normalizeText(titleNode?.getAttribute?.('title') || titleNode?.textContent || '');

    let jid = '';
    const nodes = document.querySelectorAll('#main [data-id]');
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const raw = String(nodes[index].getAttribute('data-id') || '');
      const match = raw.match(/([0-9A-Za-z._-]+@(?:c\.us|g\.us|lid|s\.whatsapp\.net))/i);
      if (match) {
        jid = match[1].toLowerCase();
        break;
      }
    }
    return jid + '|' + title;
  }

  function describeElement(element) {
    if (!(element instanceof Element)) return null;
    return {
      tag: element.tagName || '',
      role: element.getAttribute('role') || '',
      contenteditable: element.getAttribute('contenteditable') || '',
      dataTestId: element.getAttribute('data-testid') || '',
      dataTab: element.getAttribute('data-tab') || '',
      ariaLabel: element.getAttribute('aria-label') || ''
    };
  }

  function safeRequire(name) {
    try {
      if (typeof window.require !== 'function') return null;
      const loaded = window.require(name);
      if (loaded?.default && typeof loaded.default === 'object') return loaded.default;
      return loaded || null;
    } catch {
      return null;
    }
  }

  function findLexicalModule() {
    for (const name of ['Lexical.prod', 'cr:370', 'Lexical']) {
      const lexical = safeRequire(name);
      if (lexical && typeof lexical.$getRoot === 'function') return { lexical, name };
    }
    return { lexical: null, name: '' };
  }

  function findLexicalEditor(composer, lexical) {
    try {
      if (lexical && typeof lexical.getNearestEditorFromDOMNode === 'function') {
        const nearest = lexical.getNearestEditorFromDOMNode(composer);
        if (nearest) return nearest;
      }
    } catch {}

    let current = composer;
    for (let depth = 0; current && depth < 10; depth += 1) {
      try {
        if (current.__lexicalEditor) return current.__lexicalEditor;
      } catch {}
      current = current.parentElement;
    }
    return null;
  }

  function domText(composer) {
    return normalizeText(composer?.innerText || composer?.textContent || '');
  }

  function lexicalText(editor, lexical) {
    if (!editor || !lexical || typeof lexical.$getRoot !== 'function') return null;
    try {
      let value = '';
      editor.getEditorState().read(() => {
        value = lexical.$getRoot().getTextContent();
      });
      return normalizeText(value);
    } catch {
      return null;
    }
  }

  async function waitUntil(check, timeoutMs = 1200, intervalMs = 30) {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      try {
        const value = check();
        if (value) return value;
      } catch {}
      await sleep(intervalMs);
    }
    return null;
  }

  async function verifyEditorText(composer, editor, lexical, expected, timeoutMs = 1200) {
    const normalizedExpected = normalizeText(expected);
    return Boolean(await waitUntil(() => {
      if (domText(composer) !== normalizedExpected) return false;
      const stateText = lexicalText(editor, lexical);
      return stateText == null || stateText === normalizedExpected;
    }, timeoutMs));
  }

  async function clearLexical(composer, editor, lexical) {
    if (!editor || !lexical) return false;
    composer.focus();

    if (lexical.CLEAR_EDITOR_COMMAND && typeof editor.dispatchCommand === 'function') {
      try { editor.dispatchCommand(lexical.CLEAR_EDITOR_COMMAND, undefined); } catch {}
      if (await verifyEditorText(composer, editor, lexical, '', 450)) return true;
    }

    if (typeof editor.update !== 'function' || typeof lexical.$getRoot !== 'function') return false;
    try {
      editor.update(() => {
        const root = lexical.$getRoot();
        root.clear();
        if (typeof lexical.$createParagraphNode === 'function') {
          const paragraph = lexical.$createParagraphNode();
          root.append(paragraph);
          if (typeof paragraph.selectEnd === 'function') paragraph.selectEnd();
        }
      }, { tag: 'wai-clear-composer' });
    } catch {
      return false;
    }
    return verifyEditorText(composer, editor, lexical, '', 900);
  }

  async function insertLexical(composer, editor, lexical, value) {
    const expected = normalizeText(value);
    if (domText(composer) || lexicalText(editor, lexical)) return false;

    if (lexical.CONTROLLED_TEXT_INSERTION_COMMAND && typeof editor.dispatchCommand === 'function') {
      try {
        composer.focus();
        editor.dispatchCommand(lexical.CONTROLLED_TEXT_INSERTION_COMMAND, value);
      } catch {}
      if (await verifyEditorText(composer, editor, lexical, expected, 800)) return true;
      if (!await clearLexical(composer, editor, lexical)) return false;
    }

    if (
      typeof editor.update !== 'function' ||
      typeof lexical.$getRoot !== 'function' ||
      typeof lexical.$createParagraphNode !== 'function' ||
      typeof lexical.$createTextNode !== 'function'
    ) return false;

    try {
      editor.update(() => {
        const root = lexical.$getRoot();
        root.clear();
        const paragraph = lexical.$createParagraphNode();
        root.append(paragraph);

        const lines = String(value).replace(/\r\n?/g, '\n').split('\n');
        lines.forEach((line, index) => {
          if (index > 0) {
            if (typeof lexical.$createLineBreakNode === 'function') {
              paragraph.append(lexical.$createLineBreakNode());
            } else {
              paragraph.append(lexical.$createTextNode('\n'));
            }
          }
          if (line) paragraph.append(lexical.$createTextNode(line));
        });

        if (typeof paragraph.selectEnd === 'function') paragraph.selectEnd();
      }, { tag: 'wai-replace-composer' });
    } catch {
      return false;
    }

    return verifyEditorText(composer, editor, lexical, expected, 1200);
  }

  async function replaceViaLexical(composer, value) {
    const moduleResult = findLexicalModule();
    if (!moduleResult.lexical) return { ok: false, stage: 'LEXICAL_MODULE_NOT_FOUND', method: 'lexical' };

    const editor = findLexicalEditor(composer, moduleResult.lexical);
    if (!editor) {
      return { ok: false, stage: 'LEXICAL_EDITOR_NOT_FOUND', method: 'lexical', lexicalModule: moduleResult.name };
    }

    if (!await clearLexical(composer, editor, moduleResult.lexical)) {
      return {
        ok: false,
        stage: 'CLEAR_FAILED',
        method: 'lexical',
        lexicalModule: moduleResult.name,
        actualDom: domText(composer),
        actualEditor: lexicalText(editor, moduleResult.lexical)
      };
    }

    if (domText(composer) || lexicalText(editor, moduleResult.lexical)) {
      return { ok: false, stage: 'CLEAR_VERIFY_FAILED', method: 'lexical', lexicalModule: moduleResult.name };
    }

    if (!await insertLexical(composer, editor, moduleResult.lexical, value)) {
      return {
        ok: false,
        stage: 'INSERT_FAILED',
        method: 'lexical',
        lexicalModule: moduleResult.name,
        actualDom: domText(composer),
        actualEditor: lexicalText(editor, moduleResult.lexical)
      };
    }

    return { ok: true, stage: 'REPLACED', method: 'lexical', lexicalModule: moduleResult.name };
  }

  async function replaceViaPaste(composer, value) {
    const expected = normalizeText(value);
    composer.focus();

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);

      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', String(value));
      let event;
      try {
        event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard });
      } catch {
        event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: clipboard });
      }
      composer.dispatchEvent(event);
    } catch {
      return { ok: false, stage: 'PASTE_DISPATCH_FAILED', method: 'paste' };
    }

    const matched = await waitUntil(() => domText(composer) === expected, 1000);
    if (!matched) return { ok: false, stage: 'TEXT_MISMATCH', method: 'paste', actualDom: domText(composer) };

    const moduleResult = findLexicalModule();
    const editor = moduleResult.lexical ? findLexicalEditor(composer, moduleResult.lexical) : null;
    if (editor) {
      const stateMatched = await waitUntil(() => lexicalText(editor, moduleResult.lexical) === expected, 700);
      if (!stateMatched) {
        return {
          ok: false,
          stage: 'EDITOR_STATE_MISMATCH',
          method: 'paste',
          actualDom: domText(composer),
          actualEditor: lexicalText(editor, moduleResult.lexical)
        };
      }
    }

    return { ok: true, stage: 'REPLACED', method: 'paste' };
  }

  async function replaceComposer(value) {
    const composer = findComposer();
    if (!composer) return { ok: false, stage: 'COMPOSER_NOT_FOUND' };

    const primary = await replaceViaLexical(composer, value);
    if (primary.ok) return { ...primary, composer };

    const fallback = await replaceViaPaste(composer, value);
    if (fallback.ok) {
      return { ...fallback, composer, primaryStage: primary.stage, primaryMethod: primary.method };
    }

    return {
      ok: false,
      stage: fallback.stage || primary.stage || 'REPLACE_FAILED',
      primaryStage: primary.stage,
      fallbackStage: fallback.stage,
      actualDom: fallback.actualDom ?? primary.actualDom ?? domText(composer),
      actualEditor: fallback.actualEditor ?? primary.actualEditor ?? null
    };
  }

  function bubbleText(container) {
    const parts = [];
    let nodes = [];
    try {
      nodes = container.querySelectorAll('[data-testid="msg-text"], [data-testid="selectable-text"], .selectable-text');
    } catch {}
    for (const node of nodes) {
      const value = normalizeText(node.innerText || node.textContent || '');
      if (value && !parts.includes(value)) parts.push(value);
    }
    return normalizeText(parts.join('\n'));
  }

  function countOutgoingText(expectedText) {
    const expected = normalizeText(expectedText);
    let count = 0;
    let candidates = [];
    try { candidates = document.querySelectorAll('#main .message-out, #main [data-id^="true_"]'); } catch {}
    for (const candidate of candidates) {
      const container = candidate.closest?.('.message-out, [data-id^="true_"]') || candidate;
      if (bubbleText(container) === expected) count += 1;
    }
    return count;
  }

  async function sendAndConfirm(composer, expectedText, initialSignature) {
    if (conversationSignature() !== initialSignature) return { ok: false, stage: 'CHAT_CHANGED' };
    if (domText(composer) !== normalizeText(expectedText)) {
      return { ok: false, stage: 'TEXT_MISMATCH', actualDom: domText(composer) };
    }

    const button = findSendButton(composer);
    if (!button) return { ok: false, stage: 'SEND_BUTTON_NOT_FOUND' };

    const beforeCount = countOutgoingText(expectedText);
    try { button.click(); } catch { return { ok: false, stage: 'SEND_CLICK_FAILED' }; }

    const started = Date.now();
    while (Date.now() - started <= 3200) {
      if (conversationSignature() !== initialSignature) {
        return { ok: false, stage: 'CHAT_CHANGED_AFTER_CLICK' };
      }

      const currentComposer = findComposer();
      if (currentComposer && domText(currentComposer) === '') {
        return { ok: true, stage: 'SEND_CONFIRMED', confirmation: 'composer-cleared' };
      }
      if (countOutgoingText(expectedText) > beforeCount) {
        return { ok: true, stage: 'SEND_CONFIRMED', confirmation: 'outgoing-bubble' };
      }
      await sleep(50);
    }

    return { ok: false, stage: 'SEND_NOT_CONFIRMED' };
  }

  function diagnostics() {
    const composer = findComposer();
    const moduleResult = findLexicalModule();
    const editor = composer && moduleResult.lexical ? findLexicalEditor(composer, moduleResult.lexical) : null;
    return {
      ok: true,
      stage: 'DIAGNOSTICS',
      bridgeVersion: BRIDGE_VERSION,
      composer: describeElement(composer),
      lexicalModule: moduleResult.name || null,
      lexicalEditor: Boolean(editor),
      sendButton: describeElement(findSendButton(composer)),
      conversationDetected: Boolean(conversationSignature())
    };
  }

  async function handleRequest(operation, payload) {
    if (operation === 'PING') return { ok: true, stage: 'READY', bridgeVersion: BRIDGE_VERSION };
    if (operation === 'DIAGNOSE') return diagnostics();

    const value = String(payload?.text == null ? '' : payload.text);
    if (!value.trim() || value.length > 12000) return { ok: false, stage: 'INVALID_TEXT' };

    const signature = conversationSignature();
    if (!signature) return { ok: false, stage: 'CONVERSATION_NOT_FOUND' };

    const replacement = await replaceComposer(value);
    if (!replacement.ok) {
      const { composer, ...safeReplacement } = replacement;
      return safeReplacement;
    }

    if (conversationSignature() !== signature) {
      return { ok: false, stage: 'CHAT_CHANGED', method: replacement.method };
    }

    if (operation === 'REPLACE') {
      return { ok: true, stage: 'REPLACED', method: replacement.method, primaryStage: replacement.primaryStage || null };
    }

    if (operation !== 'REPLACE_AND_SEND') return { ok: false, stage: 'INVALID_OPERATION' };

    const sent = await sendAndConfirm(replacement.composer, value, signature);
    return { ...sent, method: replacement.method, primaryStage: replacement.primaryStage || null };
  }

  function postResponse(requestId, result) {
    window.postMessage({ type: RESPONSE_TYPE, requestId, result }, '*');
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== REQUEST_TYPE || typeof data.requestId !== 'string') return;

    Promise.resolve(handleRequest(data.operation, data.payload || {}))
      .then(result => postResponse(data.requestId, result))
      .catch(error => postResponse(data.requestId, {
        ok: false,
        stage: 'BRIDGE_EXCEPTION',
        message: error?.message || String(error || 'Falha interna no composer bridge.')
      }));
  });
})();