import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonlLogger, nullLogger } from './logger.js';

describe('createJsonlLogger', () => {
  const dir = join(tmpdir(), 'plantbase-logger-test');

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should write one JSON object per line to logs/<timestamp>.jsonl', () => {
    const logger = createJsonlLogger({
      dir,
      timestamp: '2026-07-01T00-00-00-000Z',
    });
    logger.event({ type: 'system', prompt: '<role>...' });
    logger.event({ type: 'tool_use', sql: 'SELECT 1' });

    expect(logger.filePath).toBe(join(dir, '2026-07-01T00-00-00-000Z.jsonl'));
    const lines = readFileSync(logger.filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      type: 'system',
      prompt: '<role>...',
    });
    expect(JSON.parse(lines[1])).toEqual({ type: 'tool_use', sql: 'SELECT 1' });
  });
});

describe('nullLogger', () => {
  it('should not throw and should have no file path', () => {
    expect(() => nullLogger.event({ any: 'thing' })).not.toThrow();
    expect(nullLogger.filePath).toBe('');
  });
});
