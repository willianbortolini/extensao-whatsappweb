// Hash the effective request so edits to prompts or conversation text cannot
// reuse an answer generated from different input. Keep account/chat isolation.
export async function suggestionCacheId({ accountId, chatId, promptId, model, instructions, input, maxOutputTokens }) {
  const data = JSON.stringify([
    'suggestion-v2', accountId, chatId, promptId, model,
    instructions, input, maxOutputTokens
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
