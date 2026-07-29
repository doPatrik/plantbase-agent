import type { TraceEvent } from '@plantbase/shared';
import type { PlantbaseUIMessage } from '../lib/ui-message';
import { MessageBubble } from './message-bubble';

interface MessageListProps {
  readonly messages: readonly PlantbaseUIMessage[];
  readonly traces: Readonly<Record<string, TraceEvent[]>>;
}

/** A beszélgetés üzenetlistája; az assistant-üzenetekhez trace-t köt id alapján. */
export function MessageList({ messages, traces }: MessageListProps) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          trace={traces[message.id]}
        />
      ))}
    </div>
  );
}
