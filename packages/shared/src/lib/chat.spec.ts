import {
  ragAnswerSchema,
  sourceRefSchema,
  type RagAnswer,
  type SourceRef,
} from './chat.js';

describe('chat DTOs', () => {
  it('parses a SourceRef with a null url', () => {
    const source: SourceRef = {
      title: 'Pozsgások gondozása',
      sourceUrl: null,
      sourcePath: 'seed/knowledge/pozsgas.md',
      headingPath: 'Öntözés',
    };
    expect(sourceRefSchema.parse(source)).toEqual(source);
  });

  it('parses a RagAnswer with sources', () => {
    const answer: RagAnswer = {
      text: 'A pozsgásokat ritkán kell öntözni.',
      route: 'knowledge',
      sources: [
        {
          title: 'Pozsgások gondozása',
          sourceUrl: 'https://example.hu/pozsgas',
          sourcePath: 'seed/knowledge/pozsgas.md',
          headingPath: null,
        },
      ],
    };
    expect(ragAnswerSchema.parse(answer)).toEqual(answer);
  });

  it('rejects a RagAnswer with an invalid route', () => {
    const bad = { text: 'x', route: 'weather', sources: [] };
    expect(ragAnswerSchema.safeParse(bad).success).toBe(false);
  });
});
