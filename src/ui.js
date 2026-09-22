import { CONFIG } from './config.js';
import { LANGUAGES, translationSettings } from './ai/translation.js';

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
    this.settings = null;
    this.summary = null;
    this.chatSettings = null;
    this.keyStatus = null;
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
      this.renderTranslationSection(),
      this.renderSuggestionsSection(),
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

    const aiCheck = el('input', { type: 'checkbox', checked: this.chatSettings?.aiEnabled === true, disabled: this.chatSettingsLoading });
    aiCheck.addEventListener('change', () => this.handlers.onSummarySettings?.({ aiEnabled: aiCheck.checked }));
    return el('div', { className: 'wai-contact' }, [
      el('div', { className: 'wai-contact-name', text: chat.displayName || 'Contato' }),
      el('div', {
        className: 'wai-contact-meta',
        text: chat.isGroup
          ? 'Grupo • histórico local separado'
          : `${chat.phone ? `+${chat.phone} • ` : ''}${chat.identityConfidence === 'fallback' ? 'identificação local' : 'conversa identificada'}`
      }),
      el('label', { className: 'wai-check' }, [aiCheck, el('span', { text: chat.isGroup ? 'Usar IA neste grupo' : 'Usar IA neste contato' })])
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
        el('div', { className: 'wai-empty', text: 'Digite uma mensagem. Após a pausa configurada, os prompts automáticos aparecerão aqui.' }),
        el('div', { className: 'wai-shortcuts', text: 'Tab: trocar sugestão • Ctrl+Enter: aplicar e enviar' })
      );
    } else {
      this.suggestions.forEach((item, index) => {
        const card = el('div', { className: `wai-suggestion${index === this.selectedIndex ? ' selected' : ''}` });
        const status = item.status === 'loading' || item.status === 'queued'
          ? el('span', { className: 'wai-status', text: item.status === 'queued' ? 'fila' : 'gerando' })
          : item.cached
            ? el('span', { className: 'wai-status', text: 'cache' })
            : null;
        card.append(el('div', { className: 'wai-suggestion-head' }, [
          el('div', { className: 'wai-suggestion-name', text: `${index + 1}  ${item.promptName}` }),
          status
        ]));

        if (item.status === 'loading' || item.status === 'queued') {
          card.append(el('div', { className: 'wai-loading' }, [
            el('span', { className: 'wai-spinner' }),
            el('span', { text: 'Gerando sugestão…' })
          ]));
        } else if (item.status === 'error') {
          card.append(
            el('div', { className: 'wai-error', text: item.error || 'Não foi possível gerar.' }),
            el('div', { className: 'wai-suggestion-actions' }, [
              button('Tentar novamente', () => this.handlers.onRetrySuggestion?.(item), 'secondary small')
            ])
          );
        } else {
          card.append(
            el('div', { className: 'wai-suggestion-text', text: item.text || '' }),
            el('div', { className: 'wai-suggestion-actions' }, [
              el('button', { className: 'wai-btn secondary small', type: 'button', text: this.applyingTranslation ? 'Traduzindo…' : translationSettings(this.chatSettings).enabled ? 'Traduzir e aplicar' : 'Usar', disabled: this.applyingTranslation || this.sendingSuggestion, onClick: () => this.handlers.onUseSuggestion?.(item) }),
              el('button', { className: 'wai-btn small', type: 'button', text: this.sendingSuggestion ? 'Enviando…' : 'Aplicar e enviar', title: 'Substitui o rascunho pela sugestão e envia a mensagem ao contato', disabled: this.applyingTranslation || this.sendingSuggestion || item.sendRequested, onClick: () => this.handlers.onSendSuggestion?.(item) })
            ])
          );
        }
        body.append(card);
      });
      body.append(el('div', { className: 'wai-shortcuts', text: 'Tab: trocar sugestão • Ctrl+Enter: aplicar e enviar a selecionada (ou a primeira pronta). Enter e Shift+Enter continuam sendo do WhatsApp.' }));
    }

    return section('Sugestões', body, el('button', {
      className: 'wai-icon',
      type: 'button',
      text: this.settings?.aiPaused ? '▶' : 'Ⅱ',
      title: this.settings?.aiPaused ? 'Retomar IA' : 'Pausar IA',
      onClick: () => this.handlers.onPauseToggle?.()
    }));
  }

  renderSummarySection() {
    const body = el('div');
    if (!this.chat) {
      body.append(el('div', { className: 'wai-empty', text: 'Selecione uma conversa.' }));
      return section('Resumo', body);
    }

    const summaryText = this.summary?.summary || '';
    body.append(el('div', {
      className: summaryText ? 'wai-summary' : 'wai-empty',
      text: summaryText || 'Ainda não existe resumo desta conversa.'
    }));

    if (this.summary?.updatedAt) {
      const pending = this.summary.messagesSinceSummary || 0;
      body.append(el('div', {
        className: 'wai-help',
        text: `Versão ${this.summary.summaryVersion || 0} • ${pending} mensagem(ns) nova(s) desde o resumo`
      }));
    }

    const actions = el('div', { className: 'wai-actions' }, [
      button(summaryText ? 'Atualizar' : 'Gerar resumo', () => this.handlers.onGenerateSummary?.(false), 'small'),
      summaryText ? button('Editar', () => this.showSummaryEditor(), 'secondary small') : null,
      summaryText ? button('Refazer', () => this.handlers.onGenerateSummary?.(true), 'secondary small') : null
    ]);
    body.append(actions);
    if (this.chatSettingsLoading || this.chatSettings?.aiEnabled !== true) {
      for (const action of actions.querySelectorAll('button')) {
        if (action.textContent !== 'Editar') action.disabled = true;
      }
    }

    const enabled = this.chatSettings?.summaryEnabled ?? this.settings?.defaultSummaryEnabled ?? true;
    const mode = this.chatSettings?.summaryMode || this.settings?.defaultSummaryMode || 'manual';
    const every = this.chatSettings?.summaryEvery || this.settings?.defaultSummaryEvery || 2;

    const enabledCheck = el('input', { type: 'checkbox', checked: enabled });
    enabledCheck.addEventListener('change', () => this.handlers.onSummarySettings?.({ summaryEnabled: enabledCheck.checked }));

    const modeSelect = el('select', { className: 'wai-select' });
    for (const [value, label] of [['manual', 'Manual'], ['automatic', 'Automático'], ['disabled', 'Desativado']]) {
      const option = el('option', { value, text: label });
      if (mode === value) option.selected = true;
      modeSelect.append(option);
    }
    modeSelect.addEventListener('change', () => this.handlers.onSummarySettings?.({ summaryMode: modeSelect.value }));

    const everyInput = el('input', { className: 'wai-input', type: 'number', value: every, min: 2, max: 50, step: 1 });
    everyInput.addEventListener('change', () => this.handlers.onSummarySettings?.({ summaryEvery: Math.max(2, Math.min(50, Number(everyInput.value) || 2)) }));

    body.append(
      el('label', { className: 'wai-check' }, [enabledCheck, el('span', { text: 'Resumo habilitado para esta conversa' })]),
      field('Modo', modeSelect),
      mode === 'automatic' ? field('Atualizar a cada N mensagens', everyInput, 'Contam mensagens recebidas e enviadas observadas pela extensão.') : null,
      el('div', { className: 'wai-divider' }),
      button('Limpar histórico local desta conversa', () => this.handlers.onClearChatHistory?.(), 'secondary small')
    );

    return section('Resumo', body);
  }

  renderTranslationSection() {
    const body = el('div');
    if (!this.chat) {
      body.append(el('div', { className: 'wai-empty', text: 'Selecione uma conversa para configurar os idiomas.' }));
      return section('Tradução', body);
    }
    const translation = translationSettings(this.chatSettings);
    const enabled = el('input', { type: 'checkbox', checked: translation.enabled, disabled: this.chatSettingsLoading });
    enabled.addEventListener('change', () => this.handlers.onSummarySettings?.({ translationEnabled: enabled.checked }));
    body.append(el('label', { className: 'wai-check' }, [enabled, el('span', { text: 'Modo tradução nesta conversa' })]));
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
    if (translation.enabled) {
      body.append(el('div', { className: 'wai-help', text: 'As traduções aparecem junto aos balões originais. Revise sugestões no seu idioma; ao aplicar, o texto será traduzido para o contato, sem enviar.' }));
      const blocked = this.chatSettings?.aiEnabled !== true || this.chatSettingsLoading || this.settings?.aiPaused;
      body.append(el('button', { className: 'wai-btn secondary small', type: 'button', text: this.applyingTranslation ? 'Traduzindo…' : 'Traduzir rascunho e aplicar', disabled: blocked || this.applyingTranslation, onClick: () => this.handlers.onTranslateDraft?.() }));
      body.append(el('button', { className: 'wai-btn secondary small', type: 'button', text: this.translatingBubbles ? 'Traduzindo balões…' : 'Traduzir balões do contato', disabled: blocked || this.translatingBubbles, onClick: () => this.handlers.onRetryTranslations?.() }));
      body.append(el('div', { className: 'wai-help', text: this.chatSettings?.aiEnabled !== true ? 'Marque “Usar IA” para permitir traduções.' : this.translationStatus || 'Traduções automáticas usam sua API e respeitam os limites de consumo.' }));
    }
    return section('Tradução', body);
  }

  renderPromptsSection() {
    const body = el('div');
    if (!this.prompts.length) {
      body.append(el('div', { className: 'wai-empty', text: 'Nenhum prompt cadastrado.' }));
    } else {
      for (const prompt of this.prompts) {
        const check = el('input', { type: 'checkbox', checked: prompt.enabled });
        check.addEventListener('change', () => this.handlers.onPromptToggle?.(prompt, { enabled: check.checked }));
        const row = el('div', { className: 'wai-prompt-row' }, [
          check,
          el('div', { className: 'wai-prompt-name', text: prompt.name }),
          prompt.autoRun ? el('span', { className: 'wai-prompt-tag', text: 'auto' }) : null,
          button('▶', () => this.handlers.onRunPrompt?.(prompt), 'secondary small'),
          button('✎', () => this.showPromptEditor(prompt), 'secondary small')
        ]);
        body.append(row);
        row.querySelector('button').disabled = !this.chat || this.chatSettingsLoading || this.chatSettings?.aiEnabled !== true;
      }
    }

    body.append(el('div', { className: 'wai-actions' }, [
      button('+ Novo prompt', () => this.showPromptEditor(null), 'secondary small')
    ]));

    return section('Prompts', body);
  }

  showPromptEditor(prompt) {
    const current = prompt || {
      name: '',
      instructions: '',
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
    const name = el('input', { className: 'wai-input', value: current.name, placeholder: 'Ex.: Inglês' });
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
    modal.append(
      el('h3', { text: prompt ? 'Editar prompt' : 'Novo prompt' }),
      field('Nome', name),
      field('Instruções', instructions, 'Variáveis disponíveis: {{texto}}, {{resumo}}, {{mensagens}}, {{nome_contato}}'),
      el('label', { className: 'wai-check' }, [enabled, el('span', { text: 'Prompt habilitado' })]),
      el('label', { className: 'wai-check' }, [autoRun, el('span', { text: 'Executar automaticamente após a pausa de digitação' })]),
      el('div', { className: 'wai-divider' }),
      el('label', { className: 'wai-check' }, [includeSummary, el('span', { text: 'Enviar resumo da conversa neste prompt' })]),
      el('label', { className: 'wai-check' }, [generateSummary, el('span', { text: 'Gerar resumo antes se este prompt precisar dele e ainda não existir' })]),
      el('label', { className: 'wai-check' }, [includeRecent, el('span', { text: 'Enviar mensagens recentes' })]),
      field('Quantidade de mensagens recentes', recentCount),
      field('Ordem', order, 'A ordem também define prioridade quando existe limite de prompts automáticos.'),
      field('Limite máximo de saída (tokens)', maxTokens),
      el('div', { className: 'wai-actions' }, [
        button('Salvar', async () => {
          const data = {
            ...current,
            id: prompt?.id,
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
        button('Cancelar', close, 'secondary'),
        prompt ? button('Excluir', async () => {
          if (!confirm(`Excluir o prompt "${prompt.name}"?`)) return;
          const ok = await this.handlers.onPromptDelete?.(prompt);
          if (ok !== false) close();
        }, 'danger') : null
      ])
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
      .filter(x => x.s.status === 'success' && x.s.text);

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
    return item?.status === 'success' ? item : null;
  }

  clearSelection() {
    if (this.selectedIndex < 0) return false;
    this.selectedIndex = -1;
    this.render();
    return true;
  }
}
