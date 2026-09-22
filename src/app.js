import { CONFIG, DEFAULT_SUGGEST_MESSAGE_PROMPT_ID, PROMPT_SCOPE } from './config.js';
import { sendRuntime, openOptions } from './runtime.js';
import { WhatsAppDom } from './whatsapp/dom.js';
import { WhatsAppComposerBridge, normalizeComposerText } from './whatsapp/composer-bridge.js';
import { SidebarUI } from './ui.js';
import { injectStyles } from './styles.js';
import { LANGUAGES, translationSettings, finalSuggestionTextForChat } from './ai/translation.js';

export class WhatsAppAIApp {
  constructor() {
    this.dom = new WhatsAppDom();
    this.composerBridge = new WhatsAppComposerBridge();
    this.ui = null;

    this.installationId = '';
    this.fallbackSessionId = crypto.randomUUID();
    this.account = null;
    this.chat = null;

    this.settings = null;
    this.keyStatus = null;
    this.allPrompts = [];
    this.prompts = [];
    this.summary = null;
    this.suggestedMessage = null;
    this.suggestedMessagePromptId = DEFAULT_SUGGEST_MESSAGE_PROMPT_ID;
    this.suggestedMessageGeneration = 0;
    this.suggestedMessageStatus = '';
    this.suggestedMessageSending = false;
    this.chatSettings = null;
    this.chatSettingsLoading = true;
    this.chatSettingsRevision = 0;

    this.currentDraft = '';
    this.suppressedDraft = null;
    this.lastAutoDraft = null;
    this.isComposing = false;
    this.replacingDraft = false;
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
    this.allPrompts = init.prompts || [];
    this.prompts = this.allPrompts.filter(prompt => (prompt.scope || PROMPT_SCOPE.GLOBAL) === PROMPT_SCOPE.GLOBAL);
    this.chooseSuggestedMessagePrompt();

    this.ui = new SidebarUI({
      onClose: () => this.setSidebarOpen(false),
      onOpen: () => this.setSidebarOpen(true),
      onOpenOptions: () => openOptions(),
      onPauseToggle: () => this.togglePause(),
      onRunPrompt: prompt => this.runManualPrompt(prompt),
      onRetrySuggestion: item => this.retrySuggestion(item),
      onUseSuggestion: item => this.useSuggestion(item),
      onSendSuggestion: item => this.applyAndSendSuggestion(item),
      onSuggestedMessagePromptChange: id => this.setSuggestedMessagePrompt(id),
      onGenerateSuggestedMessage: forceNew => this.generateSuggestedMessage(Boolean(forceNew)),
      onRetrySuggestedMessage: () => this.generateSuggestedMessage(false),
      onUseSuggestedMessage: () => this.useSuggestedMessage(),
      onSendSuggestedMessage: () => this.sendSuggestedMessage(),
      onTranslateDraft: () => this.translateDraftAndApply(),
      onRetryTranslations: () => this.retryBubbleTranslations(),
      onGenerateSummary: force => this.generateSummary(false, force),
      onEditSummary: value => this.editSummary(value),
      onSummarySettings: patch => this.updateChatSettings(patch),
      onClearChatHistory: () => this.clearCurrentChatHistory(),
      onPromptSave: prompt => this.savePrompt(prompt),
      onPromptDelete: prompt => this.deletePrompt(prompt),
      onPromptToggle: (prompt, patch) => this.savePrompt({ ...prompt, ...patch }),
      onPromptDuplicateToChat: prompt => this.duplicatePromptToCurrentChat(prompt)
    });

    this.ui.mount();
    this.ui.setState({
      settings: this.settings,
      keyStatus: this.keyStatus,
      prompts: this.prompts,
      suggestedMessage: this.suggestedMessage,
      suggestedMessagePromptId: this.suggestedMessagePromptId,
      suggestedMessageStatus: this.suggestedMessageStatus,
      suggestedMessageSending: this.suggestedMessageSending
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

    await this.reloadPrompts(false);

    this.ui?.setState({
      settings: this.settings,
      keyStatus: this.keyStatus,
      prompts: this.prompts,
      suggestedMessagePromptId: this.suggestedMessagePromptId
    });
    this.ui?.setOpen(this.settings.sidebarOpen);
    this.onDraftChanged();
  }

  chooseSuggestedMessagePrompt() {
    const enabled = this.prompts.filter(prompt => prompt.enabled);
    if (enabled.some(prompt => prompt.id === this.suggestedMessagePromptId)) {
      return this.suggestedMessagePromptId;
    }
    this.suggestedMessagePromptId =
      enabled.find(prompt => prompt.id === DEFAULT_SUGGEST_MESSAGE_PROMPT_ID)?.id ||
      enabled[0]?.id ||
      '';
    return this.suggestedMessagePromptId;
  }

  setSuggestedMessagePrompt(id) {
    const next = this.prompts.find(prompt => prompt.id === id && prompt.enabled)?.id || '';
    if (!next || next === this.suggestedMessagePromptId) return;
    this.suggestedMessagePromptId = next;
    this.clearSuggestedMessage('');
    this.ui?.setState({ suggestedMessagePromptId: next });
  }

  clearSuggestedMessage(status = '') {
    this.suggestedMessageGeneration += 1;
    this.suggestedMessage = null;
    this.suggestedMessageStatus = status;
    this.suggestedMessageSending = false;
    this.ui?.setState({
      suggestedMessage: null,
      suggestedMessageStatus: status,
      suggestedMessageSending: false
    });
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
    this.prompts = this.allPrompts.filter(prompt => (prompt.scope || PROMPT_SCOPE.GLOBAL) === PROMPT_SCOPE.GLOBAL);
    this.ui?.clearSuggestions();
    this.clearSuggestedMessage('');

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
        this.prompts = this.allPrompts.filter(prompt => (prompt.scope || PROMPT_SCOPE.GLOBAL) === PROMPT_SCOPE.GLOBAL);
        this.ui.clearSuggestions();
        this.clearSuggestedMessage('');
        this.chooseSuggestedMessagePrompt();
        this.ui.setState({
          chat: null,
          summary: null,
          chatSettings: null,
          prompts: this.prompts,
          suggestedMessagePromptId: this.suggestedMessagePromptId
        });
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
    this.clearSuggestedMessage('');

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
    this.ui.setState({
      chat: this.chat,
      summary: null,
      chatSettings: null,
      chatSettingsLoading: true,
      suggestedMessage: null,
      suggestedMessagePromptId: this.suggestedMessagePromptId,
      suggestedMessageStatus: ''
    });

    const saved = await sendRuntime('CHAT_UPSERT', { chat: this.chat });
    if (this.chat !== selectedChat) return;
    if (saved.ok && saved.chat) this.chat = saved.chat;
    const activeChat = this.chat;

    await this.loadPromptsForChat(activeChat);
    if (this.chat !== activeChat) return;

    const context = await sendRuntime('CHAT_CONTEXT_GET', {
      accountId: activeChat.accountId,
      chatId: detected.whatsappChatId,
      recentCount: 6
    });

    if (this.chat !== activeChat) return;
    this.summary = context.ok ? context.summary : null;
    this.chatSettings = context.ok ? context.chatSettings : null;
    this.chatSettingsLoading = !context.ok;

    this.chooseSuggestedMessagePrompt();
    this.ui.setState({
      chat: this.chat,
      summary: this.summary,
      chatSettings: this.chatSettings,
      chatSettingsLoading: this.chatSettingsLoading,
      prompts: this.prompts,
      suggestedMessagePromptId: this.suggestedMessagePromptId
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
        const oldSummaryVersion = this.summary?.summaryVersion || 0;
        this.summary = context.summary;
        this.chatSettings = context.chatSettings;
        if ((this.summary?.summaryVersion || 0) !== oldSummaryVersion) this.clearSuggestedMessage('');
        this.ui.setState({ summary: this.summary, chatSettings: this.chatSettings });
      }
    }

    if (this.chat === activeChat && this.isChatAIEnabled() && result.autoSummaryDue && !this.summaryRunning && !this.settings.aiPaused && !document.body.classList.contains(CONFIG.mediaOpenClass)) {
      this.generateSummary(true, false);
    }
  }

  onDraftChanged() {
    if (this.replacingDraft) return;

    const draft = this.dom.readDraft();
    if (draft === this.currentDraft) return;

    this.currentDraft = draft;
    this.lastAutoDraft = null;
    this.draftVersion += 1;
    this.invalidateGenerations();
    this.cancelDebounce();
    this.ui.clearSuggestions();

    if (this.suppressedDraft != null && draft !== this.suppressedDraft) {
      this.suppressedDraft = null;
    }

    if (this.isComposing) return;
    if (!this.canAutoSuggest(draft)) return;

    const version = this.draftVersion;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (version !== this.draftVersion) return;
      if (this.dom.readDraft() !== draft) return;
      this.runAutomaticPrompts(draft, false);
    }, CONFIG.defaultDebounceMs);
  }

