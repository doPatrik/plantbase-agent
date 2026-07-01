// Read-only runSql tool (B3 fázis). Az agent ezen keresztül futtat SQL-t a
// products katalóguson. Kettős védelem (NFR1, architektura.md):
//   1. a DB read-only role (DATABASE_URL_READONLY) — az igazi garancia;
//   2. kód-szintű SELECT-only guard — defense-in-depth, félrement lekérdezés esetén.
// Az agent NEM Prisma-n át kérdez: itt közvetlen pg kapcsolatot használunk.

import pg from 'pg';

const { Pool } = pg;

export type SqlRow = Record<string, unknown>;

/** A lekérdezésben tiltott (adatmódosító / DDL / jogosultsági) kulcsszavak. */
const FORBIDDEN_KEYWORD =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|copy|call|do|merge|set|vacuum|analyze)\b/i;

/**
 * Ellenőrzi, hogy a lekérdezés csak olvasó SELECT (vagy WITH ... SELECT) és egyetlen
 * utasítás. Hiba esetén dob.
 * @throws {Error} ha a lekérdezés nem engedélyezett.
 */
export function assertSelectOnly(query: string): void {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error('Üres lekérdezés.');
  }
  // Csak egyetlen utasítás: a végső pontosvessző megengedett, közbülső nem.
  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    throw new Error(
      'Csak egyetlen SQL utasítás engedélyezett (nincs több `;`).',
    );
  }
  if (!/^(select|with)\b/i.test(withoutTrailingSemicolon)) {
    throw new Error(
      'Csak SELECT (vagy WITH ... SELECT) lekérdezés engedélyezett.',
    );
  }
  if (FORBIDDEN_KEYWORD.test(withoutTrailingSemicolon)) {
    throw new Error(
      'Tiltott (adatmódosító vagy DDL) kulcsszó a lekérdezésben.',
    );
  }
}

let sharedPool: pg.Pool | undefined;

/** Egyszer létrehozott, megosztott read-only pool. */
function getPool(connectionString: string): pg.Pool {
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString });
  }
  return sharedPool;
}

/** A read-only pool lezárása (pl. teszt/CLI leállításkor). */
export async function closePool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = undefined;
  }
}

export interface RunSqlOptions {
  /** Read-only kapcsolati string; alapból DATABASE_URL_READONLY. */
  readonly connectionString?: string;
}

/**
 * Lefuttat egy read-only SELECT lekérdezést a katalóguson és visszaadja a sorokat.
 * @throws {Error} ha a lekérdezés nem SELECT, vagy nincs read-only kapcsolat, vagy SQL hiba.
 */
export async function runSql(
  query: string,
  options: RunSqlOptions = {},
): Promise<SqlRow[]> {
  assertSelectOnly(query);
  const connectionString =
    options.connectionString ?? process.env.DATABASE_URL_READONLY;
  if (!connectionString) {
    throw new Error('DATABASE_URL_READONLY nincs beállítva.');
  }
  const pool = getPool(connectionString);
  const result = await pool.query(query);
  return result.rows as SqlRow[];
}
