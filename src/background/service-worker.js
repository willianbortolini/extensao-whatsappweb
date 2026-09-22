import { CONFIG, DEFAULT_SETTINGS } from '../config.js';
import {
  ensureDefaults,
  listPrompts,
  getPrompt,
  savePrompt,
  deletePrompt,
  upsertAccount,
  upsertChat,
  upsertMessages,
  getRecentMessages,
  getMessagesForSummary,
  getSummary,
  saveSummary,
  bumpSummaryMessageCount,
  getChatSettings,
  saveChatSettings,
  addUsage,
  getUsageStats,
  getCache,
  putCache,
  cleanup,
  clearData
} from '../storage/database.js';
import { buildSuggestionInput, buildSummaryInput, normalizePromptInput } from '../ai/context-builder.js';
import { suggestionCacheId } from '../ai/suggestion-cache.js';
import { buildTranslationInput, translationSettings, localizeSuggestion } from '../ai/translation.js';
import { getTranslation, saveTranslation } from '../storage/database.js';

const STORAGE_SETTINGS = 'wai_settings';
const STORAGE_API_KEY = 'wai_api_key';
const STORAGE_KEY_MODE = 'wai_key_mode';
const STORAGE_INSTALLATION = 'wai_installation_id';
const STORAGE_LAST_CLEANUP = 'wai_last_cleanup';

const queue = [];
let activeRequests = 0;
const recentRequestTimes = [];

function safeError(error, fallback = 'UNKNOWN_ERROR') {
  return {
    ok: false,
    error: error?.code || fallback,
    message: error?.message || String(error || fallback)
  };
}

async function restrictStorageAccess() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {}
  try {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {}
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(data[STORAGE_SETTINGS] || {}) };
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = sanitizeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [STORAGE_SETTINGS]: next });
  return next;
}

function sanitizeSettings(settings) {
  return {
    sidebarOpen: settings.sidebarOpen !== false,
    aiPaused: Boolean(settings.aiPaused),
    automaticSuggestions: settings.automaticSuggestions !== false,
    debounceMs: CONFIG.defaultDebounceMs,
    model: String(settings.model || CONFIG.defaultModel).slice(0, 100),
    maxAutomaticPrompts: Math.max(1, Math.min(20, Number(settings.maxAutomaticPrompts) || 3)),
    defaultSummaryEnabled: settings.defaultSummaryEnabled !== false,
    defaultSummaryMode: ['manual', 'automatic', 'disabled'].includes(settings.defaultSummaryMode) ? settings.defaultSummaryMode : 'manual',
    defaultSummaryEvery: Math.max(2, Math.min(50, Number(settings.defaultSummaryEvery) || 2)),
    saveHistory: settings.saveHistory !== false,
    retentionDays: Math.max(0, Math.min(3650, Number(settings.retentionDays) || 90)),
    dailyTokenLimit: Math.max(0, Number(settings.dailyTokenLimit) || 0),
    dailyAutomaticRequestLimit: Math.max(0, Number(settings.dailyAutomaticRequestLimit) || 0),
    blockAutomaticAtLimit: settings.blockAutomaticAtLimit !== false
  };
}

async function getInstallationId() {
  const data = await chrome.storage.local.get(STORAGE_INSTALLATION);
  if (data[STORAGE_INSTALLATION]) return data[STORAGE_INSTALLATION];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [STORAGE_INSTALLATION]: id });
  return id;
}

async function setApiKey(apiKey, mode = 'session') {
  const clean = String(apiKey || '').trim();
  if (!clean) throw Object.assign(new Error('Informe uma API key.'), { code: 'INVALID_KEY' });

  if (mode === 'local') {
    await chrome.storage.local.set({ [STORAGE_API_KEY]: clean, [STORAGE_KEY_MODE]: 'local' });
    await chrome.storage.session.remove(STORAGE_API_KEY);
  } else {
    await chrome.storage.session.set({ [STORAGE_API_KEY]: clean });
    await chrome.storage.local.remove(STORAGE_API_KEY);
    await chrome.storage.local.set({ [STORAGE_KEY_MODE]: 'session' });
  }
}

