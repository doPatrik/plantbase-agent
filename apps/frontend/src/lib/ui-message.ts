import type { UIMessage } from 'ai';
import type { TraceEvent, ChatRoute, SourceRef } from '@plantbase/shared';

/** A backend `data-sources` partjának payloadja. */
export interface SourcesData {
  readonly route: ChatRoute;
  readonly sources: readonly SourceRef[];
}

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
