// A rag-builder orchestrátora (SP2): fájllista → parse → hash → skip → chunk →
// embed → upsert. Minden I/O és a core-hívások injektáltak (BuildDeps), így
// hálózat/DB nélkül tesztelhető.

import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  assertEmbeddingDim,
  type DocumentInput,
  type ChunkInput,
} from '@plantbase/core';
import { parseFrontmatter } from './frontmatter.js';
import { chunkMarkdown, type ChunkOptions } from './chunker.js';

export interface BuildDeps {
  readonly listFiles: (dir: string) => string[];
  readonly readFile: (path: string) => string;
  readonly embedTexts: (values: readonly string[]) => Promise<number[][]>;
  readonly getExistingHashes: () => Promise<Map<string, string>>;
  readonly upsert: (
    doc: DocumentInput,
    chunks: readonly ChunkInput[],
  ) => Promise<{ documentId: number; chunkCount: number }>;
  readonly log: (line: string) => void;
}

export interface BuildOptions {
  readonly dir: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly chunkOptions?: ChunkOptions;
  readonly dimension?: number;
}

export interface BuildSummary {
  readonly built: number;
  readonly skipped: number;
  readonly chunks: number;
  readonly errors: number;
}

const DEFAULT_DIMENSION = 1536;

export async function runBuild(
  deps: BuildDeps,
  options: BuildOptions,
): Promise<BuildSummary> {
  const files = deps.listFiles(options.dir);
  const existing =
    !options.force && !options.dryRun
      ? await deps.getExistingHashes()
      : new Map<string, string>();
  const dimension = options.dimension ?? DEFAULT_DIMENSION;

  let built = 0;
  let skipped = 0;
  let chunks = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const sourcePath = basename(file);
    const tag = `[${i + 1}/${files.length}] ${sourcePath}`;
    try {
      const raw = deps.readFile(file);
      const contentHash = createHash('sha256').update(raw).digest('hex');
      const charCount = raw.length;
      const parsed = parseFrontmatter(raw);

      if (!options.force && existing.get(sourcePath) === contentHash) {
        skipped++;
        deps.log(`${tag} … SKIP (unchanged)`);
        continue;
      }

      const docChunks = chunkMarkdown(parsed.body, options.chunkOptions);
      if (docChunks.length === 0) {
        deps.log(`${tag} … WARN: 0 chunk, kihagyva`);
        continue;
      }

      if (options.dryRun) {
        chunks += docChunks.length;
        deps.log(`${tag} … ${docChunks.length} chunk (DRY)`);
        continue;
      }

      const embeddings = await deps.embedTexts(docChunks.map((c) => c.content));
      const chunkInputs: ChunkInput[] = docChunks.map((c, idx) => {
        assertEmbeddingDim(embeddings[idx], dimension);
        return {
          chunk_index: c.chunk_index,
          content: c.content,
          heading_path: c.heading_path,
          token_count: c.token_count,
          embedding: embeddings[idx],
        };
      });

      const doc: DocumentInput = {
        source_path: sourcePath,
        title: parsed.title,
        source_url: parsed.source_url,
        category: parsed.category,
        content_hash: contentHash,
        char_count: charCount,
      };

      const res = await deps.upsert(doc, chunkInputs);
      built++;
      chunks += res.chunkCount;
      deps.log(`${tag} … ${res.chunkCount} chunk, embedded, upserted`);
    } catch (error) {
      errors++;
      deps.log(`${tag} … ERROR: ${(error as Error).message}`);
    }
  }

  deps.log(
    `DONE: ${built} built, ${skipped} skipped, ${chunks} chunks, ${errors} errors`,
  );
  return { built, skipped, chunks, errors };
}
