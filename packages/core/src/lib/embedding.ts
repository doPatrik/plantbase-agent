// Embedding-réteg (RAG alapok, SP1). A Vercel AI SDK `embedMany` fölött, OpenAI
// text-embedding-3-small modellel. Az alacsony szintű embedMany injektálható
// (teszthez determinisztikus fake), a meglévő DI-minta szerint (vö. runsql.ts).

import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
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
    const { embeddings } = await embedMany({
      model: openai.textEmbeddingModel(cfg.model),
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
