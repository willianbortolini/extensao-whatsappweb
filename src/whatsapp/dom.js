function visible(element) {
  if (!(element instanceof Element)) return false;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function firstVisible(selectors, root = document) {
  for (const selector of selectors) {
    const candidates = root.querySelectorAll(selector);
    for (const candidate of candidates) if (visible(candidate)) return candidate;
  }
  return null;
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\u200e|\u200f/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function simpleHash(value) {
  let h = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function jidFromText(value) {
  const text = String(value || '');
  const match = text.match(/([0-9A-Za-z._-]+@(?:c\.us|g\.us|lid|s\.whatsapp\.net))/i);
  return match ? match[1].toLowerCase() : '';
}

function phoneFromJid(jid) {
  if (!jid || /@g\.us$/i.test(jid)) return '';
  const local = jid.split('@')[0].replace(/\D/g, '');
  return local || '';
}

function parseWhatsAppTimestamp(raw) {
  const value = String(raw || '');
  const match = value.match(/\[(\d{1,2}):(\d{2})(?::(\d{2}))?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]/);
  if (!match) return 0;
  let year = Number(match[6]);
  if (year < 100) year += 2000;
  const date = new Date(year, Number(match[5]) - 1, Number(match[4]), Number(match[1]), Number(match[2]), Number(match[3] || 0));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function senderFromPrePlain(raw) {
  const text = String(raw || '');
  const match = text.match(/\]\s*([^:]+):/);
  return match ? match[1].trim() : '';
}

function messageDirection(container, dataId) {
  if (container.matches('.message-out') || container.closest('.message-out') || container.querySelector('.message-out')) return 'outgoing';
  if (container.matches('.message-in') || container.closest('.message-in') || container.querySelector('.message-in')) return 'incoming';
  // WhatsApp message keys encode fromMe even when the CSS classes are absent.
  if (/^true_/i.test(dataId)) return 'outgoing';
  if (/^false_/i.test(dataId)) return 'incoming';
  if (container.querySelector('[data-testid="tail-out"], [data-icon="tail-out"]')) return 'outgoing';
  if (container.querySelector('[data-testid="tail-in"], [data-icon="tail-in"]')) return 'incoming';
  const author = container.querySelector('span[aria-label$=":"]')?.getAttribute('aria-label')?.trim();
  if (/^(você|you|tu|tú):$/i.test(author || '')) return 'outgoing';
  if (author) return 'incoming';
  if (container.querySelector('[data-testid="msg-meta"][role="button"]')) return 'outgoing';
  return 'unknown';
}

export class WhatsAppDom {
  getConversationTitleElement() {
    return firstVisible([
      '#main header [data-testid="conversation-info-header-chat-title"]',
      '#main header [title]',
      '#main header span[dir="auto"]'
    ]);
  }

  readConversation() {
    const titleElement = this.getConversationTitleElement();
    if (!titleElement) return null;
    const displayName = normalizeWhitespace(titleElement.getAttribute('title') || titleElement.textContent);
    if (!displayName) return null;

    let jid = '';
    const messageNodes = document.querySelectorAll('#main [data-id], #main [data-testid="msg-container"] [data-id]');
    for (let i = messageNodes.length - 1; i >= 0; i -= 1) {
      jid = jidFromText(messageNodes[i].getAttribute('data-id'));
      if (jid) break;
    }

    const header = titleElement.closest('header') || document.querySelector('#main header');
    if (!jid && header) {
      jid = jidFromText(header.innerHTML);
    }

    const isGroup = /@g\.us$/i.test(jid) ||
      Boolean(header?.querySelector('[data-testid*="group" i]')) ||
      /participants|participantes/i.test(header?.innerText || '');

    const phone = phoneFromJid(jid);
    const whatsappChatId = jid || (phone ? `phone:${phone}` : `name:${simpleHash(displayName.toLowerCase())}`);

    return {
      whatsappChatId,
      displayName,
      phone,
      isGroup,
      type: isGroup ? 'group' : 'individual',
      identityConfidence: jid ? 'high' : (phone ? 'medium' : 'fallback')
    };
  }

  readAccountCandidate() {
    const knownKeys = ['last-wid-md', 'last-wid'];
    try {
      for (const key of knownKeys) {
        const value = localStorage.getItem(key);
        const jid = jidFromText(value);
        if (jid) return { whatsappAccountId: jid, phone: phoneFromJid(jid), confidence: 'high' };
      }

      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || '';
        if (!/(wid|user|account|me)/i.test(key)) continue;
        const value = localStorage.getItem(key);
        const jid = jidFromText(value);
        if (jid && !/@g\.us$/i.test(jid)) {
          return { whatsappAccountId: jid, phone: phoneFromJid(jid), confidence: 'medium' };
        }
      }
    } catch {}

    return { whatsappAccountId: '', phone: '', confidence: 'fallback' };
  }

  getComposer() {
    const current = firstVisible(['#main [data-testid="conversation-compose-box-input"][contenteditable="true"]']);
    if (current) return current;
    const footer = document.querySelector('#main footer');
    const root = footer || document.querySelector('#main') || document;
    const candidates = [
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][data-tab]',
      'div[contenteditable="true"]'
    ];
    return firstVisible(candidates, root);
  }

  readDraft() {
    const composer = this.getComposer();
    if (!composer) return '';
    return normalizeWhitespace(composer.innerText || composer.textContent || '');
  }

  setDraft(text) {
    const composer = this.getComposer();
    if (!composer) return false;

    const value = String(text || '');
    const expected = normalizeWhitespace(value);
    const current = () => normalizeWhitespace(composer.innerText || composer.textContent || '');

    const selectComposer = () => {
      const selection = window.getSelection?.();
      const range = document.createRange?.();
      if (!selection || !range) return false;
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    };

    const dispatchInput = (inputType, data = null) => {
      try {
        composer.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType,
          data
        }));
      } catch {
        composer.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    const moveCaretToEnd = () => {
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(composer);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {}
    };

    composer.focus();

    // Always clear first. Never try multiple insertions against a dirty composer,
    // otherwise a failed replacement can concatenate the suggestion repeatedly.
    try {
      selectComposer();
      document.execCommand('delete', false, null);
    } catch {}

    if (current()) {
      try {
        composer.textContent = '';
        if ('innerText' in composer) composer.innerText = '';
        dispatchInput('deleteContentBackward');
      } catch {
        return false;
      }
    }

    if (current()) return false;
    if (!value) return true;

    // Insert the suggestion exactly once through the browser editing pipeline
    // WhatsApp/Lexical listens to.
    try {
      composer.focus();
      document.execCommand('insertText', false, value);
    } catch {}

    if (current() !== expected) {
      // Last resort is replacement, never append.
      try {
        composer.textContent = value;
        if ('innerText' in composer) composer.innerText = value;
        dispatchInput('insertText', value);
      } catch {
        return false;
      }
    }

    if (current() !== expected) return false;
    moveCaretToEnd();
    return true;
  }

  findSendButton(composer = this.getComposer()) {
    if (!composer) return null;

    const roots = [];
    const addRoot = root => {
      if (root && !roots.includes(root)) roots.push(root);
    };

    // WhatsApp changes the compose DOM often. Prefer the closest scope first,
    // but fall back to the current footer and finally #main.
    addRoot(composer.closest('[data-testid="compose-box"]'));
    addRoot(composer.closest('footer'));
    if (typeof document !== 'undefined') {
      addRoot(document.querySelector('#main footer'));
      addRoot(document.querySelector('#main'));
    }

    const selectors = [
      'button[data-testid="compose-btn-send"]',
      '[role="button"][data-testid="compose-btn-send"]',
      'button[aria-label="Enviar"]',
      'button[aria-label="Send"]',
      '[role="button"][aria-label="Enviar"]',
      '[role="button"][aria-label="Send"]',
      'button[aria-label*="Enviar" i]',
      'button[aria-label*="Send" i]',
      '[role="button"][aria-label*="Enviar" i]',
      '[role="button"][aria-label*="Send" i]',
      '[data-testid="wds-ic-send-filled"]',
      '[data-icon="wds-ic-send-filled"]',
      '[data-testid="send"]',
      '[data-testid="send-button"]',
      '[data-icon="send"]'
    ];

    for (const root of roots) {
      for (const selector of selectors) {
        for (const marker of root.querySelectorAll(selector)) {
          const control = marker.matches?.('button, [role="button"]')
            ? marker
            : marker.closest?.('button, [role="button"]');
          if (!control || !visible(control)) continue;
          if (control.disabled || control.getAttribute('aria-disabled') === 'true') continue;
          return control;
        }
      }
    }

    return null;
  }

  async sendDraft(expectedText, chatId, stillAllowed = () => true) {
    const normalizedExpected = normalizeWhitespace(expectedText);

    // Let Lexical/React commit the inserted text before locating the send control.
    await new Promise(resolve => setTimeout(resolve, 80));
    for (let attempt = 0; attempt < 25; attempt++) {
      if (!stillAllowed()) return false;
      if (this.readConversation()?.whatsappChatId !== chatId) return false;
      if (this.readDraft() !== normalizedExpected) return false;

      const button = this.findSendButton();
      if (button) {
        // Revalidate immediately before the click so a chat switch or draft edit
        // can never send the suggestion to the wrong conversation.
        if (!stillAllowed()) return false;
        if (this.readConversation()?.whatsappChatId !== chatId) return false;
        if (this.readDraft() !== normalizedExpected) return false;
        button.click();
        return true;
      }

      // If the current WhatsApp build does not expose a stable send-button
      // selector, use the same Enter action a user would trigger in the focused
      // composer. We only accept it as sent if WhatsApp itself clears the draft.
      const composer = this.getComposer();
      if (composer && attempt >= 2) {
        if (!stillAllowed()) return false;
        if (this.readConversation()?.whatsappChatId !== chatId) return false;
        if (this.readDraft() !== normalizedExpected) return false;
        composer.focus();
        try {
          const options = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          };
          composer.dispatchEvent(new KeyboardEvent('keydown', options));
          composer.dispatchEvent(new KeyboardEvent('keypress', options));
          composer.dispatchEvent(new KeyboardEvent('keyup', options));
        } catch {}

        for (let verify = 0; verify < 6; verify++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          if (this.readConversation()?.whatsappChatId !== chatId) return true;
          if (!this.readDraft()) return true;
        }
      }

      // The composer may need another render before its send button becomes available.
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    return false;
  }

  readVisibleMessages() {
    this.messageElements = new Map();
    const main = document.querySelector('#main');
    if (!main) return [];

    const candidates = new Set([
      ...main.querySelectorAll('[data-testid="msg-container"]'),
      ...main.querySelectorAll('.message-in, .message-out'),
      ...main.querySelectorAll('[data-testid^="conv-msg-"][data-id]'),
      ...main.querySelectorAll('[data-id^="true_"], [data-id^="false_"]')
    ].map(node => node.closest('[data-id]') || node.querySelector('[data-id]') || node));

    const now = Date.now();
    const messages = [];
    const occurrence = new Map();
    const authorDirections = new Map();
    for (const container of candidates) {
      const author = senderFromPrePlain(container.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text'));
      const direction = messageDirection(container, container.getAttribute('data-id') || '');
      if (author && direction !== 'unknown') authorDirections.set(author, direction);
    }

    for (const container of candidates) {
      if (!(container instanceof Element)) continue;

      const dataHolder = container.matches('[data-id]') ? container : container.querySelector('[data-id]') || container.closest('[data-id]');
      const dataId = dataHolder?.getAttribute('data-id') || '';
      let direction = messageDirection(container, dataId);

      const preNode = container.querySelector('[data-pre-plain-text]') || container.closest('[data-pre-plain-text]');
      const prePlain = preNode?.getAttribute('data-pre-plain-text') || '';
      const whatsappTimestamp = parseWhatsAppTimestamp(prePlain);
      if (direction === 'unknown') direction = authorDirections.get(senderFromPrePlain(prePlain)) || 'unknown';
      const messageTime = prePlain.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1]
        || container.querySelector('[data-testid="msg-meta"]')?.textContent?.match(/\b\d{1,2}:\d{2}\b/)?.[0] || '';

      const textNodes = container.querySelectorAll('[data-testid="msg-text"], [data-testid="selectable-text"], .selectable-text');
      const parts = [];
      for (const node of textNodes) {
        if (node.closest('[data-wai-translation]')) continue;
        const text = normalizeWhitespace(node.innerText || node.textContent || '');
        if (text && !parts.includes(text)) parts.push(text);
      }

      let type = 'text';
      if (container.querySelector('video')) type = 'video-caption';
      else if (container.querySelector('img')) type = 'image-caption';
      else if (container.querySelector('[data-testid*="document" i], [data-icon*="document" i]')) type = 'document-caption';
      else if (container.querySelector('audio, [data-testid*="audio" i]')) type = 'audio';

      const text = parts.join('\n').trim() || (type === 'text' ? '' : `[${type.split('-')[0]}]`);
      if (!text && !dataId) continue;

      const senderName = direction === 'outgoing' ? 'Eu' : senderFromPrePlain(prePlain);
      const base = [
        dataId,
        direction,
        senderName,
        whatsappTimestamp || '',
        type,
        text
      ].join('|');

      const baseHash = simpleHash(base);
      const count = (occurrence.get(baseHash) || 0) + 1;
      occurrence.set(baseHash, count);

      const id = dataId ? `wa:${dataId}` : `fp:${baseHash}:${count}`;
      const bubble = container.matches('[data-testid="msg-container"]') ? container : container.querySelector('[data-testid="msg-container"]') || container.querySelector('.message-in, .message-out') || container;
      this.messageElements.set(id, { container: bubble, text });
      messages.push({
        id,
        whatsappMessageId: dataId || null,
        fingerprint: simpleHash(base),
        direction,
        senderName,
        type,
        text,
        whatsappTimestamp: whatsappTimestamp || 0,
        messageTime,
        timestampSource: whatsappTimestamp ? 'whatsapp' : 'unknown-date',
        rawTimestamp: prePlain,
        capturedAt: now
      });
    }

    const unique = new Map();
    for (const message of messages) unique.set(message.id, message);
    return [...unique.values()].sort((a, b) => a.whatsappTimestamp - b.whatsappTimestamp);
  }

  onComposerChanged(handler) {
    const listener = event => {
      const composer = this.getComposer();
      if (!composer) return;
      if (event.target === composer || composer.contains(event.target)) handler(event, composer);
    };
    document.addEventListener('input', listener, true);
    document.addEventListener('compositionstart', listener, true);
    document.addEventListener('compositionend', listener, true);
    return () => {
      document.removeEventListener('input', listener, true);
      document.removeEventListener('compositionstart', listener, true);
      document.removeEventListener('compositionend', listener, true);
    };
  }

  showTranslation(message, text, language) {
    const entry = this.messageElements?.get(message.id);
    if (!entry?.container.isConnected || entry.text !== message.text) return false;
    let translation = entry.container.querySelector('[data-wai-translation]');
    if (!translation) {
      translation = document.createElement('div');
      translation.setAttribute('data-wai-translation', '');
      entry.container.append(translation);
    }
    const label = `Tradução · ${language}\n${text}`;
    if (translation.textContent !== label) translation.textContent = label;
    return true;
  }

  clearTranslations() {
    document.querySelectorAll('[data-wai-translation]').forEach(node => node.remove());
  }

  observeMutations(handler) {
    const observer = new MutationObserver(mutations => {
      const relevant = mutations.filter(mutation => {
        const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        if (target?.closest('#wai-sidebar, [data-wai-translation]')) return false;
        const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return !nodes.length || nodes.some(node => node.nodeType !== 1 || !node.matches('[data-wai-translation]'));
      });
      if (relevant.length) handler(relevant);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: false });
    return () => observer.disconnect();
  }
}

export const DOM_UTILS = { visible, normalizeWhitespace, jidFromText, phoneFromJid, parseWhatsAppTimestamp, simpleHash, messageDirection };
