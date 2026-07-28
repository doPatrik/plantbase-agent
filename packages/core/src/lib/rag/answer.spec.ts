import { createAnswer, toSourceRefs, type AnswerStreamFn } from './answer.js';
import type { LanguageModel } from 'ai';
import type { SearchResult } from '../knowledge-store.js';

const model = { modelId: 'fake' } as unknown as LanguageModel;

const chunk = (docId: number, title: string): SearchResult => ({
  chunk_id: docId * 10,
  document_id: docId,
  content: `tartalom ${title}`,
  heading_path: 'Öntözés',
  title,
  source_url: docId === 1 ? 'https://example.hu/a' : null,
  source_path: `seed/knowledge/${title}.md`,
  similarity: 0.6,
});

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const part of stream) out += part;
  return out;
}

describe('toSourceRefs', () => {
  it('dedupes by document_id, keeping first occurrence order', () => {
    const refs = toSourceRefs([chunk(1, 'a'), chunk(1, 'a'), chunk(2, 'b')]);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      title: 'a',
      sourceUrl: 'https://example.hu/a',
      sourcePath: 'seed/knowledge/a.md',
      headingPath: 'Öntözés',
    });
    expect(refs[1].title).toBe('b');
  });
});

describe('createAnswer', () => {
  it('streams the answer and includes the chunk content in the prompt', async () => {
    let capturedPrompt = '';
    const streamAnswer: AnswerStreamFn = ({ prompt }) => {
      capturedPrompt = prompt;
      return {
        textStream: (async function* () {
          yield 'A ';
          yield 'pozsgás';
        })(),
      };
    };
    const answer = createAnswer({ model, streamAnswer });
    const result = answer({
      question: 'Hogyan öntözzem?',
      chunks: [chunk(1, 'a')],
    });
    expect(await collect(result.textStream)).toBe('A pozsgás');
    expect(capturedPrompt).toContain('tartalom a');
    expect(result.sources.map((s) => s.title)).toEqual(['a']);
  });

  it('passes catalogContext into the prompt when present (both route)', async () => {
    let capturedPrompt = '';
    const streamAnswer: AnswerStreamFn = ({ prompt }) => {
      capturedPrompt = prompt;
      return {
        textStream: (async function* () {
          yield 'ok';
        })(),
      };
    };
    const answer = createAnswer({ model, streamAnswer });
    answer({
      question: 'q',
      chunks: [chunk(1, 'a')],
      catalogContext: 'Kentia pálma: 18900 Ft',
    }).textStream;
    expect(capturedPrompt).toContain('Kentia pálma: 18900 Ft');
  });
});
