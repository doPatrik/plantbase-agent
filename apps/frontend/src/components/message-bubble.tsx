import Markdown from 'react-markdown';
import type { TraceEvent } from '@plantbase/shared';
import type { PlantbaseUIMessage, SourcesData } from '../lib/ui-message';
import { Sources } from './sources';
import { TracePanel } from './trace-panel';

interface MessageBubbleProps {
  readonly message: PlantbaseUIMessage;
  readonly trace?: readonly TraceEvent[];
}

function textOf(message: PlantbaseUIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function sourcesOf(message: PlantbaseUIMessage): SourcesData | undefined {
  const part = message.parts.find((p) => p.type === 'data-sources');
  return part ? (part as { data: SourcesData }).data : undefined;
}

/** Egy chat-üzenet buborék: user = sima szöveg, assistant = markdown + források + trace. */
export function MessageBubble({ message, trace }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const text = textOf(message);
  const sources = sourcesOf(message);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{text}</p>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <Markdown>{text}</Markdown>
          </div>
        )}
        {!isUser && sources && <Sources sources={sources.sources} />}
        {!isUser && trace && <TracePanel trace={trace} />}
      </div>
    </div>
  );
}
