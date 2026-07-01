// JSONL interakció-napló (FR4): minden agent-interakciót a logs/<timestamp>.jsonl
// fájlba írunk soronként egy JSON eseményként (system prompt, üzenetek, generált
// SQL, eredmény, válasz, token-használat). A logs/ mappa gitignore-olt.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Interakció-naplózó: soronként egy JSON eseményt fűz a naplófájlhoz. */
export interface InteractionLogger {
  /** Egy esemény hozzáfűzése a naplóhoz (egy JSONL sor). */
  event(entry: Record<string, unknown>): void;
  /** A naplófájl elérési útja (nullLogger esetén üres). */
  readonly filePath: string;
}

export interface LoggerOptions {
  /** Napló mappa; alapból "logs". */
  readonly dir?: string;
  /** Fájlnév-időbélyeg; alapból az aktuális ISO időpont (fájlbarát formában). */
  readonly timestamp?: string;
}

function fileSafeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Létrehoz egy JSONL naplózót, ami a logs/<timestamp>.jsonl fájlba ír. */
export function createJsonlLogger(
  options: LoggerOptions = {},
): InteractionLogger {
  const dir = options.dir ?? 'logs';
  const timestamp = options.timestamp ?? fileSafeTimestamp();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${timestamp}.jsonl`);
  return {
    filePath,
    event(entry: Record<string, unknown>): void {
      appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    },
  };
}

/** Nem író napló (teszthez vagy ha a naplózás ki van kapcsolva). */
export const nullLogger: InteractionLogger = {
  filePath: '',
  event: () => {
    /* no-op */
  },
};
