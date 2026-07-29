import type { PlantbaseUIMessage } from './ui-message';

/** Az üzenet text partjainak összefűzött szövege (a data-* partokat elhagyja). */
export function messageText(message: PlantbaseUIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