  isChatAIEnabled() {
    return Boolean(this.chat && this.account && !this.chatSettingsLoading && !this.chatSettingsSaving && this.chatSettings?.aiEnabled === true);
  }

  canRequestSuggestions(draft) {
    if (this.applyingTranslation || this.sendingSuggestion) return false;
    if (!this.isChatAIEnabled()) return false;
    if (!this.chat || !this.account) return false;
    if (!this.keyStatus?.configured) return false;
    if (this.settings?.aiPaused) return false;
    if (document.body.classList.contains(CONFIG.mediaOpenClass)) return false;
    if (!draft || draft.trim().length < CONFIG.minDraftLength) return false;
    return this.prompts.some(prompt => prompt.enabled && prompt.autoRun);
  }

  canAutoSuggest(draft) {
    if (!this.canRequestSuggestions(draft)) return false;
    if (!this.settings?.automaticSuggestions) return false;
    if (this.suppressedDraft != null && draft === this.suppressedDraft) return false;
    if (this.lastAutoDraft != null && draft === this.lastAutoDraft) return false;
    return true;
  }

  cancelDebounce() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  invalidateGenerations() {
    this.generationVersion += 1;
  }

  async runAutomaticPrompts(draft, forceNow = false) {
    if (forceNow) {
      if (!this.canRequestSuggestions(draft)) return false;
    } else if (!this.canAutoSuggest(draft)) {
      return false;
    }

    const prompts = this.prompts
      .filter(prompt => prompt.enabled && prompt.autoRun)
      .sort((a, b) =>
        ((a.scope === PROMPT_SCOPE.CHAT ? 0 : 1) - (b.scope === PROMPT_SCOPE.CHAT ? 0 : 1)) ||
        ((a.order ?? 999) - (b.order ?? 999)) ||
        String(a.name || '').localeCompare(String(b.name || ''))
      )
      .slice(0, Math.max(1, this.settings.maxAutomaticPrompts || 3));

    if (!prompts.length) return false;

    this.cancelDebounce();
    // A forced Ctrl+Space also satisfies the automatic cycle for this exact
    // draft, so another request will not fire five seconds later.
    this.lastAutoDraft = draft;

    const version = ++this.generationVersion;
    const suggestions = prompts.map(prompt => ({
      id: `${version}:${prompt.id}`,
      promptId: prompt.id,
      promptName: prompt.name,
      status: 'queued',
      text: '',
      promptText: '',
      finalText: '',
      translationApplied: false,
      sourceLanguage: null,
      targetLanguage: null,
      error: '',
      draft,
      automatic: !forceNow
    }));
    this.ui.setSuggestions(suggestions);

    for (const suggestion of suggestions) {
      this.generateSuggestionItem(suggestion, version);
    }
    return true;
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
    if (!this.prompts.some(item => item.id === prompt?.id)) {
      alert('Este prompt não está disponível para a conversa atual.');
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
      promptText: '',
      finalText: '',
      translationApplied: false,
      sourceLanguage: null,
      targetLanguage: null,
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
    const retry = {
      ...item,
      id: `${version}:${item.promptId}`,
      status: 'queued',
      error: '',
      text: '',
      promptText: '',
      finalText: '',
      translationApplied: false,
      translationCached: false,
      sourceLanguage: null,
      targetLanguage: null,
      translationAccountId: null,
      translationChatId: null,
      sendRequested: false,
      draft,
      automatic: false
    };
    this.ui.setSuggestions([retry]);
    await this.generateSuggestionItem(retry, version);
  }

  async generateSuggestionItem(item, version) {
    if (!this.isChatAIEnabled()) return;
    if (version !== this.generationVersion) return;

    const chat = this.chat;
    const revision = this.chatSettingsRevision;
    const draft = item.draft;
    const translation = translationSettings(this.chatSettings);

    item.status = 'loading';
    item.error = '';
    item.promptText = '';
    item.finalText = '';
    item.translationApplied = false;
    item.translationCached = false;
    item.sourceLanguage = null;
    item.targetLanguage = null;
    item.translationAccountId = null;
    item.translationChatId = null;
    this.ui.setSuggestions([...this.ui.suggestions]);

    const result = await sendRuntime('SUGGEST_GENERATE', {
      accountId: chat.accountId,
      chatId: chat.whatsappChatId,
      promptId: item.promptId,
      draft,
      contactName: chat.displayName,
      automatic: Boolean(item.automatic)
    });

    if (
      version !== this.generationVersion ||
      this.chat !== chat ||
      this.chatSettingsRevision !== revision ||
      this.dom.readDraft() !== draft ||
      !this.isChatAIEnabled()
    ) {
      return;
    }

    if (!result.ok || typeof result.text !== 'string' || !result.text.trim()) {
      item.status = 'error';
      item.error = result.ok ? 'A IA retornou uma sugestão vazia.' : this.userError(result);
      this.ui.setSuggestions([...this.ui.suggestions]);
      return;
    }

    item.promptText = result.text;
    item.text = result.text;
    item.cached = Boolean(result.cached);

    if (!translation.enabled) {
      item.finalText = item.promptText;
      item.translationApplied = false;
      item.status = 'success';
      this.ui.setSuggestions([...this.ui.suggestions]);
      return;
    }

    item.status = 'translating';
    item.sourceLanguage = translation.myLanguage;
    item.targetLanguage = translation.contactLanguage;
    item.translationAccountId = chat.accountId;
    item.translationChatId = chat.whatsappChatId;
    this.ui.setSuggestions([...this.ui.suggestions]);

    const translated = await sendRuntime('TRANSLATE_TEXT', {
      accountId: chat.accountId,
      chatId: chat.whatsappChatId,
      text: item.promptText,
      direction: 'outgoing',
      automatic: Boolean(item.automatic)
    });

    const currentTranslation = translationSettings(this.chatSettings);
    if (
      version !== this.generationVersion ||
      this.chat !== chat ||
      this.chatSettingsRevision !== revision ||
      this.dom.readDraft() !== draft ||
      !this.isChatAIEnabled() ||
      !currentTranslation.enabled ||
      currentTranslation.myLanguage !== translation.myLanguage ||
      currentTranslation.contactLanguage !== translation.contactLanguage
    ) {
      return;
    }

    if (!translated.ok || typeof translated.text !== 'string' || !translated.text.trim()) {
      item.status = 'error';
      item.finalText = '';
      item.translationApplied = false;
      item.error = translated.ok
        ? `Não foi possível traduzir a sugestão para ${LANGUAGES[translation.contactLanguage]}: a tradução retornou vazia.`
        : `Não foi possível traduzir a sugestão para ${LANGUAGES[translation.contactLanguage]}. ${this.userError(translated)}`;
      this.ui.setSuggestions([...this.ui.suggestions]);
      return;
    }

    item.finalText = translated.text;
    item.translationApplied = true;
    item.translationCached = Boolean(translated.cached);
    item.status = 'success';
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

  composerFailureMessage(result, action = 'concluir a operação') {
    const messages = {
      BRIDGE_UNAVAILABLE: 'O bridge do editor do WhatsApp não está disponível. Recarregue a extensão e a página.',
      BRIDGE_TIMEOUT: 'O editor do WhatsApp não respondeu a tempo. Recarregue a página e tente novamente.',
      COMPOSER_NOT_FOUND: 'Não foi possível localizar o campo de mensagem desta conversa.',
      CONVERSATION_NOT_FOUND: 'Não foi possível confirmar a conversa atual.',
      LEXICAL_MODULE_NOT_FOUND: 'O editor interno do WhatsApp mudou e não pôde ser carregado.',
      LEXICAL_EDITOR_NOT_FOUND: 'O editor interno desta caixa de mensagem não foi localizado.',
      CLEAR_FAILED: 'Não foi possível apagar com segurança o texto atual do WhatsApp.',
      CLEAR_VERIFY_FAILED: 'O WhatsApp não confirmou que o campo ficou vazio.',
      INSERT_FAILED: 'Não foi possível inserir a sugestão no editor interno do WhatsApp.',
      PASTE_DISPATCH_FAILED: 'O fallback de inserção do WhatsApp falhou.',
      TEXT_MISMATCH: 'O texto no campo do WhatsApp ficou diferente da sugestão. Nada foi enviado.',
      EDITOR_STATE_MISMATCH: 'O estado interno do editor ficou diferente do texto visível. Nada foi enviado.',
      CHAT_CHANGED: 'A conversa mudou durante a operação. Nada foi enviado.',
      CHAT_CHANGED_AFTER_CLICK: 'A conversa mudou antes de ser possível confirmar o envio.',
      SEND_BUTTON_NOT_FOUND: 'A sugestão foi aplicada, mas o botão real de enviar do WhatsApp não foi localizado.',
      SEND_CLICK_FAILED: 'Não foi possível clicar no botão de enviar do WhatsApp.',
      SEND_NOT_CONFIRMED: 'O botão foi acionado, mas o WhatsApp não confirmou o envio.',
      INVALID_TEXT: 'A sugestão não contém um texto válido para aplicar.',
      BRIDGE_EXCEPTION: 'Ocorreu uma falha interna ao controlar o editor do WhatsApp.'
    };
    return messages[result?.stage] || result?.message || ('Não foi possível ' + action + '.');
  }

  async prepareSuggestionAction(item) {
    if (!this.isChatAIEnabled() || this.applyingTranslation) return null;

    const chat = this.chat;
    const revision = this.chatSettingsRevision;
    if (!chat || item?.status !== 'success') return null;
    if (this.dom.readConversation && this.dom.readConversation()?.whatsappChatId !== chat.whatsappChatId) return null;

    const text = finalSuggestionTextForChat(item, this.chatSettings, chat);
    if (!text) {
      this.suggestionPreparationError = translationSettings(this.chatSettings).enabled
        ? 'A sugestão não possui uma tradução válida para o idioma atual do contato. Gere a sugestão novamente.'
        : 'A sugestão não possui uma mensagem final válida. Gere a sugestão novamente.';
      this.ui.setState({ sendStatus: this.suggestionPreparationError });
      return null;
    }

    return { text, chat, revision };
  }

  async translateDraftAndApply() {
    if (!this.isChatAIEnabled() || this.applyingTranslation || this.sendingSuggestion) return false;

    const text = this.dom.readDraft();
    if (!text.trim()) {
      this.ui.setState({ translationStatus: 'Digite uma mensagem no campo do WhatsApp para traduzir o rascunho. Para mensagens recebidas, use “Traduzir balões do contato”.' });
      return false;
    }

    const chat = this.chat;
    const revision = this.chatSettingsRevision;
    const translation = translationSettings(this.chatSettings);
    if (!translation.enabled) {
      this.ui.setState({ translationStatus: 'Ative o modo tradução nesta conversa.' });
      return false;
    }

    this.applyingTranslation = true;
    this.cancelDebounce();
    this.ui.setState({ applyingTranslation: true, translationStatus: `Traduzindo para ${LANGUAGES[translation.contactLanguage]}…` });

    try {
      const result = await sendRuntime('TRANSLATE_TEXT', {
        accountId: chat.accountId,
        chatId: chat.whatsappChatId,
        text,
        direction: 'outgoing',
        automatic: false
      });

      const currentTranslation = translationSettings(this.chatSettings);
      if (
        this.chat !== chat ||
        this.chatSettingsRevision !== revision ||
        !this.isChatAIEnabled() ||
        this.dom.readDraft() !== text ||
        !currentTranslation.enabled ||
        currentTranslation.myLanguage !== translation.myLanguage ||
        currentTranslation.contactLanguage !== translation.contactLanguage
      ) {
        this.ui.setState({ translationStatus: 'A conversa, o rascunho ou os idiomas mudaram durante a tradução. Tente novamente.' });
        return false;
      }

      if (!result.ok || typeof result.text !== 'string' || !result.text.trim()) {
        this.ui.setState({
          translationStatus: result.ok
            ? 'A tradução retornou um texto vazio.'
            : this.userError(result)
        });
        return false;
      }

      this.replacingDraft = true;
      let applied;
      try {
        applied = await this.composerBridge.replaceText(result.text, {
          chatId: chat.whatsappChatId
        });
      } finally {
        this.replacingDraft = false;
      }

      if (!applied?.ok) {
        this.ui.setState({ translationStatus: this.composerFailureMessage(applied, 'aplicar a tradução') });
        return false;
      }

      const actualDraft = this.dom.readDraft();
      if (normalizeComposerText(actualDraft) !== normalizeComposerText(result.text)) {
        this.ui.setState({ translationStatus: 'O WhatsApp não confirmou o texto traduzido no campo.' });
        return false;
      }

      this.currentDraft = actualDraft;
      this.suppressedDraft = actualDraft;
      this.draftVersion += 1;
      this.invalidateGenerations();
      this.cancelDebounce();
      this.ui.clearSuggestions();
      this.ui.setState({ translationStatus: 'Rascunho traduzido e aplicado.' });
      return true;
    } finally {
      this.applyingTranslation = false;
      this.ui.setState({ applyingTranslation: false });
    }
  }

  async useSuggestion(item) {
    if (this.sendingSuggestion || item?.status !== 'success') return false;
    this.suggestionPreparationError = '';
    const prepared = await this.prepareSuggestionAction(item);
    if (!prepared) return false;

    this.replacingDraft = true;
    let result;
    try {
      result = await this.composerBridge.replaceText(prepared.text, {
        chatId: prepared.chat.whatsappChatId
      });
    } finally {
      this.replacingDraft = false;
    }

    if (!result?.ok) {
      console.warn('[WAI] Falha ao aplicar sugestão no composer:', result);
      this.ui.setState({ sendStatus: this.composerFailureMessage(result, 'aplicar a sugestão') });
      return false;
    }

    if (
      this.chat !== prepared.chat ||
      this.chatSettingsRevision !== prepared.revision ||
      !this.isChatAIEnabled() ||
      (this.dom.readConversation && this.dom.readConversation()?.whatsappChatId !== prepared.chat.whatsappChatId)
    ) {
      return false;
    }

    const actualDraft = this.dom.readDraft();
    if (!normalizeComposerText(actualDraft) || normalizeComposerText(actualDraft) !== normalizeComposerText(prepared.text)) {
      this.ui.setState({ sendStatus: 'O WhatsApp não confirmou o texto exato da sugestão. Nada foi enviado.' });
      return false;
    }

    this.suppressedDraft = actualDraft;
    this.currentDraft = actualDraft;
    this.draftVersion += 1;
    this.invalidateGenerations();
    this.cancelDebounce();
    this.ui.clearSelection();
    this.ui.setState({ sendStatus: 'Sugestão aplicada no campo do WhatsApp.' });
    return true;
  }

  async applyAndSendSuggestion(item) {
    if (item?.status !== 'success' || !item?.finalText?.trim() || !this.isChatAIEnabled() || this.sendingSuggestion || this.applyingTranslation || item.sendRequested) return false;

    this.sendingSuggestion = true;
    this.suggestionPreparationError = '';
    this.cancelDebounce();
    this.ui.setState({ sendingSuggestion: true, sendStatus: 'Substituindo o texto e enviando pelo WhatsApp…' });

    try {
      const prepared = await this.prepareSuggestionAction(item);
      if (!prepared) {
        if (!this.suggestionPreparationError) {
          this.ui.setState({ sendStatus: 'Envio cancelado. A conversa ou o rascunho mudou durante a operação.' });
        }
        return false;
      }

      this.replacingDraft = true;
      let result;
      try {
        result = await this.composerBridge.replaceAndSend(prepared.text, {
          chatId: prepared.chat.whatsappChatId
        });
      } finally {
        this.replacingDraft = false;
      }

      if (!result?.ok) {
        console.warn('[WAI] Falha na transação de substituir e enviar:', result);

        const sendStageFailed = ['SEND_BUTTON_NOT_FOUND', 'SEND_CLICK_FAILED', 'SEND_NOT_CONFIRMED'].includes(result?.stage);
        const stillSameChat = this.chat === prepared.chat &&
          (!this.dom.readConversation || this.dom.readConversation()?.whatsappChatId === prepared.chat.whatsappChatId);
        const actualDraft = this.dom.readDraft();
        if (
          sendStageFailed &&
          stillSameChat &&
          normalizeComposerText(actualDraft) === normalizeComposerText(prepared.text)
        ) {
          this.currentDraft = actualDraft;
          this.suppressedDraft = actualDraft;
          this.lastAutoDraft = null;
          this.draftVersion += 1;
          this.invalidateGenerations();
          this.cancelDebounce();
        }

        this.ui.setState({ sendStatus: this.composerFailureMessage(result, 'substituir e enviar a sugestão') });
        return false;
      }

      item.sendRequested = true;
      this.currentDraft = this.dom.readDraft();
      this.suppressedDraft = null;
      this.lastAutoDraft = null;
      this.draftVersion += 1;
      this.invalidateGenerations();
      this.cancelDebounce();
      this.ui.clearSuggestions();
      this.ui.setState({ sendStatus: 'Mensagem enviada pelo WhatsApp.' });
      return true;
    } catch (error) {
      this.ui.setState({
        sendStatus: 'Não foi possível concluir o envio: ' + (error?.message || 'erro inesperado no editor do WhatsApp.')
      });
      return false;
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

  isSuggestedMessageRequestCurrent(generation, chat, revision, summaryVersion) {
    return generation === this.suggestedMessageGeneration &&
      this.chat === chat &&
      this.chatSettingsRevision === revision &&
      this.isChatAIEnabled() &&
      (this.summary?.summaryVersion || 0) === summaryVersion;
  }

  async generateSuggestedMessage(forceNew = false) {
    if (!this.isChatAIEnabled() || !this.chat || !this.account) return false;
    if (this.suggestedMessageSending) return false;
    if (!this.keyStatus?.configured) {
      await openOptions();
      return false;
    }
    if (this.settings?.aiPaused) {
      this.suggestedMessageStatus = 'A IA está pausada.';
      this.ui.setState({ suggestedMessageStatus: this.suggestedMessageStatus });
      return false;
    }
    if (!this.summary?.summary?.trim()) {
      this.suggestedMessageStatus = 'Esta conversa ainda não possui resumo. Gere um resumo antes de sugerir uma mensagem.';
      this.ui.setState({ suggestedMessageStatus: this.suggestedMessageStatus });
      return false;
    }

    this.chooseSuggestedMessagePrompt();
    const prompt = this.prompts.find(item => item.id === this.suggestedMessagePromptId && item.enabled);
    if (!prompt) {
      this.suggestedMessageStatus = 'Selecione um prompt habilitado para sugerir a mensagem.';
      this.ui.setState({ suggestedMessageStatus: this.suggestedMessageStatus });
      return false;
    }

    const chat = this.chat;
    const revision = this.chatSettingsRevision;
    const summaryVersion = this.summary.summaryVersion || 0;
    const generation = ++this.suggestedMessageGeneration;
    const translation = translationSettings(this.chatSettings);

    const item = {
      id: `suggest-message:${generation}`,
      accountId: chat.accountId,
      chatId: chat.whatsappChatId,
      promptId: prompt.id,
      promptName: prompt.name,
      summaryVersion,
      status: 'generating',
      promptText: '',
      finalText: '',
      translationApplied: false,
      translationCached: false,
      sourceLanguage: null,
      targetLanguage: null,
      translationAccountId: null,
      translationChatId: null,
      cached: false,
      error: '',
      forceNew: Boolean(forceNew),
      sendRequested: false
    };

    this.suggestedMessage = item;
    this.suggestedMessageStatus = '';
    this.ui.setState({
      suggestedMessage: item,
      suggestedMessagePromptId: this.suggestedMessagePromptId,
      suggestedMessageStatus: ''
    });

    const result = await sendRuntime('SUGGEST_MESSAGE_GENERATE', {
      accountId: chat.accountId,
      chatId: chat.whatsappChatId,
      promptId: prompt.id,
      forceNew: Boolean(forceNew)
    });

    if (!this.isSuggestedMessageRequestCurrent(generation, chat, revision, summaryVersion)) return false;

    if (!result.ok || typeof result.text !== 'string' || !result.text.trim()) {
      item.status = 'error';
      item.error = result.ok ? 'A IA retornou uma mensagem vazia.' : this.userError(result);
      this.ui.setState({ suggestedMessage: item });
      return false;
    }

    if ((Number(result.summaryVersion) || 0) !== summaryVersion) {
      item.status = 'error';
      item.error = 'O resumo mudou durante a geração. Gere a mensagem novamente usando o resumo atual.';
      this.ui.setState({ suggestedMessage: item });
      return false;
    }

    item.promptText = result.text;
    item.cached = Boolean(result.cached);
    item.summaryVersion = Number(result.summaryVersion) || summaryVersion;
    item.promptName = result.promptName || prompt.name;

    if (!translation.enabled) {
      item.finalText = item.promptText;
      item.translationApplied = false;
      item.status = 'success';
      this.ui.setState({ suggestedMessage: item });
      return true;
    }

    item.status = 'translating';
    item.sourceLanguage = translation.myLanguage;
    item.targetLanguage = translation.contactLanguage;
    item.translationAccountId = chat.accountId;
    item.translationChatId = chat.whatsappChatId;
    this.ui.setState({ suggestedMessage: item });

    const translated = await sendRuntime('TRANSLATE_TEXT', {
      accountId: chat.accountId,
      chatId: chat.whatsappChatId,
      text: item.promptText,
      direction: 'outgoing',
      automatic: false
    });

    const currentTranslation = translationSettings(this.chatSettings);
    if (
      !this.isSuggestedMessageRequestCurrent(generation, chat, revision, summaryVersion) ||
      !currentTranslation.enabled ||
      currentTranslation.myLanguage !== translation.myLanguage ||
      currentTranslation.contactLanguage !== translation.contactLanguage
    ) {
      return false;
    }

    if (!translated.ok || typeof translated.text !== 'string' || !translated.text.trim()) {
      item.status = 'error';
      item.finalText = '';
      item.translationApplied = false;
      item.error = translated.ok
        ? `Não foi possível traduzir a mensagem para ${LANGUAGES[translation.contactLanguage]}: a tradução retornou vazia.`
        : `Não foi possível traduzir a mensagem para ${LANGUAGES[translation.contactLanguage]}. ${this.userError(translated)}`;
      this.ui.setState({ suggestedMessage: item });
      return false;
    }

    item.finalText = translated.text;
    item.translationApplied = true;
    item.translationCached = Boolean(translated.cached);
    item.status = 'success';
    this.ui.setState({ suggestedMessage: item });
    return true;
  }

  retrySuggestedMessage() {
    return this.generateSuggestedMessage(false);
  }

  suggestedMessageFinalText() {
    return finalSuggestionTextForChat(this.suggestedMessage, this.chatSettings, this.chat);
  }

  async useSuggestedMessage() {
    const finalText = this.suggestedMessageFinalText();
    if (!finalText || this.suggestedMessageSending) return false;

    const current = this.dom.readDraft();
    if (
      current.trim() &&
      normalizeComposerText(current) !== normalizeComposerText(finalText) &&
      !confirm('Você já possui uma mensagem digitada. Substituí-la pela mensagem sugerida?')
    ) {
      return false;
    }

    const chat = this.chat;
    this.replacingDraft = true;
    let result;
    try {
      result = await this.composerBridge.replaceText(finalText, {
        chatId: chat.whatsappChatId
      });
    } finally {
      this.replacingDraft = false;
    }

    if (!result?.ok) {
      this.suggestedMessageStatus = this.composerFailureMessage(result, 'aplicar a mensagem sugerida');
      this.ui.setState({ suggestedMessageStatus: this.suggestedMessageStatus });
      return false;
    }

    if (this.chat !== chat || !this.isChatAIEnabled()) return false;
    const actualDraft = this.dom.readDraft();
    if (normalizeComposerText(actualDraft) !== normalizeComposerText(finalText)) {
      this.suggestedMessageStatus = 'O WhatsApp não confirmou o texto exato da mensagem sugerida.';
      this.ui.setState({ suggestedMessageStatus: this.suggestedMessageStatus });
      return false;
    }

    this.currentDraft = actualDraft;
    this.suppressedDraft = actualDraft;
    this.draftVersion += 1;
    this.invalidateGenerations();
    this.cancelDebounce();
    this.ui.clearSuggestions();
    this.suggestedMessageStatus = 'Mensagem sugerida aplicada no campo do WhatsApp.';
    this.ui.setState({ suggestedMessageStatus: this.suggestedMessageStatus });
    return true;
  }

  async sendSuggestedMessage() {
    const item = this.suggestedMessage;
    const finalText = this.suggestedMessageFinalText();
    if (!item || !finalText || this.suggestedMessageSending || item.sendRequested) return false;

    const chat = this.chat;
    this.suggestedMessageSending = true;
    this.suggestedMessageStatus = 'Substituindo o texto e enviando pelo WhatsApp…';
    this.ui.setState({
      suggestedMessageSending: true,
      suggestedMessageStatus: this.suggestedMessageStatus
    });

    try {
      let result;
      this.replacingDraft = true;
      try {
        result = await this.composerBridge.replaceAndSend(finalText, {
          chatId: chat.whatsappChatId
        });
      } finally {
        this.replacingDraft = false;
      }

      if (!result?.ok) {
        const sendStageFailed = ['SEND_BUTTON_NOT_FOUND', 'SEND_CLICK_FAILED', 'SEND_NOT_CONFIRMED'].includes(result?.stage);
        const actualDraft = this.dom.readDraft();
        if (
          sendStageFailed &&
          this.chat === chat &&
          normalizeComposerText(actualDraft) === normalizeComposerText(finalText)
        ) {
          this.currentDraft = actualDraft;
          this.suppressedDraft = actualDraft;
          this.draftVersion += 1;
          this.invalidateGenerations();
          this.cancelDebounce();
        }
        this.suggestedMessageStatus = this.composerFailureMessage(result, 'enviar a mensagem sugerida');
        this.ui.setState({ suggestedMessageStatus: this.suggestedMessageStatus });
        return false;
      }

      item.sendRequested = true;
      this.currentDraft = this.dom.readDraft();
      this.suppressedDraft = null;
      this.lastAutoDraft = null;
      this.draftVersion += 1;
      this.invalidateGenerations();
      this.cancelDebounce();
      this.ui.clearSuggestions();
      this.suggestedMessageGeneration += 1;
      this.suggestedMessage = null;
      this.suggestedMessageStatus = 'Mensagem sugerida enviada pelo WhatsApp.';
      this.ui.setState({
        suggestedMessage: null,
        suggestedMessageStatus: this.suggestedMessageStatus
      });
      return true;
    } finally {
      this.suggestedMessageSending = false;
      this.ui.setState({ suggestedMessageSending: false });
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
        const oldSummaryVersion = this.summary?.summaryVersion || 0;
        this.summary = context.summary;
        this.chatSettings = context.chatSettings;
        if ((this.summary?.summaryVersion || 0) !== oldSummaryVersion) this.clearSuggestedMessage('');
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
    this.clearSuggestedMessage('');
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
    this.clearSuggestedMessage('');
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

  async loadPromptsForChat(chat) {
    if (!chat?.accountId || !chat?.whatsappChatId) return false;
    const result = await sendRuntime('PROMPT_LIST_FOR_CHAT', {
      accountId: chat.accountId,
      chatId: chat.whatsappChatId
    });
    if (!result.ok || this.chat !== chat) return false;

    this.prompts = result.prompts || [];
    this.lastAutoDraft = null;
    this.chooseSuggestedMessagePrompt();
    this.ui?.setState({
      prompts: this.prompts,
      suggestedMessagePromptId: this.suggestedMessagePromptId
    });
    return true;
  }

  async savePrompt(prompt) {
    const scope = prompt?.scope === PROMPT_SCOPE.CHAT ? PROMPT_SCOPE.CHAT : PROMPT_SCOPE.GLOBAL;
    const prepared = {
      ...prompt,
      scope
    };

    if (scope === PROMPT_SCOPE.CHAT) {
      if (!this.chat || !this.account) {
        alert('Abra a conversa à qual este prompt deve pertencer.');
        return false;
      }

      if (
        prompt?.id &&
        (prompt.accountId !== this.chat.accountId || prompt.chatId !== this.chat.whatsappChatId)
      ) {
        alert('Este prompt pertence a outra conversa e não pode ser alterado aqui.');
        return false;
      }

      prepared.accountId = this.chat.accountId;
      prepared.chatId = this.chat.whatsappChatId;
      prepared.chatDisplayName = this.chat.displayName || '';
    } else {
      prepared.accountId = null;
      prepared.chatId = null;
      prepared.chatDisplayName = null;
    }

    if (prepared.autoRun && prepared.enabled) {
      const otherAutomatic = this.prompts.filter(p => p.id !== prepared.id && p.enabled && p.autoRun).length;
      const total = otherAutomatic + 1;
      if (total > (this.settings.maxAutomaticPrompts || 3)) {
        const ok = confirm(`Você terá ${total} prompts automáticos disponíveis nesta conversa. Pela configuração atual, somente os primeiros ${this.settings.maxAutomaticPrompts || 3} serão executados em cada ciclo. Prompts específicos desta conversa têm prioridade. Salvar mesmo assim?`);
        if (!ok) return false;
      }
    }

    const result = await sendRuntime('PROMPT_SAVE', { prompt: prepared });
    if (!result.ok) {
      alert(result.message || 'Não foi possível salvar o prompt.');
      return false;
    }
    await this.reloadPrompts();
    const all = await sendRuntime('PROMPT_LIST');
    if (all.ok) this.allPrompts = all.prompts || this.allPrompts;
    return true;
  }

  async duplicatePromptToCurrentChat(prompt) {
    if (!this.chat || !prompt) return false;
    const clone = {
      ...prompt,
      id: undefined,
      scope: PROMPT_SCOPE.CHAT,
      accountId: this.chat.accountId,
      chatId: this.chat.whatsappChatId,
      chatDisplayName: this.chat.displayName || '',
      createdAt: undefined,
      updatedAt: undefined
    };
    return this.savePrompt(clone);
  }

  async deletePrompt(prompt) {
    const result = await sendRuntime('PROMPT_DELETE', {
      id: prompt.id,
      accountId: this.chat?.accountId || null,
      chatId: this.chat?.whatsappChatId || null
    });
    if (!result.ok) {
      alert(result.message || 'Não foi possível excluir o prompt.');
      return false;
    }
    await this.reloadPrompts();
    const all = await sendRuntime('PROMPT_LIST');
    if (all.ok) this.allPrompts = all.prompts || this.allPrompts;
    return true;
  }

  async reloadPrompts(triggerDraft = true) {
    let result;
    if (this.chat?.accountId && this.chat?.whatsappChatId) {
      result = await sendRuntime('PROMPT_LIST_FOR_CHAT', {
        accountId: this.chat.accountId,
        chatId: this.chat.whatsappChatId
      });
    } else {
      result = await sendRuntime('PROMPT_LIST');
      if (result.ok) {
        this.allPrompts = result.prompts || [];
        result.prompts = this.allPrompts.filter(prompt =>
          (prompt.scope || PROMPT_SCOPE.GLOBAL) === PROMPT_SCOPE.GLOBAL
        );
      }
    }

    if (!result.ok) return false;

    this.prompts = result.prompts || [];
    this.lastAutoDraft = null;
    this.chooseSuggestedMessagePrompt();
    this.ui?.setState({
      prompts: this.prompts,
      suggestedMessagePromptId: this.suggestedMessagePromptId
    });
    if (triggerDraft) this.onDraftChanged();
    return true;
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

    if ((event.code === 'Space' || event.key === ' ') && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      const draft = this.dom.readDraft();
      if (this.canRequestSuggestions(draft)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) this.runAutomaticPrompts(draft, true);
      }
      return;
    }

    if (event.key === 'Enter' && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      const selected = this.ui.getSelectedSuggestion() || this.ui.suggestions.find(item => item.status === 'success' && item.finalText);
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
