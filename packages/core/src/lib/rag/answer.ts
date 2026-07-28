// Answer stage (SP3a): a grounded, magyar nyelvű válasz Sonnet modellel, STREAMELVE
// (streamText textStream). A prompt tiltja a hallucinációt: csak a megadott
// forrásrészletekből (és opcionálisan a katalógus-kontextusból) válaszolhat, és
// hivatkozzon a forrásokra (cím / URL / fájlnév). A forráshivatkozásokat (SourceRef)
// a chunkokból KÓDDAL képezzük (dokumentumonként egyszer), nem a modellre bízzuk.

import { streamText, type LanguageModel } from 'ai';
import type { SourceRef } from '@plantbase/shared';
import type { SearchResult } from '../knowledge-store.js';

/** Szűk, injektálható streamText (csak amit az answer használ). */
export type AnswerStreamFn = (args: {
  model: LanguageModel;
  system: string;
  prompt: string;
}) => { textStream: AsyncIterable<string> };

const defaultStreamAnswer: AnswerStreamFn = ({ model, system, prompt }) => {
  const { textStream } = streamText({ model, system, prompt });
  return { textStream };
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
}

export interface AnswerResult {
  readonly textStream: AsyncIterable<string>;
  readonly sources: readonly SourceRef[];
}

export interface AnswerDeps {
  readonly model: LanguageModel;
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
    const { textStream } = run({
      model: deps.model,
      system: ANSWER_SYSTEM,
      prompt: `Kérdés: ${input.question}\n\nForrásrészletek:\n${context}${catalog}`,
    });
    return { textStream, sources };
  };
}
