// HyDE (Hypothetical Document Embeddings) stage (SP3a): a kérdésre generálunk egy
// rövid, hipotetikus választ, és AZT ágyazzuk be a vektorkereséshez (a query-oldal
// minősége nő, mert a hipotetikus válasz szókincse közelebb áll a tárolt cikkekhez).
// Olcsó Haiku; a generateText injektálható a teszthez. A usage (SP5) a text
// mellett opcionálisan érkezik, ezért a Hyde visszatérése objektum (nem bare string).

import { generateText, type LanguageModel } from 'ai';
import { formatHistoryForPrompt } from './history.js';
import type { ChatMessage } from '@plantbase/shared';
import type { StageUsage } from './usage.js';

/** Szűk, injektálható generateText (csak amit a HyDE használ). */
export type GenerateTextFn = (args: {
  model: LanguageModel;
  system?: string;
  prompt: string;
}) => Promise<{
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}>;

const defaultGenerateText: GenerateTextFn = async ({
  model,
  system,
  prompt,
}) => {
  const { text, usage } = await generateText({ model, system, prompt });
  return {
    text,
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    },
  };
};

const HYDE_SYSTEM = `Írj egy rövid (2-4 mondatos), tárgyszerű magyar bekezdést, amely úgy válaszol a kérdésre, mintha egy növénygondozási cikk részlete lenne. Ne kérdezz vissza, ne mentegetőzz — csak a hipotetikus válasz szövegét add.`;

export interface HydeResult {
  readonly text: string;
  /** A HyDE-hívás token-usage-e (SP5); hiányzik, ha a generateText nem adott usage-t. */
  readonly usage?: StageUsage;
}

export interface HydeDeps {
  readonly model: LanguageModel;
  /** A trace-ben/becslőben megjelenő modell-azonosító (SP5). */
  readonly modelId?: string;
  readonly generateText?: GenerateTextFn;
}

export type Hyde = (
  question: string,
  history?: readonly ChatMessage[],
) => Promise<HydeResult>;

/** Létrehozza a HyDE-függvényt. */
export function createHyde(deps: HydeDeps): Hyde {
  const run = deps.generateText ?? defaultGenerateText;
  return async (question, history = []) => {
    const { text, usage } = await run({
      model: deps.model,
      system: HYDE_SYSTEM,
      prompt: `${formatHistoryForPrompt(history)}Kérdés: ${question}`,
    });
    return {
      text: text.trim(),
      usage: usage
        ? {
            model: deps.modelId ?? 'unknown',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          }
        : undefined,
    };
  };
}
