let sequence = 0;

export function sendRuntime(type, payload = {}) {
  const requestId = `wai-${Date.now()}-${++sequence}`;
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, requestId, payload }, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: 'EXTENSION_ERROR', message: error.message, requestId });
        return;
      }
      resolve(response || { ok: false, error: 'EMPTY_RESPONSE', requestId });
    });
  });
}

export function openOptions() {
  return sendRuntime('OPEN_OPTIONS');
}