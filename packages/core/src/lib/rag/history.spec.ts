import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@plantbase/shared';
import {
  deriveQuestion,
  formatHistoryForPrompt,
  toModelMessages,
} from './history.js';

describe('deriveQuestion', () => {
  it('az utolsó user üzenet tartalmát adja vissza', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Első?' },
      { role: 'assistant', content: 'Válasz.' },
      { role: 'user', content: 'És a kaktuszok?' },
    ];
    expect(deriveQuestion(messages)).toBe('És a kaktuszok?');
  });

  it('hibát dob, ha az utolsó üzenet nem user', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Kérdés' },
      { role: 'assistant', content: 'Válasz' },
    ];
    expect(() => deriveQuestion(messages)).toThrow();
  });

  it('hibát dob üres user tartalomra', () => {
    expect(() => deriveQuestion([{ role: 'user', content: '   ' }])).toThrow();
  });
});

describe('formatHistoryForPrompt', () => {
  it('üres history-ra üres stringet ad', () => {
    expect(formatHistoryForPrompt([])).toBe('');
  });

  it('a beszélgetést magyar szereplő-címkékkel rendereli', () => {
    const out = formatHistoryForPrompt([
      { role: 'user', content: 'Szia' },
      { role: 'assistant', content: 'Üdv' },
    ]);
    expect(out).toContain('Felhasználó: Szia');
    expect(out).toContain('Asszisztens: Üdv');
  });
});

describe('toModelMessages', () => {
  it('a history után a friss kérdést user-üzenetként fűzi', () => {
    const out = toModelMessages(
      [{ role: 'assistant', content: 'Korábbi' }],
      'Új kérdés',
    );
    expect(out).toEqual([
      { role: 'assistant', content: 'Korábbi' },
      { role: 'user', content: 'Új kérdés' },
    ]);
  });
});
