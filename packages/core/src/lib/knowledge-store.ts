// Knowledge-store (RAG alapok, SP1): pg-alapú adat-hozzáférés a documents /
// document_chunks táblákhoz. A runsql.ts pool-mintáját követi: paraméteres
// connectionString, megosztott pool, injektálható kliens teszthez.
// Írás (upsert) az RW kapcsolaton (rag-builder); keresés/statisztika az RO-n.
// A vektorkeresés SZÁNDÉKOSAN pg-n megy, nem Prisma-n (architektúra-invariáns).

import pg from 'pg';

const { Pool } = pg;
const EMBEDDING_DIMENSION = 1536;

/** A pg-kliens minimális felülete (Pool és PoolClient is teljesíti); teszthez fake-elhető. */
export interface Queryable {
  query(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface DocumentInput {
  readonly source_path: string;
  readonly title: string;
  readonly source_url: string | null;
  readonly category: string;
  readonly content_hash: string;
  readonly char_count: number;
}

export interface ChunkInput {
  readonly chunk_index: number;
  readonly content: string;
  readonly heading_path: string | null;
  readonly token_count: number | null;
  readonly embedding: readonly number[];
}

export interface SearchResult {
  readonly chunk_id: number;
  readonly document_id: number;
  readonly content: string;
  readonly heading_path: string | null;
  readonly title: string;
  readonly source_url: string | null;
  readonly source_path: string;
  readonly similarity: number;
}

export interface ChunkStats {
  readonly document_count: number;
  readonly chunk_count: number;
  readonly embedded_chunk_count: number;
  readonly avg_chunk_chars: number;
  readonly min_chunk_chars: number;
  readonly max_chunk_chars: number;
}

/** number[] → pgvector literál (`[0.1,0.2,...]`). */
export function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

/** Ellenőrzi az embedding dimenzióját. @throws {Error} eltérés esetén. */
export function assertEmbeddingDim(
  embedding: readonly number[],
  dimension: number = EMBEDDING_DIMENSION,
): void {
  if (embedding.length !== dimension) {
    throw new Error(
      `Embedding dimenzió-hiba: ${embedding.length} (elvárt: ${dimension}).`,
    );
  }
}

const UPSERT_DOCUMENT_SQL = `INSERT INTO documents
  (source_path, title, source_url, category, content_hash, char_count, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, now())
ON CONFLICT (source_path) DO UPDATE SET
  title = EXCLUDED.title,
  source_url = EXCLUDED.source_url,
  category = EXCLUDED.category,
  content_hash = EXCLUDED.content_hash,
  char_count = EXCLUDED.char_count,
  updated_at = now()
RETURNING id`;

/** Upsert egy dokumentumra (source_path kulcs), a document id-t adja vissza. */
export async function upsertDocument(
  client: Queryable,
  doc: DocumentInput,
): Promise<number> {
  const { rows } = await client.query(UPSERT_DOCUMENT_SQL, [
    doc.source_path,
    doc.title,
    doc.source_url,
    doc.category,
    doc.content_hash,
    doc.char_count,
  ]);
  return Number(rows[0].id);
}

const DELETE_CHUNKS_SQL = `DELETE FROM document_chunks WHERE document_id = $1`;
const INSERT_CHUNK_SQL = `INSERT INTO document_chunks
  (document_id, chunk_index, content, heading_path, token_count, embedding)
VALUES ($1, $2, $3, $4, $5, $6::vector)`;

/** A dokumentum összes chunkját lecseréli az újakra (idempotens rebuild). */
export async function replaceChunks(
  client: Queryable,
  documentId: number,
  chunks: readonly ChunkInput[],
): Promise<number> {
  await client.query(DELETE_CHUNKS_SQL, [documentId]);
  for (const chunk of chunks) {
    assertEmbeddingDim(chunk.embedding);
    await client.query(INSERT_CHUNK_SQL, [
      documentId,
      chunk.chunk_index,
      chunk.content,
      chunk.heading_path,
      chunk.token_count,
      toVectorLiteral(chunk.embedding),
    ]);
  }
  return chunks.length;
}

const pools = new Map<string, pg.Pool>();

function getPool(connectionString: string): pg.Pool {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({ connectionString });
    pools.set(connectionString, pool);
  }
  return pool;
}

/** Minden nyitott pool lezárása (teszt/CLI leállításkor). */
export async function closeKnowledgePool(): Promise<void> {
  for (const pool of pools.values()) {
    await pool.end();
  }
  pools.clear();
}

function resolveConnectionString(explicit?: string): string {
  const connectionString = explicit ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL nincs beállítva (knowledge-store írás).');
  }
  return connectionString;
}

