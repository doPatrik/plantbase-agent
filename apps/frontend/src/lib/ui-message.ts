import type { UIMessage } from 'ai';
import { z } from 'zod';
import {
  chatRouteSchema,
  sourceRefSchema,
  type TraceEvent,
  type ChatRoute,
  type SourceRef,
} from '@plantbase/shared';

/** A backend `data-sources` partjának payloadja. */
export interface SourcesData {
  readonly route: ChatRoute;
  readonly sources: readonly SourceRef[];
}

/** Zod-séma a `data-sources` part payloadjának határon való validálásához. */
export const sourcesDataSchema = z.object({
  route: chatRouteSchema,
  sources: z.array(sourceRefSchema),
});

/**
 * A Plantbase chat UIMessage-típusa. A data partok:
 *  - `data-trace`  → part.data: TraceEvent  (transient; csak onData-ban)
 *  - `data-sources`→ part.data: SourcesData (perzisztens; message.parts-ban)
 */
export type PlantbaseUIMessage = UIMessage<
  never,
  {
    trace: TraceEvent;
    sources: SourcesData;
  }
>;
