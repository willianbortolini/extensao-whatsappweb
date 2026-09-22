(() => {
  'use strict';
  import(chrome.runtime.getURL('src/app.js'))
    .then(({ WhatsAppAIApp }) => new WhatsAppAIApp().start())
    .catch(error => console.error('[WAI] Falha ao iniciar extensão:', error?.message || error));
})();