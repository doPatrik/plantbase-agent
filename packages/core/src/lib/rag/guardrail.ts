// Guardrail stage (SP3a): TISZTA KÓD küszöb-ellenőrzés. Ha 0 találat van, vagy a
// legnagyobb cosine-similarity a grounding-küszöb ALATT van, akkor NINCS elég
// megbízható forrás — a pipeline az answer-hívás NÉLKÜL a magyar "nem tudok
// válaszolni" üzenetet adja, hogy ne hallucináljon (PRD kemény garancia).
// A küszöb a 2026-07-28-i retrieval-kalibrációból: releváns találatok ~0.53–0.69,
// a reális küszöb ~0.35 (config.groundingThreshold, env-felülírható).

import type { SearchResult } from '../knowledge-store.js';

/** A grounding-ellenőrzés eredménye. */
export interface GroundingCheck {
  readonly grounded: boolean;
  readonly maxSimilarity: number;
}

/** A magyar üzenet, ha nincs elég megbízható forrás a tudásbázisban. */
export const NO_GROUNDING_MESSAGE =
  'A tudásbázis alapján erre a kérdésre nem tudok megbízhatóan válaszolni, ezért továbbítottam egy kollégának — hamarosan válaszolunk. Addig is pontosíthatod a kérdést, vagy kérdezz növénygondozási témában.';

/** Grounded, ha van találat és a legnagyobb similarity eléri a küszöböt. */
export function checkGrounding(
  chunks: readonly SearchResult[],
  threshold: number,
): GroundingCheck {
  if (chunks.length === 0) {
    return { grounded: false, maxSimilarity: 0 };
  }
  const maxSimilarity = Math.max(...chunks.map((c) => c.similarity));
  return { grounded: maxSimilarity >= threshold, maxSimilarity };
}
