export function messageStorageId(accountId, chatId, sourceId) {
  return JSON.stringify([accountId, chatId, sourceId]);
}

export function mergeMessageRecord(existing, message, accountId, chatId, now = Date.now()) {
  const sourceId = message.sourceId || message.id;
  return {
    ...existing, ...message,
    id: messageStorageId(accountId, chatId, sourceId), sourceId,
    accountId, chatId, chatKey: `${accountId}::${chatId}`,
    // Never replace a known message date with the time of a later scan.
    whatsappTimestamp: Number(message.whatsappTimestamp) || Number(existing?.whatsappTimestamp) || 0,
    messageTime: message.messageTime || existing?.messageTime || '',
    rawTimestamp: message.rawTimestamp || existing?.rawTimestamp || '',
    capturedAt: existing?.capturedAt || Number(message.capturedAt) || now,
    lastObservedAt: now
  };
}
