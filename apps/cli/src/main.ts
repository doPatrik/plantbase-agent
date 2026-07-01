// Plantbase CLI — belépési pont (B1 fázis: echo mód, LLM és DB nélkül).
// Két használat:
//   plantbase ask "<kérdés>"   → egyszeri echo (visszaírja a kérdést)
//   plantbase                  → interaktív mód, minden sort visszaír "exit"-ig
// A CLI stdout a termék felülete, ezért a közvetlen kiírás itt szándékos.

import { Command } from 'commander';
import * as readline from 'node:readline';
import { echo, isExitCommand } from './lib/echo.js';

/** Interaktív readline-loop: minden beírt sort visszaír, amíg "exit"-et vagy
 *  EOF-et (Ctrl+D) nem kap. */
function runInteractive(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });
    console.log(
      'Interaktív mód — írj be valamit; kilépés: "exit" vagy Ctrl+D.',
    );
    rl.prompt();
    // Pipe-olt bemenetnél a readline több sort is beolvashat egy tickben, ezért
    // a close() után beérkező, már pufferelt sorokat egy flaggel kiszűrjük.
    let stopped = false;
    rl.on('line', (line) => {
      if (stopped) return;
      if (isExitCommand(line)) {
        stopped = true;
        rl.close();
        return;
      }
      console.log(echo(line));
      rl.prompt();
    });
    rl.on('close', () => resolve());
  });
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('plantbase')
    .description(
      'Plantbase CLI — növényválasztó agent (B1: echo mód, LLM nélkül)',
    )
    .version('0.0.1');

  program
    .command('ask [question]', { isDefault: true })
    .description(
      'Kérdés feltevése; kérdés nélkül interaktív mód (kilépés: "exit")',
    )
    .action(async (question?: string) => {
      if (question && question.trim().length > 0) {
        console.log(echo(question));
        return;
      }
      await runInteractive();
    });

  await program.parseAsync();
}

main();
