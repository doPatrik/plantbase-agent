import type Anthropic from '@anthropic-ai/sdk';
import { askAgent, type AnthropicLike } from './ask-agent.js';
import type { AgentConfig } from './config.js';
import type { InteractionLogger } from './logger.js';

const config: AgentConfig = {
  apiKey: 'sk-test-123',
  model: 'claude-sonnet-4-6',
  maxTokens: 1024,
};

const usage = { input_tokens: 10, output_tokens: 5 };

function textResponse(text: string): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: config.model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text, citations: null }],
    usage,
  } as unknown as Anthropic.Message;
}

function toolUseResponse(id: string, query: string): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: config.model,
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [{ type: 'tool_use', id, name: 'runSql', input: { query } }],
    usage,
  } as unknown as Anthropic.Message;
}

function listCategoriesToolUse(id: string): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: config.model,
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [{ type: 'tool_use', id, name: 'listCategories', input: {} }],
    usage,
  } as unknown as Anthropic.Message;
}

function unknownToolUse(id: string, name: string): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: config.model,
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [{ type: 'tool_use', id, name, input: {} }],
    usage,
  } as unknown as Anthropic.Message;
}

/** Fake kliens, ami egy előre megadott válasz-sorozatot ad vissza, és rögzíti a hívásokat. */
function scriptedClient(responses: Anthropic.Message[]): {
  client: AnthropicLike;
  calls: Anthropic.MessageCreateParamsNonStreaming[];
} {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  const client: AnthropicLike = {
    messages: {
      create: async (params) => {
        // Pillanatkép: a valódi SDK is szerializálja a paramétereket híváskor,
        // így a messages tömb későbbi mutációja nem érinti a rögzített hívást.
        calls.push(structuredClone(params));
        return responses[i++];
      },
    },
  };
  return { client, calls };
}

/** In-memory logger a naplózott események ellenőrzéséhez. */
function memoryLogger(): {
  logger: InteractionLogger;
  events: Record<string, unknown>[];
} {
  const events: Record<string, unknown>[] = [];
  return {
    events,
    logger: { filePath: '', event: (e) => events.push(e) },
  };
}

describe('askAgent (B3, tool-use loop)', () => {
  it('should send the full DB-enabled system prompt with the runSql tool', async () => {
    const { client, calls } = scriptedClient([textResponse('kész')]);
    await askAgent('kérdés', { config, client, runSql: async () => [] });
    expect(calls[0].system).toContain('<schema>');
    expect(calls[0].system).toContain('CSAK SELECT');
    expect(calls[0].tools?.[0].name).toBe('runSql');
  });

  it('should return the text directly when the model does not use a tool', async () => {
    const { client } = scriptedClient([textResponse('Szia!')]);
    const result = await askAgent('Szia', {
      config,
      client,
      runSql: async () => [],
    });
    expect(result.text).toBe('Szia!');
    expect(result.steps).toBe(1);
  });

  it('should run runSql on tool_use, feed the result back, and answer', async () => {
    const rows = [{ name: 'Kentia pálma', price: '18900' }];
    const calledQueries: string[] = [];
    const { client, calls } = scriptedClient([
      toolUseResponse('tool_1', 'SELECT name, price FROM products LIMIT 5'),
      textResponse('A Kentia pálma 18900 Ft.'),
    ]);

    const result = await askAgent('Mennyi a Kentia pálma?', {
      config,
      client,
      runSql: async (q) => {
        calledQueries.push(q);
        return rows;
      },
    });

    expect(calledQueries).toEqual(['SELECT name, price FROM products LIMIT 5']);
    expect(result.text).toBe('A Kentia pálma 18900 Ft.');
    expect(result.steps).toBe(2);

    // A második hívásban vissza kellett küldeni a tool_result-ot a sorokkal.
    const secondCallMessages = calls[1].messages;
    const toolResultMsg = secondCallMessages[secondCallMessages.length - 1];
    expect(toolResultMsg.role).toBe('user');
    const block = (
      toolResultMsg.content as Anthropic.ToolResultBlockParam[]
    )[0];
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('tool_1');
    expect(block.content).toContain('Kentia');
  });

  it('should send a tool_result with is_error when runSql throws', async () => {
    const { client, calls } = scriptedClient([
      toolUseResponse('tool_1', 'UPDATE products SET price = 0'),
      textResponse('Sajnálom, nem sikerült.'),
    ]);

    const result = await askAgent('rossz kérdés', {
      config,
      client,
      runSql: async () => {
        throw new Error('Csak SELECT engedélyezett.');
      },
    });

    const block = (
      calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]
    )[0];
    expect(block.is_error).toBe(true);
    expect(block.content).toContain('SQL hiba');
    expect(result.text).toBe('Sajnálom, nem sikerült.');
  });

  it('should log system, tool_use, tool_result and final events (FR4)', async () => {
    const { logger, events } = memoryLogger();
    const { client } = scriptedClient([
      toolUseResponse('t1', 'SELECT 1'),
      textResponse('ok'),
    ]);
    await askAgent('q', {
      config,
      client,
      runSql: async () => [{ x: 1 }],
      logger,
    });
    const types = events.map((e) => e.type);
    expect(types).toContain('system');
    expect(types).toContain('tool_use');
    expect(types).toContain('tool_result');
    expect(types).toContain('final');
  });
});

describe('askAgent (listCategories tool)', () => {
  it('should offer both the runSql and listCategories tools', async () => {
    const { client, calls } = scriptedClient([textResponse('kész')]);
    await askAgent('kérdés', {
      config,
      client,
      runSql: async () => [],
      listCategories: async () => [],
    });
    const toolNames = calls[0].tools?.map((tool) => tool.name);
    expect(toolNames).toContain('runSql');
    expect(toolNames).toContain('listCategories');
  });

  it('should call listCategories on tool_use, feed the result back, and answer', async () => {
    let called = 0;
    const { client, calls } = scriptedClient([
      listCategoriesToolUse('cat_1'),
      textResponse('A kategóriák: fűszer, kaktusz.'),
    ]);

    const result = await askAgent('Milyen kategóriák vannak?', {
      config,
      client,
      runSql: async () => [],
      listCategories: async () => {
        called++;
        return ['fűszer', 'kaktusz'];
      },
    });

    expect(called).toBe(1);
    expect(result.text).toBe('A kategóriák: fűszer, kaktusz.');

    const block = (
      calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]
    )[0];
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('cat_1');
    expect(block.content).toContain('fűszer');
  });

  it('should record which tool ran in the tool_use log event', async () => {
    const { logger, events } = memoryLogger();
    const { client } = scriptedClient([
      listCategoriesToolUse('c1'),
      textResponse('ok'),
    ]);
    await askAgent('q', {
      config,
      client,
      runSql: async () => [],
      listCategories: async () => ['fűszer'],
      logger,
    });
    const toolUse = events.find((e) => e.type === 'tool_use');
    expect(toolUse?.tool).toBe('listCategories');
  });

  it('should return an is_error tool_result for an unknown tool', async () => {
    const { client, calls } = scriptedClient([
      unknownToolUse('u1', 'dropEverything'),
      textResponse('Nem tudom végrehajtani.'),
    ]);
    await askAgent('q', {
      config,
      client,
      runSql: async () => [],
      listCategories: async () => [],
    });
    const block = (
      calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]
    )[0];
    expect(block.is_error).toBe(true);
  });
});
