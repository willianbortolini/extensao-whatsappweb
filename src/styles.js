const CSS = `
:root{
  --wai-bg:#f6faf8;--wai-surface:#fff;--wai-border:#e1e9e5;--wai-text:#15231d;
  --wai-muted:#687b72;--wai-brand:#00a884;--wai-brand-dark:#00866a;--wai-soft:#e8f7f2;
  --wai-danger:#c43d3d;--wai-warn:#a56b00;--wai-shadow:0 10px 30px rgba(21,35,29,.12)
}
body.wai-sidebar-active:not(.wai-media-viewer-open) #app{width:calc(100% - 400px)!important}
body.wai-media-viewer-open #wai-sidebar,body.wai-media-viewer-open #wai-launcher{display:none!important}
body.wai-media-viewer-open #app{width:100%!important}
#wai-sidebar{position:fixed;right:0;top:0;width:400px;height:100vh;height:100dvh;z-index:9998;background:var(--wai-bg);border-left:1px solid var(--wai-border);color:var(--wai-text);font-family:Arial,sans-serif;display:flex;flex-direction:column;box-shadow:var(--wai-shadow)}
#wai-sidebar *{box-sizing:border-box}
#wai-sidebar{color-scheme:light}
#wai-sidebar select.wai-select,#wai-sidebar select.wai-select:focus,#wai-sidebar select.wai-select option{color-scheme:light;background-color:#fff!important;color:#15231d!important}
.wai-header{height:60px;min-height:60px;background:var(--wai-surface);border-bottom:1px solid var(--wai-border);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.wai-brand{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:700}
.wai-logo{width:22px;height:22px;border-radius:50%;background:var(--wai-brand);box-shadow:0 0 0 5px var(--wai-soft)}
.wai-header-actions{display:flex;gap:6px}
.wai-icon{width:34px;height:34px;border:1px solid var(--wai-border);border-radius:9px;background:#fff;cursor:pointer;font-size:16px;color:var(--wai-text)}
.wai-icon:hover{background:var(--wai-soft)}
.wai-contact{padding:11px 14px;background:#fff;border-bottom:1px solid var(--wai-border)}
.wai-contact-name{font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wai-contact-meta{font-size:11px;color:var(--wai-muted);margin-top:3px}
.wai-content{flex:1;min-height:0;overflow:auto;padding:14px}
.wai-section{background:var(--wai-surface);border:1px solid var(--wai-border);border-radius:12px;margin-bottom:12px;overflow:hidden}
.wai-section-head{padding:11px 12px;border-bottom:1px solid var(--wai-border);display:flex;align-items:center;justify-content:space-between;gap:8px}
.wai-section-title{font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
.wai-section-body{padding:12px}
.wai-muted{color:var(--wai-muted);font-size:12px;line-height:1.45}
.wai-status{font-size:11px;padding:3px 7px;border-radius:999px;background:var(--wai-soft);color:var(--wai-brand-dark);font-weight:700}
.wai-status.warn{background:#fff5d9;color:var(--wai-warn)}
.wai-status.bad{background:#fdeaea;color:var(--wai-danger)}
.wai-suggestion{border:1px solid var(--wai-border);border-radius:10px;padding:10px;margin-bottom:9px;background:#fff;transition:.12s ease}
.wai-suggestion:last-child{margin-bottom:0}
.wai-suggestion.selected{border-color:var(--wai-brand);box-shadow:0 0 0 2px rgba(0,168,132,.15)}
.wai-suggestion-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
.wai-suggestion-name{font-size:12px;font-weight:800}
.wai-suggestion-text{white-space:pre-wrap;font-size:13px;line-height:1.45;word-break:break-word}
.wai-suggestion-actions{display:flex;gap:7px;margin-top:9px}
.wai-suggested-message-card{border:1px solid var(--wai-border);border-radius:10px;padding:10px;margin-top:9px;background:#fff}
.wai-suggested-message-actions{margin-top:9px}
.wai-loading{display:flex;align-items:center;gap:8px;color:var(--wai-muted);font-size:12px}
.wai-spinner{width:13px;height:13px;border:2px solid var(--wai-border);border-top-color:var(--wai-brand);border-radius:50%;animation:wai-spin .7s linear infinite}
@keyframes wai-spin{to{transform:rotate(360deg)}}
.wai-error{font-size:12px;color:var(--wai-danger);line-height:1.4}
.wai-summary{white-space:pre-wrap;font-size:12px;line-height:1.5;max-height:210px;overflow:auto}
.wai-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}
.wai-label{font-size:12px;color:var(--wai-muted)}
.wai-btn{border:1px solid var(--wai-brand-dark);background:var(--wai-brand-dark);color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer}
.wai-btn:hover{filter:brightness(.96)}
.wai-btn.secondary{background:#fff;color:var(--wai-text);border-color:var(--wai-border)}
.wai-btn.danger{background:#fff;color:var(--wai-danger);border-color:#efb8b8}
.wai-btn.small{padding:5px 8px;font-size:11px}
.wai-btn:disabled{opacity:.5;cursor:default}
.wai-actions{display:flex;gap:7px;flex-wrap:wrap}
.wai-input,.wai-select,.wai-textarea{width:100%;border:1px solid var(--wai-border);background:#fff;color:var(--wai-text);border-radius:8px;padding:8px 9px;font:inherit;font-size:12px;outline:none}
.wai-input:focus,.wai-select:focus,.wai-textarea:focus{border-color:var(--wai-brand)}
.wai-textarea{min-height:130px;resize:vertical;line-height:1.45}
.wai-check{display:flex;gap:8px;align-items:flex-start;font-size:12px;margin:8px 0}
.wai-prompt-row{display:flex;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid var(--wai-border)}
.wai-prompt-row:last-child{border-bottom:0}
.wai-prompt-name{flex:1;font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wai-prompt-tag{font-size:10px;color:var(--wai-muted)}
.wai-footer{padding:9px 12px;border-top:1px solid var(--wai-border);font-size:10px;color:var(--wai-muted);background:#fff;display:flex;justify-content:space-between;gap:8px}
#wai-launcher{position:fixed;right:13px;top:50%;transform:translateY(-50%);z-index:9997;width:42px;height:42px;border:0;border-radius:50%;background:var(--wai-brand-dark);color:#fff;font-weight:800;cursor:pointer;box-shadow:var(--wai-shadow)}
.wai-modal-backdrop{position:absolute;inset:0;z-index:10;background:rgba(14,25,20,.35);display:flex;align-items:center;justify-content:center;padding:16px}
.wai-modal{width:100%;max-height:92%;overflow:auto;background:#fff;border-radius:12px;border:1px solid var(--wai-border);box-shadow:var(--wai-shadow);padding:14px}
.wai-modal h3{margin:0 0 12px;font-size:16px}
.wai-field{margin-bottom:11px}
.wai-field label{display:block;font-size:11px;font-weight:700;margin-bottom:5px}
.wai-help{font-size:10px;color:var(--wai-muted);line-height:1.4;margin-top:4px}
.wai-divider{height:1px;background:var(--wai-border);margin:12px 0}
.wai-empty{padding:8px 0;color:var(--wai-muted);font-size:12px}
.wai-shortcuts{font-size:10px;color:var(--wai-muted);margin-top:8px}
[data-wai-translation]{white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid #83958e66;margin:6px 0;padding:8px 10px;font-size:13px;line-height:1.45;color:inherit;background:#0a9d7820;border-radius:6px;max-width:100%}
@media(max-width:1000px){
  #wai-sidebar{width:360px}
  body.wai-sidebar-active:not(.wai-media-viewer-open) #app{width:calc(100% - 360px)!important}
}
@media(max-width:720px){
  #wai-sidebar{width:min(360px,92vw)}
  body.wai-sidebar-active:not(.wai-media-viewer-open) #app{width:100%!important}
}
`;

export function injectStyles() {
  if (document.getElementById('wai-styles')) return;
  const style = document.createElement('style');
  style.id = 'wai-styles';
  style.textContent = CSS;
  document.head.append(style);
}
