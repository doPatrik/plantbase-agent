// HyDE (Hypothetical Document Embeddings) stage (SP3a): a kérdésre generálunk egy
// rövid, hipotetikus választ, és AZT ágyazzuk be a vektorkereséshez (a query-oldal
// minősége nő, mert a hipotetikus válasz szókincse közelebb áll a tárolt cikkekhez).
// Olcsó Haiku; a generateText injektálható a teszthez.

import { generateText, type LanguageModel } from 'ai';

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

export type Hyde = (question: string) => Promise<string>;

/** Létrehozza a HyDE-függvényt. */
export function createHyde(deps: HydeDeps): Hyde {
  const run = deps.generateText ?? defaultGenerateText;
  return async (question) => {
    const { text } = await run({
      model: deps.model,
      system: HYDE_SYSTEM,
      prompt: `Kérdés: ${question}`,
    });
    return text.trim();
  };
}
