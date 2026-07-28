import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { runBuild, type BuildDeps } from './pipeline.js';

const RAW_A = `---\ntitle: Doc A\ncategory: plants-101\n---\n## H\n\nBody A content here.`;
const RAW_B = `---\ntitle: Doc B\ncategory: plants-101\n---\n## H\n\nBody B content here.`;
const hashOf = (raw: string) => createHash('sha256').update(raw).digest('hex');
const vec = () => Array.from({ length: 1536 }, () => 0.1);

interface Recorder {
  deps: BuildDeps;
  upserts: string[];
  logs: string[];
  embedCalls: () => number;
  hashCalls: () => number;
}

function makeDeps(
  files: Record<string, string>,
  existing: Map<string, string> = new Map(),
): Recorder {
  const upserts: string[] = [];
  const logs: string[] = [];
  let embedCalls = 0;
  let hashCalls = 0;
  const deps: BuildDeps = {
    listFiles: () => Object.keys(files).sort(),
    readFile: (p) => files[p],
    embedTexts: async (values) => {
      embedCalls++;
      return values.map(() => vec());
    },
    getExistingHashes: async () => {
      hashCalls++;
      return existing;
    },
    upsert: async (doc, chunks) => {
      upserts.push(doc.source_path);
      return { documentId: upserts.length, chunkCount: chunks.length };
    },
    log: (line) => logs.push(line),
  };
  return {
    deps,
    upserts,
    logs,
    embedCalls: () => embedCalls,
    hashCalls: () => hashCalls,
  };
}

describe('runBuild', () => {
  it('builds new documents: embeds and upserts each', async () => {
    const r = makeDeps({ 'a.md': RAW_A, 'b.md': RAW_B });
    const summary = await runBuild(r.deps, { dir: '/x' });
    expect(summary.built).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toBe(0);
    expect(r.upserts).toEqual(['a.md', 'b.md']);
    expect(r.hashCalls()).toBe(1); // normál build: pontosan egyszer kérdez rá
  });

  it('skips documents whose content_hash is unchanged (no embedding)', async () => {
    const existing = new Map([['a.md', hashOf(RAW_A)]]);
    const r = makeDeps({ 'a.md': RAW_A, 'b.md': RAW_B }, existing);
    const summary = await runBuild(r.deps, { dir: '/x' });
    expect(summary.skipped).toBe(1);
    expect(summary.built).toBe(1);
    expect(r.upserts).toEqual(['b.md']);
    expect(r.embedCalls()).toBe(1); // csak b.md-t embeddeltük
  });

  it('--force rebuilds even unchanged documents', async () => {
    const existing = new Map([['a.md', hashOf(RAW_A)]]);
    const r = makeDeps({ 'a.md': RAW_A }, existing);
    const summary = await runBuild(r.deps, { dir: '/x', force: true });
    expect(summary.skipped).toBe(0);
    expect(summary.built).toBe(1);
    expect(r.hashCalls()).toBe(0); // force: nem kérdezi le a meglévő hasheket
  });

  it('--dry-run chunks but never embeds or upserts', async () => {
    const r = makeDeps({ 'a.md': RAW_A });
    const summary = await runBuild(r.deps, { dir: '/x', dryRun: true });
    expect(summary.chunks).toBeGreaterThan(0);
    expect(summary.built).toBe(0);
    expect(r.embedCalls()).toBe(0);
    expect(r.upserts).toEqual([]);
    expect(r.hashCalls()).toBe(0); // dry-run: nem kérdezi le a meglévő hasheket
  });

  it('warns and skips a 0-chunk document (not counted as built/skipped/error)', async () => {
    const RAW_EMPTY = `---\ntitle: Empty\ncategory: plants-101\n---\n   `;
    const r = makeDeps({ 'empty.md': RAW_EMPTY });
    const summary = await runBuild(r.deps, { dir: '/x' });
    expect(summary.errors).toBe(0);
    expect(summary.built).toBe(0);
    expect(summary.chunks).toBe(0);
    expect(r.embedCalls()).toBe(0);
    expect(r.upserts).toEqual([]);
    expect(r.logs.some((line) => /WARN|0 chunk/i.test(line))).toBe(true);
  });

  it('isolates a per-file error and keeps going', async () => {
    const r = makeDeps({ 'bad.md': 'no frontmatter here', 'a.md': RAW_A });
    const summary = await runBuild(r.deps, { dir: '/x' });
    expect(summary.errors).toBe(1);
    expect(summary.built).toBe(1);
    expect(r.upserts).toEqual(['a.md']);
  });
});
