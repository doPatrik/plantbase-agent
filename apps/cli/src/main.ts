// Plantbase CLI — belépési pont (SP3a: AI SDK-alapú RAG-pipeline, streaming).
// Használat:
//   plantbase ask "<kérdés>"        → egyszeri kérdés, a válasz streamelve
//   plantbase                       → interaktív mód, "exit"/Ctrl+D-ig
//   --show-prompt                   → a router-döntés és a felhasznált forrásokat is kiírja
//   DEBUG=true                      → engine-trace a stderr-en (stage-enként)
// A pipeline a kérdésből eldönti az útvonalat (tudásbázis / katalógus / mindkettő),
// grounded választ ad forráshivatkozással, és NEM hallucinál (guardrail). Minden
// interakció a logs/<timestamp>.jsonl fájlba kerül (FR4).

import {
  closePool,
  closeKnowledgePool,
  createDefaultChatDeps,
  createJsonlLogger,
  loadRagConfig,
  resolveProjectRoot,
  runChat,
  type ChatDeps,
  type InteractionLogger,
} from '@plantbase/core';
import type { OnTrace, RagAnswer, TraceEvent } from '@plantbase/shared';
import { Command } from 'commander';
import { join } from 'node:path';
import * as readline from 'node:readline/promises';
import { isExitCommand } from './lib/echo.js';
import { formatTraceEvent } from './lib/trace-format.js';

/** Naplózó a monorepo gyökér logs/ mappájába. */
function createSessionLogger(): InteractionLogger {
  const logger = createJsonlLogger({ dir: join(resolveProjectRoot(), 'logs') });
  console.error(`Napló: ${logger.filePath}`);
  return logger;
}

/** onTrace, ami naplóz (FR4) és DEBUG esetén a stderr-re formázottan kiír. */
function createTrace(logger: InteractionLogger, debug: boolean): OnTrace {
  return (event: TraceEvent) => {
    logger.event({ type: 'trace', event });
    if (!debug) return;
    const line = formatTraceEvent(event);
    if (line) console.error(line);
  };
}

/** A --show-prompt kimenete: a végleges válasz metaadatai (route + források). */
function printAnswerMeta(answer: RagAnswer): void {
  console.error('----- útvonal -----');
  console.error(answer.route);
  console.error('----- források -----');
  for (const s of answer.sources) {
    console.error(
      `- ${s.title}${s.sourceUrl ? ` (${s.sourceUrl})` : ` (${s.sourcePath})`}`,
    );
  }
  console.error('-------------------');
}

/** Egy kérdés kezelése: streameli a választ a stdout-ra, majd új sor. */
async function handleQuestion(
  question: string,
  showPrompt: boolean,
  deps: ChatDeps,
): Promise<void> {
  const run = await runChat(question, deps);
  for await (const part of run.textStream) {
    process.stdout.write(part);
  }
  process.stdout.write('\n');
  const answer = await run.result;
  if (showPrompt) {
    printAnswerMeta(answer);
  }
}

/** Interaktív mód: soronként kérdez, amíg "exit"-et vagy EOF-et nem kap. */
async function runInteractive(
  showPrompt: boolean,
  deps: ChatDeps,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  console.error(
    'Plantbase — interaktív mód. Kérdezz; kilépés: "exit" vagy Ctrl+D.',
  );
  try {
    for (;;) {
      let line: string;
      try {
        line = await rl.question('> ');
      } catch {
        break;
      }
      if (isExitCommand(line)) break;
      if (line.trim().length === 0) continue;
      await handleQuestion(line, showPrompt, deps);
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('plantbase')
    .description(
      'Plantbase CLI — növény-asszisztens (SP3a: RAG + katalógus, streaming)',
    )
    .version('0.0.1');

  program
    .command('ask [question]', { isDefault: true })
    .description(
      'Kérdés feltevése; kérdés nélkül interaktív mód (kilépés: "exit")',
    )
    .option(
      '--show-prompt',
      'a router-döntés és a felhasznált források kiírása',
    )
    .action(
      async (
        question: string | undefined,
        options: { showPrompt?: boolean },
      ) => {
        const showPrompt = options.showPrompt === true;
        const logger = createSessionLogger();
        const ragConfig = loadRagConfig();
        const deps: ChatDeps = createDefaultChatDeps({
          onTrace: createTrace(logger, ragConfig.debug),
        });
        if (question && question.trim().length > 0) {
          await handleQuestion(question, showPrompt, deps);
          return;
        }
        await runInteractive(showPrompt, deps);
      },
    );

  try {
    await program.parseAsync();
  } finally {
    // A pg poolok nyitva tartanák az event loopot; kilépéshez lezárjuk.
    await closePool();
    await closeKnowledgePool();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Hiba: ${message}`);
  process.exitCode = 1;
});
