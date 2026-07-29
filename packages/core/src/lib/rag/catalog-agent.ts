// Katalógus-agent (SP3a): a products-út. streamText a catalogSql + listCategories
// toolokkal, stopWhen: stepCountIs(maxIterations) — a modell addig hívhat toolt,
// míg meg nem válaszol, de a felső korlát véd a végtelen loop ellen. A system
// prompt a meglévő schema-context.ts-ből jön (products séma + SQL-szabályok).
// A streamText injektálható (teszt); a default a valós AI SDK-hívás.

import {
  streamText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { buildSystemPrompt } from '../schema-context.js';
import { toModelMessages } from './history.js';
import {
  createCatalogTools,
  type ListCategoriesFn,
  type RunSqlFn,
} from './tools.js';
import type { ChatMessage } from '@plantbase/shared';

/** Szűk, injektálható streamText a katalógus-úthoz (tools + stopWhen). */
export type CatalogStreamFn = (args: {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  stopWhen: ReturnType<typeof stepCountIs>;
}) => { textStream: AsyncIterable<string> };

const defaultStreamCatalog: CatalogStreamFn = ({
  model,
  system,
  messages,
  tools,
  stopWhen,
}) => {
  const { textStream } = streamText({
    model,
    system,
    messages,
    tools,
    stopWhen,
  });
  return { textStream };
};

export interface CatalogAgentDeps {
  readonly model: LanguageModel;
  readonly runSql: RunSqlFn;
  readonly listCategories: ListCategoriesFn;
  readonly maxIterations: number;
  readonly streamCatalog?: CatalogStreamFn;
}

export type CatalogAgent = (
  question: string,
  history?: readonly ChatMessage[],
) => {
  textStream: AsyncIterable<string>;
};

/** Létrehozza a katalógus-agentet (streamelő, tool-loop stopWhen-nel). */
export function createCatalogAgent(deps: CatalogAgentDeps): CatalogAgent {
  const run = deps.streamCatalog ?? defaultStreamCatalog;
  const tools = createCatalogTools({
    runSql: deps.runSql,
    listCategories: deps.listCategories,
  });
  const system = buildSystemPrompt({ databaseAvailable: true });
  return (question, history = []) => {
    const messages = toModelMessages(history, question);
    return run({
      model: deps.model,
      system,
      messages,
      tools,
      stopWhen: stepCountIs(deps.maxIterations),
    });
  };
}
