import { useRef, useState, type FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { traceEventSchema, type TraceEvent } from '@plantbase/shared';
import type { PlantbaseUIMessage } from '../lib/ui-message';
import { toChatMessages } from '../lib/to-chat-messages';
import { MessageList } from './message-list';
import { StatusIndicator } from './status-indicator';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

const transport = new DefaultChatTransport<PlantbaseUIMessage>({
  api: '/api/chat',
  prepareSendMessagesRequest: ({ messages }) => ({
    body: { messages: toChatMessages(messages) },
  }),
});

type ChatViewVariant = 'internal' | 'customer';

interface ChatViewProps {
  readonly variant?: ChatViewVariant;
}

const COPY: Record<
  ChatViewVariant,
  { title: string; placeholder: string; reset: string }
> = {
  internal: {
    title: 'Plantbase',
    placeholder: 'Kérdezz a növényekről…',
    reset: 'Új beszélgetés',
  },
  customer: {
    title: 'Plantbase — kérdezz a növényedről',
    placeholder: 'Pl. Milyen növényt vegyek egy sötét nappaliba?',
    reset: 'Új kérdés',
  },
};

/** A teljes chat-oldal: input, üzenetlista, élő státusz, hibabanner. */
export function ChatView({ variant = 'internal' }: ChatViewProps) {
  const copy = COPY[variant];
  const [input, setInput] = useState('');
  const [traces, setTraces] = useState<Record<string, TraceEvent[]>>({});
  const [liveTrace, setLiveTrace] = useState<TraceEvent[]>([]);
  const liveTraceRef = useRef<TraceEvent[]>([]);

  const { messages, sendMessage, status, error, setMessages, stop } =
    useChat<PlantbaseUIMessage>({
      transport,
      onData: (dataPart) => {
        if (dataPart.type === 'data-trace') {
          const parsed = traceEventSchema.safeParse(dataPart.data);
          if (parsed.success) {
            liveTraceRef.current = [...liveTraceRef.current, parsed.data];
            setLiveTrace(liveTraceRef.current);
          }
        }
      },
      onFinish: ({ message }) => {
        const captured = liveTraceRef.current;
        if (captured.length > 0) {
          setTraces((prev) => ({ ...prev, [message.id]: captured }));
        }
      },
    });

  const busy = status === 'submitted' || status === 'streaming';
  const showTrace = variant === 'internal';

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    liveTraceRef.current = [];
    setLiveTrace([]);
    sendMessage({ text });
    setInput('');
  }

  function handleReset() {
    stop();
    setMessages([]);
    setTraces({});
    liveTraceRef.current = [];
    setLiveTrace([]);
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{copy.title}</h1>
        <Button
          variant="ghost"
          size="default"
          onClick={handleReset}
          disabled={busy}
        >
          {copy.reset}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList messages={messages} traces={showTrace ? traces : {}} />
        {busy && (
          <div className="mt-4">
            {showTrace && <StatusIndicator trace={liveTrace} />}
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder={copy.placeholder}
          disabled={busy}
          rows={2}
        />
        <Button type="submit" disabled={busy || input.trim() === ''}>
          Küldés
        </Button>
      </form>
    </div>
  );
}
