import { CONFIG } from './config.js';
import { sendRuntime, openOptions } from './runtime.js';
import { WhatsAppDom } from './whatsapp/dom.js';
import { SidebarUI } from './ui.js';
import { injectStyles } from './styles.js';
import { LANGUAGES, translationSettings } from './ai/translation.js';

export class WhatsAppAIApp {
  constructor() {
    this.dom = new WhatsAppDom();
    this.ui = null;

    this.installationId = '';
    this.fallbackSessionId = crypto.randomUUID();
    this.account = null;
    this.chat = null;

    this.settings = null;
    this.keyStatus = null;
    this.prompts = [];
    this.summary = null;
    this.chatSettings = null;
    this.chatSettingsLoading = true;
    this.chatSettingsRevision = 0;

    this.currentDraft = '';
    this.suppressedDraft = null;
    this.lastAutoDraft = null;
    this.isComposing = false;
    this.debounceTimer = null;
    this.draftVersion = 0;
    this.generationVersion = 0;

    this.domSyncTimer = null;
    this.messageScanTimer = null;
    this.summaryRunning = false;
    this.translationResults = new Map();
    this.translationAttempts = new Set();
    this.translatingMessages = false;
    this.applyingTranslation = false;
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;

    injectStyles();

    const init = await sendRuntime('INIT');
    if (!init.ok) {
      console.error('[WAI] Falha de inicialização:', init.message);
      return;
    }

    this.installationId = init.installationId;
    this.settings = init.settings;
    this.keyStatus = init.keyStatus;
    this.prompts = init.prompts || [];

    this.ui = new SidebarUI({
      onClose: () => this.setSidebarOpen(false),
      onOpen: () => this.setSidebarOpen(true),
      onOpenOptions: () => openOptions(),
      onPauseToggle: () => this.togglePause(),
      onRunPrompt: prompt => this.runManualPrompt(prompt),
      onRetrySuggestion: item => this.retrySuggestion(item),
      onUseSuggestion: item => this.useSuggestion(item),
      onSendSuggestion: item => this.applyAndSendSuggestion(item),
      onTranslateDraft: () => {
        const text = this.dom.readDraft();
        if (!text.trim()) {
          this.ui.setState({ translationStatus: 'Digite uma mensagem no campo do WhatsApp para traduzir o rascunho. Para mensagens recebidas, use “Traduzir balões do contato”.' });
          return;
        }
        return this.useSuggestion({ text });
      },
      onRetryTranslations: () => this.retryBubbleTranslations(),
      onGenerateSummary: force => this.generateSummary(false, force),
      onEditSummary: value => this.editSummary(value),
      onSummarySettings: patch => this.updateChatSettings(patch),
      onClearChatHistory: () => this.clearCurrentChatHistory(),
      onPromptSave: prompt => this.savePrompt(prompt),
      onPromptDelete: prompt => this.deletePrompt(prompt),
      onPromptToggle: (prompt, patch) => this.savePrompt({ ...prompt, ...patch })
    });

    this.ui.mount();
    this.ui.setState({
      settings: this.settings,
      keyStatus: this.keyStatus,
      prompts: this.prompts
    });
    this.ui.setOpen(this.settings.sidebarOpen);

    this.bindEvents();
    await this.syncAccountAndChat(true);
    this.scheduleMessageScan(50);
  }

  bindEvents() {
    this.dom.onComposerChanged(event => {
      if (event.type === 'compositionstart') {
        this.isComposing = true;
        this.cancelDebounce();
        return;
      }
      if (event.type === 'compositionend') {
        this.isComposing = false;
        this.onDraftChanged();
        return;
      }
      if (!this.isComposing) this.onDraftChanged();
    });

    this.dom.observeMutations(() => {
      this.scheduleDomSync();
      this.scheduleMessageScan();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.refreshConfiguration();
        this.scheduleDomSync(50);
        this.scheduleMessageScan(100);
      }
    });

    window.addEventListener('focus', () => {
      this.refreshConfiguration();
      this.scheduleDomSync(50);
      this.scheduleMessageScan(100);
    });