async function removeApiKey() {
  await Promise.all([
    chrome.storage.local.remove(STORAGE_API_KEY),
    chrome.storage.session.remove(STORAGE_API_KEY)
  ]);
}

async function getApiKey() {
  const local = await chrome.storage.local.get([STORAGE_API_KEY, STORAGE_KEY_MODE]);
  const mode = local[STORAGE_KEY_MODE] || 'session';

  if (mode === 'local' && local[STORAGE_API_KEY]) {
    return { key: local[STORAGE_API_KEY], mode };
  }

  const session = await chrome.storage.session.get(STORAGE_API_KEY);
  return { key: session[STORAGE_API_KEY] || '', mode };
}

async function getKeyStatus() {
  const { key, mode } = await getApiKey();
  if (!key) return { configured: false, mode, masked: '' };
  return {
    configured: true,
    mode,
    masked: `${key.slice(0, Math.min(7, key.length))}${'•'.repeat(12)}${key.slice(-4)}`
  };
}

function validateSender(sender) {
  const extensionOrigin = chrome.runtime.getURL('');
  if (sender?.url?.startsWith(extensionOrigin)) return true;
  const tabUrl = sender?.tab?.url || '';
  return tabUrl.startsWith('https://web.whatsapp.com/');
}

function assertSize(value, max, field) {
  if (String(value ?? '').length > max) {
    throw Object.assign(new Error(`${field} excede o tamanho permitido.`), { code: 'PAYLOAD_TOO_LARGE' });
  }
}

function pruneRateWindow(now = Date.now()) {
  while (recentRequestTimes.length && recentRequestTimes[0] <= now - 60000) recentRequestTimes.shift();
}

function enforceHardRateLimit() {
  const now = Date.now();
  pruneRateWindow(now);
  if (recentRequestTimes.length >= CONFIG.hardRateLimitPerMinute) {
    throw Object.assign(new Error('Muitas chamadas de IA em pouco tempo. Aguarde antes de tentar novamente.'), { code: 'LOCAL_RATE_LIMIT' });
  }
  recentRequestTimes.push(now);
}

async function enforceBudget({ automatic }) {
  if (!automatic) return;
  const settings = await getSettings();
  if (!settings.blockAutomaticAtLimit) return;
  const stats = await getUsageStats();

  if (settings.dailyTokenLimit > 0 && stats.today.totalTokens >= settings.dailyTokenLimit) {
    throw Object.assign(new Error('Limite diário local de tokens atingido. As chamadas automáticas foram pausadas.'), { code: 'DAILY_TOKEN_LIMIT' });
  }

  if (settings.dailyAutomaticRequestLimit > 0 && stats.today.automaticRequests >= settings.dailyAutomaticRequestLimit) {
    throw Object.assign(new Error('Limite diário de chamadas automáticas atingido.'), { code: 'DAILY_REQUEST_LIMIT' });
  }
}

function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    drainQueue();
  });
}

function drainQueue() {
  while (activeRequests < CONFIG.maxConcurrentRequests && queue.length) {
    const item = queue.shift();
    activeRequests += 1;
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        activeRequests -= 1;
        drainQueue();
      });
  }
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  const parts = [];
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

async function assertChatAIEnabled(accountId, chatId) {
  if (!accountId || !chatId || (await getChatSettings(accountId, chatId))?.aiEnabled !== true) {
    throw Object.assign(new Error('IA desativada para esta conversa.'), { code: 'CHAT_AI_DISABLED' });
  }
}

