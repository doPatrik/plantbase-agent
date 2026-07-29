// A chat-history (ChatMessage[]) átalakító segédfüggvényei (SP3b). A HTTP-határon a
// kérés messages-tömb; innen deriváljuk a friss kérdést, a prompt-formázott
// history-t (router/hyde/answer), és a katalógus-agent natív ModelMessage-listáját.

import type { ModelMessage } from 'ai';
import type { ChatMessage } from '@plantbase/shared';

/** A legutolsó (kötelezően user, nem üres) üzenet tartalma. @throws {Error} ha nincs. */
export function deriveQuestion(messages: readonly ChatMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || last.content.trim().length === 0) {
    throw new Error('A messages utolsó eleme nem üres user üzenet.');
  }
  return last.content;
}

/** A history prompt-blokká renderelve (üres history → üres string). */
export function formatHistoryForPrompt(
  history: readonly ChatMessage[],
): string {
  if (history.length === 0) return '';
  const lines = history.map(
    (m) => `${m.role === 'user' ? 'Felhasználó' : 'Asszisztens'}: ${m.content}`,
  );
  return `Eddigi beszélgetés:\n${lines.join('\n')}\n\n`;
}

/** History + friss kérdés → AI SDK ModelMessage-lista (a katalógus-agentnek). */
export function toModelMessages(
  history: readonly ChatMessage[],
  question: string,
): ModelMessage[] {
  return [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: question },
  ];
}
