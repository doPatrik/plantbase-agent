// Plantbase rag-builder — belépési pont (SP2).
// Használat:
//   rag-builder build [--force] [--dry-run] [--path <dir>]
//   rag-builder stats
// A seed/knowledge markdown-korpuszt chunkolja, embeddeli és a pgvector
// document_chunks táblába tölti (idempotens, content_hash alapján).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  resolveProjectRoot,
  loadEmbeddingConfig,
  embedTextsWithUsage,
  getExistingDocumentHashes,
  upsertDocumentWithChunks,
  getChunkStats,
  closeKnowledgePool,
  createJsonlLogger,
} from '@plantbase/core';
import { runBuild, type BuildDeps } from './lib/pipeline.js';
import { buildRunRecord } from './lib/run-log.js';

function defaultSeedDir(): string {
  return join(resolveProjectRoot(), 'seed', 'knowledge');
}

function listMarkdown(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => join(dir, f));
}

interface BuildCliOptions {
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly path?: string;
}

const program = new Command();
program
  .name('rag-builder')
  .description(
    'Plantbase RAG builder: seed/knowledge → chunk → embedding → pgvector',
  )
  .version('1.0.0');

program
  .command('build', { isDefault: true })
  .description('Chunkolás → embedding → pgvector feltöltés (idempotens)')
  .option('--force', 'minden dokumentum újraépítése (hash-skip nélkül)')
  .option('--dry-run', 'chunkolás + riport OpenAI-hívás és DB-írás nélkül')
  .option(
    '--path <dir>',
    'a knowledge könyvtár felülírása (default: seed/knowledge)',
  )
  .action(async (opts: BuildCliOptions) => {
    const dir = opts.path ?? defaultSeedDir();
    // dry-run módban nincs szükség OpenAI-kulcsra
    const config = opts.dryRun ? undefined : loadEmbeddingConfig();

    const deps: BuildDeps = {
      listFiles: listMarkdown,
      readFile: (p) => readFileSync(p, 'utf8'),
      embedTexts: (values) => embedTextsWithUsage(values, { config }),
      getExistingHashes: () => getExistingDocumentHashes(),
      upsert: (doc, chunks) => upsertDocumentWithChunks(doc, chunks),
      log: (line) => process.stdout.write(`${line}\n`),
    };

    try {
      const summary = await runBuild(deps, {
        dir,
        force: opts.force,
        dryRun: opts.dryRun,
        pricePerMillionTokens: config?.pricePerMillionTokens,
        embeddingModel: config?.model,
      });
      // Valós (nem dry-run) futásról run-log sort írunk a költség/token
      // történethez; a dry-run csak előnézet, azt nem naplózzuk.
      if (!opts.dryRun) {
        const logger = createJsonlLogger({
          dir: join(resolveProjectRoot(), 'logs', 'rag-builder'),
        });
        logger.event({
          ...buildRunRecord(summary, {
            ts: new Date().toISOString(),
            force: opts.force ?? false,
            model: config?.model ?? null,
            pricePerMillionTokens: config?.pricePerMillionTokens ?? null,
          }),
        });
        process.stdout.write(`LOG: ${logger.filePath}\n`);
      }
      process.exitCode = summary.errors > 0 ? 1 : 0;
    } finally {
      await closeKnowledgePool();
    }
  });

program
  .command('stats')
  .description('A jelenlegi tudásbázis-állapot kiírása (RO)')
  .action(async () => {
    try {
      const s = await getChunkStats();
      process.stdout.write(
        `documents: ${s.document_count}  chunks: ${s.chunk_count}  embedded: ${s.embedded_chunk_count}\n`,
      );
      process.stdout.write(
        `chunk chars: min ${s.min_chunk_chars} / avg ${Math.round(s.avg_chunk_chars)} / max ${s.max_chunk_chars}\n`,
      );
    } finally {
      await closeKnowledgePool();
    }
  });

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`Hiba: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