async function callOpenAI({ instructions, input, model, maxOutputTokens, operation, accountId = null, chatId = null, promptId = null, automatic = false, translation = null }) {
  assertSize(instructions, 24000, 'instructions');
  assertSize(input, 90000, 'input');

  await enforceBudget({ automatic });
  enforceHardRateLimit();

  const { key } = await getApiKey();
  if (!key) throw Object.assign(new Error('Configure sua API key da OpenAI.'), { code: 'API_KEY_REQUIRED' });

  return enqueue(async () => {
    // Recheck after waiting in the queue, immediately before starting the request.
    if (operation !== 'key-test') await assertChatAIEnabled(accountId, chatId);
    if (translation) {
      const current = translationSettings(await getChatSettings(accountId, chatId));
      if (!current.enabled || current.myLanguage !== translation.myLanguage || current.contactLanguage !== translation.contactLanguage) {
        throw Object.assign(new Error('As configurações de tradução mudaram. Tente novamente.'), { code: 'TRANSLATION_CHANGED' });
      }
      const settings = await getSettings();
      if (settings.aiPaused) throw Object.assign(new Error('A IA está pausada.'), { code: 'AI_PAUSED' });
      await enforceBudget({ automatic });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || CONFIG.defaultModel,
          instructions,
          input,
          max_output_tokens: Math.max(16, Math.min(2000, Number(maxOutputTokens) || 150)),
          store: false
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw Object.assign(new Error('A chamada à IA excedeu o tempo limite.'), { code: 'OPENAI_TIMEOUT' });
      }
      throw Object.assign(new Error('Falha de rede ao acessar a OpenAI.'), { code: 'OPENAI_NETWORK' });
    } finally {
      clearTimeout(timeout);
    }

    let data = null;
    try {
      data = await response.json();
    } catch {}

    if (!response.ok) {
      const message = data?.error?.message || `OpenAI respondeu HTTP ${response.status}.`;
      let code = 'OPENAI_ERROR';
      if (response.status === 401) code = 'OPENAI_UNAUTHORIZED';
      else if (response.status === 429) code = 'OPENAI_RATE_LIMIT';
      else if (response.status === 400) code = 'OPENAI_BAD_REQUEST';
      throw Object.assign(new Error(message), { code, status: response.status });
    }

    const text = extractOutputText(data);
    if (translation && data?.status === 'incomplete') {
      // Still record usage below, but never store/apply a partial translation.
      data.translationIncomplete = true;
    }
    if (!text) throw Object.assign(new Error('A OpenAI retornou uma resposta vazia.'), { code: 'OPENAI_EMPTY' });

    const usage = data?.usage || {};
    await addUsage({
      operation,
      model: data?.model || model || CONFIG.defaultModel,
      chatId,
      promptId,
      automatic,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      totalTokens: usage.total_tokens || ((usage.input_tokens || 0) + (usage.output_tokens || 0)),
      timestamp: Date.now()
    });

    if (data.translationIncomplete) throw Object.assign(new Error('Tradução incompleta. Divida o texto em mensagens menores.'), { code: 'TRANSLATION_INCOMPLETE' });
    return {
      text,
      usage: {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        totalTokens: usage.total_tokens || ((usage.input_tokens || 0) + (usage.output_tokens || 0))
      },
      model: data?.model || model || CONFIG.defaultModel
    };
  });
}

async function generateSummary({ accountId, chatId, automatic = false, forceRebuild = false }) {
  await assertChatAIEnabled(accountId, chatId);
  assertSize(accountId, 500, 'accountId');
  assertSize(chatId, 500, 'chatId');

  const settings = await getSettings();
  const existing = forceRebuild ? null : await getSummary(accountId, chatId);
  const after = existing?.lastSummarizedCapturedAt || 0;
  const messages = await getMessagesForSummary(accountId, chatId, forceRebuild ? 0 : after, forceRebuild ? 120 : 80);

  if (!messages.length) {
    return {
      summary: existing?.summary || '',
      unchanged: true,
      record: existing
    };
  }

  const built = buildSummaryInput({
    currentSummary: forceRebuild ? '' : existing?.summary,
    newMessages: messages
  });

  const result = await callOpenAI({
    ...built,
    model: settings.model,
    maxOutputTokens: CONFIG.summaryOutputTokens,
    operation: automatic ? 'summary-auto' : (forceRebuild ? 'summary-rebuild' : 'summary-manual'),
    accountId,
    chatId,
    automatic
  });

  const last = messages[messages.length - 1];
  const record = await saveSummary(accountId, chatId, {
    summary: result.text,
    lastSummarizedMessageId: last.id,
    lastSummarizedAt: Date.now(),
    lastSummarizedCapturedAt: last.capturedAt || Date.now(),
    messagesSinceSummary: 0,
    manuallyEdited: false
  });

  return { summary: result.text, usage: result.usage, record };
}

