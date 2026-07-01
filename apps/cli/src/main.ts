// Plantbase CLI — belépési pont (B2 fázis: LLM bekötve, adatbázis nélkül).
// Használat:
//   plantbase ask "<kérdés>"        → egyszeri kérdés az agentnek
//   plantbase                       → interaktív mód, "exit"/Ctrl+D-ig
//   --show-prompt                   → a teljes system prompt + üzenettömb kiírása (FR5)
// Ebben a fázisban az agentnek nincs DB-hozzáférése: adat-kérdésnél őszintén
// jelzi, hogy nem fér hozzá az adatbázishoz.

import { askAgent, type AgentResult } from '@plantbase/core';
import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import { isExitCommand } from './lib/echo.js';

/** Átláthatóság: a modellnek küldött teljes kontextus kiírása (--show-prompt). */
function printPromptContext(result: AgentResult): void {
  console.log('----- system prompt -----');
  console.log(result.systemPrompt);
  console.log('----- messages -----');
  console.log(JSON.stringify(result.messages, null, 2));
  console.log('-------------------------');
}

/** Egy kérdés kezelése: elküldi az agentnek és kiírja a választ. */
async function handleQuestion(
  question: string,
  showPrompt: boolean,
): Promise<void> {
  const result = await askAgent(question);
  if (showPrompt) {
    printPromptContext(result);
  }
  console.log(result.text);
}

/** Interaktív mód: soronként kérdez az agenttől, amíg "exit"-et vagy EOF-et nem kap. */
async function runInteractive(showPrompt: boolean): Promise<void> {
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
      await handleQuestion(line, showPrompt);
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
      'Plantbase CLI — növényválasztó agent (B2: LLM, adatbázis nélkül)',
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
        if (question && question.trim().length > 0) {
          await handleQuestion(question, showPrompt);
          return;
        }
        await runInteractive(showPrompt);
      },
    );

  await program.parseAsync();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Hiba: ${message}`);
  process.exitCode = 1;
});
