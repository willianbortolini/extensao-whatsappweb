import { DEFAULT_PROMPTS } from '../config.js';

const DB_NAME = 'whatsapp_ai_assistant';
const DB_VERSION = 1;

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
  });
}

export function chatKey(accountId, chatId) {
  return `${accountId}::${chatId}`;
}

export async function openDatabase() {
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;

    if (!db.objectStoreNames.contains('accounts')) {
      const store = db.createObjectStore('accounts', { keyPath: 'id' });
      store.createIndex('lastSeenAt', 'lastSeenAt');
    }

    if (!db.objectStoreNames.contains('chats')) {
      const store = db.createObjectStore('chats', { keyPath: 'id' });
      store.createIndex('accountId', 'accountId');
      store.createIndex('lastMessageAt', 'lastMessageAt');
    }

    if (!db.objectStoreNames.contains('messages')) {
      const store = db.createObjectStore('messages', { keyPath: 'id' });
      store.createIndex('chatKey', 'chatKey');
      store.createIndex('capturedAt', 'capturedAt');
      store.createIndex('chatCaptured', ['chatKey', 'capturedAt']);
    }

    if (!db.objectStoreNames.contains('summaries')) {
      db.createObjectStore('summaries', { keyPath: 'id' });
    }

    if (!db.objectStoreNames.contains('chat_settings')) {
      db.createObjectStore('chat_settings', { keyPath: 'id' });
    }

    if (!db.objectStoreNames.contains('prompts')) {
      const store = db.createObjectStore('prompts', { keyPath: 'id' });
      store.createIndex('order', 'order');
    }

    if (!db.objectStoreNames.contains('usage')) {
      const store = db.createObjectStore('usage', { keyPath: 'id', autoIncrement: true });
      store.createIndex('timestamp', 'timestamp');
      store.createIndex('operation', 'operation');
    }

    if (!db.objectStoreNames.contains('suggestion_cache')) {
      const store = db.createObjectStore('suggestion_cache', { keyPath: 'id' });
      store.createIndex('expiresAt', 'expiresAt');
    }

    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta', { keyPath: 'key' });
    }
  };

  return requestPromise(request);
}

export async function ensureDefaults() {
  const db = await openDatabase();
  const tx = db.transaction('prompts', 'readwrite');
  const store = tx.objectStore('prompts');
  const count = await requestPromise(store.count());

  if (!count) {
    const now = Date.now();
    for (const prompt of DEFAULT_PROMPTS) {
      store.put({ ...prompt, createdAt: now, updatedAt: now });
    }
  }

  await txDone(tx);
}

export async function listPrompts() {
  const db = await openDatabase();
  const tx = db.transaction('prompts', 'readonly');
  const values = await requestPromise(tx.objectStore('prompts').getAll());
  await txDone(tx);
  return values.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
}

export async function getPrompt(id) {
  const db = await openDatabase();
  const tx = db.transaction('prompts', 'readonly');
  const value = await requestPromise(tx.objectStore('prompts').get(id));
  await txDone(tx);
  return value || null;
}