async function generateSuggestion(payload) {
  const { accountId, chatId, promptId, draft, contactName, automatic = false } = payload;
  await assertChatAIEnabled(accountId, chatId);
  assertSize(accountId, 500, 'accountId');
  assertSize(chatId, 500, 'chatId');
  assertSize(promptId, 500, 'promptId');
  assertSize(draft, CONFIG.maxDraftChars, 'draft');

  const prompt = await getPrompt(promptId);
  if (!prompt || !prompt.enabled) {
    throw Object.assign(new Error('Prompt não encontrado ou desabilitado.'), { code: 'PROMPT_UNAVAILABLE' });
  }

  let summary = prompt.includeSummary ? await getSummary(accountId, chatId) : null;
  if (prompt.includeSummary && !summary?.summary && prompt.generateSummaryIfMissing) {
    await generateSummary({ accountId, chatId, automatic });
    summary = await getSummary(accountId, chatId);
  }

  const recentMessages = prompt.includeRecentMessages
    ? await getRecentMessages(accountId, chatId, Math.max(1, Math.min(CONFIG.maxRecentMessages, prompt.recentMessagesCount || CONFIG.defaultRecentMessages)))
    : [];

  const built = localizeSuggestion(buildSuggestionInput({
    prompt,
    draft,
    summary: summary?.summary || '',
    recentMessages,
    contactName
  }), await getChatSettings(accountId, chatId));

  const settings = await getSettings();
  const maxOutputTokens = prompt.maxOutputTokens || CONFIG.suggestionOutputTokens;
  const cacheId = await suggestionCacheId({
    accountId, chatId, promptId, model: settings.model, ...built, maxOutputTokens
  });
  const cached = await getCache(cacheId);
  if (cached) {
    return {
      text: cached.text,
      cached: true,
      model: cached.model,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    };
  }

  const result = await callOpenAI({
    ...built,
    model: settings.model,
    maxOutputTokens,
    operation: 'suggestion',
    accountId,
    chatId,
    promptId,
    automatic
  });

  await putCache({
    id: cacheId,
    text: result.text,
    model: result.model,
    createdAt: Date.now(),
    expiresAt: Date.now() + CONFIG.cacheTtlMs
  });

  return { ...result, cached: false };
}

const translationJobs = new Map();

