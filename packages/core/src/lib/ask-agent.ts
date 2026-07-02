// Az agent belépési pontja (B3 fázis): kézzel írt tool-use loop. A felhasználó
// kérdését elküldi a modellnek a teljes Plantbase system prompttal (products séma
// + SQL-szabályok + toolok). Amíg a modell tool_use-t kér, a megfelelő toolt
// lefuttatjuk (read-only), és a tool_result-ot visszaküldjük — amíg végleges
// szöveges válasz nem születik. A toolokat egy registry (agent-tools.ts) adja, a
// loop név szerint dispatch-el; nincs agent-framework (architektura.md).

import Anthropic from '@anthropic-ai/sdk';
import { AgentConfig, loadConfig } from './config.js';
import { buildSystemPrompt } from './schema-context.js';
import {
  runSql as executeSql,
  listCategories as executeListCategories,
} from './runsql.js';
import {
  buildAgentTools,
  type ListCategoriesFn,
  type RunSqlFn,
} from './agent-tools.js';
import { InteractionLogger, nullLogger } from './logger.js';

/** Az Anthropic kliens minimális felülete, amit az askAgent használ
 *  (így teszteléskor injektálható egy fake kliens). */
export interface AnthropicLike {
  readonly messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message>;
  };
}

export type { RunSqlFn, ListCategoriesFn } from './agent-tools.js';

export interface AskAgentOptions {
  /** Validált konfiguráció; ha hiányzik, a process.env-ből töltjük be. */
  readonly config?: AgentConfig;
  /** Anthropic kliens; ha hiányzik, a config alapján hozzuk létre. */
  readonly client?: AnthropicLike;
  /** runSql futtató; alapból a read-only pg alapú runSql. */
  readonly runSql?: RunSqlFn;
  /** listCategories futtató; alapból a read-only pg alapú listCategories. */
  readonly listCategories?: ListCategoriesFn;
  /** Interakció-napló (FR4); alapból nem naplóz. */
  readonly logger?: InteractionLogger;
  /** Tool-use körök felső korlátja (végtelen loop ellen). */
  readonly maxSteps?: number;
}

/** Az agent válasza és a hozzá tartozó (átláthatósági) kontextus. */
export interface AgentResult {
  readonly text: string;
  readonly systemPrompt: string;
  readonly messages: Anthropic.MessageParam[];
  readonly model: string;
  readonly steps: number;
  readonly usage: { input_tokens: number; output_tokens: number };
}

const DEFAULT_MAX_STEPS = 8;

/** A válasz szöveges tartalmának kinyerése a content blokkokból. */
function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Felteszi a kérdést az agentnek (B3: runSql toollal, kézzel írt tool-use loop),
 * és visszaadja a végleges természetes nyelvű választ.
 * @throws {Error} ha a konfiguráció érvénytelen vagy az API-hívás hibázik.
 */
export async function askAgent(
  question: string,
  options: AskAgentOptions = {},
): Promise<AgentResult> {
  const config = options.config ?? loadConfig();
  const client = options.client ?? new Anthropic({ apiKey: config.apiKey });
  const runSql = options.runSql ?? executeSql;
  const listCategories = options.listCategories ?? executeListCategories;
  const logger = options.logger ?? nullLogger;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  const tools = buildAgentTools({ runSql, listCategories });
  const toolsByName = new Map(
    tools.map((tool) => [tool.definition.name, tool]),
  );
  const toolDefinitions = tools.map((tool) => tool.definition);

  const systemPrompt = buildSystemPrompt({ databaseAvailable: true });
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: question },
  ];

  logger.event({ type: 'system', model: config.model, systemPrompt });
  logger.event({ type: 'user', content: question });

  let inputTokens = 0;
  let outputTokens = 0;
  let steps = 0;
  let text = '';

  for (steps = 1; steps <= maxSteps; steps++) {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages,
      tools: toolDefinitions,
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    messages.push({ role: 'assistant', content: response.content });
    logger.event({
      type: 'assistant',
      stop_reason: response.stop_reason,
      content: response.content,
      usage: response.usage,
    });

    if (response.stop_reason !== 'tool_use') {
      text = extractText(response.content);
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') {
        continue;
      }
      logger.event({
        type: 'tool_use',
        tool: block.name,
        tool_use_id: block.id,
        input: block.input,
      });

      let content: string;
      let isError = false;
      const tool = toolsByName.get(block.name);
      if (!tool) {
        content = `Ismeretlen tool: ${block.name}`;
        isError = true;
        logger.event({
          type: 'tool_error',
          tool: block.name,
          tool_use_id: block.id,
          error: content,
        });
      } else {
        try {
          content = await tool.run(block.input);
          logger.event({
            type: 'tool_result',
            tool: block.name,
            tool_use_id: block.id,
          });
        } catch (error: unknown) {
          content = error instanceof Error ? error.message : String(error);
          isError = true;
          logger.event({
            type: 'tool_error',
            tool: block.name,
            tool_use_id: block.id,
            error: content,
          });
        }
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content,
        is_error: isError,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  if (text.length === 0) {
    text = `Nem sikerült választ adni a megengedett ${maxSteps} lépésen belül.`;
  }

  const usage = { input_tokens: inputTokens, output_tokens: outputTokens };
  logger.event({ type: 'final', text, steps, usage });

  return { text, systemPrompt, messages, model: config.model, steps, usage };
}
