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

/** Embedding-provider konfiguráció (OpenAI). Csak ott töltjük be, ahol embedding kell,
 *  így a CLI OpenAI-kulcs nélkül is fut. */
export interface EmbeddingConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly dimension: 1536;
  /** Ár (USD) 1M input-tokenre — az embedding-költség becsléséhez. */
  readonly pricePerMillionTokens: number;
}

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536 as const;
// text-embedding-3-small listaár (USD / 1M input-token); env-ből felülírható,
// mert az árazás idővel változhat.
const DEFAULT_EMBEDDING_PRICE_PER_M = 0.02;

const embeddingEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY hiányzik vagy üres.'),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).optional(),
  OPENAI_EMBEDDING_PRICE_PER_M: z.coerce
    .number()
    .nonnegative('OPENAI_EMBEDDING_PRICE_PER_M nem lehet negatív.')
    .optional(),
});

/**
 * Betölti (find-up .env) és validálja az embedding-konfigurációt.
 * @throws {Error} ha az OPENAI_API_KEY hiányzik.
 */
export function loadEmbeddingConfig(
  cwd: string = process.cwd(),
): EmbeddingConfig {
  loadDotenvFromNearest(cwd);
  const result = embeddingEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Hibás embedding-konfiguráció: ${issues}`);
  }
  return {
    apiKey: result.data.OPENAI_API_KEY,
    model: result.data.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
    dimension: EMBEDDING_DIMENSION,
    pricePerMillionTokens:
      result.data.OPENAI_EMBEDDING_PRICE_PER_M ?? DEFAULT_EMBEDDING_PRICE_PER_M,
  };
}

/** A RAG-pipeline futásidejű konfigurációja (SP3a). */
export interface RagConfig {
  readonly maxAgentIterations: number;
  readonly debug: boolean;
  /** Router / HyDE / rerank modell (olcsó, alapból Haiku). */
  readonly routerModel: string;
  readonly hydeModel: string;
  readonly rerankModel: string;
  /** Answer + katalógus-agent modell (alapból Sonnet). */
  readonly answerModel: string;
  /** A vektorkeresés által visszaadott chunkok száma. */
  readonly topK: number;
  /** A rerank után megtartott chunkok száma. */
  readonly rerankTopN: number;
  /** Grounding-küszöb: e cosine-similarity alatt "nincs találat". */
  readonly groundingThreshold: number;
}

const DEFAULT_MAX_AGENT_ITERATIONS = 6;
const DEFAULT_CHEAP_MODEL = 'claude-haiku-4-5';
const DEFAULT_ANSWER_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TOP_K = 12;
const DEFAULT_RERANK_TOP_N = 5;
const DEFAULT_GROUNDING_THRESHOLD = 0.35;

const ragEnvSchema = z.object({
  MAX_AGENT_ITERATIONS: z.coerce
    .number()
    .int()
    .positive('MAX_AGENT_ITERATIONS pozitív egész kell legyen.')
    .optional(),
  DEBUG: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  RAG_ROUTER_MODEL: z.string().min(1).optional(),
  RAG_HYDE_MODEL: z.string().min(1).optional(),
  RAG_RERANK_MODEL: z.string().min(1).optional(),
  RAG_ANSWER_MODEL: z.string().min(1).optional(),
  RAG_TOP_K: z.coerce
    .number()
    .int()
    .positive('RAG_TOP_K pozitív egész kell legyen.')
    .optional(),
  RAG_RERANK_TOP_N: z.coerce
    .number()
    .int()
    .positive('RAG_RERANK_TOP_N pozitív egész kell legyen.')
    .optional(),
  RAG_GROUNDING_THRESHOLD: z.coerce
    .number()
    .min(0, 'RAG_GROUNDING_THRESHOLD nem lehet negatív.')
    .max(1, 'RAG_GROUNDING_THRESHOLD legfeljebb 1 lehet.')
    .optional(),
});

/**
 * Betölti (find-up .env) és validálja a RAG futásidejű konfigurációt.
 * @throws {Error} ha valamelyik érték érvénytelen.
 */
export function loadRagConfig(cwd: string = process.cwd()): RagConfig {
  loadDotenvFromNearest(cwd);
  const result = ragEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Hibás RAG-konfiguráció: ${issues}`);
  }
  return {
    maxAgentIterations:
      result.data.MAX_AGENT_ITERATIONS ?? DEFAULT_MAX_AGENT_ITERATIONS,
    debug: result.data.DEBUG ?? false,
    routerModel: result.data.RAG_ROUTER_MODEL ?? DEFAULT_CHEAP_MODEL,
    hydeModel: result.data.RAG_HYDE_MODEL ?? DEFAULT_CHEAP_MODEL,
    rerankModel: result.data.RAG_RERANK_MODEL ?? DEFAULT_CHEAP_MODEL,
    answerModel: result.data.RAG_ANSWER_MODEL ?? DEFAULT_ANSWER_MODEL,
    topK: result.data.RAG_TOP_K ?? DEFAULT_TOP_K,
    rerankTopN: result.data.RAG_RERANK_TOP_N ?? DEFAULT_RERANK_TOP_N,
    groundingThreshold:
      result.data.RAG_GROUNDING_THRESHOLD ?? DEFAULT_GROUNDING_THRESHOLD,
  };
}

