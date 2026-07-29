// Answer stage (SP3a): a grounded, magyar nyelvű válasz Sonnet modellel, STREAMELVE
// (streamText textStream). A prompt tiltja a hallucinációt: csak a megadott
// forrásrészletekből (és opcionálisan a katalógus-kontextusból) válaszolhat, és
// hivatkozzon a forrásokra (cím / URL / fájlnév). A forráshivatkozásokat (SourceRef)
// a chunkokból KÓDDAL képezzük (dokumentumonként egyszer), nem a modellre bízzuk.

import { streamText, type LanguageModel } from 'ai';
import type { SourceRef, ChatMessage } from '@plantbase/shared';
import type { SearchResult } from '../knowledge-store.js';
import { formatHistoryForPrompt } from './history.js';
import type { StageUsage } from './usage.js';

/** Szűk, injektálható streamText (csak amit az answer használ). A usage (SP5)
 *  Promise, mert a streamText usage-e csak a stream teljes elfogyasztása után áll
 *  rendelkezésre. */
export type AnswerStreamFn = (args: {
  model: LanguageModel;
  system: string;
  prompt: string;
}) => {
  textStream: AsyncIterable<string>;
  usage?: Promise<{ inputTokens: number; outputTokens: number }>;
};

const defaultStreamAnswer: AnswerStreamFn = ({ model, system, prompt }) => {
  const { textStream, usage } = streamText({ model, system, prompt });
  return {
    textStream,
    usage: usage.then((u) => ({
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
    })),
  };
};

const ANSWER_SYSTEM = `Te a Plantbase növény-asszisztens vagy. Válaszolj magyarul, tömören, KIZÁRÓLAG a megadott forrásrészletek (és ha van, a katalógus-adatok) alapján. Ha a részletek nem fedik le a kérdést, mondd ki őszintén — SOHA ne találj ki tényt, növényt, árat vagy adatot. A válasz végén sorold fel a felhasznált forrásokat (cím, és ha van, URL vagy fájlnév).`;

/** SearchResult-okból forráshivatkozások, dokumentumonként egyszer (sorrendtartó). */
export function toSourceRefs(
  chunks: readonly SearchResult[],
): readonly SourceRef[] {
  const seen = new Set<number>();
  const refs: SourceRef[] = [];
  for (const c of chunks) {
    if (seen.has(c.document_id)) continue;
    seen.add(c.document_id);
    refs.push({
      title: c.title,
      sourceUrl: c.source_url,
      sourcePath: c.source_path,
      headingPath: c.heading_path,
    });
  }
  return refs;
}

function buildContext(chunks: readonly SearchResult[]): string {
  return chunks
    .map(
      (c, i) =>
        `[Forrás ${i + 1}] ${c.title}${c.heading_path ? ` — ${c.heading_path}` : ''}` +
        `${c.source_url ? ` (${c.source_url})` : ` (${c.source_path})`}\n${c.content}`,
    )
    .join('\n\n');
}

export interface AnswerInput {
  readonly question: string;
  readonly chunks: readonly SearchResult[];
  /** Katalógus-kontextus a "both" útvonalon (a catalog-agent szöveges eredménye). */
  readonly catalogContext?: string;
  /** Az eddigi beszélgetés (koherens többfordulós válaszhoz). */
  readonly history?: readonly ChatMessage[];
}

export interface AnswerResult {
  readonly textStream: AsyncIterable<string>;
  readonly sources: readonly SourceRef[];
  /** A válasz-hívás token-usage-e (SP5); a stream teljes elfogyasztása után resolve-ol. */
  readonly usage?: Promise<StageUsage>;
}

export interface AnswerDeps {
  readonly model: LanguageModel;
  /** A trace-ben/becslőben megjelenő modell-azonosító (SP5). */
  readonly modelId?: string;
  readonly streamAnswer?: AnswerStreamFn;
}

export type Answer = (input: AnswerInput) => AnswerResult;

/** Létrehozza az answer-függvényt (grounded, streamelő). */
export function createAnswer(deps: AnswerDeps): Answer {
  const run = deps.streamAnswer ?? defaultStreamAnswer;
  return (input) => {
    const sources = toSourceRefs(input.chunks);
    const context = buildContext(input.chunks);
    const catalog = input.catalogContext
      ? `\n\nKatalógus-adatok:\n${input.catalogContext}`
      : '';
    const historyBlock = formatHistoryForPrompt(input.history ?? []);
    const { textStream, usage } = run({
      model: deps.model,
      system: ANSWER_SYSTEM,
      prompt: `${historyBlock}Kérdés: ${input.question}\n\nForrásrészletek:\n${context}${catalog}`,
    });
    return {
      textStream,
      sources,
      usage: usage?.then((u) => ({
        model: deps.modelId ?? 'unknown',
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
      })),
    };
  };
}
