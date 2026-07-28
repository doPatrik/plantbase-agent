import { createRagModels } from './models.js';
import type { RagConfig } from '../config.js';
import type { LanguageModel } from 'ai';

// `LanguageModel` (ai@7) is a union that also allows a bare provider/model-id
// string (`GlobalProviderModelId`); `createAnthropic(...)(modelId)` always
// returns the object form, so narrow that out to read `.modelId` type-safely.
function modelIdOf(model: LanguageModel): string {
  if (typeof model === 'string') {
    throw new Error('expected a language model instance, got a bare model id');
  }
  return model.modelId;
}

const config: RagConfig = {
  maxAgentIterations: 6,
  debug: false,
  routerModel: 'claude-haiku-4-5',
  hydeModel: 'claude-haiku-4-5',
  rerankModel: 'claude-haiku-4-5',
  answerModel: 'claude-sonnet-4-6',
  topK: 12,
  rerankTopN: 5,
  groundingThreshold: 0.35,
};

describe('createRagModels', () => {
  it('builds a language model per role with the configured model ids', () => {
    const models = createRagModels(config, 'sk-ant-test');
    expect(modelIdOf(models.router)).toBe('claude-haiku-4-5');
    expect(modelIdOf(models.hyde)).toBe('claude-haiku-4-5');
    expect(modelIdOf(models.rerank)).toBe('claude-haiku-4-5');
    expect(modelIdOf(models.answer)).toBe('claude-sonnet-4-6');
    // A katalógus-agent a Sonnet answer-modellt használja (design 4. pont).
    expect(modelIdOf(models.catalog)).toBe('claude-sonnet-4-6');
  });
});
