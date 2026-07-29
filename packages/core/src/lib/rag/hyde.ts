// HyDE (Hypothetical Document Embeddings) stage (SP3a): a kérdésre generálunk egy
// rövid, hipotetikus választ, és AZT ágyazzuk be a vektorkereséshez (a query-oldal
// minősége nő, mert a hipotetikus válasz szókincse közelebb áll a tárolt cikkekhez).
// Olcsó Haiku; a generateText injektálható a teszthez.

import { generateText, type LanguageModel } from 'ai';
import { formatHistoryForPrompt } from './history.js';
import type { ChatMessage } from '@plantbase/shared';

/** Szűk, injektálható generateText (csak amit a HyDE használ). */
export type GenerateTextFn = (args: {
  model: LanguageModel;
  system?: string;
  prompt: string;
}) => Promise<{ text: string }>;

const defaultGenerateText: GenerateTextFn = async ({
  model,
  system,
  prompt,
}) => {
  const { text } = await generateText({ model, system, prompt });
  return { text };
};

const HYDE_SYSTEM = `Írj egy rövid (2-4 mondatos), tárgyszerű magyar bekezdést, amely úgy válaszol a kérdésre, mintha egy növénygondozási cikk részlete lenne. Ne kérdezz vissza, ne mentegetőzz — csak a hipotetikus válasz szövegét add.`;

export interface HydeDeps {
  readonly model: LanguageModel;
  readonly generateText?: GenerateTextFn;
}

export type Hyde = (
  question: string,
  history?: readonly ChatMessage[],
) => Promise<string>;

/** Létrehozza a HyDE-függvényt. */
export function createHyde(deps: HydeDeps): Hyde {
  const run = deps.generateText ?? defaultGenerateText;
  return async (question, history = []) => {
    const { text } = await run({
      model: deps.model,
      system: HYDE_SYSTEM,
      prompt: `${formatHistoryForPrompt(history)}Kérdés: ${question}`,
    });
    return text.trim();
  };
}
