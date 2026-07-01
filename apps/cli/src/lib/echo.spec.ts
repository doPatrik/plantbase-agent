import { echo, isExitCommand } from './echo.js';

describe('echo', () => {
  it('should return the input unchanged', () => {
    expect(echo('szia')).toEqual('szia');
  });

  it('should preserve whitespace and special characters', () => {
    expect(echo('  árvíztűrő  tükörfúrógép ')).toEqual(
      '  árvíztűrő  tükörfúrógép ',
    );
  });

  it('should return an empty string for empty input', () => {
    expect(echo('')).toEqual('');
  });
});

describe('isExitCommand', () => {
  it('should detect "exit"', () => {
    expect(isExitCommand('exit')).toBe(true);
  });

  it('should be case-insensitive and ignore surrounding whitespace', () => {
    expect(isExitCommand('  EXIT ')).toBe(true);
  });

  it('should not match other input', () => {
    expect(isExitCommand('exit now')).toBe(false);
    expect(isExitCommand('szia')).toBe(false);
  });
});
