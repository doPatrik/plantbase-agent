// Embedding-réteg (RAG alapok, SP1). A Vercel AI SDK `embedMany` fölött, OpenAI
// text-embedding-3-small modellel. Az alacsony szintű embedMany injektálható
// (teszthez determinisztikus fake), a meglévő DI-minta szerint (vö. runsql.ts).

import { embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { loadEmbeddingConfig, type EmbeddingConfig } from './config.js';

/** Alacsony szintű embedder: sztringek → vektorok, azonos sorrendben. */
export type EmbedManyFn = (values: readonly string[]) => Promise<number[][]>;

export interface EmbedOptions {
  /** Embedding-konfiguráció; ha hiányzik, a process.env-ből töltjük. */
  readonly config?: EmbeddingConfig;
  /** Injektálható embedder; alapból a valódi OpenAI embedMany. */
  readonly embedMany?: EmbedManyFn;
}

/** A valódi (OpenAI) embedder előállítása a konfigurációból. */
function defaultEmbedMany(config?: EmbeddingConfig): EmbedManyFn {
  return async (values) => {
    const cfg = config ?? loadEmbeddingConfig();
    const provider = createOpenAI({ apiKey: cfg.apiKey });
    const { embeddings } = await embedMany({
      model: provider.textEmbeddingModel(cfg.model),
      values: [...values],
    });
    return embeddings;
  };
}

/**
 * Beágyazza a megadott szövegeket. Üres bemenetre üres tömböt ad, a modell hívása nélkül.
 * @throws {Error} ha nincs embedding-konfiguráció, vagy a provider hibázik.
 */
export async function embedTexts(
  values: readonly string[],
  options: EmbedOptions = {},
): Promise<number[][]> {
  if (values.length === 0) {
    return [];
  }
  const run = options.embedMany ?? defaultEmbedMany(options.config);
  return run(values);
}

/**
 * Egyetlen lekérdezés-szöveg beágyazása (a HyDE/vektorkeresés query-oldala).
 * @throws {Error} ha nincs embedding-konfiguráció, vagy a provider hibázik.
 */
export async function embedQuery(
  text: string,
  options: EmbedOptions = {},
): Promise<number[]> {
  const [embedding] = await embedTexts([text], options);
  return embedding;
}

/** Embedding-eredmény a felhasznált input-tokenek számával (költség-statisztikához). */
export interface EmbedResult {
  readonly embeddings: number[][];
  /** Az `embedMany` által jelentett összes input-token (usage.tokens). */
  readonly totalTokens: number;
}

/** Alacsony szintű, usage-t is visszaadó embedder (teszthez injektálható). */
export type EmbedManyWithUsageFn = (
  values: readonly string[],
) => Promise<EmbedResult>;

export interface EmbedWithUsageOptions {
  /** Embedding-konfiguráció; ha hiányzik, a process.env-ből töltjük. */
  readonly config?: EmbeddingConfig;
  /** Injektálható embedder; alapból a valódi OpenAI embedMany (usage-dzsel). */
  readonly embedMany?: EmbedManyWithUsageFn;
}

/** A valódi (OpenAI) embedder, ami a vektorok mellett a token-usage-t is visszaadja. */
function defaultEmbedManyWithUsage(
  config?: EmbeddingConfig,
): EmbedManyWithUsageFn {
  return async (values) => {
    const cfg = config ?? loadEmbeddingConfig();
    const provider = createOpenAI({ apiKey: cfg.apiKey });
    const { embeddings, usage } = await embedMany({
      model: provider.textEmbeddingModel(cfg.model),
      values: [...values],
    });
    return { embeddings, totalTokens: usage.tokens };
  };
}

/**
 * Mint az {@link embedTexts}, de a vektorok mellett a felhasznált input-tokenek
 * számát is visszaadja (költség-statisztikához). Üres bemenetre üres eredményt ad,
 * a modell hívása nélkül.
 * @throws {Error} ha nincs embedding-konfiguráció, vagy a provider hibázik.
 */
export async function embedTextsWithUsage(
  values: readonly string[],
  options: EmbedWithUsageOptions = {},
): Promise<EmbedResult> {
  if (values.length === 0) {
    return { embeddings: [], totalTokens: 0 };
  }
  const run = options.embedMany ?? defaultEmbedManyWithUsage(options.config);
  return run(values);
}
