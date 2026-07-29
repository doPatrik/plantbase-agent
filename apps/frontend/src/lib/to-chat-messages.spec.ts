import { describe, it, expect } from 'vitest';
import { toChatMessages } from './to-chat-messages';
import type { PlantbaseUIMessage } from './ui-message';

function msg(
  role: PlantbaseUIMessage['role'],
  parts: PlantbaseUIMessage['parts'],
): PlantbaseUIMessage {
  return { id: 'x', role, parts } as PlantbaseUIMessage;
}

describe('toChatMessages', () => {
  it('egyszerű user+assistant szöveget lapít', () => {
    const out = toChatMessages([
      msg('user', [{ type: 'text', text: 'Szia' }]),
      msg('assistant', [{ type: 'text', text: 'Üdv!' }]),
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'Szia' },
      { role: 'assistant', content: 'Üdv!' },
    ]);
  });

  it('több text partot összefűz', () => {
    const out = toChatMessages([
      msg('assistant', [
        { type: 'text', text: 'A' },
        { type: 'text', text: 'B' },
      ]),
    ]);
    expect(out).toEqual([{ role: 'assistant', content: 'AB' }]);
  });

  it('a nem-text partokat elhagyja', () => {
    const out = toChatMessages([
      msg('assistant', [
        { type: 'text', text: 'Szöveg' },
        { type: 'data-sources', data: { route: 'knowledge', sources: [] } },
      ] as PlantbaseUIMessage['parts']),
    ]);
    expect(out).toEqual([{ role: 'assistant', content: 'Szöveg' }]);
  });

  it('a system role-t kiszűri', () => {
    const out = toChatMessages([
      msg('system' as PlantbaseUIMessage['role'], [
        { type: 'text', text: 'sys' },
      ]),
      msg('user', [{ type: 'text', text: 'Hello' }]),
    ]);
    expect(out).toEqual([{ role: 'user', content: 'Hello' }]);
  });
});
