import type Anthropic from '@anthropic-ai/sdk';
import { askAgent, type AnthropicLike } from './ask-agent.js';
import type { AgentConfig } from './config.js';

const config: AgentConfig = {
  apiKey: 'sk-test-123',
  model: 'claude-sonnet-4-6',
  maxTokens: 1024,
};

/** Fake kliens, ami rögzíti a kapott paramétereket és canned választ ad. */
function makeFakeClient(text: string): {
  client: AnthropicLike;
  calls: Anthropic.MessageCreateParamsNonStreaming[];
} {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: AnthropicLike = {
    messages: {
      create: async (params) => {
        calls.push(params);
        return {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: params.model,
          stop_reason: 'end_turn',
          stop_sequence: null,
          content: [{ type: 'text', text, citations: null }],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, calls };
}

describe('askAgent (B2, no DB)', () => {
  it('should return the assistant text from the response', async () => {
    const { client } = makeFakeClient('Szia! Miben segíthetek?');
    const result = await askAgent('Szia', { config, client });
    expect(result.text).toBe('Szia! Miben segíthetek?');
    expect(result.model).toBe('claude-sonnet-4-6');
  });

  it('should send the no-DB system prompt and the user question', async () => {
    const { client, calls } = makeFakeClient('...');
    await askAgent('Milyen pozsgások vannak raktáron?', { config, client });
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toMatch(/nem férsz hozzá az adatbázishoz/i);
    expect(calls[0].system).not.toContain('runSql');
    expect(calls[0].messages).toEqual([
      { role: 'user', content: 'Milyen pozsgások vannak raktáron?' },
    ]);
  });

  it('should expose the system prompt and messages for transparency', async () => {
    const { client } = makeFakeClient('ok');
    const result = await askAgent('kérdés', { config, client });
    expect(result.systemPrompt).toContain('<role>');
    expect(result.messages).toEqual([{ role: 'user', content: 'kérdés' }]);
  });
});
