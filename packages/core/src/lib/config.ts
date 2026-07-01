// Környezeti konfiguráció betöltése és validálása (boundary → zod, lásd konvenciok.md).
// A titkok kizárólag a repo-gyökér .env-jében élnek; azt innen keressük meg
// (find-up), hogy a CLI bárhonnan indítható legyen a monorepón belül.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';
import { findUp } from './paths.js';

/** Az agenthez szükséges, validált konfiguráció. */
export interface AgentConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly maxTokens: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY hiányzik vagy üres.'),
  ANTHROPIC_MODEL: z.string().min(1).optional(),
});

/** Megkeresi a legközelebbi .env fájlt (find-up), és beolvassa a benne lévő
 *  változókat (a már beállított process.env értékeket nem írja felül). */
function loadDotenvFromNearest(startDir: string): void {
  const dir = findUp('.env', startDir);
  if (!dir) return;
  const parsed = parseDotenv(readFileSync(join(dir, '.env')));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Betölti (find-up .env) és validálja a konfigurációt a process.env-ből.
 * @throws {Error} ha a kötelező változók hiányoznak vagy érvénytelenek.
 */
export function loadConfig(cwd: string = process.cwd()): AgentConfig {
  loadDotenvFromNearest(cwd);

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Hibás környezeti konfiguráció: ${issues}`);
  }

  return {
    apiKey: result.data.ANTHROPIC_API_KEY,
    model: result.data.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}
