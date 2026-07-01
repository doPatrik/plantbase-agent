// Plantbase CLI — belépési pont (B3 fázis: runSql tool, valós SQL a katalóguson).
// Használat:
//   plantbase ask "<kérdés>"        → egyszeri kérdés az agentnek
//   plantbase                       → interaktív mód, "exit"/Ctrl+D-ig
//   --show-prompt                   → a teljes system prompt + üzenettömb kiírása (FR5)
// Az agent a kérdésből SQL-t ír, a runSql toollal (read-only) lefuttatja a
// products katalóguson, és magyar nyelvű választ ad. Minden interakció a
// logs/<timestamp>.jsonl fájlba kerül (FR4).

import {
  askAgent,
  closePool,
  createJsonlLogger,
  resolveProjectRoot,
  type AgentResult,
  type InteractionLogger,
} from '@plantbase/core';
import { Command } from 'commander';
import { join } from 'node:path';
import * as readline from 'node:readline/promises';
import { isExitCommand } from './lib/echo.js';

/** Naplózó a monorepo gyökér logs/ mappájába (a futtatási könyvtártól függetlenül). */
function createSessionLogger(): InteractionLogger {
  const logger = createJsonlLogger({ dir: join(resolveProjectRoot(), 'logs') });
  console.error(`Napló: ${logger.filePath}`);
  return logger;
}

/** Átláthatóság: a modellnek küldött teljes kontextus kiírása (--show-prompt). */
function printPromptContext(result: AgentResult): void {
  console.log('----- system prompt -----');
  console.log(result.systemPrompt);
  console.log('----- messages -----');
  console.log(JSON.stringify(result.messages, null, 2));
  console.log('-------------------------');
}

/** Egy kérdés kezelése: elküldi az agentnek (runSql toollal) és kiírja a választ. */
async function handleQuestion(
  question: string,
  showPrompt: boolean,
  logger: InteractionLogger,
): Promise<void> {
  const result = await askAgent(question, { logger });
  if (showPrompt) {
    printPromptContext(result);
  }
  console.log(result.text);
}

/** Interaktív mód: soronként kérdez az agenttől, amíg "exit"-et vagy EOF-et nem kap. */
async function runInteractive(
  showPrompt: boolean,
  logger: InteractionLogger,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  console.log(
    'Plantbase — interaktív mód. Kérdezz; kilépés: "exit" vagy Ctrl+D.',
  );
  try {
    for (;;) {
      let line: string;
      try {
        line = await rl.question('> ');
      } catch {
        break; // EOF (Ctrl+D) vagy megszakítás
      }
      if (isExitCommand(line)) break;
      if (line.trim().length === 0) continue;
      await handleQuestion(line, showPrompt, logger);
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
      'Plantbase CLI — növényválasztó agent (B3: valós SQL a katalóguson)',
    )
    .version('0.0.1');

  program
    .command('ask [question]', { isDefault: true })
    .description(
      'Kérdés feltevése; kérdés nélkül interaktív mód (kilépés: "exit")',
    )
    .option('--show-prompt', 'a teljes system prompt és üzenettömb kiírása')
    .action(
      async (
        question: string | undefined,
        options: { showPrompt?: boolean },
      ) => {
        const showPrompt = options.showPrompt === true;
        const logger = createSessionLogger();
        if (question && question.trim().length > 0) {
          await handleQuestion(question, showPrompt, logger);
          return;
        }
        await runInteractive(showPrompt, logger);
      },
    );

  try {
    await program.parseAsync();
  } finally {
    // A pg pool nyitva tartaná az event loopot; kilépéshez lezárjuk.
    await closePool();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Hiba: ${message}`);
  process.exitCode = 1;
});
