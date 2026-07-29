import { describe, it, expect } from 'vitest';
import { messageText } from './message-text';
import type { PlantbaseUIMessage } from './ui-message';

function msg(parts: PlantbaseUIMessage['parts']): PlantbaseUIMessage {
  return { id: 'x', role: 'assistant', parts } as PlantbaseUIMessage;
}

describe('messageText', () => {
  it('üres/nem-text partok esetén üres stringet ad', () => {
    expect(
      messageText(
        msg([
          { type: 'data-sources', data: { route: 'knowledge', sources: [] } },
        ] as PlantbaseUIMessage['parts']),
      ),
    ).toBe('');
  });

  it('több text partot összefűz', () => {
    expect(
      messageText(
        msg([
          { type: 'text', text: 'A' },
          { type: 'text', text: 'B' },
        ]),
      ),
    ).toBe('AB');
  });
});