export async function savePrompt(prompt) {
  const db = await openDatabase();
  const tx = db.transaction('prompts', 'readwrite');
  const store = tx.objectStore('prompts');
  const existing = prompt.id ? await requestPromise(store.get(prompt.id)) : null;
  const now = Date.now();
  const value = {
    id: prompt.id || crypto.randomUUID(),
    name: String(prompt.name || '').trim(),
    instructions: String(prompt.instructions || '').trim(),
    enabled: prompt.enabled !== false,
    autoRun: Boolean(prompt.autoRun),
    order: Number.isFinite(Number(prompt.order)) ? Number(prompt.order) : 999,
    includeSummary: Boolean(prompt.includeSummary),
    includeRecentMessages: Boolean(prompt.includeRecentMessages),
    recentMessagesCount: Math.max(0, Math.min(20, Number(prompt.recentMessagesCount) || 0)),
    generateSummaryIfMissing: Boolean(prompt.generateSummaryIfMissing),
    maxOutputTokens: Math.max(32, Math.min(1200, Number(prompt.maxOutputTokens) || 150)),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  store.put(value);
  await txDone(tx);
  return value;
}

export async function deletePrompt(id) {
  const db = await openDatabase();
  const tx = db.transaction('prompts', 'readwrite');
  tx.objectStore('prompts').delete(id);
  await txDone(tx);
}

export async function upsertAccount(account) {
  const db = await openDatabase();
  const tx = db.transaction('accounts', 'readwrite');
  const store = tx.objectStore('accounts');
  const existing = await requestPromise(store.get(account.id));
  const now = Date.now();
  store.put({
    ...existing,
    ...account,
    createdAt: existing?.createdAt || now,
    lastSeenAt: now
  });
  await txDone(tx);
}

export async function upsertChat(chat) {
  const db = await openDatabase();
  const tx = db.transaction('chats', 'readwrite');
  const store = tx.objectStore('chats');
  const id = chatKey(chat.accountId, chat.whatsappChatId);
  const existing = await requestPromise(store.get(id));
  const now = Date.now();
  const value = {
    ...existing,
    ...chat,
    id,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  store.put(value);
  await txDone(tx);
  return value;
}

export async function upsertMessages(accountId, chatId, messages) {
  const db = await openDatabase();
  const key = chatKey(accountId, chatId);
  const tx = db.transaction(['messages', 'chats'], 'readwrite');
  const store = tx.objectStore('messages');
  let inserted = 0;
  let latest = 0;

  for (const message of messages) {
    if (!message?.id) continue;
    const existing = await requestPromise(store.get(message.id));
    const capturedAt = Number(message.capturedAt) || Date.now();
    latest = Math.max(latest, Number(message.whatsappTimestamp) || capturedAt);
    if (!existing) inserted += 1;
    store.put({
      ...existing,
      ...message,
      accountId,
      chatId,
      chatKey: key,
      capturedAt: existing?.capturedAt || capturedAt
    });
  }

  if (latest) {
    const chats = tx.objectStore('chats');
    const chat = await requestPromise(chats.get(key));
    if (chat) chats.put({ ...chat, lastMessageAt: Math.max(chat.lastMessageAt || 0, latest), updatedAt: Date.now() });
  }

  await txDone(tx);
  return inserted;
}

export async function getRecentMessages(accountId, chatId, count = 6) {
  const db = await openDatabase();
  const key = chatKey(accountId, chatId);
  const tx = db.transaction('messages', 'readonly');
  const index = tx.objectStore('messages').index('chatCaptured');
  const range = IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]);
  const items = [];

  await new Promise((resolve, reject) => {
    const req = index.openCursor(range, 'prev');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || items.length >= count) {
        resolve();
        return;
      }
      items.push(cursor.value);
      cursor.continue();
    };
  });

  await txDone(tx);
  return items.reverse();
}

export async function getMessagesForSummary(accountId, chatId, afterCapturedAt = 0, limit = 80) {
  const db = await openDatabase();
  const key = chatKey(accountId, chatId);
  const tx = db.transaction('messages', 'readonly');
  const index = tx.objectStore('messages').index('chatCaptured');
  const range = IDBKeyRange.bound([key, Math.max(0, Number(afterCapturedAt) || 0)], [key, Number.MAX_SAFE_INTEGER]);
  const items = [];

  await new Promise((resolve, reject) => {
    const req = index.openCursor(range, 'next');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || items.length >= limit) {
        resolve();
        return;
      }
      if (cursor.value.capturedAt > afterCapturedAt) items.push(cursor.value);
      cursor.continue();
    };
  });

  await txDone(tx);
  return items;
}

export async function getSummary(accountId, chatId) {
  const db = await openDatabase();
  const id = chatKey(accountId, chatId);
  const tx = db.transaction('summaries', 'readonly');
  const value = await requestPromise(tx.objectStore('summaries').get(id));
  await txDone(tx);
  return value || null;
}

export async function saveSummary(accountId, chatId, data) {
  const db = await openDatabase();
  const id = chatKey(accountId, chatId);
  const tx = db.transaction('summaries', 'readwrite');
  const store = tx.objectStore('summaries');
  const old = await requestPromise(store.get(id));
  const value = {
    ...old,
    ...data,
    id,
    accountId,
    chatId,
    summaryVersion: (old?.summaryVersion || 0) + 1,
    updatedAt: Date.now()
  };
  store.put(value);
  await txDone(tx);
  return value;
}


export async function bumpSummaryMessageCount(accountId, chatId, delta) {
  if (!delta) return getSummary(accountId, chatId);
  const db = await openDatabase();
  const id = chatKey(accountId, chatId);
  const tx = db.transaction('summaries', 'readwrite');
  const store = tx.objectStore('summaries');
  const old = await requestPromise(store.get(id));
  const value = {
    id,
    accountId,
    chatId,
    summary: old?.summary || '',
    summaryVersion: old?.summaryVersion || 0,
    lastSummarizedMessageId: old?.lastSummarizedMessageId || null,
    lastSummarizedAt: old?.lastSummarizedAt || 0,
    lastSummarizedCapturedAt: old?.lastSummarizedCapturedAt || 0,
    messagesSinceSummary: Math.max(0, (old?.messagesSinceSummary || 0) + delta),
    manuallyEdited: Boolean(old?.manuallyEdited),
    updatedAt: old?.updatedAt || Date.now()
  };
  store.put(value);
  await txDone(tx);
  return value;
}

