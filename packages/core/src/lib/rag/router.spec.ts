import { createRouter, type GenerateObjectFn } from './router.js';
import type { LanguageModel } from 'ai';
import type { ChatMessage } from '@plantbase/shared';

const model = { modelId: 'fake' } as unknown as LanguageModel;

describe('createRouter', () => {
  it('returns the classified route and passes the question in the prompt', async () => {
    let capturedPrompt = '';
    // Test-only cast (consistent with the `model` cast above): `GenerateObjectFn`'s
    // `T` is universally quantified (the real generateObject infers it from the
    // caller-provided zod schema), but this fake always returns one concrete
    // shape, so it is cast to the DI type rather than annotated as it.
    const generateObject = (async ({ prompt }) => {
      capturedPrompt = prompt;
      return {
        object: { route: 'catalog', reasoning: 'Konkrét termékadat kell.' },
      };
    }) as GenerateObjectFn;
    const router = createRouter({ model, generateObject });
    const result = await router('Mennyibe kerül a Kentia pálma?');
    expect(result.route).toBe('catalog');
    expect(result.reasoning).toContain('termékadat');
    expect(capturedPrompt).toContain('Mennyibe kerül a Kentia pálma?');
  });

  it('propagates the schema so an invalid route would be rejected upstream', async () => {
    const generateObject = (async ({ schema }) => {
      // A séma zod-objektum: a route mezőnek enumnak kell lennie.
      expect(schema.safeParse({ route: 'both', reasoning: 'x' }).success).toBe(
        true,
      );
      expect(schema.safeParse({ route: 'nope', reasoning: 'x' }).success).toBe(
        false,
      );
      return { object: { route: 'both', reasoning: 'x' } };
    }) as GenerateObjectFn;
    const router = createRouter({ model, generateObject });
    expect((await router('q')).route).toBe('both');
  });

  it('a history-t beleszövi a promptba', async () => {
    let captured = '';
    const router = createRouter({
      model: {} as never,
      generateObject: async ({ prompt }) => {
        captured = prompt;
        return { object: { route: 'knowledge', reasoning: 'ok' } };
      },
    });
    await router('És a kaktuszok?', [
      { role: 'user', content: 'Mesélj a pozsgásokról' },
      { role: 'assistant', content: 'A pozsgások...' },
    ]);
    expect(captured).toContain('Mesélj a pozsgásokról');
    expect(captured).toContain('És a kaktuszok?');
  });
});
