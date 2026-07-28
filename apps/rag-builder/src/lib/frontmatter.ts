// Markdown frontmatter szétválasztása és validálása (boundary → zod).
// A seed/knowledge cikkek egyszerű 3-mezős YAML-frontmattert használnak
// (title / category / source); az értékben lehet kettőspont (pl. "Bug Off: …"),
// ezért CSAK az első kettőspontnál vágunk.

import { z } from 'zod';

export interface ParsedDocument {
  readonly title: string;
  readonly category: string;
  readonly source_url: string | null;
  readonly body: string;
}

const frontmatterSchema = z.object({
  title: z.string().min(1, 'title hiányzik vagy üres.'),
  category: z.string().min(1, 'category hiányzik vagy üres.'),
  source: z.string().min(1).optional(),
});

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Kibontja a frontmatter mezőit és a body-t egy nyers markdown-fájlból.
 * @throws {Error} ha nincs frontmatter-blokk, vagy hiányzik kötelező mező.
 */
export function parseFrontmatter(raw: string): ParsedDocument {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    throw new Error('Hiányzó vagy hibás frontmatter-blokk.');
  }
  const [, block, body] = match;

  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key.length > 0) fields[key] = value;
  }

  const result = frontmatterSchema.safeParse(fields);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Hibás frontmatter: ${issues}`);
  }

  return {
    title: result.data.title,
    category: result.data.category,
    source_url: result.data.source ?? null,
    body: body.trim(),
  };
}
