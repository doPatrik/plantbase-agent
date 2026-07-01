// Az agent belépési pontja (B2 fázis): egyszerű LLM-hívás, tool/DB nélkül.
// A felhasználó kérdését elküldi a modellnek a Plantbase system prompttal, és
// visszaadja a szöveges választ + az átláthatósághoz szükséges kontextust
// (system prompt, üzenetek) — utóbbit a CLI --show-prompt flagje használja.

import Anthropic from '@anthropic-ai/sdk';
import { AgentConfig, loadConfig } from './config.js';
import { buildSystemPrompt } from './schema-context.js';

/** Az Anthropic kliens minimális felülete, amit az askAgent használ
 *  (így teszteléskor injektálható egy fake kliens). */
export interface AnthropicLike {
  readonly messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message>;
  };
}

export interface AskAgentOptions {
  /** Validált konfiguráció; ha hiányzik, a process.env-ből töltjük be. */
  readonly config?: AgentConfig;
  /** Anthropic kliens; ha hiányzik, a config alapján hozzuk létre. */
  readonly client?: AnthropicLike;
}

/** Az agent válasza és a hozzá tartozó (átláthatósági) kontextus. */
export interface AgentResult {
  readonly text: string;
  readonly systemPrompt: string;
  readonly messages: Anthropic.MessageParam[];
  readonly model: string;
  readonly usage?: Anthropic.Usage;
}

/** A válasz szöveges tartalmának kinyerése a content blokkokból. */
function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Felteszi a kérdést az agentnek (B2: DB/tool nélkül) és visszaadja a választ.
 * @throws {Error} ha a konfiguráció érvénytelen vagy az API-hívás hibázik.
 */
export async function askAgent(
  question: string,
  options: AskAgentOptions = {},
): Promise<AgentResult> {
  const config = options.config ?? loadConfig();
  const client = options.client ?? new Anthropic({ apiKey: config.apiKey });

  const systemPrompt = buildSystemPrompt({ databaseAvailable: false });
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: question },
  ];

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    system: systemPrompt,
    messages,
  });

  return {
    text: extractText(response.content),
    systemPrompt,
    messages,
    model: config.model,
    usage: response.usage,
  };
}