async function translateText({ accountId, chatId, text, direction, messageId = null, automatic = null }) {
  await assertChatAIEnabled(accountId, chatId);
  const translation = translationSettings(await getChatSettings(accountId, chatId));
  if (!translation.enabled) throw Object.assign(new Error('Ative o modo tradução nesta conversa.'), { code: 'TRANSLATION_DISABLED' });
  if (!['incoming', 'outgoing'].includes(direction) || typeof text !== 'string' || !text.trim()) {
    throw new Error('Texto ou direção de tradução inválidos.');
  }
  assertSize(text, CONFIG.maxDraftChars, 'text');
  const sourceLanguage = direction === 'incoming' ? translation.contactLanguage : translation.myLanguage;
  const targetLanguage = direction === 'incoming' ? translation.myLanguage : translation.contactLanguage;
  const settings = await getSettings();
  if (settings.aiPaused) throw Object.assign(new Error('A IA está pausada.'), { code: 'AI_PAUSED' });
  const built = buildTranslationInput(text, sourceLanguage, targetLanguage);
  const id = await suggestionCacheId({ accountId, chatId, promptId: `translation:${direction}:${messageId || ''}`, model: settings.model, ...built, maxOutputTokens: 2000 });
  const cached = settings.saveHistory ? await getTranslation(id) : null;
  if (cached) return { text: cached.translatedText, cached: true };
  if (translationJobs.has(id)) return translationJobs.get(id);
  const job = (async () => {
    const result = sourceLanguage === targetLanguage ? { text, cached: true } : await callOpenAI({
      ...built, model: settings.model, maxOutputTokens: 2000,
      operation: `translation-${direction}`, accountId, chatId,
      automatic: automatic == null ? direction === 'incoming' : Boolean(automatic), translation
    });
    // Keep both versions. An applied draft is not recorded as a sent message.
    const current = translationSettings(await getChatSettings(accountId, chatId));
    await assertChatAIEnabled(accountId, chatId);
    if (!current.enabled || current.myLanguage !== translation.myLanguage || current.contactLanguage !== translation.contactLanguage) {
      throw Object.assign(new Error('As configurações de tradução mudaram.'), { code: 'TRANSLATION_CHANGED' });
    }
    if ((await getSettings()).saveHistory) await saveTranslation({
      id, accountId, chatId, messageId, direction, originalText: text,
      translatedText: result.text, sourceLanguage, targetLanguage,
      model: settings.model, createdAt: Date.now()
    });
    return result;
  })();
  translationJobs.set(id, job);
  try { return await job; } finally { translationJobs.delete(id); }
}

async function maybeCleanup() {
  const settings = await getSettings();
  const local = await chrome.storage.local.get(STORAGE_LAST_CLEANUP);
  const last = Number(local[STORAGE_LAST_CLEANUP]) || 0;
  if (Date.now() - last < 86400000) return;
  await cleanup(settings.retentionDays);
  await chrome.storage.local.set({ [STORAGE_LAST_CLEANUP]: Date.now() });
}

async function init() {
  await restrictStorageAccess();
  await ensureDefaults();
  await getInstallationId();
  await maybeCleanup();
}