export async function getChatSettings(accountId, chatId) {
  const db = await openDatabase();
  const id = chatKey(accountId, chatId);
  const tx = db.transaction('chat_settings', 'readonly');
  const value = await requestPromise(tx.objectStore('chat_settings').get(id));
  await txDone(tx);
  return value || null;
}

export async function saveChatSettings(accountId, chatId, patch) {
  const db = await openDatabase();
  const id = chatKey(accountId, chatId);
  const tx = db.transaction('chat_settings', 'readwrite');
  const store = tx.objectStore('chat_settings');
  const old = await requestPromise(store.get(id));
  const value = { ...old, ...patch, id, accountId, chatId, updatedAt: Date.now() };
  store.put(value);
  await txDone(tx);
  return value;
}

export async function addUsage(record) {
  const db = await openDatabase();
  const tx = db.transaction('usage', 'readwrite');
  tx.objectStore('usage').add({ ...record, timestamp: record.timestamp || Date.now() });
  await txDone(tx);
}

export async function getUsageStats(now = Date.now()) {
  const d = new Date(now);
  const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

  const db = await openDatabase();
  const tx = db.transaction('usage', 'readonly');
  const index = tx.objectStore('usage').index('timestamp');
  const range = IDBKeyRange.lowerBound(monthStart);
  const stats = {
    today: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, automaticRequests: 0 },
    month: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, automaticRequests: 0 }
  };

  await new Promise((resolve, reject) => {
    const req = index.openCursor(range);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const value = cursor.value;
      const automatic = Boolean(value.automatic);
      stats.month.requests += 1;
      stats.month.inputTokens += value.inputTokens || 0;
      stats.month.outputTokens += value.outputTokens || 0;
      stats.month.totalTokens += value.totalTokens || 0;
      if (automatic) stats.month.automaticRequests += 1;

      if (value.timestamp >= todayStart) {
        stats.today.requests += 1;
        stats.today.inputTokens += value.inputTokens || 0;
        stats.today.outputTokens += value.outputTokens || 0;
        stats.today.totalTokens += value.totalTokens || 0;
        if (automatic) stats.today.automaticRequests += 1;
      }
      cursor.continue();
    };
  });

  await txDone(tx);
  return stats;
}

export async function getCache(id) {
  const db = await openDatabase();
  const tx = db.transaction('suggestion_cache', 'readwrite');
  const store = tx.objectStore('suggestion_cache');
  const value = await requestPromise(store.get(id));
  if (value && value.expiresAt <= Date.now()) {
    store.delete(id);
    await txDone(tx);
    return null;
  }
  await txDone(tx);
  return value || null;
}

export async function putCache(value) {
  const db = await openDatabase();
  const tx = db.transaction('suggestion_cache', 'readwrite');
  tx.objectStore('suggestion_cache').put(value);
  await txDone(tx);
}

export async function cleanup(retentionDays = 90) {
  const db = await openDatabase();
  const now = Date.now();
  const cutoff = retentionDays > 0 ? now - retentionDays * 86400000 : 0;
  const tx = db.transaction(['messages', 'suggestion_cache'], 'readwrite');

  if (cutoff) {
    const messagesIndex = tx.objectStore('messages').index('capturedAt');
    const range = IDBKeyRange.upperBound(cutoff, true);
    await new Promise((resolve, reject) => {
      const req = messagesIndex.openCursor(range);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
    });
  }

  const cacheIndex = tx.objectStore('suggestion_cache').index('expiresAt');
  await new Promise((resolve, reject) => {
    const req = cacheIndex.openCursor(IDBKeyRange.upperBound(now));
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      cursor.delete();
      cursor.continue();
    };
  });

  await txDone(tx);
}

export async function clearData(kind, accountId = null, chatId = null) {
  const db = await openDatabase();
  const storesByKind = {
    history: ['messages'],
    summaries: ['summaries'],
    prompts: ['prompts'],
    all: ['accounts', 'chats', 'messages', 'summaries', 'chat_settings', 'prompts', 'usage', 'suggestion_cache', 'meta']
  };
  const stores = storesByKind[kind];
  if (!stores) throw new Error('Tipo de limpeza inválido');

  const tx = db.transaction(stores, 'readwrite');

  if (kind === 'history' && accountId && chatId) {
    const key = chatKey(accountId, chatId);
    const index = tx.objectStore('messages').index('chatKey');
    await new Promise((resolve, reject) => {
      const req = index.openCursor(IDBKeyRange.only(key));
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
    });
  } else {
    for (const name of stores) tx.objectStore(name).clear();
  }

  await txDone(tx);
  if (kind === 'prompts' || kind === 'all') await ensureDefaults();
}
