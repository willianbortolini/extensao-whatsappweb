import { CONFIG, PROMPT_SCOPE } from './config.js';
import { LANGUAGES, translationSettings, finalSuggestionTextForChat } from './ai/translation.js';

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = String(options.text);
  if (options.type) node.type = options.type;
  if (options.title) node.title = options.title;
  if (options.value != null) node.value = String(options.value);
  if (options.placeholder) node.placeholder = options.placeholder;
  if (options.checked != null) node.checked = Boolean(options.checked);
  if (options.disabled) node.disabled = true;
  if (options.min != null) node.min = String(options.min);
  if (options.max != null) node.max = String(options.max);
  if (options.step != null) node.step = String(options.step);
  if (options.onClick) node.addEventListener('click', options.onClick);
  children.filter(Boolean).forEach(child => node.append(child));
  return node;
}

function button(text, onClick, kind = '') {
  return el('button', { className: `wai-btn${kind ? ` ${kind}` : ''}`, type: 'button', text, onClick });
}

function section(title, body, action = null) {
  const root = el('section', { className: 'wai-section' });
  const head = el('div', { className: 'wai-section-head' }, [
    el('div', { className: 'wai-section-title', text: title })
  ]);
  if (action) head.append(action);
  root.append(head, el('div', { className: 'wai-section-body' }, [body]));
  return root;
}

export function appendPresent(parent, ...children) {
  children.filter(Boolean).forEach(child => parent.append(child));
  return parent;
}

export function summaryCompactStatus(summary) {
  if (!summary?.summary?.trim()) return 'Não criado';
  const pending = Math.max(0, Number(summary.messagesSinceSummary) || 0);
  return pending > 0 ? `+${pending} nova${pending === 1 ? '' : 's'}` : '✓ Atualizado';
}

export function promptsCompactStatus(prompts = []) {
  const enabled = prompts.filter(prompt => prompt.enabled);
  const automatic = enabled.filter(prompt => prompt.autoRun).length;
  const local = enabled.filter(prompt => prompt.scope === PROMPT_SCOPE.CHAT).length;
  if (local > 0) return `${automatic} auto • ${local} aqui`;
  return `${automatic} auto`;
}

export function translationCompactState(settings, expanded = false) {
  const translation = translationSettings(settings);
  return {
    enabled: translation.enabled,
    showDetails: Boolean(translation.enabled && expanded),
    summary: translation.enabled
      ? `${LANGUAGES[translation.myLanguage] || translation.myLanguage} → ${LANGUAGES[translation.contactLanguage] || translation.contactLanguage}`
      : 'Desativada'
  };
}

function collapsibleSection({ title, summary = '', expanded = false, onToggle, body = null, action = null, disabled = false }) {
  const root = el('section', { className: `wai-section wai-collapsible${expanded ? ' expanded' : ''}` });
  const head = el('div', { className: 'wai-section-head wai-section-head-compact' });
  const toggle = el('button', {
    className: 'wai-section-toggle',
    type: 'button',
    disabled,
    onClick: () => {
      if (!disabled) onToggle?.();
    }
  }, [
    el('div', { className: 'wai-section-title', text: title }),
    el('div', { className: 'wai-section-compact-summary', text: summary }),
    el('span', { className: 'wai-chevron', text: disabled ? '' : (expanded ? '▴' : '▾') })
  ]);
  head.append(toggle);
  if (action) head.append(action);
  root.append(head);
  if (expanded && body) root.append(el('div', { className: 'wai-section-body' }, [body]));
  return root;
}

function field(label, input, help = '') {
  const wrap = el('div', { className: 'wai-field' }, [
    el('label', { text: label }),
    input
  ]);
  if (help) wrap.append(el('div', { className: 'wai-help', text: help }));
  return wrap;
}

