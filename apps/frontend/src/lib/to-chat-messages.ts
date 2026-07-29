import type { ChatMessage } from '@plantbase/shared';
import type { PlantbaseUIMessage } from './ui-message';

/**
 * A useChat `UIMessage[]`-jét a backend `ChatMessage[]` kontraktusára lapítja:
 * csak user/assistant üzenetek, a content a text partok összefűzése.
 */
export function toChatMessages(
  messages: readonly PlantbaseUIMessage[],
): ChatMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join(''),
    }));
}
