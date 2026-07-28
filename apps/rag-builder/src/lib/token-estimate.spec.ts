import { describe, it, expect } from 'vitest';
import { estimateTokens } from './token-estimate.js';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('approximates ~1 token per 4 characters (ceil)', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });
});