chrome.runtime.onInstalled.addListener(() => { init().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { init().catch(() => {}); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!validateSender(sender)) {
    sendResponse({ ok: false, error: 'INVALID_SENDER', message: 'Origem da mensagem não autorizada.' });
    return false;
  }

  const requestId = message?.requestId || null;
  const type = message?.type;
  const payload = message?.payload || {};

  Promise.resolve().then(async () => {
    await init();

    switch (type) {
      case 'INIT': {
        return {
          installationId: await getInstallationId(),
          settings: await getSettings(),
          keyStatus: await getKeyStatus(),
          prompts: await listPrompts()
        };
      }

      case 'OPEN_OPTIONS':
        await chrome.runtime.openOptionsPage();
        return { opened: true };

      case 'SETTINGS_GET':
        return { settings: await getSettings(), keyStatus: await getKeyStatus() };

      case 'SETTINGS_UPDATE':
        return { settings: await saveSettings(payload || {}) };

      case 'API_KEY_SET':
        await setApiKey(payload.apiKey, payload.mode);
        return { keyStatus: await getKeyStatus() };

      case 'API_KEY_REMOVE':
        await removeApiKey();
        return { keyStatus: await getKeyStatus() };

      case 'API_KEY_TEST': {
        if (payload.apiKey) await setApiKey(payload.apiKey, payload.mode || 'session');
        const settings = await getSettings();
        const result = await callOpenAI({
          instructions: 'Teste de conexão. Responda apenas OK.',
          input: 'OK',
          model: settings.model,
          maxOutputTokens: 16,
          operation: 'key-test',
          automatic: false
        });
        return { keyStatus: await getKeyStatus(), result: result.text };
      }

      case 'PROMPT_LIST':
        return { prompts: await listPrompts() };

      case 'PROMPT_SAVE': {
        const normalized = normalizePromptInput(payload.prompt);
        if (!normalized.name || !normalized.instructions) throw Object.assign(new Error('Nome e instruções são obrigatórios.'), { code: 'INVALID_PROMPT' });
        return { prompt: await savePrompt(normalized) };
      }

      case 'PROMPT_DELETE':
        await deletePrompt(String(payload.id || ''));
        return { deleted: true };

      case 'ACCOUNT_UPSERT':
        await upsertAccount(payload.account);
        return { saved: true };

      case 'CHAT_UPSERT':
        return { chat: await upsertChat(payload.chat) };

      case 'MESSAGES_UPSERT': {
        const settings = await getSettings();
        if (!settings.saveHistory) return { inserted: 0, autoSummaryDue: false };
        const messages = Array.isArray(payload.messages) ? payload.messages.slice(0, 500) : [];
        const inserted = await upsertMessages(payload.accountId, payload.chatId, messages);
        const summaryState = await bumpSummaryMessageCount(payload.accountId, payload.chatId, inserted);
        const chatSettings = await getChatSettings(payload.accountId, payload.chatId);
        const enabled = chatSettings?.summaryEnabled ?? settings.defaultSummaryEnabled;
        const mode = chatSettings?.summaryMode || settings.defaultSummaryMode;
        const every = Math.max(2, Number(chatSettings?.summaryEvery || settings.defaultSummaryEvery));
        return {
          inserted,
          autoSummaryDue: Boolean(chatSettings?.aiEnabled === true && inserted && enabled && mode === 'automatic' && (summaryState?.messagesSinceSummary || 0) >= every)
        };
      }

      case 'CHAT_CONTEXT_GET': {
        const count = Math.max(1, Math.min(CONFIG.maxRecentMessages, Number(payload.recentCount) || CONFIG.defaultRecentMessages));
        return {
          summary: await getSummary(payload.accountId, payload.chatId),
          recentMessages: await getRecentMessages(payload.accountId, payload.chatId, count),
          chatSettings: await getChatSettings(payload.accountId, payload.chatId)
        };
      }

      case 'CHAT_SETTINGS_UPDATE':
        return { chatSettings: await saveChatSettings(payload.accountId, payload.chatId, payload.patch || {}) };

      case 'SUMMARY_GENERATE':
        return await generateSummary({
          accountId: payload.accountId,
          chatId: payload.chatId,
          automatic: Boolean(payload.automatic),
          forceRebuild: Boolean(payload.forceRebuild)
        });

      case 'SUMMARY_EDIT': {
        assertSize(payload.summary, CONFIG.maxSummaryChars, 'summary');
        const old = await getSummary(payload.accountId, payload.chatId);
        return {
          record: await saveSummary(payload.accountId, payload.chatId, {
            summary: String(payload.summary || '').trim(),
            lastSummarizedMessageId: old?.lastSummarizedMessageId || null,
            lastSummarizedAt: old?.lastSummarizedAt || Date.now(),
            lastSummarizedCapturedAt: old?.lastSummarizedCapturedAt || Date.now(),
            messagesSinceSummary: old?.messagesSinceSummary || 0,
            manuallyEdited: true
          })
        };
      }

      case 'SUGGEST_GENERATE':
        return await generateSuggestion(payload);

      case 'TRANSLATE_TEXT':
        return await translateText(payload);

      case 'USAGE_STATS':
        return { stats: await getUsageStats() };

      case 'DATA_CLEAR':
        await clearData(payload.kind, payload.accountId || null, payload.chatId || null);
        if (payload.kind === 'all') {
          await removeApiKey();
          await chrome.storage.local.remove([STORAGE_SETTINGS, STORAGE_KEY_MODE, STORAGE_LAST_CLEANUP, STORAGE_INSTALLATION]);
          await getInstallationId();
        }
        return { cleared: true };

      default:
        throw Object.assign(new Error('Operação desconhecida.'), { code: 'UNKNOWN_OPERATION' });
    }
  }).then(data => {
    sendResponse({ ok: true, requestId, ...data });
  }).catch(error => {
    sendResponse({ requestId, ...safeError(error) });
  });

  return true;
});

init().catch(() => {});
