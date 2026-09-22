(() => {
  'use strict';

  const BODY_CLASS = 'wai-media-viewer-open';
  const LARGE_WIDTH = 0.68;
  const LARGE_HEIGHT = 0.68;
  let scheduled = false;

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function large(element) {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= innerWidth * LARGE_WIDTH && rect.height >= innerHeight * LARGE_HEIGHT;
  }

  // Media inside a normal conversation bubble is not an opened media viewer.
  // In particular, sticker-heavy groups contain large images and canvases.
  const CHAT_MESSAGE_SELECTOR = '#main .message-in, #main .message-out, #main [data-testid="msg-container"], #main [data-testid^="conv-msg-"], #main [data-id^="true_"], #main [data-id^="false_"]';

  function chatMessageMedia(element) {
    return Boolean(element?.closest(CHAT_MESSAGE_SELECTOR));
  }

  function containsConversationComposer(element) {
    const main = document.querySelector('#main');
    if (!main) return false;
    if (element === main) return true;
    const footer = main.querySelector('footer');
    return Boolean(footer && element.contains(footer));
  }

  function overlayLike(element) {
    if (!(element instanceof Element)) return false;
    if (element.getAttribute('role') === 'dialog') return true;
    if (element.getAttribute('aria-modal') === 'true') return true;
    if (element.hasAttribute('data-animate-modal-body')) return true;
    const testId = String(element.getAttribute('data-testid') || '').toLowerCase();
    // Generic "media" / "document" wrappers can be part of message bubbles.
    if (testId.includes('viewer') || testId.includes('media-modal')) return true;
    const position = getComputedStyle(element).position;
    return position === 'fixed' || position === 'absolute';
  }

  function hasViewerContent(element) {
    if (!element) return false;
    if (element.closest('#wai-sidebar')) return false;
    if (element.querySelector('video, canvas, iframe, embed, object')) return true;

    const image = element.querySelector('img');
    if (image) {
      const rect = image.getBoundingClientRect();
      if (rect.width >= 220 || rect.height >= 220) return true;
    }

    const controls = [
      '[data-icon*="download"]',
      '[data-icon*="zoom"]',
      '[data-icon*="rotate"]',
      '[data-icon*="document"]',
      '[aria-label*="Download" i]',
      '[aria-label*="Baixar" i]',
      '[aria-label*="Zoom" i]'
    ].join(',');
    return Boolean(element.querySelector(controls));
  }

  function isActualViewer(element) {
    return !chatMessageMedia(element) &&
      !containsConversationComposer(element) &&
      !element.closest('#wai-sidebar') &&
      overlayLike(element) &&
      large(element) &&
      hasViewerContent(element);
  }

  function largeViewerAncestor(element) {
    if (chatMessageMedia(element)) return null;
    let current = element;
    while (current && current !== document.body) {
      if (isActualViewer(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function isOpen() {
    const explicit = document.querySelectorAll(
      '[role="dialog"],[aria-modal="true"],[data-animate-modal-body],[data-testid*="viewer" i],[data-testid*="media-modal" i]'
    );
    for (const candidate of explicit) {
      if (isActualViewer(candidate)) return true;
    }

    const media = document.querySelectorAll('video,canvas,iframe,embed,object,img');
    for (const item of media) {
      if (item.closest('#wai-sidebar') || chatMessageMedia(item)) continue;
      const rect = item.getBoundingClientRect();
      if (rect.width < 220 && rect.height < 220) continue;
      if (largeViewerAncestor(item)) return true;
    }
    return false;
  }

  function sync() {
    scheduled = false;
    if (!document.body) return;
    const wasOpen = document.body.classList.contains(BODY_CLASS);
    const nowOpen = isOpen();
    document.body.classList.toggle(BODY_CLASS, nowOpen);
    if (wasOpen !== nowOpen) {
      document.dispatchEvent(new CustomEvent('wai:media-viewer', { detail: { open: nowOpen } }));
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sync);
  }

  function start() {
    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    addEventListener('resize', schedule);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') setTimeout(schedule, 50);
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();