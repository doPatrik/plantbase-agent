// Eszkalációs jegyek append-only JSONL-tárolása (HF5): amikor a RAG-pipeline
// guardrail-je bizonytalan, egy 'opened' eseményt írunk; a support-nézet egy
// 'resolved' eseménnyel zárja le. A list() a két eseménytípust id szerint
// összefésülve adja vissza a jegyeket. Nincs új DB-séma — konzisztens a
// meglévő logger.ts JSONL-naplózási konvenciójával, csak egy fix fájlnévbe
// (nem időbélyegzettbe) írva, hogy sessionök között is megmaradjon.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { EscalationTicket } from '@plantbase/shared';

interface OpenedEvent {
  readonly type: 'opened';
  readonly id: string;
  readonly createdAt: string;
  readonly question: string;
  readonly maxSimilarity: number;
  readonly reason: 'low_grounding';
}

interface ResolvedEvent {
  readonly type: 'resolved';
  readonly id: string;
  readonly resolvedAt: string;
  readonly reply: string;
}

type EscalationEvent = OpenedEvent | ResolvedEvent;

/** Az `open()` bemenete: a kérdés, ami miatt a guardrail bizonytalan volt. */
export interface OpenEscalationInput {
  readonly question: string;
  readonly maxSimilarity: number;
}

export interface EscalationStoreOptions {
  /** Napló mappa; alapból "logs". */
  readonly dir?: string;
  /** Fájlnév; alapból "escalations.jsonl" (fix, nem időbélyegzett). */
  readonly filename?: string;
}

export interface EscalationStore {
  readonly filePath: string;
  /** Új eszkalációs jegy nyitása; visszaadja a pending jegyet. */
  open(input: OpenEscalationInput): EscalationTicket;
  /** Jegy lezárása jóváhagyott válasszal; hibát dob ismeretlen/már lezárt id-ra. */
  resolve(id: string, reply: string): EscalationTicket;
  /** Az összes jegy, összefésülve, a legújabb elöl. */
  list(): EscalationTicket[];
}

function readEvents(filePath: string): EscalationEvent[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8').trim();
  if (raw === '') return [];
  return raw.split('\n').map((line) => JSON.parse(line) as EscalationEvent);
}

function foldEvents(events: readonly EscalationEvent[]): EscalationTicket[] {
  const byId = new Map<string, EscalationTicket>();
  for (const event of events) {
    if (event.type === 'opened') {
      byId.set(event.id, {
        id: event.id,
        createdAt: event.createdAt,
        question: event.question,
        maxSimilarity: event.maxSimilarity,
        reason: event.reason,
        status: 'pending',
        reply: null,
        resolvedAt: null,
      });
    } else {
      const existing = byId.get(event.id);
      if (existing) {
        byId.set(event.id, {
          ...existing,
          status: 'resolved',
          reply: event.reply,
          resolvedAt: event.resolvedAt,
        });
      }
    }
  }
  return [...byId.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

/** Létrehoz egy eszkaláció-tárat, ami a `<dir>/<filename>` JSONL-fájlba ír/olvas. */
export function createEscalationStore(
  options: EscalationStoreOptions = {},
): EscalationStore {
  const dir = options.dir ?? 'logs';
  const filename = options.filename ?? 'escalations.jsonl';
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);

  return {
    filePath,
    open(input: OpenEscalationInput): EscalationTicket {
      const event: OpenedEvent = {
        type: 'opened',
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        question: input.question,
        maxSimilarity: input.maxSimilarity,
        reason: 'low_grounding',
      };
      appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
      return {
        id: event.id,
        createdAt: event.createdAt,
        question: event.question,
        maxSimilarity: event.maxSimilarity,
        reason: event.reason,
        status: 'pending',
        reply: null,
        resolvedAt: null,
      };
    },
    resolve(id: string, reply: string): EscalationTicket {
      const current = foldEvents(readEvents(filePath)).find((t) => t.id === id);
      if (!current) {
        throw new Error(`Nincs ilyen eszkalációs jegy: ${id}`);
      }
      if (current.status === 'resolved') {
        throw new Error(`A jegy már le van zárva: ${id}`);
      }
      const event: ResolvedEvent = {
        type: 'resolved',
        id,
        resolvedAt: new Date().toISOString(),
        reply,
      };
      appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
      return {
        ...current,
        status: 'resolved',
        reply,
        resolvedAt: event.resolvedAt,
      };
    },
    list(): EscalationTicket[] {
      return foldEvents(readEvents(filePath));
    },
  };
}