export class SidebarUI {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.root = null;
    this.launcher = null;
    this.chat = null;
    this.prompts = [];
    this.suggestions = [];
    this.selectedIndex = -1;
    this.suggestedMessage = null;
    this.suggestedMessagePromptId = '';
    this.suggestedMessageStatus = '';
    this.suggestedMessageSending = false;
    this.settings = null;
    this.summary = null;
    this.chatSettings = null;
    this.keyStatus = null;
    this.expandedSections = {
      translation: false,
      summary: false,
      summarySettings: false,
      prompts: false
    };
  }

  mount() {
    if (document.getElementById(CONFIG.sidebarId)) return;
    this.root = el('aside');
    this.root.id = CONFIG.sidebarId;

    this.launcher = el('button', {
      type: 'button',
      text: 'AI',
      title: 'Abrir Assistente IA',
      onClick: () => this.handlers.onOpen?.()
    });
    this.launcher.id = CONFIG.launcherId;
    this.launcher.style.display = 'none';

    document.body.append(this.root, this.launcher);
    this.render();
  }

  setOpen(open) {
    document.body.classList.toggle(CONFIG.bodyActiveClass, Boolean(open));
    if (this.root) this.root.style.display = open ? 'flex' : 'none';
    if (this.launcher) this.launcher.style.display = open ? 'none' : 'block';
  }

  setState(patch = {}) {
    Object.assign(this, patch);
    this.render();
  }

  toggleSection(name, force = null) {
    if (!(name in this.expandedSections)) return false;
    this.expandedSections[name] = force == null ? !this.expandedSections[name] : Boolean(force);
    if (name === 'summary' && !this.expandedSections.summary) {
      this.expandedSections.summarySettings = false;
    }
    this.render();
    return this.expandedSections[name];
  }

  render() {
    if (!this.root) return;
    this.root.replaceChildren();

    const header = el('div', { className: 'wai-header' }, [
      el('div', { className: 'wai-brand' }, [
        el('span', { className: 'wai-logo' }),
        el('span', { text: 'Assistente IA' })
      ]),
      el('div', { className: 'wai-header-actions' }, [
        el('button', { className: 'wai-icon', type: 'button', text: '⚙', title: 'Configurações', onClick: () => this.handlers.onOpenOptions?.() }),
        el('button', { className: 'wai-icon', type: 'button', text: '×', title: 'Fechar', onClick: () => this.handlers.onClose?.() })
      ])
    ]);
    this.root.append(header);

    this.root.append(this.renderContact());

    const content = el('div', { className: 'wai-content' });
    content.append(
      this.renderSuggestionsSection(),
      this.renderSuggestedMessageSection(),
      this.renderTranslationSection(),
      this.renderSummarySection(),
      this.renderPromptsSection()
    );
    this.root.append(content);

    const automaticCount = this.prompts.filter(p => p.enabled && p.autoRun).length;
    this.root.append(el('div', { className: 'wai-footer' }, [
      el('span', { text: this.chatSettings?.aiEnabled !== true ? 'IA desativada nesta conversa' : this.settings?.aiPaused ? 'IA pausada' : `${automaticCount} prompt(s) automático(s)` }),
      el('span', { text: this.keyStatus?.configured ? 'OpenAI ✓' : 'API não configurada' })
    ]));
  }

  renderContact() {
    const chat = this.chat;
    if (!chat) {
      return el('div', { className: 'wai-contact' }, [
        el('div', { className: 'wai-contact-name', text: 'Nenhuma conversa selecionada' }),
        el('div', { className: 'wai-contact-meta', text: 'Abra uma conversa no WhatsApp.' })
      ]);
    }

    const aiCheck = el('input', {
      type: 'checkbox',
      checked: this.chatSettings?.aiEnabled === true,
      disabled: this.chatSettingsLoading
    });
    aiCheck.addEventListener('change', () => this.handlers.onSummarySettings?.({ aiEnabled: aiCheck.checked }));

    return el('div', { className: 'wai-contact wai-contact-compact' }, [
      el('div', { className: 'wai-contact-name', text: chat.displayName || 'Contato' }),
      el('label', {
        className: 'wai-check wai-ai-toggle',
        title: chat.isGroup ? 'Usar IA neste grupo' : 'Usar IA neste contato'
      }, [
        aiCheck,
        el('span', { text: 'IA' })
      ])
    ]);
  }

  renderSuggestionsSection() {
    const body = el('div');
    if (this.sendStatus) body.append(el('div', { className: 'wai-help', text: this.sendStatus }));

    if (this.chatSettings?.aiEnabled !== true) {
      body.append(el('div', { className: 'wai-empty', text: 'IA desativada nesta conversa. Nenhuma nova solicitação de sugestões ou resumos será enviada.' }));
    } else if (this.settings?.aiPaused) {
      body.append(el('div', { className: 'wai-empty', text: 'A IA está pausada.' }));
    } else if (!this.keyStatus?.configured) {
      body.append(
        el('div', { className: 'wai-muted', text: 'Configure sua API key da OpenAI para gerar sugestões.' }),
        el('div', { className: 'wai-actions', style: '' }, [
          button('Configurar API', () => this.handlers.onOpenOptions?.(), 'secondary')
        ])
      );
    } else if (!this.chat) {
      body.append(el('div', { className: 'wai-empty', text: 'Selecione uma conversa para usar a IA.' }));
    } else if (!this.suggestions.length) {
      body.append(
        el('div', { className: 'wai-empty', text: 'Digite uma mensagem para receber sugestões.' }),
        el('div', { className: 'wai-shortcuts', text: 'Ctrl+Espaço gera agora' })
      );
    } else {
      this.suggestions.forEach((item, index) => {
        const card = el('div', { className: `wai-suggestion${index === this.selectedIndex ? ' selected' : ''}` });
        const status = ['loading', 'queued', 'translating'].includes(item.status)
          ? el('span', {
              className: 'wai-status',
              text: item.status === 'queued'
                ? 'fila'
                : item.status === 'translating'
                  ? 'traduzindo'
                  : 'gerando'
            })
          : item.cached && (!item.translationApplied || item.translationCached)
            ? el('span', { className: 'wai-status', text: 'cache' })
            : null;
        card.append(el('div', { className: 'wai-suggestion-head' }, [
          el('div', { className: 'wai-suggestion-name', text: `${index + 1}  ${item.promptName}` }),
          status
        ]));

        if (item.status === 'loading' || item.status === 'queued' || item.status === 'translating') {
          card.append(el('div', { className: 'wai-loading' }, [
            el('span', { className: 'wai-spinner' }),
            el('span', {
              text: item.status === 'translating'
                ? `Traduzindo para ${LANGUAGES[item.targetLanguage] || 'o idioma do contato'}…`
                : 'Aplicando prompt…'
            })
          ]));
        } else if (item.status === 'error') {
          card.append(
            el('div', { className: 'wai-error', text: item.error || 'Não foi possível gerar.' }),
            el('div', { className: 'wai-suggestion-actions' }, [
              button('Tentar novamente', () => this.handlers.onRetrySuggestion?.(item), 'secondary small')
            ])
          );
        } else {
          const finalText = finalSuggestionTextForChat(item, this.chatSettings, this.chat);
          card.append(
            item.translationApplied
              ? el('div', {
                  className: 'wai-help',
                  text: `Mensagem final • ${LANGUAGES[item.targetLanguage] || 'idioma do contato'}`
                })
              : null,
            el('div', { className: 'wai-suggestion-text', text: finalText || item.finalText || '' }),
            el('div', { className: 'wai-suggestion-actions' }, [
              el('button', { className: 'wai-btn secondary small', type: 'button', text: 'Usar', disabled: this.applyingTranslation || this.sendingSuggestion || !finalText, onClick: () => this.handlers.onUseSuggestion?.(item) }),
              el('button', { className: 'wai-btn small', type: 'button', text: this.sendingSuggestion ? 'Enviando…' : 'Aplicar e enviar', title: 'Substitui o rascunho pela mensagem final e envia ao contato', disabled: this.applyingTranslation || this.sendingSuggestion || item.sendRequested || !finalText, onClick: () => this.handlers.onSendSuggestion?.(item) })
            ])
          );
        }
        body.append(card);
      });
      body.append(el('div', { className: 'wai-shortcuts', text: 'Tab alterna • Ctrl+Enter aplica e envia' }));
    }

    const root = section('Sugestões', body, el('button', {
      className: 'wai-icon',
      type: 'button',
      text: this.settings?.aiPaused ? '▶' : 'Ⅱ',
      title: this.settings?.aiPaused ? 'Retomar IA' : 'Pausar IA',
      onClick: () => this.handlers.onPauseToggle?.()
    }));
    root.classList.add('wai-primary-section');
    return root;
  }

  renderSuggestedMessageSection() {
    const body = el('div');
    const primarySection = () => {
      const root = section('Sugerir mensagem', body);
      root.classList.add('wai-primary-section');
      return root;
    };

    if (this.suggestedMessageStatus) {
      body.append(el('div', { className: 'wai-help', text: this.suggestedMessageStatus }));
    }

    if (!this.chat) {
      body.append(el('div', { className: 'wai-empty', text: 'Selecione uma conversa para sugerir uma mensagem.' }));
      return primarySection();
    }

    if (this.chatSettings?.aiEnabled !== true) {
      body.append(el('div', { className: 'wai-empty', text: 'Ative “Usar IA” nesta conversa para sugerir uma mensagem.' }));
      return primarySection();
    }

    if (this.settings?.aiPaused) {
      body.append(el('div', { className: 'wai-empty', text: 'A IA está pausada.' }));
      return primarySection();
    }

    if (!this.keyStatus?.configured) {
      body.append(
        el('div', { className: 'wai-muted', text: 'Configure sua API key da OpenAI para sugerir mensagens.' }),
        el('div', { className: 'wai-actions' }, [
          button('Configurar API', () => this.handlers.onOpenOptions?.(), 'secondary small')
        ])
      );
      return primarySection();
    }

    const summaryText = this.summary?.summary || '';
    if (!summaryText.trim()) {
      body.append(
        el('div', { className: 'wai-empty', text: 'Esta conversa ainda não possui resumo. Gere um resumo para habilitar esta função.' }),
        el('div', { className: 'wai-actions' }, [
          button('Gerar resumo', () => this.handlers.onGenerateSummary?.(false), 'small')
        ])
      );
      return primarySection();
    }

    const enabledPrompts = this.prompts.filter(prompt => prompt.enabled);
    if (!enabledPrompts.length) {
      body.append(el('div', { className: 'wai-empty', text: 'Nenhum prompt habilitado está disponível.' }));
      return primarySection();
    }

    const promptSelect = el('select', {
      className: 'wai-select',
      disabled: this.chatSettingsLoading || Boolean(this.suggestedMessage && ['generating', 'translating'].includes(this.suggestedMessage.status))
    });
    for (const prompt of enabledPrompts) {
      const scopeLabel = prompt.scope === PROMPT_SCOPE.CHAT ? '👤' : '🌐';
      const option = el('option', { value: prompt.id, text: `${scopeLabel} ${prompt.name}` });
      if (prompt.id === this.suggestedMessagePromptId) option.selected = true;
      promptSelect.append(option);
    }
    promptSelect.addEventListener('change', () => this.handlers.onSuggestedMessagePromptChange?.(promptSelect.value));
    body.append(field('Prompt', promptSelect));

    const pending = Number(this.summary?.messagesSinceSummary) || 0;
    if (pending > 0) {
      body.append(el('div', {
        className: 'wai-summary-warning',
        text: `⚠ ${pending} mensagem(ns) nova(s) ainda não incorporada(s) ao resumo.`
      }));
    }

    const item = this.suggestedMessage;
    if (!item) {
      body.append(el('div', { className: 'wai-actions wai-suggested-message-actions' }, [
        button('Sugerir mensagem', () => this.handlers.onGenerateSuggestedMessage?.(false), 'small'),
        pending > 0 ? button('Atualizar resumo', () => this.handlers.onGenerateSummary?.(false), 'secondary small') : null
      ]));
      return primarySection();
    }

    if (item.status === 'generating' || item.status === 'translating') {
      body.append(el('div', { className: 'wai-loading wai-suggested-message-card' }, [
        el('span', { className: 'wai-spinner' }),
        el('span', {
          text: item.status === 'translating'
            ? `Traduzindo para ${LANGUAGES[item.targetLanguage] || 'o idioma do contato'}…`
            : 'Gerando mensagem com base no resumo…'
        })
      ]));
      return primarySection();
    }

    if (item.status === 'error') {
      body.append(
        el('div', { className: 'wai-error', text: item.error || 'Não foi possível gerar a mensagem.' }),
        el('div', { className: 'wai-actions' }, [
          button('Tentar novamente', () => this.handlers.onRetrySuggestedMessage?.(), 'secondary small')
        ])
      );
      return primarySection();
    }

    const finalText = finalSuggestionTextForChat(item, this.chatSettings, this.chat);
    body.append(el('div', { className: 'wai-suggested-message-card' }, [
      el('div', { className: 'wai-suggestion-head' }, [
        el('div', { className: 'wai-suggestion-name', text: item.promptName || 'Mensagem sugerida' }),
        item.cached && (!item.translationApplied || item.translationCached)
          ? el('span', { className: 'wai-status', text: 'cache' })
          : null
      ]),
      item.translationApplied
        ? el('div', {
            className: 'wai-help',
            text: `Mensagem final • ${LANGUAGES[item.targetLanguage] || 'idioma do contato'}`
          })
        : null,
      el('div', { className: 'wai-suggestion-text', text: finalText || item.finalText || '' })
    ]));

    body.append(el('div', { className: 'wai-actions wai-suggested-message-actions' }, [
      button('Usar', () => this.handlers.onUseSuggestedMessage?.(), 'secondary small'),
      el('button', {
        className: 'wai-btn small',
        type: 'button',
        text: this.suggestedMessageSending ? 'Enviando…' : 'Aplicar e enviar',
        disabled: this.suggestedMessageSending || !finalText || item.sendRequested,
        onClick: () => this.handlers.onSendSuggestedMessage?.()
      }),
      button('Gerar outra', () => this.handlers.onGenerateSuggestedMessage?.(true), 'secondary small')
    ]));

    return primarySection();
  }

  renderSummarySection() {
    const expanded = Boolean(this.expandedSections.summary);
    const summaryText = this.summary?.summary || '';
    const status = this.chat ? summaryCompactStatus(this.summary) : 'Sem conversa';

    if (!expanded) {
      return collapsibleSection({
        title: '📝 Resumo',
        summary: status,
        expanded: false,
        disabled: !this.chat,
        onToggle: () => this.toggleSection('summary')
      });
    }

    const body = el('div');
    body.append(el('div', {
      className: summaryText ? 'wai-summary' : 'wai-empty',
      text: summaryText || 'Ainda não existe resumo desta conversa.'
    }));

    if (this.summary?.updatedAt) {
      const pending = Math.max(0, Number(this.summary.messagesSinceSummary) || 0);
      body.append(el('div', {
        className: 'wai-help',
        text: `Versão ${this.summary.summaryVersion || 0}${pending > 0 ? ` • ${pending} nova(s)` : ''}`
      }));
    }

    const actions = el('div', { className: 'wai-actions wai-summary-actions' });
    appendPresent(
      actions,
      button(summaryText ? 'Atualizar' : 'Gerar resumo', () => this.handlers.onGenerateSummary?.(false), 'small'),
      summaryText ? button('Editar', () => this.showSummaryEditor(), 'secondary small') : null,
      summaryText ? button('Refazer', () => this.handlers.onGenerateSummary?.(true), 'secondary small') : null
    );
    body.append(actions);

    if (this.chatSettingsLoading || this.chatSettings?.aiEnabled !== true) {
      for (const action of actions.querySelectorAll('button')) {
        if (action.textContent !== 'Editar') action.disabled = true;
      }
    }

    const enabled = this.chatSettings?.summaryEnabled ?? this.settings?.defaultSummaryEnabled ?? true;
    const mode = this.chatSettings?.summaryMode || this.settings?.defaultSummaryMode || 'manual';
    const every = this.chatSettings?.summaryEvery || this.settings?.defaultSummaryEvery || 2;
    const modeLabel = { manual: 'Manual', automatic: 'Automático', disabled: 'Desativado' }[mode] || 'Manual';

    const settingsToggle = el('button', {
      className: 'wai-subsection-toggle',
      type: 'button',
      text: `Configurações do resumo • ${modeLabel} ${this.expandedSections.summarySettings ? '▴' : '▾'}`,
      onClick: () => this.toggleSection('summarySettings')
    });
    body.append(settingsToggle);

    if (this.expandedSections.summarySettings) {
      const settingsBody = el('div', { className: 'wai-subsection-body' });
      const enabledCheck = el('input', { type: 'checkbox', checked: enabled });
      enabledCheck.addEventListener('change', () => this.handlers.onSummarySettings?.({ summaryEnabled: enabledCheck.checked }));

      const modeSelect = el('select', { className: 'wai-select' });
      for (const [value, label] of [['manual', 'Manual'], ['automatic', 'Automático'], ['disabled', 'Desativado']]) {
        const option = el('option', { value, text: label });
        if (mode === value) option.selected = true;
        modeSelect.append(option);
      }
      modeSelect.addEventListener('change', () => this.handlers.onSummarySettings?.({ summaryMode: modeSelect.value }));

      const everyInput = el('input', {
        className: 'wai-input',
        type: 'number',
        value: every,
        min: 2,
        max: 50,
        step: 1
      });
      everyInput.addEventListener('change', () => this.handlers.onSummarySettings?.({
        summaryEvery: Math.max(2, Math.min(50, Number(everyInput.value) || 2))
      }));

      appendPresent(
        settingsBody,
        el('label', { className: 'wai-check' }, [
          enabledCheck,
          el('span', { text: 'Resumo habilitado para esta conversa' })
        ]),
        field('Modo', modeSelect)
      );

      if (mode === 'automatic') {
        settingsBody.append(field(
          'Atualizar a cada N mensagens',
          everyInput,
          'Contam mensagens recebidas e enviadas observadas pela extensão.'
        ));
      }

      settingsBody.append(
        el('div', { className: 'wai-divider' }),
        button('Limpar histórico local desta conversa', () => this.handlers.onClearChatHistory?.(), 'secondary small')
      );
      body.append(settingsBody);
    }

    return collapsibleSection({
      title: '📝 Resumo',
      summary: status,
      expanded: true,
      onToggle: () => this.toggleSection('summary'),
      body
    });
  }

  renderTranslationSection() {
    const state = translationCompactState(this.chatSettings, this.expandedSections.translation);
    const enabledCheck = el('input', {
      type: 'checkbox',
      checked: state.enabled,
      disabled: this.chatSettingsLoading || !this.chat
    });
    enabledCheck.addEventListener('change', () => {
      this.expandedSections.translation = Boolean(enabledCheck.checked);
      this.handlers.onSummarySettings?.({ translationEnabled: enabledCheck.checked });
    });

    const action = el('label', {
      className: 'wai-compact-check',
      title: state.enabled ? 'Tradução ativada' : 'Ativar tradução'
    }, [
      enabledCheck
    ]);

    if (!this.chat || !state.enabled) {
      return collapsibleSection({
        title: '🌐 Tradução',
        summary: this.chat ? state.summary : 'Sem conversa',
        expanded: false,
        disabled: true,
        action
      });
    }

    if (!state.showDetails) {
      return collapsibleSection({
        title: '🌐 Tradução',
        summary: state.summary,
        expanded: false,
        onToggle: () => this.toggleSection('translation'),
        action
      });
    }

    const body = el('div');
    const translation = translationSettings(this.chatSettings);
    for (const [key, label] of [['myLanguage', 'Meu idioma'], ['contactLanguage', 'Idioma do contato']]) {
      const select = el('select', { className: 'wai-select', disabled: this.chatSettingsLoading });
      for (const [value, text] of Object.entries(LANGUAGES)) {
        const option = el('option', { value, text });
        option.selected = translation[key] === value;
        select.append(option);
      }
      select.addEventListener('change', () => this.handlers.onSummarySettings?.({ [key]: select.value }));
      body.append(field(label, select));
    }

    const blocked = this.chatSettings?.aiEnabled !== true || this.chatSettingsLoading || this.settings?.aiPaused;
    body.append(el('div', { className: 'wai-actions' }, [
      el('button', {
        className: 'wai-btn secondary small',
        type: 'button',
        text: this.applyingTranslation ? 'Traduzindo…' : 'Traduzir rascunho',
        disabled: blocked || this.applyingTranslation,
        onClick: () => this.handlers.onTranslateDraft?.()
      }),
      el('button', {
        className: 'wai-btn secondary small',
        type: 'button',
        text: this.translatingBubbles ? 'Traduzindo…' : 'Traduzir balões',
        disabled: blocked || this.translatingBubbles,
        onClick: () => this.handlers.onRetryTranslations?.()
      })
    ]));

    if (this.chatSettings?.aiEnabled !== true || this.translationStatus) {
      body.append(el('div', {
        className: 'wai-help',
        text: this.chatSettings?.aiEnabled !== true
          ? 'Ative a IA desta conversa para usar tradução.'
          : this.translationStatus
      }));
    }

    return collapsibleSection({
      title: '🌐 Tradução',
      summary: state.summary,
      expanded: true,
      onToggle: () => this.toggleSection('translation'),
      body,
      action
    });
  }


  renderPromptsSection() {
    const expanded = Boolean(this.expandedSections.prompts);
    const globals = this.prompts.filter(prompt => (prompt.scope || PROMPT_SCOPE.GLOBAL) === PROMPT_SCOPE.GLOBAL);
    const chatPrompts = this.prompts.filter(prompt => prompt.scope === PROMPT_SCOPE.CHAT);
    const status = promptsCompactStatus(this.prompts);

    if (!expanded) {
      return collapsibleSection({
        title: '✨ Prompts',
        summary: status,
        expanded: false,
        onToggle: () => this.toggleSection('prompts')
      });
    }

    const body = el('div');
    const renderPromptRow = prompt => {
      const check = el('input', { type: 'checkbox', checked: prompt.enabled });
      check.addEventListener('change', () => this.handlers.onPromptToggle?.(prompt, { enabled: check.checked }));

      const isChatPrompt = prompt.scope === PROMPT_SCOPE.CHAT;
      const scopeText = isChatPrompt ? (this.chat?.isGroup ? 'grupo' : 'esta conversa') : 'global';
      const run = button('▶', () => this.handlers.onRunPrompt?.(prompt), 'secondary small');
      run.disabled = !this.chat || this.chatSettingsLoading || this.chatSettings?.aiEnabled !== true || !prompt.enabled;
      const edit = button('✎', () => this.showPromptEditor(prompt), 'secondary small');

      const children = [
        check,
        el('div', { className: 'wai-prompt-name', text: prompt.name }),
        el('span', { className: `wai-prompt-tag${isChatPrompt ? ' chat' : ''}`, text: scopeText }),
        prompt.autoRun ? el('span', { className: 'wai-prompt-tag', text: 'auto' }) : null,
        run,
        edit
      ];

      if (!isChatPrompt && this.chat) {
        children.push(el('button', {
          className: 'wai-btn secondary small',
          type: 'button',
          text: '⧉',
          title: `Duplicar "${prompt.name}" para ${this.chat.displayName || 'esta conversa'}`,
          onClick: () => this.handlers.onPromptDuplicateToChat?.(prompt)
        }));
      }

      return el('div', { className: 'wai-prompt-row' }, children);
    };

    if (!globals.length && !chatPrompts.length) {
      body.append(el('div', { className: 'wai-empty', text: 'Nenhum prompt disponível nesta conversa.' }));
    }

    if (chatPrompts.length) {
      body.append(el('div', {
        className: 'wai-help wai-prompt-group-title',
        text: this.chat?.isGroup
          ? `Somente este grupo · ${this.chat?.displayName || ''}`
          : `Somente esta conversa · ${this.chat?.displayName || ''}`
      }));
      for (const prompt of chatPrompts) body.append(renderPromptRow(prompt));
    }

    if (globals.length) {
      body.append(el('div', {
        className: 'wai-help wai-prompt-group-title',
        text: 'Globais'
      }));
      for (const prompt of globals) body.append(renderPromptRow(prompt));
    }

    body.append(el('div', { className: 'wai-actions wai-prompt-create-actions' }, [
      this.chat
        ? button(
            this.chat.isGroup ? '+ Para este grupo' : '+ Para este contato',
            () => this.showPromptEditor(null, PROMPT_SCOPE.CHAT),
            'secondary small'
          )
        : null,
      button('+ Global', () => this.showPromptEditor(null, PROMPT_SCOPE.GLOBAL), 'secondary small')
    ]));

    return collapsibleSection({
      title: '✨ Prompts',
      summary: status,
      expanded: true,
      onToggle: () => this.toggleSection('prompts'),
      body
    });
  }

  showPromptEditor(prompt, requestedScope = PROMPT_SCOPE.GLOBAL) {
    const scope = prompt
      ? (prompt.scope === PROMPT_SCOPE.CHAT ? PROMPT_SCOPE.CHAT : PROMPT_SCOPE.GLOBAL)
      : (requestedScope === PROMPT_SCOPE.CHAT ? PROMPT_SCOPE.CHAT : PROMPT_SCOPE.GLOBAL);

    if (scope === PROMPT_SCOPE.CHAT && !this.chat) {
      alert('Abra uma conversa para criar um prompt específico.');
      return;
    }

    const current = prompt || {
      name: '',
      instructions: '',
      scope,
      accountId: scope === PROMPT_SCOPE.CHAT ? this.chat?.accountId : null,
      chatId: scope === PROMPT_SCOPE.CHAT ? this.chat?.whatsappChatId : null,
      chatDisplayName: scope === PROMPT_SCOPE.CHAT ? this.chat?.displayName : null,
      enabled: true,
      autoRun: false,
      order: this.prompts.length + 1,
      includeSummary: false,
      includeRecentMessages: false,
      recentMessagesCount: 6,
      generateSummaryIfMissing: false,
      maxOutputTokens: 150
    };

    const backdrop = el('div', { className: 'wai-modal-backdrop' });
    const modal = el('div', { className: 'wai-modal' });
    const name = el('input', { className: 'wai-input', value: current.name, placeholder: 'Ex.: Follow-up comercial' });
    const instructions = el('textarea', { className: 'wai-textarea', value: current.instructions, placeholder: 'Instruções para a IA…' });
    const enabled = el('input', { type: 'checkbox', checked: current.enabled });
    const autoRun = el('input', { type: 'checkbox', checked: current.autoRun });
    const includeSummary = el('input', { type: 'checkbox', checked: current.includeSummary });
    const includeRecent = el('input', { type: 'checkbox', checked: current.includeRecentMessages });
    const recentCount = el('input', { className: 'wai-input', type: 'number', value: current.recentMessagesCount || 6, min: 1, max: 20 });
    const generateSummary = el('input', { type: 'checkbox', checked: current.generateSummaryIfMissing });
    const order = el('input', { className: 'wai-input', type: 'number', value: current.order || (this.prompts.length + 1), min: 1, max: 999 });
    const maxTokens = el('input', { className: 'wai-input', type: 'number', value: current.maxOutputTokens || 150, min: 32, max: 1200 });

    const close = () => backdrop.remove();
    const scopeDescription = scope === PROMPT_SCOPE.CHAT
      ? `${this.chat?.isGroup ? 'Somente o grupo' : 'Somente o contato'}: ${this.chat?.displayName || current.chatDisplayName || 'conversa atual'}`
      : 'Global: disponível para todos os contatos e grupos.';

    const actions = [
      button('Salvar', async () => {
        const data = {
          ...current,
          id: prompt?.id,
          scope,
          accountId: scope === PROMPT_SCOPE.CHAT ? (current.accountId || this.chat?.accountId) : null,
          chatId: scope === PROMPT_SCOPE.CHAT ? (current.chatId || this.chat?.whatsappChatId) : null,
          chatDisplayName: scope === PROMPT_SCOPE.CHAT ? (current.chatDisplayName || this.chat?.displayName || '') : null,
          name: name.value,
          instructions: instructions.value,
          enabled: enabled.checked,
          autoRun: autoRun.checked,
          includeSummary: includeSummary.checked,
          generateSummaryIfMissing: generateSummary.checked,
          includeRecentMessages: includeRecent.checked,
          recentMessagesCount: Number(recentCount.value) || 0,
          order: Math.max(1, Number(order.value) || 999),
          maxOutputTokens: Number(maxTokens.value) || 150
        };
        const ok = await this.handlers.onPromptSave?.(data);
        if (ok !== false) close();
      }),
      button('Cancelar', close, 'secondary')
    ];

    if (prompt && scope === PROMPT_SCOPE.GLOBAL && this.chat) {
      actions.push(button('Duplicar para esta conversa', async () => {
        const ok = await this.handlers.onPromptDuplicateToChat?.(prompt);
        if (ok !== false) close();
      }, 'secondary'));
    }

    if (prompt) {
      actions.push(button('Excluir', async () => {
        if (!confirm(`Excluir o prompt "${prompt.name}"?`)) return;
        const ok = await this.handlers.onPromptDelete?.(prompt);
        if (ok !== false) close();
      }, 'danger'));
    }

    modal.append(
      el('h3', {
        text: prompt
          ? 'Editar prompt'
          : scope === PROMPT_SCOPE.CHAT
            ? `Novo prompt para ${this.chat?.displayName || 'esta conversa'}`
            : 'Novo prompt global'
      }),
      el('div', { className: 'wai-prompt-scope-note', text: scopeDescription }),
      field('Nome', name),
      field('Instruções', instructions, 'Variáveis disponíveis: {{texto}}, {{resumo}}, {{mensagens}}, {{nome_contato}}'),
      el('label', { className: 'wai-check' }, [enabled, el('span', { text: 'Prompt habilitado' })]),
      el('label', { className: 'wai-check' }, [autoRun, el('span', { text: 'Executar automaticamente após a pausa de digitação' })]),
      el('div', { className: 'wai-divider' }),
      el('label', { className: 'wai-check' }, [includeSummary, el('span', { text: 'Enviar resumo da conversa neste prompt' })]),
      el('label', { className: 'wai-check' }, [generateSummary, el('span', { text: 'Gerar resumo antes se este prompt precisar dele e ainda não existir' })]),
      el('label', { className: 'wai-check' }, [includeRecent, el('span', { text: 'Enviar mensagens recentes' })]),
      field('Quantidade de mensagens recentes', recentCount),
      field('Ordem', order, 'Prompts específicos têm prioridade sobre globais quando existe limite de automáticos; dentro do mesmo escopo vale esta ordem.'),
      field('Limite máximo de saída (tokens)', maxTokens),
      el('div', { className: 'wai-actions' }, actions)
    );

    backdrop.append(modal);
    this.root.append(backdrop);
    setTimeout(() => name.focus(), 0);
  }

  showSummaryEditor() {
    if (!this.summary?.summary) return;
    const backdrop = el('div', { className: 'wai-modal-backdrop' });
    const modal = el('div', { className: 'wai-modal' });
    const textarea = el('textarea', { className: 'wai-textarea', value: this.summary.summary });
    textarea.style.minHeight = '260px';
    const close = () => backdrop.remove();

    modal.append(
      el('h3', { text: 'Editar resumo' }),
      field('Resumo local', textarea, 'A próxima atualização incremental usará sua versão editada como base.'),
      el('div', { className: 'wai-actions' }, [
        button('Salvar', async () => {
          const ok = await this.handlers.onEditSummary?.(textarea.value);
          if (ok !== false) close();
        }),
        button('Cancelar', close, 'secondary')
      ])
    );
    backdrop.append(modal);
    this.root.append(backdrop);
  }

  clearSuggestions() {
    this.suggestions = [];
    this.selectedIndex = -1;
    this.render();
  }

  setSuggestions(items) {
    this.suggestions = items;
    if (this.selectedIndex >= items.length) this.selectedIndex = -1;
    this.render();
  }

  moveSelection(delta) {
    const usable = this.suggestions
      .map((s, index) => ({ s, index }))
      .filter(x => x.s.status === 'success' && x.s.finalText);

    if (!usable.length) {
      this.selectedIndex = -1;
      this.render();
      return null;
    }

    const currentPos = usable.findIndex(x => x.index === this.selectedIndex);
    const nextPos = currentPos < 0
      ? (delta < 0 ? usable.length - 1 : 0)
      : (currentPos + delta + usable.length) % usable.length;
    this.selectedIndex = usable[nextPos].index;
    this.render();
    this.root.querySelectorAll('.wai-suggestion')[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
    return this.suggestions[this.selectedIndex];
  }

  getSelectedSuggestion() {
    if (this.selectedIndex < 0) return null;
    const item = this.suggestions[this.selectedIndex];
    return item?.status === 'success' && item.finalText ? item : null;
  }

  clearSelection() {
    if (this.selectedIndex < 0) return false;
    this.selectedIndex = -1;
    this.render();
    return true;
  }
}
