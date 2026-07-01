import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findUp, resolveProjectRoot } from './paths.js';

describe('findUp / resolveProjectRoot', () => {
  const root = join(tmpdir(), 'plantbase-paths-test');
  const nested = join(root, 'apps', 'cli');

  beforeEach(() => {
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should find the marker directory walking up from a nested dir', () => {
    expect(findUp('pnpm-workspace.yaml', nested)).toBe(root);
  });

  it('should return undefined when the marker is not found', () => {
    expect(findUp('does-not-exist.marker', nested)).toBeUndefined();
  });

  it('resolveProjectRoot should return the workspace root from a nested dir', () => {
    expect(resolveProjectRoot(nested)).toBe(root);
  });

  it('resolveProjectRoot should fall back to the start dir when no marker exists', () => {
    const orphan = join(tmpdir(), 'plantbase-paths-orphan');
    mkdirSync(orphan, { recursive: true });
    try {
      expect(resolveProjectRoot(orphan)).toBe(orphan);
    } finally {
      rmSync(orphan, { recursive: true, force: true });
    }
  });
});
