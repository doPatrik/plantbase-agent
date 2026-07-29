import { createHyde, type GenerateTextFn } from './hyde.js';
import type { LanguageModel } from 'ai';
import type { ChatMessage } from '@plantbase/shared';

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
    expect(doc).toContain('öntözni');
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
});
