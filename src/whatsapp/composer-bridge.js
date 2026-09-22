export const COMPOSER_BRIDGE_REQUEST = 'WAI_COMPOSER_BRIDGE_REQUEST';
export const COMPOSER_BRIDGE_RESPONSE = 'WAI_COMPOSER_BRIDGE_RESPONSE';

let requestSequence = 0;

export function normalizeComposerText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200e\u200f\u2066-\u2069]/g, '')
    .trim();
}

export class WhatsAppComposerBridge {
  constructor({ defaultTimeoutMs = 5000 } = {}) {
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.pending = new Map();
    this.onMessage = event => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.type !== COMPOSER_BRIDGE_RESPONSE || typeof data.requestId !== 'string') return;
      const entry = this.pending.get(data.requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(data.requestId);
      entry.resolve(data.result || { ok: false, stage: 'EMPTY_BRIDGE_RESPONSE' });
    };
    window.addEventListener('message', this.onMessage);
  }

  request(operation, payload = {}, timeoutMs = this.defaultTimeoutMs) {
    if (typeof window === 'undefined' || typeof window.postMessage !== 'function') {
      return Promise.resolve({ ok: false, stage: 'BRIDGE_UNAVAILABLE' });
    }

    const random = globalThis.crypto?.randomUUID?.() || String(++requestSequence);
    const requestId = 'wai-composer-' + Date.now() + '-' + random;

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, stage: 'BRIDGE_TIMEOUT' });
      }, timeoutMs);

      this.pending.set(requestId, { resolve, timer });
      try {
        window.postMessage({ type: COMPOSER_BRIDGE_REQUEST, requestId, operation, payload }, '*');
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({
          ok: false,
          stage: 'BRIDGE_UNAVAILABLE',
          message: error?.message || String(error || '')
        });
      }
    });
  }

  replaceText(text, { chatId = '' } = {}) {
    return this.request('REPLACE', { text, chatId }, 5000);
  }

  replaceAndSend(text, { chatId = '' } = {}) {
    return this.request('REPLACE_AND_SEND', { text, chatId }, 8000);
  }

  diagnose() {
    return this.request('DIAGNOSE', {}, 2500);
  }

  destroy() {
    window.removeEventListener('message', this.onMessage);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, stage: 'BRIDGE_DESTROYED' });
    }
    this.pending.clear();
  }
}