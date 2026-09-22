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

    composer.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, value);
    } catch {}

    if (!inserted) {
      composer.textContent = value;
      try {
        composer.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: value
        }));
      } catch {
        composer.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    const finalRange = document.createRange();
    finalRange.selectNodeContents(composer);
    finalRange.collapse(false);
    selection.removeAllRanges();
    selection.addRange(finalRange);
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  readVisibleMessages() {
    const main = document.querySelector('#main');
    if (!main) return [];

    const candidates = new Set([
      ...main.querySelectorAll('[data-testid="msg-container"]'),
      ...main.querySelectorAll('.message-in, .message-out')
    ]);

    const now = Date.now();
    const messages = [];
    const occurrence = new Map();

    for (const container of candidates) {
      if (!(container instanceof Element)) continue;

      const dataHolder = container.matches('[data-id]') ? container : container.querySelector('[data-id]') || container.closest('[data-id]');
      const dataId = dataHolder?.getAttribute('data-id') || '';
      const direction = container.classList.contains('message-out') || Boolean(container.closest('.message-out'))
        ? 'outgoing'
        : (container.classList.contains('message-in') || Boolean(container.closest('.message-in')) ? 'incoming' : 'unknown');

      const preNode = container.querySelector('[data-pre-plain-text]') || container.closest('[data-pre-plain-text]');
      const prePlain = preNode?.getAttribute('data-pre-plain-text') || '';
      const whatsappTimestamp = parseWhatsAppTimestamp(prePlain);

      const textNodes = container.querySelectorAll('[data-testid="msg-text"], .selectable-text');
      const parts = [];
      for (const node of textNodes) {
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

      messages.push({
        id: dataId ? `wa:${dataId}` : `fp:${baseHash}:${count}`,
        whatsappMessageId: dataId || null,
        fingerprint: simpleHash(base),
        direction,
        senderName,
        type,
        text,
        whatsappTimestamp: whatsappTimestamp || now,
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

  observeMutations(handler) {
    const observer = new MutationObserver(mutations => handler(mutations));
    observer.observe(document.body, { childList: true, subtree: true, attributes: false });
    return () => observer.disconnect();
  }
}

export const DOM_UTILS = { visible, normalizeWhitespace, jidFromText, phoneFromJid, parseWhatsAppTimestamp, simpleHash };
