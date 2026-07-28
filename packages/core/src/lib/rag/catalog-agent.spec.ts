import { createCatalogAgent, type CatalogStreamFn } from './catalog-agent.js';
import type { LanguageModel } from 'ai';

const model = { modelId: 'fake' } as unknown as LanguageModel;

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const part of stream) out += part;
  return out;
}

describe('createCatalogAgent', () => {
  it('streams the catalog answer, wiring tools, system prompt and the question', async () => {
    let captured: Parameters<CatalogStreamFn>[0] | undefined;
    const streamCatalog: CatalogStreamFn = (args) => {
      captured = args;
      return {
        textStream: (async function* () {
          yield 'A ';
          yield 'Kentia';
        })(),
      };
    };
    const agent = createCatalogAgent({
      model,
      runSql: async () => [],
      listCategories: async () => [],
      maxIterations: 6,
      streamCatalog,
    });
    const { textStream } = agent('Mennyi a Kentia pálma?');
    expect(await collect(textStream)).toBe('A Kentia');
    expect(captured?.system).toContain('<schema>');
    expect(Object.keys(captured?.tools ?? {})).toContain('catalogSql');
    // A kérdés user-üzenetként megy be.
    expect(JSON.stringify(captured?.messages)).toContain(
      'Mennyi a Kentia pálma?',
    );
  });
});
