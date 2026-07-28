// Katalógus-toolok AI SDK `tool()` formában (SP3a). A régi agent-tools.ts Anthropic-
// SDK definícióit váltja le. A catalogSql a read-only runSql guard mögött fut
// (assertSelectOnly + DATABASE_URL_READONLY — kettős védelem invariáns), a
// listCategories a hiteles kategória-listát adja. A futtatók injektálhatók (teszt).

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { SqlRow } from '../runsql.js';

/** A runSql tool futtatója (injektálható teszthez). */
export type RunSqlFn = (query: string) => Promise<SqlRow[]>;
/** A listCategories tool futtatója (injektálható teszthez). */
export type ListCategoriesFn = () => Promise<string[]>;

export interface CatalogToolDeps {
  readonly runSql: RunSqlFn;
  readonly listCategories: ListCategoriesFn;
}

/** Összeállítja a katalógus-út AI SDK toolkészletét. */
export function createCatalogTools(deps: CatalogToolDeps): ToolSet {
  return {
    catalogSql: tool({
      description:
        'Read-only SQL futtatása a products katalóguson. A generált SELECT-et mindig ezzel futtasd, ne csak írd ki. Csak SELECT engedélyezett; az eredmény JSON sorok tömbje.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe('A futtatandó PostgreSQL SELECT lekérdezés.'),
      }),
      execute: async ({ query }) => {
        const rows = await deps.runSql(query);
        return JSON.stringify(rows);
      },
    }),
    listCategories: tool({
      description:
        'A katalógusban ténylegesen előforduló növénykategóriák hiteles, ábécé-rendezett listája (a products.category distinct értékei). Kategóriára szűrésnél / kategória-kérdésnél ezt használd. Nincs bemeneti paramétere.',
      inputSchema: z.object({}),
      execute: async () => {
        const categories = await deps.listCategories();
        return JSON.stringify(categories);
      },
    }),
  };
}