/** Modellenkénti listaár (USD / 1M token) — a költség-becslőhöz. */
export interface ModelPrice {
  readonly inputPerM: number;
  readonly outputPerM: number;
}

const HAIKU_MODEL_ID = 'claude-haiku-4-5';
const SONNET_MODEL_ID = 'claude-sonnet-4-6';
const DEFAULT_HAIKU_INPUT_PRICE = 1.0;
const DEFAULT_HAIKU_OUTPUT_PRICE = 5.0;
const DEFAULT_SONNET_INPUT_PRICE = 3.0;
const DEFAULT_SONNET_OUTPUT_PRICE = 15.0;

const priceEnvSchema = z.object({
  RAG_PRICE_HAIKU_INPUT_PER_M: z.coerce
    .number()
    .nonnegative('RAG_PRICE_HAIKU_INPUT_PER_M nem lehet negatív.')
    .optional(),
  RAG_PRICE_HAIKU_OUTPUT_PER_M: z.coerce
    .number()
    .nonnegative('RAG_PRICE_HAIKU_OUTPUT_PER_M nem lehet negatív.')
    .optional(),
  RAG_PRICE_SONNET_INPUT_PER_M: z.coerce
    .number()
    .nonnegative('RAG_PRICE_SONNET_INPUT_PER_M nem lehet negatív.')
    .optional(),
  RAG_PRICE_SONNET_OUTPUT_PER_M: z.coerce
    .number()
    .nonnegative('RAG_PRICE_SONNET_OUTPUT_PER_M nem lehet negatív.')
    .optional(),
});

/**
 * Betölti a modellenkénti default listaárakat (Haiku/Sonnet/embedding), env-ből
 * felülírhatóan. A kulcsok a DEFAULT modell-azonosítók (claude-haiku-4-5,
 * claude-sonnet-4-6, text-embedding-3-small) — ha valaki egyedi RAG_*_MODEL-t
 * állít be, arra nem lesz ár-bejegyzés (a becslő ismeretlen-ár-ként kezeli).
 * @throws {Error} ha az OPENAI_API_KEY hiányzik (az embedding-ár ebből épül).
 */
export function loadModelPrices(
  cwd: string = process.cwd(),
): Record<string, ModelPrice> {
  loadDotenvFromNearest(cwd);
  const result = priceEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Hibás ár-konfiguráció: ${issues}`);
  }
  const embedding = loadEmbeddingConfig(cwd);
  return {
    [HAIKU_MODEL_ID]: {
      inputPerM:
        result.data.RAG_PRICE_HAIKU_INPUT_PER_M ?? DEFAULT_HAIKU_INPUT_PRICE,
      outputPerM:
        result.data.RAG_PRICE_HAIKU_OUTPUT_PER_M ?? DEFAULT_HAIKU_OUTPUT_PRICE,
    },
    [SONNET_MODEL_ID]: {
      inputPerM:
        result.data.RAG_PRICE_SONNET_INPUT_PER_M ?? DEFAULT_SONNET_INPUT_PRICE,
      outputPerM:
        result.data.RAG_PRICE_SONNET_OUTPUT_PER_M ??
        DEFAULT_SONNET_OUTPUT_PRICE,
    },
    [embedding.model]: {
      inputPerM: embedding.pricePerMillionTokens,
      outputPerM: 0,
    },
  };
}
