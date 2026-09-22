let sequence = 0;

function runtimeFailure(error, requestId) {
  const originalMessage = error?.message || String(error || 'Falha de comunicação com a extensão.');
  const normalized = originalMessage.toLowerCase();

  if (normalized.includes('extension context invalidated')) {
    return {
      ok: false,
      error: 'EXTENSION_CONTEXT_INVALIDATED',
      message: 'A extensão foi atualizada ou recarregada. Recarregue a aba do WhatsApp Web para reconectar.',
      requestId
    };
  }

  if (
    normalized.includes('receiving end does not exist') ||
    normalized.includes('could not establish connection') ||
    normalized.includes('message port closed') ||
    normalized.includes('the message channel closed')
  ) {
    return {
      ok: false,
      error: 'BACKGROUND_UNAVAILABLE',
      message: 'O serviço interno da extensão não está disponível. Recarregue a extensão e depois a aba do WhatsApp Web.',
      requestId
    };
  }

  return {
    ok: false,
    error: 'EXTENSION_ERROR',
    message: originalMessage,
    requestId
  };
}

export function sendRuntime(type, payload = {}) {
  const requestId = `wai-${Date.now()}-${++sequence}`;

  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type, requestId, payload }, response => {
        let error = null;

        try {
          error = chrome.runtime.lastError;
        } catch (runtimeError) {
          resolve(runtimeFailure(runtimeError, requestId));
          return;
        }

        if (error) {
          resolve(runtimeFailure(error, requestId));
          return;
        }

        resolve(response || { ok: false, error: 'EMPTY_RESPONSE', requestId });
      });
    } catch (error) {
      resolve(runtimeFailure(error, requestId));
    }
  });
}

export function openOptions() {
  return sendRuntime('OPEN_OPTIONS');
}
