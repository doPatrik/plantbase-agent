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
  readonly embedTexts: (
    values: readonly string[],
  ) => Promise<{ embeddings: number[][]; totalTokens: number }>;
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
  /** Ár (USD) 1M input-tokenre az embedding-költség becsléséhez (default 0.02). */
  readonly pricePerMillionTokens?: number;
  /** Embedding-modell neve — csak az EMBEDDING log-sorhoz. */
  readonly embeddingModel?: string;
}

export interface BuildSummary {
  readonly built: number;
  readonly skipped: number;
  readonly chunks: number;
  readonly errors: number;
  /** Az embeddinghez felhasznált összes input-token (usage alapján). */
  readonly embeddedTokens: number;
  /** Becsült embedding-költség USD-ben (embeddedTokens × ár). */
  readonly estimatedCostUsd: number;
}

const DEFAULT_DIMENSION = 1536;
const DEFAULT_PRICE_PER_M = 0.02;

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
  let embeddedTokens = 0;

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

      const { embeddings, totalTokens } = await deps.embedTexts(
        docChunks.map((c) => c.content),
      );
      embeddedTokens += totalTokens;
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

  const pricePerM = options.pricePerMillionTokens ?? DEFAULT_PRICE_PER_M;
  const estimatedCostUsd = (embeddedTokens / 1_000_000) * pricePerM;

  deps.log(
    `DONE: ${built} built, ${skipped} skipped, ${chunks} chunks, ${errors} errors`,
  );
  if (embeddedTokens > 0) {
    const modelSuffix = options.embeddingModel
      ? ` (${options.embeddingModel})`
      : '';
    deps.log(
      `EMBEDDING: ${embeddedTokens} tokens ≈ $${estimatedCostUsd.toFixed(4)}${modelSuffix}`,
    );
  }
  return { built, skipped, chunks, errors, embeddedTokens, estimatedCostUsd };
}