    document.addEventListener('wai:media-viewer', event => {
      const open = Boolean(event.detail?.open);
      if (open) {
        this.cancelDebounce();
        this.invalidateGenerations();
      } else {
        this.scheduleDomSync(50);
        this.scheduleMessageScan(100);
      }
    });

    document.addEventListener('keydown', event => this.handleKeyboard(event), true);
  }

  async refreshConfiguration() {
    const result = await sendRuntime('SETTINGS_GET');
    if (!result.ok) return;
    this.settings = result.settings;
    this.keyStatus = result.keyStatus;

    const prompts = await sendRuntime('PROMPT_LIST');
    if (prompts.ok) this.prompts = prompts.prompts || this.prompts;

    this.ui?.setState({
      settings: this.settings,
      keyStatus: this.keyStatus,
      prompts: this.prompts
    });
    this.ui?.setOpen(this.settings.sidebarOpen);
    this.onDraftChanged();
  }

  async setSidebarOpen(open) {
    this.settings = { ...this.settings, sidebarOpen: Boolean(open) };
    this.ui.setState({ settings: this.settings });
    this.ui.setOpen(Boolean(open));
    const result = await sendRuntime('SETTINGS_UPDATE', { sidebarOpen: Boolean(open) });
    if (result.ok) this.settings = result.settings;
  }

  async togglePause() {
    const aiPaused = !this.settings.aiPaused;
    const result = await sendRuntime('SETTINGS_UPDATE', { aiPaused });
    if (!result.ok) return;
    this.settings = result.settings;
    if (aiPaused) {
      this.cancelDebounce();
      this.invalidateGenerations();
    } else {
      this.onDraftChanged();
    }
    this.ui.setState({ settings: this.settings });
  }

  scheduleDomSync(delay = 180) {
    clearTimeout(this.domSyncTimer);
    this.domSyncTimer = setTimeout(() => this.syncAccountAndChat(false), delay);
  }

  scheduleMessageScan(delay = 300) {
    clearTimeout(this.messageScanTimer);
    this.messageScanTimer = setTimeout(() => this.scanMessages(), delay);
  }

  async syncAccountAndChat(force = false) {
    await this.syncAccount();
    await this.syncChat(force);
  }

  async syncAccount() {
    const candidate = this.dom.readAccountCandidate();
    const stable = candidate.whatsappAccountId;
    const accountId = stable
      ? `wa:${stable}`
      : `session:${this.installationId}:${this.fallbackSessionId}`;

    if (this.account?.id === accountId) return;

    this.cancelDebounce();
    this.invalidateGenerations();
    this.chat = null;
    this.summary = null;
    this.chatSettings = null;
    this.ui?.clearSuggestions();

    this.account = {
      id: accountId,
      installationId: this.installationId,
      whatsappAccountId: stable || null,
      phone: candidate.phone || '',
      identityConfidence: candidate.confidence || 'fallback'
    };

    await sendRuntime('ACCOUNT_UPSERT', { account: this.account });
  }

  async syncChat(force = false) {
    if (!this.account) return;
    const detected = this.dom.readConversation();

    if (!detected) {
      if (this.chat) {
        this.cancelDebounce();
        this.invalidateGenerations();
        this.chat = null;
        this.summary = null;
        this.chatSettings = null;
        this.ui.clearSuggestions();
        this.ui.setState({ chat: null, summary: null, chatSettings: null });
      }
      return;
    }

    const nextKey = `${this.account.id}::${detected.whatsappChatId}`;
    const currentKey = this.chat ? `${this.chat.accountId}::${this.chat.whatsappChatId}` : '';

    if (!force && nextKey === currentKey) return;

    this.cancelDebounce();
    this.invalidateGenerations();
    this.currentDraft = this.dom.readDraft();
    this.suppressedDraft = null;
    this.ui.clearSuggestions();

    this.chat = {
      ...detected,
      accountId: this.account.id
    };
    this.dom.clearTranslations();
    this.translationResults.clear();
    this.translationAttempts.clear();
    this.translationFailure = false;
    const selectedChat = this.chat;
    this.chatSettingsLoading = true;
    this.chatSettings = null;
    this.lastAutoDraft = null;
    this.ui.setState({ chat: this.chat, summary: null, chatSettings: null, chatSettingsLoading: true });

    const saved = await sendRuntime('CHAT_UPSERT', { chat: this.chat });
    if (this.chat !== selectedChat) return;
    if (saved.ok && saved.chat) this.chat = saved.chat;
    const activeChat = this.chat;

    const context = await sendRuntime('CHAT_CONTEXT_GET', {
      accountId: activeChat.accountId,
      chatId: detected.whatsappChatId,
      recentCount: 6
    });

    if (this.chat !== activeChat) return;
    this.summary = context.ok ? context.summary : null;
    this.chatSettings = context.ok ? context.chatSettings : null;
    this.chatSettingsLoading = !context.ok;

    this.ui.setState({
      chat: this.chat,
      summary: this.summary,
      chatSettings: this.chatSettings,
      chatSettingsLoading: this.chatSettingsLoading
    });

    this.scheduleMessageScan(30);
    this.onDraftChanged();
  }

  async retryBubbleTranslations() {
    this.translationFailure = false;
    this.translationAttempts.clear();
    this.ui.setState({ translationStatus: 'Procurando mensagens recebidas para traduzir…' });
    try {
      await this.scanMessages(true);
    } catch (error) {
      this.ui.setState({ translationStatus: error?.message || 'Não foi possível ler os balões. Recarregue o WhatsApp e tente novamente.' });
    }
  }

  async scanMessages(manualTranslation = false) {
    if (!this.chat || !this.account) return;
    const activeChat = this.chat;
    const settingsRevision = this.chatSettingsRevision;
    const messages = this.dom.readVisibleMessages();
    if (!messages.length) {
      if (manualTranslation) this.ui.setState({ translationStatus: 'Nenhum balão de mensagem reconhecido. Abra uma conversa com mensagens de texto e tente novamente.' });
      return;
    }

    const result = { ok: true, inserted: 0, autoSummaryDue: false };
    // Reconcile all loaded messages, including old ones, before translation.
    // Match the worker's batch limit without silently dropping older bubbles.
    for (let offset = 0; offset < messages.length; offset += 500) {
      if (this.chat !== activeChat) return;
      const batch = await sendRuntime('MESSAGES_UPSERT', {
        accountId: activeChat.accountId,
        chatId: activeChat.whatsappChatId,
        messages: messages.slice(offset, offset + 500)
      });
      if (!batch.ok) { Object.assign(result, batch); break; }
      result.inserted += batch.inserted || 0;
      result.autoSummaryDue ||= batch.autoSummaryDue;
    }

    if (this.chat !== activeChat) return;
    if (!result.ok) {
      this.ui.setState({ translationStatus: `Não foi possível salvar o histórico: ${result.message || result.error}. Recarregue a extensão e o WhatsApp.` });
      return;
    }
    await this.translateVisibleMessages(messages, manualTranslation);
    if (this.chat !== activeChat) return;

    if (result.inserted > 0) {
      const context = await sendRuntime('CHAT_CONTEXT_GET', {
        accountId: this.account.id,
        chatId: this.chat.whatsappChatId,
        recentCount: 6
      });
      if (context.ok && this.chat === activeChat && !this.chatSettingsSaving && settingsRevision === this.chatSettingsRevision) {
        this.summary = context.summary;
        this.chatSettings = context.chatSettings;
        this.ui.setState({ summary: this.summary, chatSettings: this.chatSettings });
      }
    }

    if (this.chat === activeChat && this.isChatAIEnabled() && result.autoSummaryDue && !this.summaryRunning && !this.settings.aiPaused && !document.body.classList.contains(CONFIG.mediaOpenClass)) {
      this.generateSummary(true, false);
    }
  }

  onDraftChanged() {
    const draft = this.dom.readDraft();
    if (draft !== this.currentDraft) {
      this.currentDraft = draft;
      this.lastAutoDraft = null;
      this.draftVersion += 1;
      this.invalidateGenerations();
      this.cancelDebounce();
      this.ui.clearSuggestions();

      if (this.suppressedDraft != null && draft !== this.suppressedDraft) {
        this.suppressedDraft = null;
      }
    }

    if (this.isComposing) return;
    if (!this.canAutoSuggest(draft)) return;

    const version = this.draftVersion;
    this.debounceTimer = setTimeout(() => {
      if (version !== this.draftVersion) return;
      if (this.dom.readDraft() !== draft) return;
      this.runAutomaticPrompts(draft);
    }, this.settings.debounceMs || CONFIG.defaultDebounceMs);
  }

  isChatAIEnabled() {
    return Boolean(this.chat && this.account && !this.chatSettingsLoading && !this.chatSettingsSaving && this.chatSettings?.aiEnabled === true);
  }

  canAutoSuggest(draft) {
    if (this.applyingTranslation) return false;
    if (!this.isChatAIEnabled()) return false;
    if (!this.chat || !this.account) return false;
    if (!this.keyStatus?.configured) return false;
    if (this.settings?.aiPaused || !this.settings?.automaticSuggestions) return false;
    if (document.body.classList.contains(CONFIG.mediaOpenClass)) return false;
    if (!draft || draft.trim().length < CONFIG.minDraftLength) return false;
    if (this.suppressedDraft != null && draft === this.suppressedDraft) return false;
    if (this.lastAutoDraft != null && draft === this.lastAutoDraft) return false;
    return this.prompts.some(prompt => prompt.enabled && prompt.autoRun);
  }

  cancelDebounce() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  invalidateGenerations() {
    this.generationVersion += 1;
  }

  async runAutomaticPrompts(draft) {
    if (!this.canAutoSuggest(draft)) return;
    const prompts = this.prompts
      .filter(prompt => prompt.enabled && prompt.autoRun)
      .slice(0, Math.max(1, this.settings.maxAutomaticPrompts || 3));

    if (!prompts.length) return;

    this.lastAutoDraft = draft;
    const version = ++this.generationVersion;
    const suggestions = prompts.map(prompt => ({
      id: `${version}:${prompt.id}`,
      promptId: prompt.id,
      promptName: prompt.name,
      status: 'queued',
      text: '',
      error: '',
      draft,
      automatic: true
    }));
    this.ui.setSuggestions(suggestions);

    for (const suggestion of suggestions) {
      this.generateSuggestionItem(suggestion, version);
    }
  }

  async runManualPrompt(prompt) {
    if (!this.isChatAIEnabled()) return;
    if (!this.chat) {
      alert('Selecione uma conversa no WhatsApp.');
      return;
    }
    if (!this.keyStatus?.configured) {
      await openOptions();
      return;
    }

    const draft = this.dom.readDraft();
    if (!draft.trim()) {
      alert('Digite uma mensagem no campo do WhatsApp antes de executar o prompt.');
      return;
    }

    const version = ++this.generationVersion;
    const item = {
      id: `${version}:${prompt.id}`,
      promptId: prompt.id,
      promptName: prompt.name,
      status: 'queued',
      text: '',
      error: '',
      draft,
      automatic: false
    };
    this.ui.setSuggestions([item]);
    await this.generateSuggestionItem(item, version);
  }

  async retrySuggestion(item) {
    if (!this.isChatAIEnabled()) return;
    if (!item) return;
    const draft = this.dom.readDraft();
    const version = ++this.generationVersion;
    const retry = { ...item, id: `${version}:${item.promptId}`, status: 'queued', error: '', text: '', draft };
    this.ui.setSuggestions([retry]);
    await this.generateSuggestionItem(retry, version);
  }

  async generateSuggestionItem(item, version) {
    if (!this.isChatAIEnabled()) return;
    if (version !== this.generationVersion) return;

    item.status = 'loading';
    this.ui.setSuggestions([...this.ui.suggestions]);

    const result = await sendRuntime('SUGGEST_GENERATE', {
      accountId: this.account.id,
      chatId: this.chat.whatsappChatId,
      promptId: item.promptId,
      draft: item.draft,
      contactName: this.chat.displayName,
      automatic: Boolean(item.automatic)
    });

    if (version !== this.generationVersion) return;
    if (this.dom.readDraft() !== item.draft) return;
    if (!this.chat) return;

    if (!result.ok) {
      item.status = 'error';
      item.error = this.userError(result);
    } else {
      item.status = 'success';
      item.text = result.text;
      item.cached = Boolean(result.cached);
    }

    this.ui.setSuggestions([...this.ui.suggestions]);
  }

  userError(result) {
    const map = {
      CHAT_AI_DISABLED: 'IA desativada para esta conversa.',
      API_KEY_REQUIRED: 'Configure sua API key da OpenAI.',
      OPENAI_UNAUTHORIZED: 'A API key foi recusada pela OpenAI. Verifique a configuração.',
      OPENAI_RATE_LIMIT: 'A OpenAI aplicou um limite temporário ou a conta atingiu um limite.',
      OPENAI_TIMEOUT: 'A OpenAI demorou demais para responder.',
      OPENAI_NETWORK: 'Não foi possível acessar a OpenAI.',
      LOCAL_RATE_LIMIT: 'Proteção local ativada: muitas chamadas em pouco tempo.',
      DAILY_TOKEN_LIMIT: 'Seu limite diário local de tokens foi atingido.',
      DAILY_REQUEST_LIMIT: 'Seu limite diário de chamadas automáticas foi atingido.'
    };
    return map[result.error] || result.message || 'Não foi possível gerar a sugestão.';
  }

  async useSuggestion(item) {
    if (!item?.text?.trim() || !this.isChatAIEnabled() || this.applyingTranslation) return;
    const selectedChat = this.chat;
    if (this.dom.readConversation && this.dom.readConversation()?.whatsappChatId !== selectedChat.whatsappChatId) return;
    let text = item.text;
    if (translationSettings(this.chatSettings).enabled) {
      const chat = this.chat;
      const draft = this.dom.readDraft();
      const revision = this.chatSettingsRevision;
      this.applyingTranslation = true;
      this.cancelDebounce();
      this.ui.setState({ applyingTranslation: true, translationStatus: 'Traduzindo para o idioma do contato…' });
      try {
        const result = await sendRuntime('TRANSLATE_TEXT', {
          accountId: chat.accountId, chatId: chat.whatsappChatId,
          text, direction: 'outgoing'
        });
        if (this.chat !== chat || this.chatSettingsRevision !== revision || !this.isChatAIEnabled()) return;
        if (!result.ok) {
          this.ui.setState({ translationStatus: this.userError(result) });
          return;
        }
        if (this.dom.readDraft() !== draft) {
          this.ui.setState({ translationStatus: 'Você alterou o rascunho. A tradução não foi aplicada; tente novamente.' });
          return;
        }
        text = result.text;
        this.ui.setState({ translationStatus: 'Tradução aplicada. Revise e envie pelo WhatsApp quando quiser.' });
      } finally {
        this.applyingTranslation = false;
        this.ui.setState({ applyingTranslation: false });
      }
    }
    if (this.chat !== selectedChat || (this.dom.readConversation && this.dom.readConversation()?.whatsappChatId !== selectedChat.whatsappChatId)) return;
    if (!this.dom.setDraft(text)) return;
    this.suppressedDraft = text.trim();
    this.currentDraft = text.trim();
    this.draftVersion += 1;
    this.invalidateGenerations();
    this.cancelDebounce();
    this.ui.clearSelection();
    return true;
  }

  async applyAndSendSuggestion(item) {
    if (!item?.text || !this.isChatAIEnabled() || this.sendingSuggestion || this.applyingTranslation || item.sendRequested) return;
    const chat = this.chat;
    const revision = this.chatSettingsRevision;
    if (this.dom.readConversation()?.whatsappChatId !== chat.whatsappChatId) return;
    this.sendingSuggestion = true;
    this.ui.setState({ sendingSuggestion: true, sendStatus: 'Preparando sugestão para enviar…' });
    try {
      const applied = await this.useSuggestion(item);
      if (!applied || this.chat !== chat || this.chatSettingsRevision !== revision || !this.isChatAIEnabled()) {
        this.ui.setState({ sendStatus: 'Envio cancelado. Confira a conversa e o rascunho antes de tentar novamente.' });
        return;
      }
      const expectedText = this.currentDraft;
      const sent = await this.dom.sendDraft(expectedText, chat.whatsappChatId,
        () => this.chat === chat && this.chatSettingsRevision === revision && this.isChatAIEnabled());
      if (!sent) {
        this.ui.setState({ sendStatus: 'Não foi possível acionar o envio com segurança. Confira o texto no campo e envie pelo WhatsApp.' });
        return;
      }
      item.sendRequested = true;
      this.ui.clearSuggestions();
      this.ui.setState({ sendStatus: 'Envio acionado no WhatsApp.' });
    } catch {
      this.ui.setState({ sendStatus: 'Não foi possível concluir o envio. Confira a conversa antes de tentar novamente.' });
    } finally {
      this.sendingSuggestion = false;
      this.ui.setState({ sendingSuggestion: false });
    }
  }

  async translateVisibleMessages(messages, manual = false) {
    if (this.translatingMessages) {
      this.translationRescan = true;
      if (manual) this.ui.setState({ translationStatus: 'Já existe uma tradução em andamento. Aguarde a conclusão.' });
      return;
    }
    const translation = translationSettings(this.chatSettings);
    const reason = !this.isChatAIEnabled() ? 'Marque “Usar IA” e aguarde o carregamento da conversa.'
      : !translation.enabled ? 'Ative o modo tradução nesta conversa.'
      : this.settings.aiPaused ? 'A IA está pausada. Retome a IA para traduzir.'
      : !this.keyStatus?.configured ? 'Configure sua API key em Configurações para traduzir os balões.'
      : document.body.classList.contains(CONFIG.mediaOpenClass) ? 'Feche o visualizador de mídia para traduzir os balões.'
      : this.translationFailure ? 'A tradução foi interrompida após um erro. Clique em traduzir os balões para tentar novamente.' : '';
    if (reason) {
      if (manual) this.ui.setState({ translationStatus: reason });
      return;
    }
    const received = messages.filter(m => m.direction === 'incoming' && m.text && !/^\[(audio|video|image|document)\]$/.test(m.text));
    const eligible = manual ? received : received.slice(-20);
    if (!eligible.length) {
      if (manual) this.ui.setState({ translationStatus: 'Nenhuma mensagem de texto recebida foi identificada nos balões carregados.' });
      return;
    }
    const chat = this.chat;
    const revision = this.chatSettingsRevision;
    this.translatingMessages = true;
    let displayed = 0;
    this.ui.setState({ translatingBubbles: true });
    try {
      // Bound automatic work to the 20 most recent loaded text messages.
      for (const message of eligible) {
        if (this.chat !== chat || revision !== this.chatSettingsRevision || !this.isChatAIEnabled() || this.settings.aiPaused || document.body.classList.contains(CONFIG.mediaOpenClass)) break;
        const key = JSON.stringify([chat.accountId, chat.whatsappChatId, message.id, message.text, translation.myLanguage, translation.contactLanguage, this.settings.model]);
        if (this.translationResults.has(key)) {
          if (this.dom.showTranslation(message, this.translationResults.get(key), LANGUAGES[translation.myLanguage])) displayed++;
          continue;
        }
        if (this.translationAttempts.has(key)) continue;
        this.translationAttempts.add(key);
        this.ui.setState({ translationStatus: `Traduzindo balões: ${displayed + 1} de ${eligible.length}…` });
        const result = await sendRuntime('TRANSLATE_TEXT', {
          accountId: chat.accountId, chatId: chat.whatsappChatId,
          text: message.text, messageId: message.id, direction: 'incoming'
        });
        if (this.chat !== chat || revision !== this.chatSettingsRevision || !this.isChatAIEnabled()) break;
        if (!result.ok) {
          this.translationFailure = true;
          this.ui.setState({ translationStatus: this.userError(result) });
          // Do not retry a failing API on every DOM mutation.
          break;
        }
        this.translationResults.set(key, result.text);
        if (this.translationResults.size > 200) this.translationResults.delete(this.translationResults.keys().next().value);
        if (this.translationAttempts.size > 500) this.translationAttempts.delete(this.translationAttempts.values().next().value);
        if (this.dom.showTranslation(message, result.text, LANGUAGES[translation.myLanguage])) displayed++;
      }
      if (this.chat === chat && revision === this.chatSettingsRevision && !this.translationFailure && displayed) {
        this.ui.setState({ translationStatus: `${displayed} balão(ões) com tradução exibida.` });
      } else if (manual && this.chat === chat && revision === this.chatSettingsRevision && !this.translationFailure) {
        this.ui.setState({ translationStatus: 'Os balões mudaram durante a tradução. Clique em traduzir novamente para exibir as traduções salvas.' });
      }
    } finally {
      this.translatingMessages = false;
      this.ui.setState({ translatingBubbles: false });
      if (this.translationRescan || this.chat !== chat || revision !== this.chatSettingsRevision) this.scheduleMessageScan(100);
      this.translationRescan = false;
    }
  }

  async generateSummary(automatic = false, forceRebuild = false) {
    if (!this.isChatAIEnabled()) return false;
    if (this.summaryRunning || !this.chat || !this.account) return false;
    const activeChat = this.chat;
    const settingsRevision = this.chatSettingsRevision;
    if (!this.keyStatus?.configured) {
      if (!automatic) await openOptions();
      return false;
    }

    if (forceRebuild && !automatic) {
      const ok = confirm('Refazer o resumo pode usar mais tokens porque reprocessa mais histórico local. Continuar?');
      if (!ok) return false;
    }

    this.summaryRunning = true;
    try {
      const result = await sendRuntime('SUMMARY_GENERATE', {
        accountId: activeChat.accountId,
        chatId: activeChat.whatsappChatId,
        automatic,
        forceRebuild
      });

      if (this.chat !== activeChat || !this.isChatAIEnabled()) return false;
      if (!result.ok) {
        if (!automatic) alert(this.userError(result));
        return false;
      }

      const context = await sendRuntime('CHAT_CONTEXT_GET', {
        accountId: this.account.id,
        chatId: this.chat.whatsappChatId,
        recentCount: 6
      });
      if (context.ok && this.chat === activeChat && settingsRevision === this.chatSettingsRevision && !this.chatSettingsSaving) {
        this.summary = context.summary;
        this.chatSettings = context.chatSettings;
        this.ui.setState({ summary: this.summary, chatSettings: this.chatSettings });
      }
      return true;
    } finally {
      this.summaryRunning = false;
    }
  }

  async editSummary(value) {
    if (!this.chat || !this.account) return false;
    const result = await sendRuntime('SUMMARY_EDIT', {
      accountId: this.account.id,
      chatId: this.chat.whatsappChatId,
      summary: value
    });
    if (!result.ok) {
      alert(result.message || 'Não foi possível salvar o resumo.');
      return false;
    }
    this.summary = result.record;
    this.ui.setState({ summary: this.summary });
    return true;
  }

  async updateChatSettings(patch) {
    if (!this.chat || !this.account || this.chatSettingsSaving) return;
    const activeChat = this.chat;
    const previous = this.chatSettings;
    this.chatSettingsRevision += 1;
    this.translationFailure = false;
    this.chatSettingsSaving = true;
    this.chatSettings = { ...previous, ...patch };
    this.dom.clearTranslations();
    this.translationResults.clear();
    this.translationAttempts.clear();
    this.cancelDebounce();
    this.invalidateGenerations();
    this.ui.clearSuggestions();
    this.ui.setState({ chatSettings: this.chatSettings, chatSettingsLoading: true });
    const result = await sendRuntime('CHAT_SETTINGS_UPDATE', {
      accountId: activeChat.accountId,
      chatId: activeChat.whatsappChatId,
      patch
    });
    this.chatSettingsSaving = false;
    if (this.chat !== activeChat) return;
    this.chatSettings = result.ok ? result.chatSettings : previous;
    this.ui.setState({ chatSettings: this.chatSettings, chatSettingsLoading: this.chatSettingsLoading });
    if (!result.ok) alert(result.message || 'Não foi possível salvar a preferência de IA.');
    this.lastAutoDraft = null;
    this.onDraftChanged();
    this.scheduleMessageScan(30);
  }

  async savePrompt(prompt) {
    if (prompt.autoRun && prompt.enabled) {
      const otherAutomatic = this.prompts.filter(p => p.id !== prompt.id && p.enabled && p.autoRun).length;
      const total = otherAutomatic + 1;
      if (total > (this.settings.maxAutomaticPrompts || 3)) {
        const ok = confirm(`Você terá ${total} prompts automáticos ativos. Pela configuração atual, somente os primeiros ${this.settings.maxAutomaticPrompts || 3} serão executados em cada ciclo. Salvar mesmo assim?`);
        if (!ok) return false;
      }
    }

    const result = await sendRuntime('PROMPT_SAVE', { prompt });
    if (!result.ok) {
      alert(result.message || 'Não foi possível salvar o prompt.');
      return false;
    }
    await this.reloadPrompts();
    return true;
  }

  async deletePrompt(prompt) {
    const result = await sendRuntime('PROMPT_DELETE', { id: prompt.id });
    if (!result.ok) {
      alert(result.message || 'Não foi possível excluir o prompt.');
      return false;
    }
    await this.reloadPrompts();
    return true;
  }

  async reloadPrompts() {
    const result = await sendRuntime('PROMPT_LIST');
    if (result.ok) {
      this.prompts = result.prompts || [];
      this.lastAutoDraft = null;
      this.ui.setState({ prompts: this.prompts });
      this.onDraftChanged();
    }
  }

  async clearCurrentChatHistory() {
    if (!this.chat || !this.account) return false;
    if (!confirm('Apagar o histórico local observado desta conversa? O resumo será mantido.')) return false;
    const result = await sendRuntime('DATA_CLEAR', {
      kind: 'history',
      accountId: this.account.id,
      chatId: this.chat.whatsappChatId
    });
    if (!result.ok) {
      alert(result.message || 'Não foi possível limpar o histórico.');
      return false;
    }
    alert('Histórico local desta conversa apagado.');
    this.dom.clearTranslations();
    this.translationResults.clear();
    return true;
  }

  handleKeyboard(event) {
    if (!this.ui || document.body.classList.contains(CONFIG.mediaOpenClass)) return;
    if (event.isComposing || this.isComposing || event.keyCode === 229) return;

    const modalInput = event.target?.closest?.('#wai-sidebar input, #wai-sidebar textarea, #wai-sidebar select');
    if (modalInput) return;

    const composer = this.dom.getComposer();
    const composerFocused = composer && (document.activeElement === composer || composer.contains(document.activeElement));
    if (!composerFocused) return;

    if (event.key === 'Enter' && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      const selected = this.ui.getSelectedSuggestion() || this.ui.suggestions.find(item => item.status === 'success' && item.text);
      if (selected) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) this.applyAndSendSuggestion(selected);
      }
      return;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey && /^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      const item = this.ui.suggestions[index];
      if (item?.status === 'success') {
        event.preventDefault();
        event.stopPropagation();
        this.useSuggestion(item);
      }
      return;
    }

    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const selected = this.ui.moveSelection(event.shiftKey ? -1 : 1);
      if (selected) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (event.key === 'Escape') {
      if (this.ui.clearSelection()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }
}
