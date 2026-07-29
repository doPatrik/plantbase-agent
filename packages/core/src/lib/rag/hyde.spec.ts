import { createHyde, type GenerateTextFn } from './hyde.js';
import type { LanguageModel } from 'ai';

const model = { modelId: 'fake' } as unknown as LanguageModel;

describe('createHyde', () => {
  it('returns a hypothetical answer document for the question', async () => {
    let capturedPrompt = '';
    const generateText: GenerateTextFn = async ({ prompt }) => {
      capturedPrompt = prompt;
      return { text: 'A pozsgásokat ritkán, alaposan kell öntözni.' };
    };
    const hyde = createHyde({ model, generateText });
    const doc = await hyde('Hogyan öntözzem a pozsgást?');
    expect(doc.text).toContain('öntözni');
    expect(capturedPrompt).toContain('Hogyan öntözzem a pozsgást?');
  });

  it('a history-t figyelembe veszi a promptban', async () => {
    let captured = '';
    const hyde = createHyde({
      model: {} as never,
      generateText: async ({ prompt }) => {
        captured = prompt;
        return { text: 'hipotetikus' };
      },
    });
    await hyde('És télen?', [
      { role: 'user', content: 'Hogyan öntözzem a monsterát?' },
    ]);
    expect(captured).toContain('Hogyan öntözzem a monsterát?');
    expect(captured).toContain('És télen?');
  });

  it('a generateText usage-ét a modelId-vel StageUsage-ként adja vissza', async () => {
    const hyde = createHyde({
      model,
      modelId: 'claude-haiku-4-5',
      generateText: async () => ({
        text: 'hipotetikus',
        usage: { inputTokens: 40, outputTokens: 30 },
      }),
    });
    const result = await hyde('kérdés');
    expect(result.usage).toEqual({
      model: 'claude-haiku-4-5',
      inputTokens: 40,
      outputTokens: 30,
    });
  });

  it('usage nélküli generateText esetén a usage undefined', async () => {
    const hyde = createHyde({
      model,
      generateText: async () => ({ text: 'hipotetikus' }),
    });
    const result = await hyde('kérdés');
    expect(result.usage).toBeUndefined();
  });
});