function resolveReadConnectionString(explicit?: string): string {
  const connectionString = explicit ?? process.env.DATABASE_URL_READONLY;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_READONLY nincs beállítva (knowledge-store keresés).',
    );
  }
  return connectionString;
}

export interface WriteOptions {
  /** RW kapcsolat; alapból DATABASE_URL. */
  readonly connectionString?: string;
  /** Injektálható kliens teszthez; ilyenkor NEM nyitunk tranzakciót. */
  readonly client?: Queryable;
}

/** Egy dokumentum + chunkjai atomikus upsertje (tranzakcióban). */
export async function upsertDocumentWithChunks(
  doc: DocumentInput,
  chunks: readonly ChunkInput[],
  options: WriteOptions = {},
): Promise<{ documentId: number; chunkCount: number }> {
  if (options.client) {
    const documentId = await upsertDocument(options.client, doc);
    const chunkCount = await replaceChunks(options.client, documentId, chunks);
    return { documentId, chunkCount };
  }
  const pool = getPool(resolveConnectionString(options.connectionString));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const documentId = await upsertDocument(client, doc);
    const chunkCount = await replaceChunks(client, documentId, chunks);
    await client.query('COMMIT');
    return { documentId, chunkCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SEARCH_SQL = `SELECT
  dc.id AS chunk_id,
  dc.document_id,
  dc.content,
  dc.heading_path,
  d.title,
  d.source_url,
  d.source_path,
  1 - (dc.embedding <=> $1::vector) AS similarity
FROM document_chunks dc
JOIN documents d ON d.id = dc.document_id
ORDER BY dc.embedding <=> $1::vector
LIMIT $2`;

export interface ReadOptions {
  /** RO kapcsolat; alapból DATABASE_URL_READONLY. */
  readonly connectionString?: string;
  /** Injektálható kliens teszthez. */
  readonly client?: Queryable;
}

/** Koszinusz-hasonlóság szerinti top-k chunk (RO). */
export async function searchChunks(
  queryEmbedding: readonly number[],
  k: number,
  options: ReadOptions = {},
): Promise<SearchResult[]> {
  assertEmbeddingDim(queryEmbedding);
  const client =
    options.client ??
    getPool(resolveReadConnectionString(options.connectionString));
  const { rows } = await client.query(SEARCH_SQL, [
    toVectorLiteral(queryEmbedding),
    k,
  ]);
  return rows.map((row) => ({
    chunk_id: Number(row.chunk_id),
    document_id: Number(row.document_id),
    content: String(row.content),
    heading_path: row.heading_path === null ? null : String(row.heading_path),
    title: String(row.title),
    source_url: row.source_url === null ? null : String(row.source_url),
    source_path: String(row.source_path),
    similarity: Number(row.similarity),
  }));
}

const STATS_SQL = `SELECT
  (SELECT count(*) FROM documents) AS document_count,
  (SELECT count(*) FROM document_chunks) AS chunk_count,
  (SELECT count(*) FROM document_chunks WHERE embedding IS NOT NULL) AS embedded_chunk_count,
  (SELECT coalesce(avg(char_length(content)), 0) FROM document_chunks) AS avg_chunk_chars,
  (SELECT coalesce(min(char_length(content)), 0) FROM document_chunks) AS min_chunk_chars,
  (SELECT coalesce(max(char_length(content)), 0) FROM document_chunks) AS max_chunk_chars`;

/** Chunk-statisztika a debug-endpointhoz (RO). */
export async function getChunkStats(
  options: ReadOptions = {},
): Promise<ChunkStats> {
  const client =
    options.client ??
    getPool(resolveReadConnectionString(options.connectionString));
  const { rows } = await client.query(STATS_SQL, []);
  const row = rows[0];
  return {
    document_count: Number(row.document_count),
    chunk_count: Number(row.chunk_count),
    embedded_chunk_count: Number(row.embedded_chunk_count),
    avg_chunk_chars: Number(row.avg_chunk_chars),
    min_chunk_chars: Number(row.min_chunk_chars),
    max_chunk_chars: Number(row.max_chunk_chars),
  };
}

const EXISTING_HASHES_SQL = `SELECT source_path, content_hash FROM documents`;

/** Meglévő dokumentumok source_path → content_hash térképe (RO, idempotens rebuildhez). */
export async function getExistingDocumentHashes(
  options: ReadOptions = {},
): Promise<Map<string, string>> {
  const client =
    options.client ??
    getPool(resolveReadConnectionString(options.connectionString));
  const { rows } = await client.query(EXISTING_HASHES_SQL, []);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(String(row.source_path), String(row.content_hash));
  }
  return map;
}
