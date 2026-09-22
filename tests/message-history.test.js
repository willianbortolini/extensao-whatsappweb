import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMessageRecord, messageStorageId } from '../src/storage/message-record.js';
import { DOM_UTILS } from '../src/whatsapp/dom.js';
import { WhatsAppAIApp } from '../src/app.js';

test('data/hora original é preservada em releituras; IDs são separados por conta e contato', () => {
  const timestamp = DOM_UTILS.parseWhatsAppTimestamp('[07:52, 22/09/2026] Contato: ');
  const input = { id: 'wa:3AABC', text: 'Olá', whatsappTimestamp: timestamp, messageTime: '07:52', capturedAt: 100 };
  const first = mergeMessageRecord(null, input, 'a', 'c', 100);
  const repeat = mergeMessageRecord(first, { ...input, capturedAt: 999 }, 'a', 'c', 999);
  assert.equal(repeat.id, first.id);
  assert.equal(repeat.whatsappTimestamp, timestamp);
  assert.equal(repeat.messageTime, '07:52');
  assert.equal(repeat.capturedAt, 100);
  assert.equal(repeat.lastObservedAt, 999);
  assert.notEqual(first.id, messageStorageId('a', 'other', input.id));
  assert.notEqual(first.id, messageStorageId('other', 'c', input.id));
  assert.notEqual(first.id, messageStorageId('a', 'c', 'wa:OTHER'));
  assert.equal(mergeMessageRecord(null, { id: 'unknown', messageTime: '07:52' }, 'a', 'c', 999).whatsappTimestamp, 0);
});

test('clique captura todas as mensagens antigas antes de traduzir e relê sem duplicar', async () => {
  const previousChrome = globalThis.chrome;
  const records = new Map();
  const events = [];
  const messages = Array.from({ length: 501 }, (_, i) => ({ id: `wa:${i}`, text: 'Mensagem antiga', whatsappTimestamp: 1000 + i, direction: i % 2 ? 'incoming' : 'outgoing' }));
  globalThis.chrome = { runtime: { sendMessage: (message, done) => {
    if (message.type === 'MESSAGES_UPSERT') {
      let inserted = 0;
      for (const m of message.payload.messages) {
        const id = messageStorageId('a', 'c', m.id);
        if (!records.has(id)) inserted++;
        records.set(id, mergeMessageRecord(records.get(id), m, 'a', 'c'));
      }
      events.push(['saved', inserted]);
      done({ ok: true, inserted, autoSummaryDue: false });
    } else done({ ok: true, chatSettings: { aiEnabled: true } });
  } } };
  try {
    const app = Object.create(WhatsAppAIApp.prototype);
    Object.assign(app, { account: { id: 'a' }, chat: { accountId: 'a', whatsappChatId: 'c' },
      settings: {}, translationAttempts: new Set(), ui: { setState() {} },
      dom: { readVisibleMessages: () => messages },
      translateVisibleMessages: async (loaded, manual) => {
        assert.equal(records.size, 501);
        assert.equal(loaded.length, 501);
        assert.equal(manual, true);
        events.push(['translated']);
      }
    });
    await app.retryBubbleTranslations();
    await app.retryBubbleTranslations();
    assert.deepEqual(events, [['saved', 500], ['saved', 1], ['translated'], ['saved', 0], ['saved', 0], ['translated']]);
    assert.equal(records.size, 501);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome; else globalThis.chrome = previousChrome;
  }
});
