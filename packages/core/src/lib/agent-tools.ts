// Az agent eszközkészlete (tool-registry). Minden tool egyetlen egység: az
// Anthropic tool-definíció (amit a modell lát) + a `run` handler (ami a nyers
// tool-inputból előállítja a tool_result szöveges tartalmát). Az askAgent loop
// név szerint dispatch-el ezekre — új tool = egy új sor a buildAgentTools-ban,
// a loop mérete változatlan (nincs if/else-lánc).

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SqlRow } from './runsql.js';

/** A runSql tool futtatója (injektálható teszthez). */
export type RunSqlFn = (query: string) => Promise<SqlRow[]>;

/** A listCategories tool futtatója (injektálható teszthez). */
export type ListCategoriesFn = () => Promise<string[]>;

/** Egy agent-tool: a modellnek szóló definíció + a végrehajtó handler. */
export interface AgentTool {
  readonly definition: Anthropic.Tool;
  /**
   * Lefuttatja a toolt a modell által adott nyers inputtal, és a tool_result
   * szöveges tartalmát adja vissza.
   * @throws {Error} ha az input érvénytelen vagy a futás hibázik; a loop ezt
   *   is_error tool_result-ként küldi vissza a modellnek.
   */
  run(input: unknown): Promise<string>;
}

const runSqlInputSchema = z.object({ query: z.string().min(1) });

/** A runSql tool: read-only SELECT futtatása a katalóguson. */
export function createRunSqlTool(runSql: RunSqlFn): AgentTool {
  return {
    definition: {
      name: 'runSql',
      description:
        'Read-only SQL futtatása a products katalóguson. A generált SELECT-et mindig ezzel futtasd, ne csak írd ki. Csak SELECT engedélyezett; az eredmény JSON sorok tömbje.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A futtatandó PostgreSQL SELECT lekérdezés.',
          },
        },
        required: ['query'],
      },
    },
    async run(input) {
      const parsed = runSqlInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Érvénytelen runSql input: ${parsed.error.issues
            .map((issue) => issue.message)
            .join('; ')}`,
        );
      }
      try {
        const rows = await runSql(parsed.data.query);
        return JSON.stringify(rows);
      } catch (error: unknown) {
        throw new Error(
          `SQL hiba: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

/** A listCategories tool: a katalógus kategória-szókészlete (nincs inputja). */
export function createListCategoriesTool(
  listCategories: ListCategoriesFn,
): AgentTool {
  return {
    definition: {
      name: 'listCategories',
      description:
        'A katalógusban ténylegesen előforduló növénykategóriák hiteles, ábécé-rendezett listája (a products.category distinct értékei). Használd, ha kategóriára szűrsz vagy a kategóriákról kérdeznek — ne a séma-komment felsorolására hagyatkozz. Nincs bemeneti paramétere.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    async run() {
      const categories = await listCategories();
      return JSON.stringify(categories);
    },
  };
}

/** Az agent futtatóinak halmaza (dependency injection a toolokhoz). */
export interface AgentToolDeps {
  readonly runSql: RunSqlFn;
  readonly listCategories: ListCategoriesFn;
}

/** Összeállítja az agent eszközkészletét. Új tool = egy új sor itt. */
export function buildAgentTools(deps: AgentToolDeps): AgentTool[] {
  return [
    createRunSqlTool(deps.runSql),
    createListCategoriesTool(deps.listCategories),
  ];
}
